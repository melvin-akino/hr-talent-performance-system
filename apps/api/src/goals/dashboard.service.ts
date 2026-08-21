import { Injectable } from '@nestjs/common';
import { DbService, RequestContext } from '../db/db.service';

/**
 * The three dashboards named in the source meeting notes: HR, Employee (EE),
 * and Manager.
 *
 * Every query below is written as though the caller could see the whole
 * organization. RLS narrows it. That is why the same SQL serves an IC (who
 * sees one row) and an HR admin (who sees the org) without a branch: the
 * manager roll-up is not "filter by my reports", it is "everything I am
 * permitted to see", which is strictly more correct -- it automatically
 * respects department-scoped HR partners and skip-level visibility.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DbService) {}

  /** Employee view: my goals, my progress, what needs a check-in. */
  async employee(ctx: RequestContext, goalPeriodId: string) {
    return this.db.withContext(ctx, async (client) => {
      const summary = await client.query(
        `SELECT COUNT(*)::int                                    AS "totalGoals",
                COUNT(*) FILTER (WHERE g.state = 'draft')::int   AS "draft",
                COUNT(*) FILTER (WHERE g.state = 'pending_approval')::int
                                                                 AS "pendingApproval",
                COUNT(*) FILTER (WHERE g.state = 'active')::int  AS "active",
                COALESCE(SUM(g.weight), 0)::text                 AS "totalWeight",
                ROUND(SUM(att.pct * g.weight)
                      / NULLIF(SUM(g.weight) FILTER (WHERE att.pct IS NOT NULL), 0), 2)::text
                                                                 AS "weightedAttainment"
           FROM goal g
           LEFT JOIN LATERAL (
             SELECT AVG(t.attainment_pct) AS pct FROM goal_target t
              WHERE t.goal_id = g.id AND t.attainment_pct IS NOT NULL
           ) att ON TRUE
          WHERE g.employee_id = $1
            AND g.goal_period_id = $2
            AND g.state <> 'cancelled'`,
        [ctx.employeeId, goalPeriodId],
      );

      // "Never checked in" and "checked in long ago" are the same problem to
      // the employee, so COALESCE collapses them into one overdue list rather
      // than two.
      const needsCheckin = await client.query(
        `SELECT g.id, g.title, g.due_on::text AS "dueOn",
                last.period_ending::text AS "lastCheckinOn",
                (CURRENT_DATE - COALESCE(last.period_ending, g.created_at::date))::int
                  AS "daysSinceCheckin"
           FROM goal g
           LEFT JOIN LATERAL (
             SELECT c.period_ending FROM goal_checkin c
              WHERE c.goal_id = g.id
              ORDER BY c.period_ending DESC LIMIT 1
           ) last ON TRUE
          WHERE g.employee_id = $1
            AND g.goal_period_id = $2
            AND g.state = 'active'
            AND (CURRENT_DATE - COALESCE(last.period_ending, g.created_at::date)) >= 30
          ORDER BY "daysSinceCheckin" DESC`,
        [ctx.employeeId, goalPeriodId],
      );

      return { summary: summary.rows[0], needsCheckin: needsCheckin.rows };
    });
  }

  /** Manager view: team roll-up, at-risk goals, approvals waiting on me. */
  async manager(ctx: RequestContext, goalPeriodId: string) {
    return this.db.withContext(ctx, async (client) => {
      const team = await client.query(
        `SELECT e.id                                   AS "employeeId",
                e.first_name || ' ' || e.last_name     AS "employeeName",
                COUNT(g.id)::int                       AS "goalCount",
                COALESCE(SUM(g.weight), 0)::text       AS "totalWeight",
                ROUND(SUM(att.pct * g.weight)
                      / NULLIF(SUM(g.weight) FILTER (WHERE att.pct IS NOT NULL), 0), 2)::text
                                                       AS "attainment",
                COUNT(*) FILTER (WHERE chk.status_flag = 'off_track')::int AS "offTrack",
                COUNT(*) FILTER (WHERE chk.status_flag = 'at_risk')::int   AS "atRisk",
                COUNT(*) FILTER (WHERE g.state = 'pending_approval')::int  AS "awaitingApproval"
           FROM employee e
           JOIN goal g ON g.employee_id = e.id AND g.goal_period_id = $1
           LEFT JOIN LATERAL (
             SELECT AVG(t.attainment_pct) AS pct FROM goal_target t
              WHERE t.goal_id = g.id AND t.attainment_pct IS NOT NULL
           ) att ON TRUE
           LEFT JOIN LATERAL (
             SELECT c.status_flag FROM goal_checkin c
              WHERE c.goal_id = g.id
              ORDER BY c.period_ending DESC, c.created_at DESC LIMIT 1
           ) chk ON TRUE
          WHERE g.state <> 'cancelled'
            AND e.id <> $2
          GROUP BY e.id, e.first_name, e.last_name
          ORDER BY e.last_name, e.first_name`,
        [goalPeriodId, ctx.employeeId],
      );

      const atRisk = await client.query(
        `SELECT g.id, g.title,
                e.first_name || ' ' || e.last_name AS "employeeName",
                chk.status_flag::text              AS "status",
                chk.comment,
                chk.period_ending::text            AS "asOf"
           FROM goal g
           JOIN employee e ON e.id = g.employee_id
           JOIN LATERAL (
             SELECT c.status_flag, c.comment, c.period_ending FROM goal_checkin c
              WHERE c.goal_id = g.id
              ORDER BY c.period_ending DESC, c.created_at DESC LIMIT 1
           ) chk ON TRUE
          WHERE g.goal_period_id = $1
            AND g.state = 'active'
            AND chk.status_flag IN ('at_risk', 'off_track')
            AND g.employee_id <> $2
          ORDER BY chk.status_flag DESC, chk.period_ending DESC`,
        [goalPeriodId, ctx.employeeId],
      );

      // RLS already limits this to goals the caller may see; the approve grant
      // is checked at the point of approval.
      const pending = await client.query(
        `SELECT g.id, g.title, g.weight::text AS weight,
                e.first_name || ' ' || e.last_name AS "employeeName",
                g.updated_at::text AS "submittedAt"
           FROM goal g
           JOIN employee e ON e.id = g.employee_id
          WHERE g.goal_period_id = $1
            AND g.state = 'pending_approval'
            AND g.employee_id <> $2
          ORDER BY g.updated_at`,
        [goalPeriodId, ctx.employeeId],
      );

      return { team: team.rows, atRisk: atRisk.rows, pendingApproval: pending.rows };
    });
  }

  /** HR view: org-wide completion, coverage gaps, weight problems. */
  async hr(ctx: RequestContext, goalPeriodId: string) {
    return this.db.withContext(ctx, async (client) => {
      const coverage = await client.query(
        `SELECT COUNT(DISTINCT e.id)::int AS "employeesVisible",
                COUNT(DISTINCT g.employee_id)::int AS "employeesWithGoals",
                COUNT(DISTINCT e.id) FILTER (WHERE g.id IS NULL)::int
                  AS "employeesWithoutGoals"
           FROM employee e
           LEFT JOIN goal g
             ON g.employee_id = e.id
            AND g.goal_period_id = $1
            AND g.state <> 'cancelled'
          WHERE e.deleted_at IS NULL AND e.status = 'active'`,
        [goalPeriodId],
      );

      const byState = await client.query(
        `SELECT g.state::text AS state, COUNT(*)::int AS count
           FROM goal g WHERE g.goal_period_id = $1
          GROUP BY g.state ORDER BY g.state`,
        [goalPeriodId],
      );

      const byDepartment = await client.query(
        `SELECT d.name                          AS "department",
                COUNT(DISTINCT g.employee_id)::int AS "employeesWithGoals",
                COUNT(g.id)::int               AS "goalCount",
                ROUND(SUM(att.pct * g.weight)
                      / NULLIF(SUM(g.weight) FILTER (WHERE att.pct IS NOT NULL), 0), 2)::text
                                               AS "attainment"
           FROM goal g
           JOIN employment em
             ON em.employee_id = g.employee_id
            AND em.effective_to IS NULL
           JOIN department d ON d.id = em.department_id
           LEFT JOIN LATERAL (
             SELECT AVG(t.attainment_pct) AS pct FROM goal_target t
              WHERE t.goal_id = g.id AND t.attainment_pct IS NOT NULL
           ) att ON TRUE
          WHERE g.goal_period_id = $1 AND g.state <> 'cancelled'
          GROUP BY d.name ORDER BY d.name`,
        [goalPeriodId],
      );

      // Surfaced BEFORE lock is attempted, so HR can fix weights rather than
      // discovering the problem when the lock is rejected.
      const weightIssues = await client.query(
        `SELECT v.employee_id AS "employeeId",
                e.first_name || ' ' || e.last_name AS "employeeName",
                v.total_weight::text AS "totalWeight",
                v.goal_count::int    AS "goalCount"
           FROM app.goal_weight_violations($1) v
           JOIN employee e ON e.id = v.employee_id
          ORDER BY e.last_name`,
        [goalPeriodId],
      );

      return {
        coverage: coverage.rows[0],
        byState: byState.rows,
        byDepartment: byDepartment.rows,
        weightIssues: weightIssues.rows,
      };
    });
  }

  /**
   * CSV export of goals and attainment.
   *
   * Built server-side rather than in the browser so the export reflects RLS
   * exactly: a user can only ever export what they can already read.
   */
  async exportCsv(ctx: RequestContext, goalPeriodId: string): Promise<string> {
    const rows = await this.db.withContext(ctx, async (client) => {
      const res = await client.query<Record<string, string | null>>(
        `SELECT e.employee_no          AS "Employee No",
                e.last_name || ', ' || e.first_name AS "Employee",
                d.name                 AS "Department",
                p.name                 AS "Period",
                g.title                AS "Goal",
                k.code                 AS "KPI Code",
                g.weight::text         AS "Weight",
                g.state::text          AS "State",
                t.measure_name         AS "Measure",
                t.direction::text      AS "Direction",
                t.baseline_value::text AS "Baseline",
                t.target_value::text   AS "Target",
                t.actual_value::text   AS "Actual",
                t.attainment_pct::text AS "Attainment %",
                g.due_on::text         AS "Due"
           FROM goal g
           JOIN employee e ON e.id = g.employee_id
           JOIN goal_period p ON p.id = g.goal_period_id
           LEFT JOIN goal_target t ON t.goal_id = g.id
           LEFT JOIN kpi_definition k
             ON k.id = g.kpi_definition_id AND k.version = g.kpi_definition_version
           LEFT JOIN employment em
             ON em.employee_id = e.id AND em.effective_to IS NULL
           LEFT JOIN department d ON d.id = em.department_id
          WHERE g.goal_period_id = $1
          ORDER BY e.last_name, e.first_name, g.weight DESC, t.sequence`,
        [goalPeriodId],
      );
      return res.rows;
    });

    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]!);

    // Excel interprets a leading =, +, -, or @ as a formula. An unescaped cell
    // is a CSV injection vector, and this file is opened in Excel by default.
    const escape = (v: string | null): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
    };

    return [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => escape(r[h] ?? null)).join(',')),
    ].join('\r\n');
  }
}
