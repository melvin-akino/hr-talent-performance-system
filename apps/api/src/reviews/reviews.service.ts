import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

export const createCycle = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  goalPeriodId: z.string().uuid().optional(),
  opensOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phases: z.array(z.object({
    phaseType: z.enum(['self', 'supervisor', 'calibration', 'signoff']),
    opensOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1),
});

export const saveResponses = z.object({
  responses: z.record(z.string(), z.unknown()),
  overallRating: z.number().optional(),
});

/**
 * Review cycles.
 *
 * Confidentiality is enforced by RLS (migration 0014): an employee cannot read
 * a supervisor review of themselves until it is released. Nothing in this file
 * should re-implement that, and nothing should work around it.
 */
@Injectable()
export class ReviewsService {
  constructor(private readonly db: DbService) {}

  async createCycle(ctx: RequestContext, input: z.infer<typeof createCycle>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Requesting employee not found');

      const cycle = await client.query<{ id: string }>(
        `INSERT INTO review_cycle (org_id, goal_period_id, name, description,
                                   opens_on, closes_on)
              VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [orgId, input.goalPeriodId ?? null, input.name, input.description ?? null,
         input.opensOn, input.closesOn]);
      const cycleId = cycle.rows[0]?.id;
      if (!cycleId) throw new ForbiddenException('Not permitted to create review cycles');

      let sequence = 1;
      for (const p of input.phases) {
        await client.query(
          `INSERT INTO review_cycle_phase (review_cycle_id, phase_type, sequence,
                                           opens_on, closes_on)
                VALUES ($1,$2::review_phase_type,$3,$4,$5)`,
          [cycleId, p.phaseType, sequence++, p.opensOn, p.closesOn]);
      }
      return { id: cycleId };
    });
  }

  async listCycles(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT c.id, c.name, c.description, c.state::text AS state,
                c.opens_on::text AS "opensOn", c.closes_on::text AS "closesOn",
                c.goal_period_id AS "goalPeriodId",
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'phaseType', p.phase_type, 'opensOn', p.opens_on,
                    'closesOn', p.closes_on) ORDER BY p.sequence)
                    FROM review_cycle_phase p WHERE p.review_cycle_id = c.id
                ), '[]') AS phases
           FROM review_cycle c
          ORDER BY c.opens_on DESC`);
      return res.rows;
    });
  }

  /**
   * Generate review instances for everyone in scope.
   *
   * Creates a self-review and a supervisor review per subject. Idempotent:
   * re-running after adding staff tops up rather than duplicating, because
   * launching a cycle twice by accident must not double everyone's workload.
   *
   * Subjects are limited by RLS to employees the caller may write reviews for.
   */
  async generateInstances(ctx: RequestContext, cycleId: string, asOf?: string) {
    return this.db.withContext(ctx, async (client) => {
      const cycle = await client.query<{ org_id: string }>(
        'SELECT org_id FROM review_cycle WHERE id = $1', [cycleId]);
      if (!cycle.rows[0]) throw new NotFoundException('Review cycle not found');

      const date = asOf ?? new Date().toISOString().slice(0, 10);

      // Eligible subjects: active employees whose employment type is marked
      // review-eligible. Consultants and interns are commonly excluded, and
      // that flag already exists on employment_type from Phase 0.
      const subjects = await client.query<{
        employee_id: string; supervisor_id: string | null; form_version_id: string | null;
      }>(
        `SELECT e.id AS employee_id,
                rl.supervisor_employee_id AS supervisor_id,
                app.resolve_form_version(e.id, $2::date) AS form_version_id
           FROM employee e
           JOIN employment em
             ON em.employee_id = e.id
            AND em.effective_from <= $2::date
            AND (em.effective_to IS NULL OR $2::date < em.effective_to)
           JOIN employment_type et
             ON et.id = em.employment_type_id AND et.is_eligible_for_review
           LEFT JOIN reporting_line rl
             ON rl.employee_id = e.id AND rl.line_type = 'primary'
            AND rl.effective_from <= $2::date
            AND (rl.effective_to IS NULL OR $2::date < rl.effective_to)
          WHERE e.deleted_at IS NULL AND e.status = 'active'`,
        [cycleId, date]);

      const created: string[] = [];
      const skipped: { employeeId: string; reason: string }[] = [];

      for (const s of subjects.rows) {
        if (!s.form_version_id) {
          // Loud, not silent. A person with no form is a configuration error,
          // and skipping them quietly means they are missing at close.
          skipped.push({ employeeId: s.employee_id, reason: 'no matching form template' });
          continue;
        }

        await client.query(
          `INSERT INTO review_summary (review_cycle_id, subject_employee_id)
                VALUES ($1,$2)
           ON CONFLICT (review_cycle_id, subject_employee_id) DO NOTHING`,
          [cycleId, s.employee_id]);

        const self = await client.query<{ id: string }>(
          `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                        reviewer_employee_id, reviewer_role,
                                        form_version_id)
                VALUES ($1,$2,$2,'self',$3)
           ON CONFLICT (review_cycle_id, subject_employee_id,
                        reviewer_employee_id, reviewer_role) DO NOTHING
             RETURNING id`,
          [cycleId, s.employee_id, s.form_version_id]);
        if (self.rows[0]) created.push(self.rows[0].id);

        if (s.supervisor_id) {
          const sup = await client.query<{ id: string }>(
            `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                          reviewer_employee_id, reviewer_role,
                                          form_version_id)
                  VALUES ($1,$2,$3,'supervisor',$4)
             ON CONFLICT (review_cycle_id, subject_employee_id,
                          reviewer_employee_id, reviewer_role) DO NOTHING
               RETURNING id`,
            [cycleId, s.employee_id, s.supervisor_id, s.form_version_id]);
          if (sup.rows[0]) created.push(sup.rows[0].id);
        } else {
          skipped.push({ employeeId: s.employee_id, reason: 'no supervisor assigned' });
        }
      }

      return { created: created.length, skipped };
    });
  }

  async setCycleState(
    ctx: RequestContext, cycleId: string, state: 'open' | 'calibration' | 'closed',
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `UPDATE review_cycle
            SET state = $2::review_cycle_state,
                closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END
          WHERE id = $1 RETURNING id`, [cycleId, state]);
      if (!res.rows[0]) throw new NotFoundException('Review cycle not found');
      return { id: cycleId, state };
    });
  }

  /** Review instances assigned TO the caller. The reviewer's inbox. */
  async myAssignments(ctx: RequestContext, cycleId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT ri.id, ri.reviewer_role::text AS "reviewerRole",
                ri.state::text AS state,
                ri.overall_rating::text AS "overallRating",
                ri.submitted_at::text AS "submittedAt",
                ri.returned_reason AS "returnedReason",
                ri.form_version_id AS "formVersionId",
                ri.subject_employee_id AS "subjectEmployeeId",
                e.first_name || ' ' || e.last_name AS "subjectName",
                c.id AS "reviewCycleId", c.name AS "cycleName",
                c.state::text AS "cycleState"
           FROM review_instance ri
           JOIN employee e ON e.id = ri.subject_employee_id
           JOIN review_cycle c ON c.id = ri.review_cycle_id
          WHERE ri.reviewer_employee_id = $1
            AND ($2::uuid IS NULL OR ri.review_cycle_id = $2)
          ORDER BY c.opens_on DESC, e.last_name`,
        [ctx.employeeId, cycleId ?? null]);
      return res.rows;
    });
  }

  async getInstance(ctx: RequestContext, instanceId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT ri.id, ri.reviewer_role::text AS "reviewerRole",
                ri.state::text AS state,
                ri.overall_rating::text AS "overallRating",
                ri.submitted_at::text AS "submittedAt",
                ri.returned_reason AS "returnedReason",
                ri.subject_employee_id AS "subjectEmployeeId",
                e.first_name || ' ' || e.last_name AS "subjectName",
                ri.review_cycle_id AS "reviewCycleId",
                c.name AS "cycleName", c.goal_period_id AS "goalPeriodId",
                v.id AS "formVersionId", v.schema_json AS schema,
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'value', p.value, 'label', p.label,
                           'description', p.description) ORDER BY p.sequence)
                    FROM rating_scale_point p
                   WHERE p.rating_scale_id = v.rating_scale_id
                ), '[]') AS "ratingPoints",
                COALESCE((
                  SELECT json_object_agg(fr.field_key, fr.value_json)
                    FROM form_response fr WHERE fr.review_instance_id = ri.id
                ), '{}') AS responses
           FROM review_instance ri
           JOIN employee e ON e.id = ri.subject_employee_id
           JOIN review_cycle c ON c.id = ri.review_cycle_id
           JOIN form_version v ON v.id = ri.form_version_id
          WHERE ri.id = $1`, [instanceId]);
      if (!res.rows[0]) throw new NotFoundException('Review not found');
      return res.rows[0];
    });
  }

  /** Goals and attainment for a subject, to score inside the review form. */
  async goalContext(ctx: RequestContext, instanceId: string) {
    return this.db.withContext(ctx, async (client) => {
      const inst = await client.query<{ subject: string; period: string | null }>(
        `SELECT ri.subject_employee_id AS subject, c.goal_period_id AS period
           FROM review_instance ri
           JOIN review_cycle c ON c.id = ri.review_cycle_id
          WHERE ri.id = $1`, [instanceId]);
      const row = inst.rows[0];
      if (!row) throw new NotFoundException('Review not found');
      if (!row.period) return { goals: [], weightedAttainment: null };

      const goals = await client.query(
        `SELECT g.id, g.title, g.weight::text AS weight, g.state::text AS state,
                att.pct::text AS "attainmentPct"
           FROM goal g
           LEFT JOIN LATERAL (
             SELECT AVG(t.attainment_pct) AS pct FROM goal_target t
              WHERE t.goal_id = g.id AND t.attainment_pct IS NOT NULL
           ) att ON TRUE
          WHERE g.employee_id = $1 AND g.goal_period_id = $2
            AND g.state NOT IN ('cancelled','draft')
          ORDER BY g.weight DESC`,
        [row.subject, row.period]);

      const overall = await client.query<{ pct: string | null }>(
        'SELECT app.review_goal_attainment($1,$2)::text AS pct',
        [row.subject, row.period]);

      return { goals: goals.rows, weightedAttainment: overall.rows[0]?.pct ?? null };
    });
  }

  /** Save a draft. Rejected once submitted (trigger in migration 0013). */
  async saveDraft(
    ctx: RequestContext, instanceId: string, input: z.infer<typeof saveResponses>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const owned = await client.query<{ state: string }>(
        `SELECT state::text AS state FROM review_instance
          WHERE id = $1 AND reviewer_employee_id = $2`, [instanceId, ctx.employeeId]);
      if (!owned.rows[0]) {
        throw new ForbiddenException('This review is not assigned to you');
      }
      if (owned.rows[0].state === 'submitted') {
        throw new BadRequestException(
          'This review has been submitted. Ask for it to be returned to make changes.');
      }

      for (const [key, value] of Object.entries(input.responses)) {
        await client.query(
          `INSERT INTO form_response (review_instance_id, field_key, value_json,
                                      created_by, updated_by)
                VALUES ($1,$2,$3::jsonb,$4,$4)
           ON CONFLICT (review_instance_id, field_key)
           DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by`,
          [instanceId, key, JSON.stringify(value ?? null), ctx.employeeId]);
      }

      await client.query(
        `UPDATE review_instance
            SET state = CASE WHEN state = 'not_started' THEN 'in_progress' ELSE state END,
                overall_rating = COALESCE($2, overall_rating)
          WHERE id = $1`,
        [instanceId, input.overallRating ?? null]);

      return { saved: Object.keys(input.responses).length };
    });
  }

  /**
   * Submit. Validates required fields against the form's own schema -- the
   * database cannot express "required" for arbitrary JSONB, so this is the one
   * rule that legitimately lives in the service.
   */
  async submit(ctx: RequestContext, instanceId: string) {
    return this.db.withContext(ctx, async (client) => {
      const inst = await client.query<{
        schema: { sections: { fields: { key: string; label: string; required: boolean }[] }[] };
        state: string;
      }>(
        `SELECT v.schema_json AS schema, ri.state::text AS state
           FROM review_instance ri
           JOIN form_version v ON v.id = ri.form_version_id
          WHERE ri.id = $1 AND ri.reviewer_employee_id = $2`,
        [instanceId, ctx.employeeId]);
      const row = inst.rows[0];
      if (!row) throw new ForbiddenException('This review is not assigned to you');

      const answered = await client.query<{ field_key: string; value_json: unknown }>(
        `SELECT field_key, value_json FROM form_response WHERE review_instance_id = $1`,
        [instanceId]);
      const values = new Map(answered.rows.map((r) => [r.field_key, r.value_json]));

      const missing: string[] = [];
      for (const section of row.schema.sections ?? []) {
        for (const field of section.fields ?? []) {
          if (!field.required) continue;
          const v = values.get(field.key);
          if (v === undefined || v === null || v === '') missing.push(field.label);
        }
      }
      if (missing.length > 0) {
        throw new BadRequestException(
          `Cannot submit — required questions are unanswered: ${missing.join(', ')}`);
      }

      await client.query(
        `UPDATE review_instance SET state = 'submitted' WHERE id = $1`, [instanceId])
        .catch((err: { code?: string; message?: string }) => {
          if (err.code === 'P0001') throw new BadRequestException(err.message);
          throw err;
        });

      return { state: 'submitted' };
    });
  }

  /** HR or the manager returns a submitted review for revision. */
  async returnForRevision(ctx: RequestContext, instanceId: string, reason: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `UPDATE review_instance SET state = 'returned', returned_reason = $2
          WHERE id = $1 RETURNING id`, [instanceId, reason])
        .catch((err: { code?: string; message?: string }) => {
          if (err.code === 'P0001') throw new BadRequestException(err.message);
          throw err;
        });
      if (!res.rows[0]) throw new NotFoundException('Review not found');

      const inst = await client.query<{ reviewer: string; subject: string }>(
        `SELECT ri.reviewer_employee_id AS reviewer,
                e.first_name || ' ' || e.last_name AS subject
           FROM review_instance ri
           JOIN employee e ON e.id = ri.subject_employee_id
          WHERE ri.id = $1`, [instanceId]);
      if (inst.rows[0]) {
        await NotificationsService.enqueue(
          client, inst.rows[0].reviewer, 'review.returned',
          { subjectName: inst.rows[0].subject, reason },
          `review-returned:${instanceId}`);
      }
      return { state: 'returned' };
    });
  }

  // --- Summary, calibration, sign-off --------------------------------------

  async summaries(ctx: RequestContext, cycleId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT s.id, s.subject_employee_id AS "subjectEmployeeId",
                e.first_name || ' ' || e.last_name AS "subjectName",
                d.name AS department,
                s.overall_rating::text AS "overallRating",
                s.calibrated_rating::text AS "calibratedRating",
                s.goal_attainment_pct::text AS "goalAttainmentPct",
                s.released_at::text AS "releasedAt",
                s.signed_off_at::text AS "signedOffAt",
                s.employee_acknowledged_at::text AS "acknowledgedAt",
                s.potential_rating AS "potentialRating",
                (SELECT count(*)::int FROM review_instance ri
                  WHERE ri.review_cycle_id = s.review_cycle_id
                    AND ri.subject_employee_id = s.subject_employee_id) AS "instanceCount",
                (SELECT count(*)::int FROM review_instance ri
                  WHERE ri.review_cycle_id = s.review_cycle_id
                    AND ri.subject_employee_id = s.subject_employee_id
                    AND ri.state = 'submitted') AS "submittedCount"
           FROM review_summary s
           JOIN employee e ON e.id = s.subject_employee_id
           LEFT JOIN employment em
             ON em.employee_id = e.id AND em.effective_to IS NULL
           LEFT JOIN department d ON d.id = em.department_id
          WHERE s.review_cycle_id = $1
          ORDER BY e.last_name, e.first_name`, [cycleId]);
      return res.rows;
    });
  }

  async calibrate(
    ctx: RequestContext, summaryId: string,
    input: { calibratedRating: number; calibrationNotes?: string | undefined },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `UPDATE review_summary
            SET calibrated_rating = $2, calibration_notes = COALESCE($3, calibration_notes)
          WHERE id = $1 RETURNING id`,
        [summaryId, input.calibratedRating, input.calibrationNotes ?? null])
        .catch((err: { code?: string; message?: string }) => {
          if (err.code === 'P0001') throw new BadRequestException(err.message);
          throw err;
        });
      if (!res.rows[0]) throw new NotFoundException('Review summary not found');
      return { id: summaryId };
    });
  }

  /**
   * Sign off: finalises ratings, snapshots goal attainment, and releases the
   * review to the employee.
   *
   * Attainment is snapshotted because actuals keep moving until the goal period
   * closes -- the signed review must record what was true at signing.
   */
  async signOff(ctx: RequestContext, summaryId: string) {
    return this.db.withContext(ctx, async (client) => {
      const s = await client.query<{
        subject: string; period: string | null; cycle: string; signed: string | null;
      }>(
        `SELECT s.subject_employee_id AS subject, c.goal_period_id AS period,
                c.id AS cycle, s.signed_off_at::text AS signed
           FROM review_summary s
           JOIN review_cycle c ON c.id = s.review_cycle_id
          WHERE s.id = $1`, [summaryId]);
      const row = s.rows[0];
      if (!row) throw new NotFoundException('Review summary not found');
      if (row.signed) throw new BadRequestException('This review is already signed off');

      const pending = await client.query<{ c: string }>(
        `SELECT count(*)::int AS c FROM review_instance
          WHERE review_cycle_id = $1 AND subject_employee_id = $2
            AND state <> 'submitted'`, [row.cycle, row.subject]);
      if (Number(pending.rows[0]?.c ?? 0) > 0) {
        throw new BadRequestException(
          `Cannot sign off: ${pending.rows[0]!.c} review(s) for this employee ` +
          `have not been submitted yet.`);
      }

      const attainment = row.period
        ? (await client.query<{ pct: string | null }>(
            'SELECT app.review_goal_attainment($1,$2)::text AS pct',
            [row.subject, row.period])).rows[0]?.pct ?? null
        : null;

      // The supervisor's rating becomes the record unless calibration moved it.
      const supervisor = await client.query<{ rating: string | null }>(
        `SELECT overall_rating::text AS rating FROM review_instance
          WHERE review_cycle_id = $1 AND subject_employee_id = $2
            AND reviewer_role = 'supervisor' LIMIT 1`, [row.cycle, row.subject]);

      await client.query(
        `UPDATE review_summary
            SET overall_rating = COALESCE(overall_rating, $2::numeric),
                goal_attainment_pct = $3::numeric,
                signed_off_by = $4, signed_off_at = now()
          WHERE id = $1`,
        [summaryId, supervisor.rows[0]?.rating ?? null, attainment, ctx.employeeId])
        .catch((err: { code?: string; message?: string }) => {
          if (err.code === 'P0001') throw new BadRequestException(err.message);
          throw err;
        });

      // Same transaction as the sign-off: the employee is told their review is
      // available only if it actually was released.
      await NotificationsService.enqueue(client, row.subject, 'review.released', {
        cycleName: (await client.query<{ name: string }>(
          'SELECT name FROM review_cycle WHERE id = $1', [row.cycle])).rows[0]?.name
          ?? 'Review',
      }, `review-released:${summaryId}`);

      return { id: summaryId, released: true };
    });
  }

  /** The employee acknowledges a released review. Only they may do this. */
  async acknowledge(ctx: RequestContext, summaryId: string, comment?: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `UPDATE review_summary
            SET employee_acknowledged_at = now(),
                employee_comment = COALESCE($2, employee_comment)
          WHERE id = $1 AND subject_employee_id = $3
            AND released_at IS NOT NULL AND employee_acknowledged_at IS NULL
      RETURNING id`,
        [summaryId, comment ?? null, ctx.employeeId]);
      if (!res.rows[0]) {
        throw new BadRequestException(
          'Only the employee named in a released review can acknowledge it, and only once');
      }
      return { id: summaryId };
    });
  }

  /** A subject's own released reviews. */
  async myReviews(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT s.id, c.name AS "cycleName",
                s.overall_rating::text AS "overallRating",
                s.calibrated_rating::text AS "calibratedRating",
                s.goal_attainment_pct::text AS "goalAttainmentPct",
                s.released_at::text AS "releasedAt",
                s.employee_acknowledged_at::text AS "acknowledgedAt",
                s.employee_comment AS "employeeComment"
           FROM review_summary s
           JOIN review_cycle c ON c.id = s.review_cycle_id
          WHERE s.subject_employee_id = $1
          ORDER BY c.opens_on DESC`, [ctx.employeeId]);
      return res.rows;
    });
  }
}
