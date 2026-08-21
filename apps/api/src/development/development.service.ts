import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';

export const createPlan = z.object({
  /** Omit to create your own plan. */
  employeeId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().max(4000).optional(),
  goalPeriodId: z.string().uuid().optional(),
  targetPositionId: z.string().uuid().optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actions: z.array(z.object({
    description: z.string().trim().min(1),
    competencyId: z.string().uuid().optional(),
    targetLevel: z.number().int().positive().optional(),
    learningResourceId: z.string().uuid().optional(),
    supportNeeded: z.string().trim().optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })).min(1, 'A development plan needs at least one action'),
});

export const updateAction = z.object({
  status: z.enum(['not_started', 'in_progress', 'completed', 'deferred', 'cancelled']),
  notes: z.string().trim().max(2000).optional(),
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const createLearningResource = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  resourceType: z.enum(['course', 'document', 'video', 'book', 'workshop',
                        'link', 'mentoring']),
  url: z.string().url().max(2048).optional(),
  provider: z.string().trim().max(200).optional(),
  durationMinutes: z.number().int().positive().optional(),
  competencyId: z.string().uuid().optional(),
});

export const assignLearning = z.object({
  employeeId: z.string().uuid(),
  learningResourceId: z.string().uuid(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  devActionId: z.string().uuid().optional(),
});

export const createCareerPath = z.object({
  fromPositionId: z.string().uuid(),
  toPositionId: z.string().uuid(),
  moveType: z.enum(['promotion', 'lateral', 'specialisation']).default('promotion'),
  typicalMonths: z.number().int().positive().optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Development plans, career paths, and the learning library.
 *
 * Visibility is RLS's job (migration 0024). Note the deliberate difference from
 * PIPs: a development plan follows the GOAL visibility model (up the reporting
 * subtree), not the PIP model. Development is not discipline, and treating it
 * as such makes people conceal what they need to work on.
 */
@Injectable()
export class DevelopmentService {
  constructor(private readonly db: DbService) {}

  private static readonly PLAN_SELECT = `
    SELECT p.id,
           p.employee_id            AS "employeeId",
           app.display_name(p.employee_id) AS "employeeName",
           p.title, p.objective,
           p.goal_period_id         AS "goalPeriodId",
           p.target_position_id     AS "targetPositionId",
           tp.title                 AS "targetPositionTitle",
           p.starts_on::text        AS "startsOn",
           p.target_date::text      AS "targetDate",
           p.state::text            AS state,
           p.closed_at::text        AS "closedAt",
           (SELECT count(*)::int FROM dev_action a
             WHERE a.development_plan_id = p.id)                        AS "actionCount",
           (SELECT count(*)::int FROM dev_action a
             WHERE a.development_plan_id = p.id AND a.status = 'completed')
                                                                        AS "actionsCompleted"
      FROM development_plan p
      LEFT JOIN position tp ON tp.id = p.target_position_id`;

  // --- Plans ---------------------------------------------------------------

  async createPlan(ctx: RequestContext, input: z.infer<typeof createPlan>) {
    return this.db.withContext(ctx, async (client) => {
      const employeeId = input.employeeId ?? ctx.employeeId;

      const emp = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [employeeId]);
      const orgId = emp.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Employee not found');

      const plan = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO development_plan (org_id, employee_id, title, objective,
                                       goal_period_id, target_position_id,
                                       starts_on, target_date)
              VALUES ($1,$2,$3,$4,$5,$6,
                      COALESCE($7::date, CURRENT_DATE), $8)
           RETURNING id`,
        [orgId, employeeId, input.title, input.objective ?? null,
         input.goalPeriodId ?? null, input.targetPositionId ?? null,
         input.startsOn ?? null, input.targetDate ?? null]));

      const planId = plan.rows[0]?.id;
      if (!planId) {
        throw new ForbiddenException('Not permitted to create a plan for this employee');
      }

      let sequence = 1;
      for (const a of input.actions) {
        await this.wrap(() => client.query(
          `INSERT INTO dev_action (development_plan_id, sequence, description,
                                   competency_id, target_level, learning_resource_id,
                                   support_needed, target_date)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [planId, sequence++, a.description, a.competencyId ?? null,
           a.targetLevel ?? null, a.learningResourceId ?? null,
           a.supportNeeded ?? null, a.targetDate ?? null]));
      }

      return { id: planId };
    });
  }

  async listPlans(ctx: RequestContext, employeeId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `${DevelopmentService.PLAN_SELECT}
          WHERE ($1::uuid IS NULL OR p.employee_id = $1)
          ORDER BY p.starts_on DESC`, [employeeId ?? null]);
      return res.rows;
    });
  }

  async planById(ctx: RequestContext, planId: string) {
    return this.db.withContext(ctx, async (client) => {
      const plan = await client.query(
        `${DevelopmentService.PLAN_SELECT} WHERE p.id = $1`, [planId]);
      if (!plan.rows[0]) throw new NotFoundException('Development plan not found');

      const actions = await client.query(
        `SELECT a.id, a.sequence, a.description,
                a.competency_id        AS "competencyId",
                c.name                 AS "competencyName",
                a.target_level         AS "targetLevel",
                a.learning_resource_id AS "learningResourceId",
                r.title                AS "learningResourceTitle",
                r.url                  AS "learningResourceUrl",
                a.support_needed       AS "supportNeeded",
                a.target_date::text    AS "targetDate",
                a.status::text         AS status,
                a.completed_on::text   AS "completedOn",
                a.notes
           FROM dev_action a
           LEFT JOIN competency c ON c.id = a.competency_id
           LEFT JOIN learning_resource r ON r.id = a.learning_resource_id
          WHERE a.development_plan_id = $1
          ORDER BY a.sequence`, [planId]);

      return { ...plan.rows[0], actions: actions.rows };
    });
  }

  async setPlanState(
    ctx: RequestContext, planId: string, state: 'active' | 'completed' | 'cancelled',
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ id: string }>(
        `UPDATE development_plan SET state = $2::development_plan_state
          WHERE id = $1 RETURNING id`, [planId, state]));
      if (!res.rows[0]) throw new NotFoundException('Development plan not found');
      return { id: planId, state };
    });
  }

  async updateAction(
    ctx: RequestContext, actionId: string, input: z.infer<typeof updateAction>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      // completed_on is paired with status by a CHECK constraint, so derive it
      // rather than trusting the caller to keep the two consistent.
      const completedOn = input.status === 'completed'
        ? (input.completedOn ?? new Date().toISOString().slice(0, 10))
        : null;

      const res = await this.wrap(() => client.query<{ id: string }>(
        `UPDATE dev_action
            SET status = $2::dev_action_status,
                completed_on = $3::date,
                notes = COALESCE($4, notes)
          WHERE id = $1 RETURNING id`,
        [actionId, input.status, completedOn, input.notes ?? null]));
      if (!res.rows[0]) throw new NotFoundException('Action not found or not permitted');
      return { id: actionId };
    });
  }

  // --- Learning library ----------------------------------------------------

  async listResources(ctx: RequestContext, competencyId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT r.id, r.title, r.description,
                r.resource_type::text AS "resourceType",
                r.url, r.provider,
                r.duration_minutes    AS "durationMinutes",
                r.competency_id       AS "competencyId",
                c.name                AS "competencyName",
                r.is_active           AS "isActive"
           FROM learning_resource r
           LEFT JOIN competency c ON c.id = r.competency_id
          WHERE r.is_active
            AND ($1::uuid IS NULL OR r.competency_id = $1)
          ORDER BY c.name NULLS LAST, r.title`, [competencyId ?? null]);
      return res.rows;
    });
  }

  async createResource(
    ctx: RequestContext, input: z.infer<typeof createLearningResource>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Requesting employee not found');

      const res = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO learning_resource (org_id, title, description, resource_type,
                                        url, provider, duration_minutes, competency_id)
              VALUES ($1,$2,$3,$4::learning_resource_type,$5,$6,$7,$8)
           RETURNING id`,
        [orgId, input.title, input.description ?? null, input.resourceType,
         input.url ?? null, input.provider ?? null,
         input.durationMinutes ?? null, input.competencyId ?? null]));
      if (!res.rows[0]) {
        throw new ForbiddenException('Not permitted to manage the learning library');
      }
      return { id: res.rows[0].id };
    });
  }

  /** "HR library per employee" — what has been assigned to someone. */
  async myLearning(ctx: RequestContext, employeeId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const subject = employeeId ?? ctx.employeeId;
      const res = await client.query(
        `SELECT la.id, la.learning_resource_id AS "learningResourceId",
                r.title, r.resource_type::text AS "resourceType", r.url,
                r.duration_minutes AS "durationMinutes",
                c.name             AS "competencyName",
                app.display_name(la.assigned_by) AS "assignedBy",
                la.due_on::text    AS "dueOn",
                la.state::text     AS state,
                la.completed_on::text AS "completedOn",
                la.dev_action_id   AS "devActionId"
           FROM learning_assignment la
           JOIN learning_resource r ON r.id = la.learning_resource_id
           LEFT JOIN competency c ON c.id = r.competency_id
          WHERE la.employee_id = $1
          ORDER BY la.state, la.due_on NULLS LAST, r.title`, [subject]);
      return res.rows;
    });
  }

  async assign(ctx: RequestContext, input: z.infer<typeof assignLearning>) {
    return this.db.withContext(ctx, async (client) => {
      const emp = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [input.employeeId]);
      const orgId = emp.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Employee not found');

      const res = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO learning_assignment (org_id, employee_id, learning_resource_id,
                                          assigned_by, dev_action_id, due_on)
              VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [orgId, input.employeeId, input.learningResourceId, ctx.employeeId,
         input.devActionId ?? null, input.dueOn ?? null]));
      if (!res.rows[0]) {
        throw new ForbiddenException('Not permitted to assign learning to this employee');
      }
      return { id: res.rows[0].id };
    });
  }

  /**
   * Progress on assigned learning. Completing an assignment linked to a
   * development action closes that action too — enforced by trigger, so the
   * plan cannot show outstanding work that is actually finished.
   */
  async setAssignmentState(
    ctx: RequestContext, assignmentId: string,
    state: 'assigned' | 'in_progress' | 'completed' | 'waived',
  ) {
    return this.db.withContext(ctx, async (client) => {
      const completedOn = state === 'completed'
        ? new Date().toISOString().slice(0, 10) : null;
      const res = await this.wrap(() => client.query<{ id: string }>(
        `UPDATE learning_assignment
            SET state = $2::learning_assignment_state, completed_on = $3::date
          WHERE id = $1 RETURNING id`, [assignmentId, state, completedOn]));
      if (!res.rows[0]) throw new NotFoundException('Assignment not found');
      return { id: assignmentId, state };
    });
  }

  // --- Career paths & recommendations --------------------------------------

  async careerOptions(ctx: RequestContext, employeeId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const subject = employeeId ?? ctx.employeeId;
      const res = await client.query(
        `SELECT to_position_id       AS "toPositionId",
                to_position_title    AS "toPositionTitle",
                move_type            AS "moveType",
                typical_months       AS "typicalMonths",
                requirements_total::int   AS "requirementsTotal",
                requirements_met::int     AS "requirementsMet",
                requirements_unassessed::int AS "requirementsUnassessed"
           FROM app.career_options($1)`, [subject]);
      return res.rows;
    });
  }

  /** Library resources matching the employee's current competency gaps. */
  async recommendations(ctx: RequestContext, employeeId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const subject = employeeId ?? ctx.employeeId;
      const res = await client.query(
        `SELECT competency_id     AS "competencyId",
                competency_name   AS "competencyName",
                required_level    AS "requiredLevel",
                assessed_level    AS "assessedLevel",
                gap,
                resource_id       AS "resourceId",
                resource_title    AS "resourceTitle",
                resource_type::text AS "resourceType",
                already_assigned  AS "alreadyAssigned"
           FROM app.recommended_learning($1)`, [subject]);
      return res.rows;
    });
  }

  async listCareerPaths(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT cp.id,
                cp.from_position_id AS "fromPositionId",
                fp.title            AS "fromPositionTitle",
                cp.to_position_id   AS "toPositionId",
                tp.title            AS "toPositionTitle",
                cp.move_type        AS "moveType",
                cp.typical_months   AS "typicalMonths",
                cp.notes
           FROM career_path cp
           JOIN position fp ON fp.id = cp.from_position_id
           JOIN position tp ON tp.id = cp.to_position_id
          ORDER BY fp.title, tp.title`);
      return res.rows;
    });
  }

  async createCareerPath(ctx: RequestContext, input: z.infer<typeof createCareerPath>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Requesting employee not found');

      const res = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO career_path (org_id, from_position_id, to_position_id,
                                  move_type, typical_months, notes)
              VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [orgId, input.fromPositionId, input.toPositionId, input.moveType,
         input.typicalMonths ?? null, input.notes ?? null]));
      if (!res.rows[0]) {
        throw new ForbiddenException('Not permitted to define career paths');
      }
      return { id: res.rows[0].id };
    });
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; message?: string; constraint?: string };
      if (e.code === 'P0001' || e.code === '23514') {
        throw new BadRequestException(e.message ?? 'Not allowed');
      }
      if (e.code === '23505') {
        throw new BadRequestException(
          e.constraint === 'learning_assignment_employee_id_learning_resource_id_key'
            ? 'That resource is already assigned to this employee.'
            : 'That record already exists.');
      }
      throw err;
    }
  }
}
