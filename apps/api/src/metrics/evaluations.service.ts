import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';

/**
 * Evaluating somebody against the scorecard they were loaded onto.
 *
 * The client's second option, "load KPI and evaluate". An evaluation is opened
 * for a period, each line is given the points actually earned, and submitting it
 * totals the lines and freezes them.
 *
 * Two rules are enforced in the database rather than here, because they are the
 * ones that matter and code paths multiply:
 *
 *   - the lines are a SNAPSHOT, so editing a scorecard cannot move a score that
 *     has already been given (0033);
 *   - a submitted evaluation is frozen — the RLS UPDATE policy on the lines has
 *     `state = 'draft'` in its USING clause.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const openEvaluation = z.object({
  employeeId: z.string().uuid(),
  periodStart: isoDate,
  periodEnd: isoDate,
});

export const scoreLine = z.object({
  /**
   * null means "unassessed", which is not the same as 0. Submitting refuses
   * while any line is still null, so the distinction has to survive the wire.
   */
  pointsAwarded: z.number().nonnegative().nullable(),
  note: z.string().trim().max(2000).optional(),
});

export const scoreLines = z.object({
  lines: z.record(z.string().uuid(), scoreLine).refine(
    (v) => Object.keys(v).length > 0, 'No lines given'),
});

@Injectable()
export class EvaluationsService {
  constructor(private readonly db: DbService) {}

