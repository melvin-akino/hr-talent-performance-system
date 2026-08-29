import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService, RequestContext } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateCheckin, CreateGoal, UpdateGoal } from './dto';

export interface GoalTargetRow {
  id: string;
  sequence: number;
  measureName: string;
  measureType: string;
  direction: string;
  unit: string | null;
  baselineValue: string | null;
  targetValue: string;
  stretchValue: string | null;
  actualValue: string | null;
  actualAsOf: string | null;
  attainmentPct: string | null;
}

export interface GoalRow {
  id: string;
  goalPeriodId: string;
  employeeId: string;
  employeeName: string;
  title: string;
  description: string | null;
  weight: string;
  dueOn: string | null;
  state: string;
  parentGoalId: string | null;
  kpiDefinitionId: string | null;
  kpiDefinitionVersion: number | null;
  kpiCode: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** The second gate (C5). Null unless the period requires HCM release. */
  hcmApprovedBy: string | null;
  hcmApprovedAt: string | null;
  /** Why HCM last sent this target back. Cleared on release. */
  hcmRevisionNote: string | null;
  /** Weighted mean of target attainment. NULL until something is measured. */
  attainmentPct: string | null;
  latestStatus: string | null;
  latestCheckinAt: string | null;
  targets?: GoalTargetRow[];
}

/**
 * Goals and KPI monitoring.
 *
 * As in EmployeesService, there are no visibility checks here -- RLS decides
 * what the caller can see (decisions.md D-003). What this service DOES own is
 * orchestration the database cannot express: multi-statement writes, and
 * turning constraint violations into useful HTTP errors.
 *
 * Business invariants (state machine, period freezing, weight sums, cascade
 * cycles, attainment math) live in migrations 0007-0008, not here. If you are
 * about to add a rule to this file, check it does not belong in a trigger --
 * this service is not the only writer.
 */
@Injectable()
export class GoalsService {
  constructor(private readonly db: DbService) {}

  private static readonly GOAL_SELECT = `
    SELECT g.id,
           g.goal_period_id            AS "goalPeriodId",
           g.employee_id               AS "employeeId",
           e.first_name || ' ' || e.last_name AS "employeeName",
           g.title,
           g.description,
           g.weight::text              AS weight,
           g.due_on::text              AS "dueOn",
           g.state::text               AS state,
           g.parent_goal_id            AS "parentGoalId",
           g.kpi_definition_id         AS "kpiDefinitionId",
           g.kpi_definition_version    AS "kpiDefinitionVersion",
           k.code                      AS "kpiCode",
           g.approved_by               AS "approvedBy",
           g.approved_at::text         AS "approvedAt",
           g.hcm_approved_by           AS "hcmApprovedBy",
           g.hcm_approved_at::text     AS "hcmApprovedAt",
           g.hcm_revision_note         AS "hcmRevisionNote",
           agg.attainment_pct::text    AS "attainmentPct",
           chk.status_flag::text       AS "latestStatus",
           chk.created_at::text        AS "latestCheckinAt"
      FROM goal g
      JOIN employee e ON e.id = g.employee_id
      -- Snapshot join: the goal's frozen version, NOT the current one. Joining
      -- on id alone would retroactively relabel historical goals when a KPI is
      -- superseded (architecture.md principle 1).
      LEFT JOIN kpi_definition k
        ON k.id = g.kpi_definition_id
       AND k.version = g.kpi_definition_version
      LEFT JOIN LATERAL (
        SELECT AVG(t.attainment_pct) AS attainment_pct
          FROM goal_target t
         WHERE t.goal_id = g.id AND t.attainment_pct IS NOT NULL
      ) agg ON TRUE
      LEFT JOIN LATERAL (
        SELECT c.status_flag, c.created_at
          FROM goal_checkin c
         WHERE c.goal_id = g.id
         ORDER BY c.period_ending DESC, c.created_at DESC
         LIMIT 1
      ) chk ON TRUE`;

