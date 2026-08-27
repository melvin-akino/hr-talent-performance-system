import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { DbService, RequestContext } from '../db/db.service';

/**
 * Task metrics: what a person is measured on, defined without evaluating them.
 *
 * The client asked for two modes — "just load the metrics for the staff for
 * later use" and "load KPI and evaluate". This is the first. Everything here
 * defines; nothing here scores.
 *
 * Three things, in the order HCM works through them:
 *
 *   1. the CATALOGUE, a controlled vocabulary of task indicators
 *   2. a SCORECARD, a set of those indicators with points and the written
 *      criterion for each
 *   3. an ASSIGNMENT, effective-dated, saying who is measured on which
 */

export const createIndicator = z.object({
  name: z.string().trim().min(1).max(120),
  nature: z.enum(['administrative', 'field', 'technical']),
  description: z.string().trim().optional(),
});

export const createScorecard = z.object({
  name: z.string().trim().min(1).max(120),
  departmentId: z.string().uuid().nullish(),
  description: z.string().trim().optional(),
});

export const addScorecardItem = z.object({
  taskIndicatorId: z.string().uuid(),
  /**
   * Optional: defaults to the indicator's nature multiplier (1 / 1.5 / 2). Most
   * lines take the default, and the ones that do not are the interesting ones —
   * "Applicant Matching" is worth 14 because it is two points per division.
   */
  points: z.number().positive().optional(),
  criteria: z.string().trim().optional(),
  sequence: z.number().int().positive().optional(),
});