  /** Evaluations the caller can see — theirs to do, or theirs to read. */
  async list(ctx: RequestContext, employeeId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT e.id, e.employee_id AS "employeeId",
                app.display_name(e.employee_id) AS "employeeName",
                e.scorecard_id AS "scorecardId", s.name AS "scorecardName",
                e.state::text AS state,
                e.period_start::text AS "periodStart",
                e.period_end::text AS "periodEnd",
                e.target_points AS "targetPoints",
                e.awarded_points AS "awardedPoints",
                e.evaluator_employee_id AS "evaluatorId",
                app.display_name(e.evaluator_employee_id) AS "evaluatorName",
                e.submitted_at AS "submittedAt",
                (SELECT count(*)::int FROM scorecard_evaluation_line l
                  WHERE l.evaluation_id = e.id) AS "lineCount",
                -- How much is left to do. The evaluator's real question while a
                -- draft is open, and it cannot be derived from the total.
                (SELECT count(*)::int FROM scorecard_evaluation_line l
                  WHERE l.evaluation_id = e.id AND l.points_awarded IS NULL)
                  AS "unassessed"
           FROM scorecard_evaluation e
           JOIN scorecard s ON s.id = e.scorecard_id
          WHERE ($1::uuid IS NULL OR e.employee_id = $1)
          ORDER BY e.period_end DESC, "employeeName"`,
        [employeeId ?? null]);
      return res.rows;
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const head = await client.query(
        `SELECT e.id, e.employee_id AS "employeeId",
                app.display_name(e.employee_id) AS "employeeName",
                s.name AS "scorecardName", e.state::text AS state,
                e.period_start::text AS "periodStart",
                e.period_end::text AS "periodEnd",
                e.target_points AS "targetPoints",
                e.awarded_points AS "awardedPoints",
                e.note,
                app.display_name(e.evaluator_employee_id) AS "evaluatorName",
                e.evaluator_employee_id AS "evaluatorId",
                e.submitted_at AS "submittedAt",
                e.acknowledged_at AS "acknowledgedAt"
           FROM scorecard_evaluation e
           JOIN scorecard s ON s.id = e.scorecard_id
          WHERE e.id = $1`, [id]);
      if (!head.rows[0]) throw new NotFoundException('Evaluation not found');

      const lines = await client.query(
        `SELECT l.id, l.indicator_name AS "indicatorName", l.criteria,
                l.nature::text AS nature,
                l.points_available AS "pointsAvailable",
                l.points_awarded AS "pointsAwarded",
                l.note, l.sequence
           FROM scorecard_evaluation_line l
          WHERE l.evaluation_id = $1
          ORDER BY l.sequence`, [id]);

      return { ...head.rows[0], lines: lines.rows };
    });
  }

  /**
   * Opens an evaluation, snapshotting the scorecard the person held at the end
   * of the period.
   */
  async open(ctx: RequestContext, input: z.infer<typeof openEvaluation>) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `SELECT app.open_scorecard_evaluation($1, $2::date, $3::date, $4) AS id`,
        [input.employeeId, input.periodStart, input.periodEnd, ctx.employeeId])
        .catch((err: { code?: string; message?: string; hint?: string }) => {
          if (err.code === '23505') {
            throw new BadRequestException(
              'That person already has an evaluation for this exact period.');
          }
          // The function raises with a written reason — no scorecard assigned,
          // an empty scorecard, a period the wrong way round. Passing it
          // through is better than replacing it with a generic failure.
          if (err.code === 'P0001') {
            throw new BadRequestException(
              [err.message, err.hint].filter(Boolean).join(' '));
          }
          throw err;
        });

      const id = res.rows[0]?.id;
      if (!id) throw new BadRequestException('Not permitted to evaluate that person');
      return { id };
    });
  }

  /**
   * Records the points earned on one or more lines.
   *
   * Written as a single statement over a values list rather than a loop: a
   * half-applied set of scores is the sort of thing that produces a total nobody
   * can explain.
   */
  async score(ctx: RequestContext, evaluationId: string,
              input: z.infer<typeof scoreLines>) {
    return this.db.withContext(ctx, async (client) => {
      await this.assertDraft(client, evaluationId);

      const ids = Object.keys(input.lines);
      const points = ids.map((id) => input.lines[id]!.pointsAwarded);
      const notes = ids.map((id) => input.lines[id]!.note ?? null);

      const res = await client.query<{ id: string }>(
        `UPDATE scorecard_evaluation_line l
            SET points_awarded = v.points, note = v.note
           FROM unnest($2::uuid[], $3::numeric[], $4::text[]) AS v(id, points, note)
          WHERE l.id = v.id AND l.evaluation_id = $1
        RETURNING l.id`,
        [evaluationId, ids, points, notes])
        .catch((err: { code?: string; constraint?: string }) => {
          if (err.constraint === 'scorecard_evaluation_line_within_available') {
            throw new BadRequestException(
              'A line was given more points than it is worth. The points on a line '
              + 'are its ceiling, not a starting figure.');
          }
          throw err;
        });

      if (res.rows.length !== ids.length) {
        throw new BadRequestException(
          `Scored ${res.rows.length} of ${ids.length} lines — the rest do not belong `
          + 'to this evaluation, or it is no longer a draft.');
      }
      return { scored: res.rows.length };
    });
  }

  /** Totals the lines and freezes them. */
  async submit(ctx: RequestContext, evaluationId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ total: string }>(
        `SELECT app.submit_scorecard_evaluation($1) AS total`, [evaluationId])
        .catch((err: { code?: string; message?: string; hint?: string }) => {
          if (err.code === 'P0001') {
            throw new BadRequestException(
              [err.message, err.hint].filter(Boolean).join(' '));
          }
          throw err;
        });
      return { awardedPoints: res.rows[0]!.total };
    });
  }

  /**
   * The subject's acknowledgement — the only write they hold on their own
   * evaluation, and the reason the RLS policy carves out an exception for them.
   */
  async acknowledge(ctx: RequestContext, evaluationId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `UPDATE scorecard_evaluation
            SET state = 'acknowledged', acknowledged_at = now()
          WHERE id = $1 AND employee_id = $2 AND state = 'submitted'
        RETURNING id`, [evaluationId, ctx.employeeId]);
      if (!res.rows[0]) {
        throw new BadRequestException(
          'Only the person evaluated can acknowledge it, and only once it has been '
          + 'submitted.');
      }
      return { id: res.rows[0].id };
    });
  }

  private async assertDraft(client: PoolClient, evaluationId: string) {
    const res = await client.query<{ state: string }>(
      `SELECT state::text AS state FROM scorecard_evaluation WHERE id = $1`,
      [evaluationId]);
    const state = res.rows[0]?.state;
    if (!state) throw new NotFoundException('Evaluation not found');
    if (state !== 'draft') {
      throw new BadRequestException(
        'That evaluation has been submitted. Scores are fixed once submitted — a '
        + 'correction has to be a new evaluation, so the change stays visible.');
    }
  }
}
