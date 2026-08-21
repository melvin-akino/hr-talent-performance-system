import { Injectable } from '@nestjs/common';
import { DbService, RequestContext } from '../db/db.service';

/**
 * Phase 2 monitoring depth: overdue check-ins, trend, escalation.
 *
 * Phase 1 recorded check-ins; this surfaces their ABSENCE and their direction.
 * Everything reads through views and functions that run under the caller's RLS,
 * so no extra scoping is applied here.
 */
@Injectable()
export class MonitoringService {
  constructor(private readonly db: DbService) {}

  /** Goals past their cadence window. The core Phase 2 signal. */
  async overdue(ctx: RequestContext, goalPeriodId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT s.goal_id              AS "goalId",
                s.title,
                s.employee_id          AS "employeeId",
                e.first_name || ' ' || e.last_name AS "employeeName",
                s.cadence::text        AS cadence,
                s.cadence_days         AS "cadenceDays",
                s.last_checkin_on::text AS "lastCheckinOn",
                s.last_status::text    AS "lastStatus",
                s.days_since_checkin   AS "daysSinceCheckin",
                s.next_checkin_due::text AS "nextCheckinDue"
           FROM goal_checkin_status s
           JOIN employee e ON e.id = s.employee_id
          WHERE s.goal_period_id = $1
            AND s.is_overdue
          ORDER BY s.days_since_checkin DESC`,
        [goalPeriodId]);
      return res.rows;
    });
  }

  /**
   * Attainment and reported values over time for one goal.
   *
   * Ordered ascending because this feeds a chart, and a chart drawn backwards
   * is worse than no chart.
   */
  async trend(ctx: RequestContext, goalId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT c.period_ending::text  AS "periodEnding",
                c.reported_value::text AS "reportedValue",
                c.progress_pct::text   AS "progressPct",
                c.status_flag::text    AS "statusFlag",
                t.measure_name         AS "measureName",
                t.target_value::text   AS "targetValue",
                t.direction::text      AS direction
           FROM goal_checkin c
           LEFT JOIN goal_target t ON t.id = c.goal_target_id
          WHERE c.goal_id = $1
          ORDER BY c.period_ending ASC, c.created_at ASC`,
        [goalId]);
      return res.rows;
    });
  }

  /**
   * Goals with 2+ consecutive at_risk/off_track check-ins.
   *
   * The threshold is deliberate: a single bad check-in is noise, a run is a
   * pattern -- and often the trigger for the PIP conversation this phase adds.
   */
  async escalations(ctx: RequestContext, goalPeriodId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT x.goal_id            AS "goalId",
                x.title,
                x.employee_id        AS "employeeId",
                e.first_name || ' ' || e.last_name AS "employeeName",
                x.consecutive_bad    AS "consecutiveBad",
                x.worst_status::text AS "status",
                x.last_checkin_on::text AS "lastCheckinOn",
                EXISTS (
                  SELECT 1 FROM pip_plan p
                   WHERE p.employee_id = x.employee_id
                     AND p.state = 'active'
                )                    AS "hasActivePip"
           FROM app.goal_escalations($1) x
           JOIN employee e ON e.id = x.employee_id
          ORDER BY x.consecutive_bad DESC`,
        [goalPeriodId]);
      return res.rows;
    });
  }

  /** Cadence compliance across everything the caller can see. */
  async complianceSummary(ctx: RequestContext, goalPeriodId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT COUNT(*) FILTER (WHERE state = 'active')::int      AS "activeGoals",
                COUNT(*) FILTER (WHERE is_overdue)::int            AS "overdueGoals",
                COUNT(*) FILTER (WHERE state = 'active'
                                 AND last_checkin_on IS NULL)::int AS "neverCheckedIn",
                COUNT(*) FILTER (WHERE last_status = 'off_track')::int AS "offTrack",
                COUNT(*) FILTER (WHERE last_status = 'at_risk')::int   AS "atRisk"
           FROM goal_checkin_status
          WHERE goal_period_id = $1`,
        [goalPeriodId]);
      return res.rows[0];
    });
  }
}