export const assignScorecard = z.object({
  employeeId: z.string().uuid(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

@Injectable()
export class MetricsService {
  constructor(private readonly db: DbService) {}

  private async orgOf(client: PoolClient, employeeId: string) {
    const res = await client.query<{ org_id: string }>(
      'SELECT org_id FROM employee WHERE id = $1', [employeeId]);
    const org = res.rows[0]?.org_id;
    if (!org) throw new NotFoundException('Requesting employee not found');
    return org;
  }

  // --- catalogue -----------------------------------------------------------

  async listIndicators(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT t.id, t.name, t.nature::text AS nature, t.description,
                t.is_active AS "isActive",
                app.task_nature_multiplier(t.nature) AS "defaultPoints",
                -- How widely a line is used: the number an HCM administrator
                -- wants before retiring or renaming one.
                (SELECT count(*)::int FROM scorecard_item i
                  WHERE i.task_indicator_id = t.id) AS "usedInLines"
           FROM task_indicator t
          ORDER BY t.nature, t.name`);
      return res.rows;
    });
  }

  async createIndicator(ctx: RequestContext, input: z.infer<typeof createIndicator>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await this.orgOf(client, ctx.employeeId);
      const res = await client.query<{ id: string }>(
        `INSERT INTO task_indicator (org_id, name, nature, description)
              VALUES ($1,$2,$3::task_nature,$4) RETURNING id`,
        [org, input.name, input.nature, input.description ?? null])
        .catch((err: { code?: string }) => {
          if (err.code === '23505') {
            throw new BadRequestException(
              `'${input.name}' is already in the catalogue. Two names for the same `
              + 'work make every comparison between departments meaningless.');
          }
          throw err;
        });
      const id = res.rows[0]?.id;
      if (!id) throw new BadRequestException('Not permitted to edit the catalogue');
      return { id };
    });
  }

  // --- scorecards ----------------------------------------------------------

  async listScorecards(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT s.id, s.name, s.description, s.is_active AS "isActive",
                s.department_id AS "departmentId", d.name AS "departmentName",
                (SELECT count(*)::int FROM scorecard_item i
                  WHERE i.scorecard_id = s.id) AS "lineCount",
                app.scorecard_target(s.id) AS "targetPoints",
                (SELECT count(*)::int FROM scorecard_assignment a
                  WHERE a.scorecard_id = s.id AND a.effective_to IS NULL) AS "holders"
           FROM scorecard s
           LEFT JOIN department d ON d.id = s.department_id
          ORDER BY s.name`);
      return res.rows;
    });
  }

  async getScorecard(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const head = await client.query(
        `SELECT s.id, s.name, s.description, s.department_id AS "departmentId",
                d.name AS "departmentName", app.scorecard_target(s.id) AS "targetPoints"
           FROM scorecard s
           LEFT JOIN department d ON d.id = s.department_id
          WHERE s.id = $1`, [id]);
      if (!head.rows[0]) throw new NotFoundException('Scorecard not found');

      const items = await client.query(
        `SELECT i.id, i.points, i.criteria, i.sequence,
                t.id AS "taskIndicatorId", t.name AS "indicatorName",
                t.nature::text AS nature
           FROM scorecard_item i
           JOIN task_indicator t ON t.id = i.task_indicator_id
          WHERE i.scorecard_id = $1
          ORDER BY i.sequence, t.name`, [id]);

      const holders = await client.query(
        `SELECT a.id, a.employee_id AS "employeeId",
                app.display_name(a.employee_id) AS name,
                a.effective_from::text AS "effectiveFrom",
                a.effective_to::text AS "effectiveTo"
           FROM scorecard_assignment a
          WHERE a.scorecard_id = $1
          ORDER BY a.effective_from DESC`, [id]);

      return { ...head.rows[0], items: items.rows, holders: holders.rows };
    });
  }

  async createScorecard(ctx: RequestContext, input: z.infer<typeof createScorecard>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await this.orgOf(client, ctx.employeeId);
      const res = await client.query<{ id: string }>(
        `INSERT INTO scorecard (org_id, name, department_id, description)
              VALUES ($1,$2,$3,$4) RETURNING id`,
        [org, input.name, input.departmentId ?? null, input.description ?? null])
        .catch((err: { code?: string }) => {
          if (err.code === '23505') {
            throw new BadRequestException(`A scorecard named '${input.name}' already exists`);
          }
          throw err;
        });
      const id = res.rows[0]?.id;
      if (!id) throw new BadRequestException('Not permitted to create scorecards');
      return { id };
    });
  }

  /**
   * Adds a line.
   *
   * Repeats of the same indicator are allowed on purpose. The client's own
   * scorecards rely on it — "Claims Processing" appears three times under Social
   * Insurances, once each for accident, maternity and sickness, a point apiece.
   * The line is the unit of measurement, not the indicator.
   */
  async addItem(ctx: RequestContext, scorecardId: string,
                input: z.infer<typeof addScorecardItem>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await this.orgOf(client, ctx.employeeId);
      const res = await client.query<{ id: string }>(
        `INSERT INTO scorecard_item (org_id, scorecard_id, task_indicator_id, points,
                                     criteria, sequence)
              SELECT $1, $2, t.id,
                     COALESCE($4::numeric, app.task_nature_multiplier(t.nature)),
                     $5,
                     COALESCE($6::smallint,
                              (SELECT COALESCE(max(sequence), 0) + 1
                                 FROM scorecard_item WHERE scorecard_id = $2))
                FROM task_indicator t
               WHERE t.id = $3
           RETURNING id`,
        [org, scorecardId, input.taskIndicatorId, input.points ?? null,
         input.criteria ?? null, input.sequence ?? null]);
      const id = res.rows[0]?.id;
      if (!id) {
        throw new BadRequestException(
          'Could not add the line — the indicator may not exist, or you may not be '
          + 'permitted to edit this scorecard.');
      }
      return { id };
    });
  }

  async removeItem(ctx: RequestContext, itemId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `DELETE FROM scorecard_item WHERE id = $1 RETURNING id`, [itemId]);
      if (!res.rows[0]) throw new NotFoundException('Line not found, or not permitted');
      return { id: res.rows[0].id };
    });
  }

  // --- assignment ----------------------------------------------------------

  /**
   * Puts someone on a scorecard from a date.
   *
   * Closes whatever they were on first: a person is measured on one scorecard at
   * a time, and the database enforces it. Doing the close here means moving
   * somebody is one call rather than two, and cannot half-succeed.
   */
  async assign(ctx: RequestContext, scorecardId: string,
               input: z.infer<typeof assignScorecard>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await this.orgOf(client, ctx.employeeId);
      const from = input.effectiveFrom ?? null;

      await client.query(
        `UPDATE scorecard_assignment
            SET effective_to = COALESCE($2::date, CURRENT_DATE)
          WHERE employee_id = $1 AND effective_to IS NULL
            AND effective_from < COALESCE($2::date, CURRENT_DATE)`,
        [input.employeeId, from]);

      const res = await client.query<{ id: string }>(
        `INSERT INTO scorecard_assignment (org_id, scorecard_id, employee_id, effective_from)
              VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE)) RETURNING id`,
        [org, scorecardId, input.employeeId, from])
        .catch((err: { code?: string; message?: string }) => {
          if (err.code === '23P01') {
            throw new BadRequestException(
              'That person is already on a scorecard covering this period. Close the '
              + 'existing one first, or start this one later.');
          }
          throw err;
        });

      const id = res.rows[0]?.id;
      if (!id) throw new BadRequestException('Not permitted to assign scorecards');
      return { id };
    });
  }

  /** What one person is measured on, as of a date. */
  async forEmployee(ctx: RequestContext, employeeId: string, asOf?: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT s.id, s.name, app.scorecard_target(s.id) AS "targetPoints",
                a.effective_from::text AS "effectiveFrom"
           FROM scorecard_assignment a
           JOIN scorecard s ON s.id = a.scorecard_id
          WHERE a.employee_id = $1
            AND a.effective_from <= COALESCE($2::date, CURRENT_DATE)
            AND (a.effective_to IS NULL OR COALESCE($2::date, CURRENT_DATE) < a.effective_to)`,
        [employeeId, asOf ?? null]);

      // Not an error: most people have no scorecard yet, and "nothing is loaded
      // for this person" is exactly what HCM needs to see while loading them.
      if (!res.rows[0]) return null;

      const items = await client.query(
        `SELECT i.points, i.criteria, t.name AS "indicatorName", t.nature::text AS nature
           FROM scorecard_item i
           JOIN task_indicator t ON t.id = i.task_indicator_id
          WHERE i.scorecard_id = $1
          ORDER BY i.sequence, t.name`, [res.rows[0].id]);

      return { ...res.rows[0], items: items.rows };
    });
  }
}