  async create(ctx: RequestContext, input: CreateGoal): Promise<GoalRow> {
    return this.db.withContext(ctx, async (client) => {
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM goal_period WHERE id = $1', [input.goalPeriodId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Goal period not found');

      // Cascade parents must sit in the same period, or roll-up compares
      // unrelated timeframes.
      if (input.parentGoalId) {
        const parent = await client.query<{ goal_period_id: string }>(
          'SELECT goal_period_id FROM goal WHERE id = $1', [input.parentGoalId]);
        if (!parent.rows[0]) throw new NotFoundException('Parent goal not found');
        if (parent.rows[0].goal_period_id !== input.goalPeriodId) {
          throw new BadRequestException(
            'Parent goal belongs to a different goal period');
        }
      }

      const inserted = await this.wrapConstraint(() =>
        client.query<{ id: string }>(
          `INSERT INTO goal (org_id, goal_period_id, employee_id, kpi_definition_id,
                             parent_goal_id, title, description, weight, due_on)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING id`,
          [orgId, input.goalPeriodId, input.employeeId, input.kpiDefinitionId ?? null,
           input.parentGoalId ?? null, input.title, input.description ?? null,
           input.weight, input.dueOn ?? null],
        ));

      const goalId = inserted.rows[0]?.id;
      if (!goalId) {
        // RLS denied the insert: WITH CHECK failures return no row rather than
        // raising, so an empty result here means "not permitted".
        throw new ForbiddenException('Not permitted to create a goal for this employee');
      }

      await this.insertTargets(client, goalId, input.targets);
      return this.requireGoal(client, goalId);
    });
  }

  async update(ctx: RequestContext, goalId: string, patch: UpdateGoal): Promise<GoalRow> {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrapConstraint(() =>
        client.query<{ id: string }>(
          `UPDATE goal
              SET title = COALESCE($2, title),
                  description = COALESCE($3, description),
                  weight = COALESCE($4, weight),
                  due_on = COALESCE($5::date, due_on)
            WHERE id = $1
        RETURNING id`,
          [goalId, patch.title ?? null, patch.description ?? null,
           patch.weight ?? null, patch.dueOn ?? null],
        ));
      if (!res.rows[0]) throw new NotFoundException('Goal not found');
      return this.requireGoal(client, goalId);
    });
  }

  /**
   * Submit a draft for approval. Separate from update() because a state change
   * is a distinct action with distinct permissions, not a field edit.
   */
  async submit(ctx: RequestContext, goalId: string): Promise<GoalRow> {
    const goal = await this.transition(ctx, goalId, 'pending_approval');

    // Notify the approver, in a follow-up transaction. Deliberately NOT inside
    // the state transition: failing to queue an email must not roll back a
    // submitted goal, and the dedupe key makes a retry harmless.
    await this.db.withContext(ctx, async (client) => {
      const sup = await client.query<{ id: string }>(
        `SELECT supervisor_employee_id AS id FROM reporting_line
          WHERE employee_id = $1 AND line_type = 'primary'
            AND effective_from <= CURRENT_DATE
            AND (effective_to IS NULL OR CURRENT_DATE < effective_to)`,
        [goal.employeeId]);
      const approver = sup.rows[0]?.id;
      if (!approver) return;
      await NotificationsService.enqueue(client, approver, 'goal.approval_requested', {
        goalTitle: goal.title,
        employeeName: goal.employeeName,
        weight: Number(goal.weight),
      }, `goal-approval:${goalId}`);
    });

    return goal;
  }

  /**
   * Approve a goal, making it active.
   *
   * The approver is taken from the request context, never from the payload.
   * Self-approval is blocked in the database as well (migration 0008) -- this
   * check exists to return a clear 400 instead of a raw constraint error.
   */
  async approve(ctx: RequestContext, goalId: string): Promise<GoalRow> {
    return this.db.withContext(ctx, async (client) => {
      const goal = await client.query<{ employee_id: string; state: string }>(
        'SELECT employee_id, state FROM goal WHERE id = $1', [goalId]);
      const row = goal.rows[0];
      if (!row) throw new NotFoundException('Goal not found');
      if (row.employee_id === ctx.employeeId) {
        throw new BadRequestException('You cannot approve your own goal');
      }

      const allowed = await client.query<{ ok: boolean }>(
        `SELECT app.can_access('goal', 'approve', $1) AS ok`, [row.employee_id]);
      if (!allowed.rows[0]?.ok) {
        throw new ForbiddenException('Not permitted to approve goals for this employee');
      }

      // Where this lands depends on the period: straight to active, or parked
      // for HCM (C5, migration 0037). Asked rather than repeated, so the two
      // paths cannot drift apart.
      const res = await this.wrapConstraint(() =>
        client.query<{ id: string; state: string }>(
          `UPDATE goal
              SET state = app.goal_state_after_supervisor_approval($1),
                  approved_by = $2, approved_at = now()
            WHERE id = $1
        RETURNING id, state::text AS state`,
          [goalId, ctx.employeeId],
        ));
      if (!res.rows[0]) throw new NotFoundException('Goal not found');

      const approved = await this.requireGoal(client, goalId);
      const parked = res.rows[0].state === 'pending_hcm';

      // Same transaction as the approval: nobody is told a goal is active
      // unless it actually became active. When HCM still has to release it,
      // the employee is told that instead -- silence here would read as the
      // supervisor having done nothing.
      await NotificationsService.enqueue(
        client, approved.employeeId,
        parked ? 'goal.awaiting_hcm' : 'goal.approved', {
          goalTitle: approved.title,
          approverName: approved.employeeName,
        }, `goal-approved:${goalId}`);
      return approved;
    });
  }

  /**
   * HCM releases a target that a supervisor has already approved (C5, §4.3).
   *
   * A distinct grant from goal:approve. A supervisor holds goal:approve over
   * their own reports, so reusing it would hand every supervisor the second
   * gate as well -- and two gates one role can pass alone is one gate.
   */
  async hcmApprove(ctx: RequestContext, goalId: string): Promise<GoalRow> {
    return this.db.withContext(ctx, async (client) => {
      const goal = await client.query<{ employee_id: string; state: string }>(
        'SELECT employee_id, state::text AS state FROM goal WHERE id = $1', [goalId]);
      const row = goal.rows[0];
      if (!row) throw new NotFoundException('Goal not found');

      if (row.state !== 'pending_hcm') {
        throw new BadRequestException(
          row.state === 'active'
            ? 'That target is already active.'
            : 'That target is not waiting for HCM. A supervisor approves it first.');
      }
      if (row.employee_id === ctx.employeeId) {
        throw new BadRequestException('You cannot release your own target');
      }

      const allowed = await client.query<{ ok: boolean }>(
        `SELECT app.can_access('goal_target', 'approve', $1) AS ok`,
        [row.employee_id]);
      if (!allowed.rows[0]?.ok) {
        throw new ForbiddenException('Not permitted to release targets');
      }

      const res = await this.wrapConstraint(() =>
        client.query<{ id: string }>(
          `UPDATE goal
              SET state = 'active', hcm_approved_by = $2, hcm_approved_at = now(),
                  hcm_revision_note = NULL
            WHERE id = $1 AND state = 'pending_hcm'
        RETURNING id`, [goalId, ctx.employeeId]));
      if (!res.rows[0]) throw new NotFoundException('Goal not found');

      const released = await this.requireGoal(client, goalId);
      await NotificationsService.enqueue(client, released.employeeId, 'goal.approved', {
        goalTitle: released.title,
        approverName: released.employeeName,
      }, `goal-hcm-approved:${goalId}`);
      return released;
    });
  }

  /**
   * HCM sends a target back to be rewritten, with the reason attached.
   *
   * Back to draft, not to the supervisor: HCM revises a target because the
   * target is wrong, and the person who wrote it has to rewrite it. Returning
   * it to the supervisor would ask them to approve the same text again.
   *
   * The state machine clears both approvals on the way (0037) -- a revised goal
   * must not still carry the signature of somebody who approved a different
   * version of it.
   */
  async hcmRevise(
    ctx: RequestContext, goalId: string, note: string,
  ): Promise<GoalRow> {
    return this.db.withContext(ctx, async (client) => {
      const goal = await client.query<{ employee_id: string; state: string }>(
        'SELECT employee_id, state::text AS state FROM goal WHERE id = $1', [goalId]);
      const row = goal.rows[0];
      if (!row) throw new NotFoundException('Goal not found');
      if (row.state !== 'pending_hcm') {
        throw new BadRequestException('That target is not waiting for HCM.');
      }

      const allowed = await client.query<{ ok: boolean }>(
        `SELECT app.can_access('goal_target', 'approve', $1) AS ok`,
        [row.employee_id]);
      if (!allowed.rows[0]?.ok) {
        throw new ForbiddenException('Not permitted to revise targets');
      }

      const res = await this.wrapConstraint(() =>
        client.query<{ id: string }>(
          `UPDATE goal SET state = 'draft', hcm_revision_note = $2
            WHERE id = $1 AND state = 'pending_hcm'
        RETURNING id`, [goalId, note]));
      if (!res.rows[0]) throw new NotFoundException('Goal not found');

      const revised = await this.requireGoal(client, goalId);
      await NotificationsService.enqueue(client, revised.employeeId, 'goal.revision_requested', {
        goalTitle: revised.title,
        note,
      }, `goal-revise:${goalId}:${Date.now()}`);
      return revised;
    });
  }

  async complete(
    ctx: RequestContext, goalId: string, outcome: 'achieved' | 'missed',
  ): Promise<GoalRow> {
    return this.transition(ctx, goalId, outcome);
  }

  async cancel(ctx: RequestContext, goalId: string, reason: string): Promise<GoalRow> {
    return this.transition(ctx, goalId, 'cancelled', reason);
  }

  private async transition(
    ctx: RequestContext, goalId: string, state: string, reason?: string,
  ): Promise<GoalRow> {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrapConstraint(() =>
        client.query<{ id: string }>(
          `UPDATE goal
              SET state = $2::goal_state,
                  cancelled_reason = COALESCE($3, cancelled_reason)
            WHERE id = $1
        RETURNING id`,
          [goalId, state, reason ?? null],
        ));
      if (!res.rows[0]) throw new NotFoundException('Goal not found');
      return this.requireGoal(client, goalId);
    });
  }

  /**
   * Record a check-in. This is the KPI monitoring trail -- append-only, and
   * enforced as such by rules on the table.
   */
  async checkIn(
    ctx: RequestContext, goalId: string, input: CreateCheckin,
  ): Promise<{ id: string }> {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrapConstraint(() =>
        client.query<{ id: string }>(
          `INSERT INTO goal_checkin (goal_id, goal_target_id, checked_in_by,
                                     reported_value, progress_pct, status_flag,
                                     comment, evidence_url, period_ending, created_by)
                VALUES ($1,$2,$3,$4,$5,$6::checkin_status,$7,$8,$9,$3)
             RETURNING id`,
          [goalId, input.goalTargetId ?? null, ctx.employeeId,
           input.reportedValue ?? null, input.progressPct ?? null, input.statusFlag,
           input.comment ?? null, input.evidenceUrl ?? null, input.periodEnding],
        ));

      const id = res.rows[0]?.id;
      if (!id) throw new ForbiddenException('Not permitted to check in on this goal');

      // Optionally roll the reported value into the target's actual, so
      // attainment reflects the latest check-in without a second call.
      if (input.updateActual && input.goalTargetId && input.reportedValue !== undefined) {
        await this.wrapConstraint(() =>
          client.query(
            `UPDATE goal_target
                SET actual_value = $2, actual_as_of = $3
              WHERE id = $1 AND goal_id = $4`,
            [input.goalTargetId, input.reportedValue, input.periodEnding, goalId],
          ));
      }

      return { id };
    });
  }

  async checkinHistory(ctx: RequestContext, goalId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT c.id,
                c.reported_value::text AS "reportedValue",
                c.progress_pct::text   AS "progressPct",
                c.status_flag::text    AS "statusFlag",
                c.comment,
                c.evidence_url         AS "evidenceUrl",
                c.period_ending::text  AS "periodEnding",
                c.created_at::text     AS "createdAt",
                app.display_name(c.checked_in_by) AS "checkedInBy"
           FROM goal_checkin c
          WHERE c.goal_id = $1
          ORDER BY c.period_ending DESC, c.created_at DESC`,
        [goalId],
      );
      return res.rows;
    });
  }

  async byId(ctx: RequestContext, goalId: string): Promise<GoalRow> {
    return this.db.withContext(ctx, (client) => this.requireGoal(client, goalId));
  }

  async listForEmployee(
    ctx: RequestContext, employeeId: string, goalPeriodId?: string,
  ): Promise<GoalRow[]> {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<GoalRow>(
        `${GoalsService.GOAL_SELECT}
          WHERE g.employee_id = $1
            AND ($2::uuid IS NULL OR g.goal_period_id = $2)
          ORDER BY g.weight DESC, g.title`,
        [employeeId, goalPeriodId ?? null],
      );
      return res.rows;
    });
  }

  /** Direct children of a cascaded goal, for the contribution view. */
  async children(ctx: RequestContext, goalId: string): Promise<GoalRow[]> {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<GoalRow>(
        `${GoalsService.GOAL_SELECT} WHERE g.parent_goal_id = $1
          ORDER BY e.last_name, g.title`,
        [goalId],
      );
      return res.rows;
    });
  }

  // -------------------------------------------------------------------------

  private async insertTargets(
    client: PoolClient, goalId: string, targets: CreateGoal['targets'],
  ): Promise<void> {
    let sequence = 1;
    for (const t of targets) {
      await this.wrapConstraint(() =>
        client.query(
          `INSERT INTO goal_target (goal_id, sequence, measure_name, measure_type,
                                    direction, unit, baseline_value, target_value,
                                    stretch_value)
           VALUES ($1,$2,$3,$4::kpi_measure_type,$5::kpi_direction,$6,$7,$8,$9)`,
          [goalId, sequence++, t.measureName, t.measureType, t.direction,
           t.unit ?? null, t.baselineValue ?? null, t.targetValue,
           t.stretchValue ?? null],
        ));
    }
  }

  private async requireGoal(client: PoolClient, goalId: string): Promise<GoalRow> {
    const res = await client.query<GoalRow>(
      `${GoalsService.GOAL_SELECT} WHERE g.id = $1`, [goalId]);
    const goal = res.rows[0];
    if (!goal) throw new NotFoundException('Goal not found');

    const targets = await client.query<GoalTargetRow>(
      `SELECT id, sequence, measure_name AS "measureName",
              measure_type::text AS "measureType", direction::text AS direction,
              unit, baseline_value::text AS "baselineValue",
              target_value::text AS "targetValue",
              stretch_value::text AS "stretchValue",
              actual_value::text AS "actualValue",
              actual_as_of::text AS "actualAsOf",
              attainment_pct::text AS "attainmentPct"
         FROM goal_target WHERE goal_id = $1 ORDER BY sequence`,
      [goalId],
    );
    goal.targets = targets.rows;
    return goal;
  }

  /**
   * Database invariants surface as raised exceptions with ERRCODE
   * check_violation. Left unhandled they become opaque 500s, so the operator
   * sees "Internal Server Error" for what is really "you cannot approve your
   * own goal". Translate, but do not swallow.
   */
  private async wrapConstraint<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; message?: string; constraint?: string };
      if (e.code === '23514' || e.code === '23P01' || e.code === 'P0001') {
        throw new BadRequestException(e.message ?? 'Constraint violated');
      }
      if (e.code === '23505') {
        throw new BadRequestException('That record already exists');
      }
      throw err;
    }
  }
}
