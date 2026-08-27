import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';
import { assertScoringValid, fieldPoints, scoringConfig } from './scoring';

/** A form field. `goal_review` renders the subject's Phase 1 goals inline. */
export const formField = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]+$/, 'lowercase, digits and underscore only'),
  label: z.string().trim().min(1),
  type: z.enum([
    'rating', 'text', 'textarea', 'select', 'multiselect',
    'number', 'boolean',
    // Renders the subject's goals / competency requirements inline. Neither
    // stores its answer in form_response: goal results come from Phase 1, and
    // competency ratings are written to competency_assessment so they feed the
    // gap report rather than being buried in a form blob.
    'goal_review', 'competency_review',
  ]),
  required: z.boolean().default(false),
  // What this line is worth. A single number scores everyone the same; a map
  // keyed by classification carries the client's two point columns (Admin vs
  // Technical/Ops/Field) on one instrument. See scoring.ts.
  points: fieldPoints.optional(),
  helpText: z.string().trim().optional(),
  options: z.array(z.string()).optional(),
  maxLength: z.number().int().positive().optional(),
});

export const formSchema = z.object({
  // Present only on scored forms. Its absence is what makes every form built
  // before points existed still valid.
  scoring: scoringConfig.optional(),
  sections: z.array(z.object({
    key: z.string().trim().min(1),
    title: z.string().trim().min(1),
    description: z.string().trim().optional(),
    fields: z.array(formField).min(1),
  })).min(1),
});

export const createTemplate = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  schema: formSchema,
  ratingScaleId: z.string().uuid().optional(),
});

export const createRatingScale = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  points: z.array(z.object({
    value: z.number(),
    label: z.string().trim().min(1),
    description: z.string().trim().optional(),
  })).min(2, 'A rating scale needs at least two points'),
});

export const assignTemplate = z.object({
  formTemplateId: z.string().uuid(),
  employmentTypeId: z.string().uuid().optional(),
  appRoleId: z.string().uuid().optional(),
});

/**
 * Rating scales and form templates.
 *
 * Published versions are immutable (enforced by trigger in migration 0012).
 * Every "edit" here is really a new version.
 */
@Injectable()
export class FormsService {
  constructor(private readonly db: DbService) {}

