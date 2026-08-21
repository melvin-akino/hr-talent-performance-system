import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';

export const createFramework = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  competencies: z.array(z.object({
    code: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
    category: z.string().trim().optional(),
    levels: z.array(z.object({
      levelNo: z.number().int().positive(),
      label: z.string().trim().min(1),
      behavioralIndicator: z.string().trim().optional(),
    })).min(2, 'A competency needs at least two levels to be assessable'),
  })).min(1),
});

export const mapPosition = z.object({
  positionId: z.string().uuid(),
  requirements: z.array(z.object({
    competencyId: z.string().uuid(),
    requiredLevel: z.number().int().positive(),
    weight: z.number().positive().max(100).optional(),
  })).min(1),
});

export const assessCompetencies = z.object({
  subjectEmployeeId: z.string().uuid(),
  reviewInstanceId: z.string().uuid().optional(),
  assessedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assessments: z.array(z.object({
    competencyId: z.string().uuid(),
    assessedLevel: z.number().int().positive(),
    notes: z.string().trim().optional(),
  })).min(1),
});

/**
 * Competency frameworks, position mapping, assessment, and gap analysis.
 *
 * A published framework is immutable (migration 0016) — every "edit" is a new
 * version. Assessments are append-only, so a re-assessment adds a row and the
 * trajectory over time stays visible rather than being overwritten.
 */
@Injectable()
export class CompetenciesService {
  constructor(private readonly db: DbService) {}

