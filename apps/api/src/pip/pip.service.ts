import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

export const createPip = z.object({
  employeeId: z.string().uuid(),
  goalPeriodId: z.string().uuid().optional(),
  reason: z.string().trim().min(10, 'State the performance concern in full'),
  expectedOutcome: z.string().trim().optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviewCadence: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly']).default('biweekly'),
  milestones: z.array(z.object({
    description: z.string().trim().min(1),
    successCriteria: z.string().trim().optional(),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1, 'A PIP requires at least one measurable milestone'),
});

export const assessMilestone = z.object({
  met: z.boolean(),
  assessmentNotes: z.string().trim().optional(),
});

export const createPipReview = z.object({
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  progressSummary: z.string().trim().min(1),
  statusFlag: z.enum(['on_track', 'at_risk', 'off_track']),
  employeeComment: z.string().trim().optional(),
});

export const closePip = z.object({
  outcome: z.enum(['successful', 'extended', 'unsuccessful', 'withdrawn']),
  outcomeNotes: z.string().trim().optional(),
});

/**
 * Performance Improvement Plans.
 *
 * PIP visibility is narrower than goals -- employee, DIRECT supervisor, HR --
 * and that is enforced by RLS (migration 0011), not here. The service adds the
 * orchestration RLS cannot express, and translates database invariants into
 * usable errors.
 */
@Injectable()
export class PipService {
  constructor(private readonly db: DbService) {}

  private static readonly PLAN_SELECT = `
    SELECT p.id,
           p.employee_id                        AS "employeeId",
           e.first_name || ' ' || e.last_name   AS "employeeName",
           p.supervisor_id                      AS "supervisorId",
           app.display_name(p.supervisor_id)     AS "supervisorName",
           p.reason,
           p.expected_outcome                   AS "expectedOutcome",
           p.starts_on::text                    AS "startsOn",
           p.ends_on::text                      AS "endsOn",
           p.review_cadence::text               AS "reviewCadence",
           p.state::text                        AS state,
           p.outcome::text                      AS outcome,
           p.outcome_notes                      AS "outcomeNotes",
           p.acknowledged_at::text              AS "acknowledgedAt",
           p.closed_at::text                    AS "closedAt",
           (SELECT count(*)::int FROM pip_milestone m WHERE m.pip_plan_id = p.id)
                                                AS "milestoneCount",
           (SELECT count(*)::int FROM pip_milestone m
             WHERE m.pip_plan_id = p.id AND m.met IS TRUE) AS "milestonesMet",
           (SELECT count(*)::int FROM pip_milestone m
             WHERE m.pip_plan_id = p.id AND m.met IS NULL) AS "milestonesPending"
      FROM pip_plan p
      -- The SUBJECT is joined: seeing a plan implies seeing whose plan it is.
      -- The SUPERVISOR is not — an employee cannot read their own manager's
      -- employee row, so an inner join here made a person's own PIP vanish.
      JOIN employee e ON e.id = p.employee_id`;

  async create(ctx: RequestContext, input: z.infer<typeof createPip>) {
    return this.db.withContext(ctx, async (client) => {
      if (input.employeeId === ctx.employeeId) {
        throw new BadRequestException('You cannot initiate a PIP for yourself');
      }

      const emp = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [input.employeeId]);
      const orgId = emp.rows[0]?.org_id;
      // RLS hides employees the caller may not see, so this doubles as an
      // authorization check without disclosing whether the person exists.
      if (!orgId) throw new NotFoundException('Employee not found');

      const inserted = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO pip_plan (org_id, employee_id, initiated_by, supervisor_id,
                               goal_period_id, reason, expected_outcome,
                               starts_on, ends_on, review_cadence)
              VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9::checkin_cadence)
           RETURNING id`,
        [orgId, input.employeeId, ctx.employeeId, input.goalPeriodId ?? null,
         input.reason, input.expectedOutcome ?? null, input.startsOn,
         input.endsOn, input.reviewCadence]));

      const planId = inserted.rows[0]?.id;
      if (!planId) {
        throw new ForbiddenException('Not permitted to initiate a PIP for this employee');
      }

      let sequence = 1;
      for (const m of input.milestones) {
        await this.wrap(() => client.query(
          `INSERT INTO pip_milestone (pip_plan_id, sequence, description,
                                      success_criteria, due_on)
                VALUES ($1,$2,$3,$4,$5)`,
          [planId, sequence++, m.description, m.successCriteria ?? null, m.dueOn]));
      }

      return this.requirePlan(ctx, planId);
    });
  }

  async list(
    ctx: RequestContext,
    // `| undefined` required by exactOptionalPropertyTypes: these come from
    // query params, where absent is genuinely undefined rather than missing.
    opts: { employeeId?: string | undefined; state?: string | undefined } = {},
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `${PipService.PLAN_SELECT}
          WHERE ($1::uuid IS NULL OR p.employee_id = $1)
            AND ($2::text IS NULL OR p.state::text = $2)
          ORDER BY p.starts_on DESC`,
        [opts.employeeId ?? null, opts.state ?? null]);
      return res.rows;
    });
  }

  async byId(ctx: RequestContext, planId: string) {
    return this.requirePlan(ctx, planId);
  }

  /** Activate a draft. The database refuses if it has no milestones. */
  async activate(ctx: RequestContext, planId: string) {
    await this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{
        id: string; employee_id: string; starts_on: string; ends_on: string;
      }>(
        `UPDATE pip_plan SET state = 'active' WHERE id = $1
      RETURNING id, employee_id, starts_on::text AS starts_on,
                ends_on::text AS ends_on`, [planId]));
      const plan = res.rows[0];
      if (!plan) throw new NotFoundException('PIP not found');

      // The subject is told when the plan becomes ACTIVE, not when it is
      // drafted: a draft may still be reworded or abandoned, and notifying on
      // a draft would be both alarming and premature.
      await NotificationsService.enqueue(client, plan.employee_id, 'pip.created', {
        startsOn: plan.starts_on,
        endsOn: plan.ends_on,
      }, `pip-active:${planId}`);
    });
    return this.requirePlan(ctx, planId);
  }

  /**
   * The employee records that they have seen the plan.
   *
   * Only the subject may do this -- an acknowledgement entered by the manager
   * would be worthless as a record. Enforced here because it is a statement
   * about who is acting, which RLS on the row cannot express.
   */
  async acknowledge(ctx: RequestContext, planId: string) {
    await this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE pip_plan SET acknowledged_at = now()
          WHERE id = $1 AND employee_id = $2 AND acknowledged_at IS NULL
      RETURNING id`,
        [planId, ctx.employeeId]);
      if (!res.rows[0]) {
        throw new BadRequestException(
          'Only the employee named in the plan can acknowledge it, and only once');
      }
    });
    return this.requirePlan(ctx, planId);
  }

  async assessMilestone(
    ctx: RequestContext, milestoneId: string, input: z.infer<typeof assessMilestone>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ pip_plan_id: string }>(
        `UPDATE pip_milestone
            SET met = $2, assessed_by = $3, assessed_at = now(),
                assessment_notes = COALESCE($4, assessment_notes)
          WHERE id = $1
      RETURNING pip_plan_id`,
        [milestoneId, input.met, ctx.employeeId, input.assessmentNotes ?? null]));
      if (!res.rows[0]) throw new NotFoundException('Milestone not found');
      return { pipPlanId: res.rows[0].pip_plan_id };
    });
  }

  async addReview(
    ctx: RequestContext, planId: string, input: z.infer<typeof createPipReview>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO pip_review (pip_plan_id, reviewed_by, review_date,
                                 progress_summary, status_flag, employee_comment,
                                 created_by)
              VALUES ($1,$2,$3,$4,$5::checkin_status,$6,$2)
           RETURNING id`,
        [planId, ctx.employeeId, input.reviewDate, input.progressSummary,
         input.statusFlag, input.employeeComment ?? null]));
      if (!res.rows[0]) {
        throw new ForbiddenException('Not permitted to record a review on this PIP');
      }
      return res.rows[0];
    });
  }

  async reviews(ctx: RequestContext, planId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT r.id, r.review_date::text AS "reviewDate",
                r.progress_summary AS "progressSummary",
                r.status_flag::text AS "statusFlag",
                r.employee_comment  AS "employeeComment",
                r.created_at::text  AS "createdAt",
                app.display_name(r.reviewed_by) AS "reviewedBy"
           FROM pip_review r
          WHERE r.pip_plan_id = $1
          ORDER BY r.review_date DESC`, [planId]);
      return res.rows;
    });
  }

  async milestones(ctx: RequestContext, planId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT m.id, m.sequence, m.description,
                m.success_criteria AS "successCriteria",
                m.due_on::text     AS "dueOn",
                m.met,
                m.assessment_notes AS "assessmentNotes",
                m.assessed_at::text AS "assessedAt",
                e.first_name || ' ' || e.last_name AS "assessedBy"
           FROM pip_milestone m
           LEFT JOIN employee e ON e.id = m.assessed_by
          WHERE m.pip_plan_id = $1
          ORDER BY m.sequence`, [planId]);
      return res.rows;
    });
  }

  async close(ctx: RequestContext, planId: string, input: z.infer<typeof closePip>) {
    await this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query(
        `UPDATE pip_plan
            SET state = 'completed', outcome = $2::pip_outcome, outcome_notes = $3
          WHERE id = $1
      RETURNING id`,
        [planId, input.outcome, input.outcomeNotes ?? null]));
      if (!res.rows[0]) throw new NotFoundException('PIP not found');
    });
    return this.requirePlan(ctx, planId);
  }

  async cancel(ctx: RequestContext, planId: string, reason: string) {
    await this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query(
        `UPDATE pip_plan SET state = 'cancelled', outcome_notes = $2
          WHERE id = $1 RETURNING id`, [planId, reason]));
      if (!res.rows[0]) throw new NotFoundException('PIP not found');
    });
    return this.requirePlan(ctx, planId);
  }

  private async requirePlan(ctx: RequestContext, planId: string) {
    const rows = await this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `${PipService.PLAN_SELECT} WHERE p.id = $1`, [planId]);
      return res.rows;
    });
    if (!rows[0]) throw new NotFoundException('PIP not found');
    return rows[0];
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === '23514' || e.code === 'P0001' || e.code === '23P01') {
        throw new BadRequestException(e.message ?? 'Constraint violated');
      }
      throw err;
    }
  }
}