  private async orgOf(ctx: RequestContext, client: import('pg').PoolClient): Promise<string> {
    const res = await client.query<{ org_id: string }>(
      'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
    const org = res.rows[0]?.org_id;
    if (!org) throw new NotFoundException('Requesting employee not found');
    return org;
  }

  // --- Rating scales -------------------------------------------------------

  async listScales(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT s.id, s.code, s.version, s.name, s.description,
                s.is_active AS "isActive",
                COALESCE(json_agg(
                  json_build_object('value', p.value, 'label', p.label,
                                    'description', p.description)
                  ORDER BY p.sequence
                ) FILTER (WHERE p.id IS NOT NULL), '[]') AS points
           FROM rating_scale s
           LEFT JOIN rating_scale_point p ON p.rating_scale_id = s.id
          GROUP BY s.id
          ORDER BY s.code, s.version DESC`);
      return res.rows;
    });
  }

  async createScale(ctx: RequestContext, input: z.infer<typeof createRatingScale>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await this.orgOf(ctx, client);
      const scale = await client.query<{ id: string }>(
        `INSERT INTO rating_scale (org_id, code, version, name, description, published_at)
              VALUES ($1,$2,1,$3,$4,now()) RETURNING id`,
        [org, input.code, input.name, input.description ?? null],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') {
          throw new BadRequestException(`A rating scale '${input.code}' already exists`);
        }
        throw err;
      });

      const id = scale.rows[0]?.id;
      if (!id) throw new BadRequestException('Not permitted to create rating scales');

      let sequence = 1;
      for (const p of input.points) {
        await client.query(
          `INSERT INTO rating_scale_point (rating_scale_id, sequence, value, label, description)
                VALUES ($1,$2,$3,$4,$5)`,
          [id, sequence++, p.value, p.label, p.description ?? null]);
      }
      return { id };
    });
  }

  // --- Templates -----------------------------------------------------------

  async listTemplates(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT t.id, t.code, t.name, t.description, t.is_active AS "isActive",
                v.id AS "activeVersionId", v.version AS "activeVersion",
                v.rating_scale_id AS "ratingScaleId",
                v.published_at::text AS "publishedAt",
                (SELECT count(*)::int FROM form_version fv
                  WHERE fv.form_template_id = t.id) AS "versionCount"
           FROM form_template t
           LEFT JOIN form_version v ON v.form_template_id = t.id AND v.is_active
          ORDER BY t.code`);
      return res.rows;
    });
  }

  async getVersion(ctx: RequestContext, versionId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT v.id, v.version, v.schema_json AS schema,
                v.published_at::text AS "publishedAt",
                t.code AS "templateCode", t.name AS "templateName",
                s.id AS "ratingScaleId", s.name AS "ratingScaleName",
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'value', p.value, 'label', p.label,
                           'description', p.description) ORDER BY p.sequence)
                    FROM rating_scale_point p WHERE p.rating_scale_id = s.id
                ), '[]') AS "ratingPoints"
           FROM form_version v
           JOIN form_template t ON t.id = v.form_template_id
           LEFT JOIN rating_scale s ON s.id = v.rating_scale_id
          WHERE v.id = $1`, [versionId]);
      if (!res.rows[0]) throw new NotFoundException('Form version not found');
      return res.rows[0];
    });
  }

  async createTemplate(ctx: RequestContext, input: z.infer<typeof createTemplate>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await this.orgOf(ctx, client);
      this.assertUniqueKeys(input.schema);
      assertScoringValid(input.schema);

      const t = await client.query<{ id: string }>(
        `INSERT INTO form_template (org_id, code, name, description)
              VALUES ($1,$2,$3,$4) RETURNING id`,
        [org, input.code, input.name, input.description ?? null],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') {
          throw new BadRequestException(`A template '${input.code}' already exists`);
        }
        throw err;
      });

      const templateId = t.rows[0]?.id;
      if (!templateId) throw new BadRequestException('Not permitted to create templates');

      const v = await client.query<{ id: string }>(
        `INSERT INTO form_version (form_template_id, version, schema_json,
                                   rating_scale_id, published_at, is_active)
              VALUES ($1,1,$2,$3,now(),TRUE) RETURNING id`,
        [templateId, JSON.stringify(input.schema), input.ratingScaleId ?? null]);

      return { templateId, versionId: v.rows[0]?.id };
    });
  }

  /**
   * Publish a new version, retiring the current one.
   *
   * Atomic for the same reason as KPI versioning: the partial unique index
   * allows only one active version per template, so a non-atomic swap would
   * either collide or leave the template with no active version.
   */
  async publishVersion(
    ctx: RequestContext, templateId: string,
    input: { schema: z.infer<typeof formSchema>; ratingScaleId?: string | undefined },
  ) {
    return this.db.withContext(ctx, async (client) => {
      this.assertUniqueKeys(input.schema);
      assertScoringValid(input.schema);

      const current = await client.query<{ version: number }>(
        `SELECT version FROM form_version
          WHERE form_template_id = $1 ORDER BY version DESC LIMIT 1`, [templateId]);
      if (!current.rows[0]) throw new NotFoundException('Template not found');

      const retired = await client.query(
        `UPDATE form_version SET is_active = FALSE
          WHERE form_template_id = $1 AND is_active RETURNING id`, [templateId]);
      if (!retired.rows[0]) {
        throw new BadRequestException('Not permitted to modify form templates');
      }

      const next = await client.query<{ id: string; version: number }>(
        `INSERT INTO form_version (form_template_id, version, schema_json,
                                   rating_scale_id, published_at, is_active)
              VALUES ($1,$2,$3,$4,now(),TRUE) RETURNING id, version`,
        [templateId, current.rows[0].version + 1, JSON.stringify(input.schema),
         input.ratingScaleId ?? null]);
      return next.rows[0];
    });
  }

  async assign(ctx: RequestContext, input: z.infer<typeof assignTemplate>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await this.orgOf(ctx, client);
      const res = await client.query<{ id: string }>(
        `INSERT INTO form_template_assignment (org_id, form_template_id,
                                               employment_type_id, app_role_id)
              VALUES ($1,$2,$3,$4) RETURNING id`,
        [org, input.formTemplateId, input.employmentTypeId ?? null,
         input.appRoleId ?? null],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') {
          throw new BadRequestException(
            'Another template is already assigned to that combination. ' +
            'Two templates matching the same employee would make resolution ' +
            'nondeterministic.');
        }
        throw err;
      });
      return { id: res.rows[0]?.id };
    });
  }

  async listAssignments(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT a.id, t.code AS "templateCode", t.name AS "templateName",
                et.code AS "employmentType", r.code AS "role"
           FROM form_template_assignment a
           JOIN form_template t ON t.id = a.form_template_id
           LEFT JOIN employment_type et ON et.id = a.employment_type_id
           LEFT JOIN app_role r ON r.id = a.app_role_id
          ORDER BY t.code`);
      return res.rows;
    });
  }

  /** Which form an employee would get today. Used to preview configuration. */
  async resolveFor(ctx: RequestContext, employeeId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string | null }>(
        'SELECT app.resolve_form_version($1) AS id', [employeeId]);
      const id = res.rows[0]?.id;
      if (!id) {
        throw new NotFoundException(
          'No form template matches this employee. Add an organisation-wide ' +
          'default assignment so nobody is left without a form.');
      }
      return { formVersionId: id };
    });
  }

  /**
   * Field keys must be unique across the WHOLE form, not just per section --
   * responses are stored keyed by field_key against the instance, so a
   * duplicate key would silently overwrite another section's answer.
   */
  private assertUniqueKeys(schema: z.infer<typeof formSchema>): void {
    const seen = new Set<string>();
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (seen.has(field.key)) {
          throw new BadRequestException(
            `Duplicate field key '${field.key}'. Keys must be unique across the entire form.`);
        }
        seen.add(field.key);
      }
    }
  }
}