  private async orgOf(ctx: RequestContext, client: import('pg').PoolClient): Promise<string> {
    const res = await client.query<{ org_id: string }>(
      'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
    const org = res.rows[0]?.org_id;
    if (!org) throw new NotFoundException('Requesting employee not found');
    return org;
  }

  // --- Frameworks ----------------------------------------------------------

  async listFrameworks(ctx: RequestContext, includeRetired = false) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT f.id, f.code, f.version, f.name, f.description,
                f.is_active AS "isActive", f.published_at::text AS "publishedAt",
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'id', c.id, 'code', c.code, 'name', c.name,
                           'category', c.category, 'description', c.description,
                           'levels', (
                             SELECT COALESCE(json_agg(json_build_object(
                                      'levelNo', l.level_no, 'label', l.label,
                                      'behavioralIndicator', l.behavioral_indicator)
                                    ORDER BY l.level_no), '[]')
                               FROM competency_level l WHERE l.competency_id = c.id))
                         ORDER BY c.sequence)
                    FROM competency c WHERE c.framework_id = f.id
                ), '[]') AS competencies
           FROM competency_framework f
          WHERE ($1::boolean OR f.is_active)
          ORDER BY f.code, f.version DESC`,
        [includeRetired]);
      return res.rows;
    });
  }

  /**
   * Create a draft framework with its competencies and levels.
   *
   * Created unpublished: the immutability trigger blocks edits once published,
   * so a framework must be reviewable before it is frozen.
   */
  async createFramework(ctx: RequestContext, input: z.infer<typeof createFramework>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await this.orgOf(ctx, client);

      const existing = await client.query<{ version: number }>(
        `SELECT version FROM competency_framework
          WHERE org_id = $1 AND code = $2 ORDER BY version DESC LIMIT 1`,
        [org, input.code]);
      const version = (existing.rows[0]?.version ?? 0) + 1;

      const f = await client.query<{ id: string }>(
        `INSERT INTO competency_framework (org_id, code, version, name, description)
              VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [org, input.code, version, input.name, input.description ?? null]);
      const frameworkId = f.rows[0]?.id;
      if (!frameworkId) {
        throw new ForbiddenException('Not permitted to create competency frameworks');
      }

      let sequence = 1;
      for (const c of input.competencies) {
        const comp = await client.query<{ id: string }>(
          `INSERT INTO competency (framework_id, code, name, description, category, sequence)
                VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [frameworkId, c.code, c.name, c.description ?? null,
           c.category ?? null, sequence++]);
        const competencyId = comp.rows[0]!.id;

        for (const l of c.levels) {
          await client.query(
            `INSERT INTO competency_level (competency_id, level_no, label,
                                           behavioral_indicator)
                  VALUES ($1,$2,$3,$4)`,
            [competencyId, l.levelNo, l.label, l.behavioralIndicator ?? null]);
        }
      }

      return { id: frameworkId, version };
    });
  }

  /**
   * Publish a draft, retiring the previous active version.
   *
   * Atomic: the partial unique index permits one active version per code, so a
   * non-atomic swap would either collide or leave the code with none.
   */
  async publishFramework(ctx: RequestContext, frameworkId: string) {
    return this.db.withContext(ctx, async (client) => {
      const target = await client.query<{ org_id: string; code: string }>(
        `SELECT org_id, code FROM competency_framework WHERE id = $1`, [frameworkId]);
      const row = target.rows[0];
      if (!row) throw new NotFoundException('Framework not found');

      const hasCompetencies = await client.query(
        `SELECT 1 FROM competency WHERE framework_id = $1 LIMIT 1`, [frameworkId]);
      if (hasCompetencies.rowCount === 0) {
        throw new BadRequestException('Cannot publish a framework with no competencies');
      }

      await client.query(
        `UPDATE competency_framework SET is_active = FALSE
          WHERE org_id = $1 AND code = $2 AND is_active`, [row.org_id, row.code]);

      const res = await client.query(
        `UPDATE competency_framework
            SET is_active = TRUE, published_at = COALESCE(published_at, now())
          WHERE id = $1 RETURNING id`, [frameworkId])
        .catch((err: { code?: string; message?: string }) => {
          if (err.code === 'P0001') throw new BadRequestException(err.message);
          throw err;
        });
      if (!res.rows[0]) throw new ForbiddenException('Not permitted to publish frameworks');
      return { id: frameworkId, published: true };
    });
  }

  // --- Position mapping ----------------------------------------------------

  async mapPosition(ctx: RequestContext, input: z.infer<typeof mapPosition>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await this.orgOf(ctx, client);
      let written = 0;

      for (const r of input.requirements) {
        const res = await client.query(
          `INSERT INTO position_competency_map (org_id, position_id, competency_id,
                                                required_level, weight)
                VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (position_id, competency_id)
           DO UPDATE SET required_level = EXCLUDED.required_level,
                         weight = EXCLUDED.weight
             RETURNING id`,
          [org, input.positionId, r.competencyId, r.requiredLevel, r.weight ?? null])
          .catch((err: { code?: string; message?: string }) => {
            if (err.code === 'P0001') throw new BadRequestException(err.message);
            throw err;
          });
        written += res.rowCount ?? 0;
      }

      if (written === 0) {
        throw new ForbiddenException('Not permitted to map competencies to positions');
      }
      return { mapped: written };
    });
  }

  async positionRequirements(ctx: RequestContext, positionId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT m.id, m.competency_id AS "competencyId", c.code, c.name, c.category,
                m.required_level AS "requiredLevel", m.weight::text AS weight,
                (SELECT l.label FROM competency_level l
                  WHERE l.competency_id = c.id AND l.level_no = m.required_level)
                  AS "requiredLabel"
           FROM position_competency_map m
           JOIN competency c ON c.id = m.competency_id
          WHERE m.position_id = $1
          ORDER BY c.category NULLS LAST, c.name`,
        [positionId]);
      return res.rows;
    });
  }

  // --- Assessment ----------------------------------------------------------

  async assess(ctx: RequestContext, input: z.infer<typeof assessCompetencies>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await this.orgOf(ctx, client);
      if (input.subjectEmployeeId === ctx.employeeId) {
        throw new BadRequestException('You cannot assess your own competencies');
      }

      const ids: string[] = [];
      for (const a of input.assessments) {
        const res = await client.query<{ id: string }>(
          `INSERT INTO competency_assessment (org_id, subject_employee_id, competency_id,
                                              assessed_level, assessed_by, notes,
                                              review_instance_id, assessed_on, created_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),$5)
             RETURNING id`,
          [org, input.subjectEmployeeId, a.competencyId, a.assessedLevel,
           ctx.employeeId, a.notes ?? null, input.reviewInstanceId ?? null,
           input.assessedOn ?? null])
          .catch((err: { code?: string; message?: string }) => {
            if (err.code === 'P0001' || err.code === '23514') {
              throw new BadRequestException(err.message);
            }
            throw err;
          });
        if (!res.rows[0]) {
          throw new ForbiddenException(
            'Not permitted to assess competencies for this employee');
        }
        ids.push(res.rows[0].id);
      }
      return { recorded: ids.length };
    });
  }

  async assessmentHistory(ctx: RequestContext, employeeId: string, competencyId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT a.id, a.competency_id AS "competencyId", c.name AS "competencyName",
                a.assessed_level AS "assessedLevel", a.framework_version AS "frameworkVersion",
                a.notes, a.assessed_on::text AS "assessedOn",
                app.display_name(a.assessed_by) AS "assessedBy",
                a.review_instance_id AS "reviewInstanceId"
           FROM competency_assessment a
           JOIN competency c ON c.id = a.competency_id
          WHERE a.subject_employee_id = $1
            AND ($2::uuid IS NULL OR a.competency_id = $2)
          ORDER BY a.assessed_on DESC, a.created_at DESC`,
        [employeeId, competencyId ?? null]);
      return res.rows;
    });
  }

  // --- Gap analysis --------------------------------------------------------

  /** Required vs latest assessed, for one employee's current position. */
  async gaps(ctx: RequestContext, employeeId: string, asOf?: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT g.competency_id   AS "competencyId",
                g.competency_code AS "code",
                g.competency_name AS "name",
                g.category,
                g.required_level  AS "requiredLevel",
                g.assessed_level  AS "assessedLevel",
                g.gap,
                g.weight::text    AS weight,
                g.assessed_on::text AS "assessedOn"
           FROM app.competency_gaps($1, COALESCE($2::date, CURRENT_DATE)) g`,
        [employeeId, asOf ?? null]);

      const rows = res.rows as {
        gap: number | null; requiredLevel: number; assessedLevel: number | null;
      }[];

      return {
        competencies: res.rows,
        summary: {
          mapped: rows.length,
          // "Never assessed" is deliberately its own bucket: it is a process
          // failure, not a performance finding, and lumping it with "below
          // required" would misrepresent people nobody has reviewed.
          notAssessed: rows.filter((r) => r.assessedLevel === null).length,
          meetingOrAbove: rows.filter((r) => r.gap !== null && r.gap >= 0).length,
          below: rows.filter((r) => r.gap !== null && r.gap < 0).length,
        },
      };
    });
  }

  /**
   * Gap report across a job family — the Phase 4 exit criterion.
   *
   * Aggregates per competency across everyone the caller may see holding
   * positions in that family, which is how HR spots a systemic capability hole
   * rather than an individual one.
   */
  async jobFamilyGaps(ctx: RequestContext, jobFamily: string, asOf?: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `WITH people AS (
           SELECT e.id AS employee_id, p.job_family
             FROM employee e
             JOIN employment em
               ON em.employee_id = e.id
              AND em.effective_from <= COALESCE($2::date, CURRENT_DATE)
              AND (em.effective_to IS NULL
                   OR COALESCE($2::date, CURRENT_DATE) < em.effective_to)
             JOIN position p ON p.id = em.position_id
            WHERE p.job_family = $1
              AND e.deleted_at IS NULL AND e.status = 'active'
         ),
         gaps AS (
           SELECT pe.employee_id, g.*
             FROM people pe
             CROSS JOIN LATERAL app.competency_gaps(
               pe.employee_id, COALESCE($2::date, CURRENT_DATE)) g
         )
         SELECT competency_code AS "code",
                competency_name AS "name",
                category,
                MAX(required_level)                                  AS "requiredLevel",
                COUNT(*)::int                                        AS "peopleMapped",
                COUNT(*) FILTER (WHERE assessed_level IS NULL)::int   AS "notAssessed",
                COUNT(*) FILTER (WHERE gap IS NOT NULL AND gap < 0)::int AS "below",
                COUNT(*) FILTER (WHERE gap IS NOT NULL AND gap >= 0)::int AS "meeting",
                ROUND(AVG(assessed_level) FILTER (WHERE assessed_level IS NOT NULL), 2)::text
                                                                     AS "averageAssessed"
           FROM gaps
          GROUP BY competency_code, competency_name, category
          ORDER BY COUNT(*) FILTER (WHERE gap IS NOT NULL AND gap < 0) DESC,
                   competency_name`,
        [jobFamily, asOf ?? null]);
      return res.rows;
    });
  }

  async jobFamilies(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT DISTINCT job_family AS "jobFamily"
           FROM position WHERE job_family IS NOT NULL ORDER BY 1`);
      return res.rows;
    });
  }
}
