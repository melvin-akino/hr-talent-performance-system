import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, RequestContext } from '../db/db.service';

export interface EmployeeSummary {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  status: string;
  positionTitle: string | null;
  departmentName: string | null;
  departmentId: string | null;
  /**
   * Role codes the caller currently holds. Populated only by me(); listing
   * other people does not disclose their grants.
   */
  roles?: string[];
}

export interface TimelineEvent {
  occurredOn: string;
  kind: 'review' | 'task_evaluation' | 'pip' | 'competency' | 'employment_event';
  title: string;
  detail: string | null;
  /**
   * Text, not a number. A review's 4.2, a task evaluation's 32/37 and a PIP's
   * "met" are not one scale, and rendering them as though they were is how a
   * timeline starts implying comparisons nobody made.
   */
  result: string | null;
  refId: string;
}

/**
 * Read paths for people data.
 *
 * Note what is absent: there are no visibility checks in this file. Filtering
 * is done by RLS (decisions.md D-003), so these queries are written as if the
 * caller could see everything -- and the database returns only what they may.
 * Adding an application-level `WHERE manager_id = ...` here would create a
 * second, divergent definition of visibility. Don't.
 */
@Injectable()
export class EmployeesService {
  constructor(private readonly db: DbService) {}

  private static readonly SUMMARY_SELECT = `
    SELECT e.id,
           e.employee_no    AS "employeeNo",
           e.first_name     AS "firstName",
           e.last_name      AS "lastName",
           e.work_email     AS "workEmail",
           e.status::text   AS status,
           p.title          AS "positionTitle",
           d.name           AS "departmentName",
           d.id             AS "departmentId",
           -- The three dates the client's 201 sheet asks for, read from the
           -- employment history rather than stored beside it (migration 0029).
           m.hired_on::text        AS "hiredOn",
           m.regularized_on::text  AS "regularizedOn",
           m.last_promoted_on::text AS "lastPromotedOn"
      FROM employee e
      LEFT JOIN employment em
        ON em.employee_id = e.id
       AND em.effective_from <= $1::date
       AND (em.effective_to IS NULL OR $1::date < em.effective_to)
      LEFT JOIN position p ON p.id = em.position_id
      LEFT JOIN department d ON d.id = em.department_id
      LEFT JOIN LATERAL app.employment_milestones(e.id) m ON TRUE`;

  /** The requesting employee's own record. */
  /**
   * The caller's own record, including the role codes they currently hold.
   *
   * The roles are for the interface only — deciding which navigation groups to
   * render, so a plain employee is not offered a calibration console they have
   * no rows for. **They are not an authorization boundary**; RLS is. Someone who
   * edits this array in their browser gains nothing, because every query still
   * runs under their own policies and returns the same empty result.
   *
   * Exposing them is safe: these are facts about the caller, to the caller.
   */
  async me(ctx: RequestContext, asOf = new Date()): Promise<EmployeeSummary> {
    const rows = await this.db.withContext(ctx, async (client) => {
      const res = await client.query<EmployeeSummary>(
        `${EmployeesService.SUMMARY_SELECT} WHERE e.id = $2`,
        [asOf, ctx.employeeId],
      );
      if (!res.rows[0]) return res.rows;

      const roles = await client.query<{ code: string }>(
        `SELECT DISTINCT r.code
           FROM role_assignment ra
           JOIN app_role r ON r.id = ra.role_id
          WHERE ra.employee_id = $1
            AND ra.effective_from <= $2::date
            AND (ra.effective_to IS NULL OR $2::date < ra.effective_to)
          ORDER BY r.code`,
        [ctx.employeeId, asOf],
      );
      return [{ ...res.rows[0], roles: roles.rows.map((r) => r.code) }];
    });
    if (!rows[0]) throw new NotFoundException('Employee record not found');
    return rows[0];
  }

  /**
   * Direct reports as of a date. `asOf` is a real parameter, not a convenience:
   * resolving a past review period must use the hierarchy that existed then
   * (architecture.md principle 3).
   */
  async directReports(ctx: RequestContext, asOf = new Date()): Promise<EmployeeSummary[]> {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<EmployeeSummary>(
        `${EmployeesService.SUMMARY_SELECT}
           JOIN reporting_line rl
             ON rl.employee_id = e.id
            AND rl.line_type = 'primary'
            AND rl.effective_from <= $1::date
            AND (rl.effective_to IS NULL OR $1::date < rl.effective_to)
          WHERE rl.supervisor_employee_id = $2
            AND e.deleted_at IS NULL
          ORDER BY e.last_name, e.first_name`,
        [asOf, ctx.employeeId],
      );
      return res.rows;
    });
  }

  /**
   * Everyone the caller may see. Paginated by keyset rather than OFFSET:
   * OFFSET degrades linearly and, worse, skips or duplicates rows when the
   * underlying set shifts between pages.
   */
  async list(
    ctx: RequestContext,
    // `| undefined` on each member is required by exactOptionalPropertyTypes:
    // the controller parses query params, and an absent param is genuinely
    // undefined rather than missing.
    opts: {
      limit?: number | undefined;
      afterLastName?: string | undefined;
      afterId?: string | undefined;
      asOf?: Date | undefined;
    } = {},
  ): Promise<EmployeeSummary[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const asOf = opts.asOf ?? new Date();
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<EmployeeSummary>(
        `${EmployeesService.SUMMARY_SELECT}
          WHERE e.deleted_at IS NULL
            AND ($3::text IS NULL
                 OR (e.last_name, e.id) > ($3::text, $4::uuid))
          ORDER BY e.last_name, e.id
          LIMIT $2`,
        [asOf, limit, opts.afterLastName ?? null, opts.afterId ?? null],
      );
      return res.rows;
    });
  }

  /**
   * One employee's history across every source that records something about
   * them (requirements section 7.1).
   *
   * The filtering is entirely app.employee_timeline's, which runs as the caller
   * so each source applies its own visibility rule. Nothing is re-checked here:
   * a second implementation of the confidentiality rules is a second thing to
   * get wrong, and this is the view where getting it wrong leaks assessment.
   */
  async timeline(
    ctx: RequestContext, employeeId: string, from?: string, to?: string,
  ): Promise<TimelineEvent[]> {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<TimelineEvent>(
        `SELECT occurred_on::text AS "occurredOn",
                kind::text AS kind,
                title, detail, result,
                ref_id AS "refId"
           FROM app.employee_timeline($1, $2::date, $3::date)`,
        [employeeId, from ?? null, to ?? null]);
      return res.rows;
    });
  }

  async byId(ctx: RequestContext, id: string, asOf = new Date()): Promise<EmployeeSummary> {
    const rows = await this.db.withContext(ctx, async (client) => {
      const res = await client.query<EmployeeSummary>(
        `${EmployeesService.SUMMARY_SELECT} WHERE e.id = $2 AND e.deleted_at IS NULL`,
        [asOf, id],
      );
      return res.rows;
    });
    // RLS makes an unauthorised row indistinguishable from a missing one, and
    // that is the correct behaviour: a 403 would confirm the record exists.
    if (!rows[0]) throw new NotFoundException('Employee not found');
    return rows[0];
  }
}
