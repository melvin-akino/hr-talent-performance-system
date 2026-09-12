import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { DbService, RequestContext } from '../db/db.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * The events that describe something happening in the real world.
 *
 * `correction` is absent on purpose. It is in the database enum (0029) because
 * a corrected ROW is tagged as one, but it is not something you "record": it
 * amends a row that was always wrong. Offering it here would invite the very
 * confusion D-016 exists to prevent.
 */
export const employmentEvent = z.enum([
  'regularization', 'promotion', 'lateral_transfer', 'demotion', 'rehire',
]);

export const createEmployee = z.object({
  employeeNo: z.string().trim().min(1).max(32),
  firstName: z.string().trim().min(1),
  middleName: z.string().trim().nullish(),
  lastName: z.string().trim().min(1),
  preferredName: z.string().trim().nullish(),
  // Not optional. First sign-in binds the account by matching this against the
  // directory, once — somebody imported without one cannot sign in at all, and
  // discovering that on their first day is a poor introduction.
  workEmail: z.string().trim().email(),
  hiredOn: isoDate,
  departmentId: z.string().uuid(),
  employmentTypeId: z.string().uuid(),
  positionId: z.string().uuid().nullish(),
  status: z.enum(['probationary', 'regular', 'project', 'fixed_term',
                  'consultant', 'intern']).default('probationary'),
  supervisorEmployeeId: z.string().uuid().nullish(),
});

/**
 * A correction: the value was never true.
 *
 * Deliberately narrow. Nothing here can move an employment period or a
 * reporting line — those are changes, and they go through their own endpoint
 * whatever the caller meant. `hiredOn` is included because a mistyped hire date
 * is a genuine typo, and `app.employment_milestones()` reads it straight from
 * this column.
 */
export const correctEmployee = z.object({
  employeeNo: z.string().trim().min(1).max(32).optional(),
  firstName: z.string().trim().min(1).optional(),
  middleName: z.string().trim().nullish(),
  lastName: z.string().trim().min(1).optional(),
  preferredName: z.string().trim().nullish(),
  workEmail: z.string().trim().email().optional(),
  personalEmail: z.string().trim().email().nullish(),
  hiredOn: isoDate.optional(),
}).refine((v) => Object.keys(v).length > 0, 'Nothing to correct');

export const recordEvent = z.object({
  event: employmentEvent,
  effectiveFrom: isoDate,
  // Required, and the database requires it too. An undated, unexplained
  // transfer cannot be defended a year later.
  reason: z.string().trim().min(1),
  positionId: z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
  employmentTypeId: z.string().uuid().nullish(),
  status: z.enum(['probationary', 'regular', 'project', 'fixed_term',
                  'consultant', 'intern']).nullish(),
  /**
   * Moves the primary reporting line in the SAME transaction as the transfer.
   *
   * Not a follow-up screen: `hr sync-roles` derives the supervisor role from
   * reporting lines, so a transfer whose reporting line lands later leaves the
   * old supervisor holding access to somebody who no longer reports to them.
   */
  supervisorEmployeeId: z.string().uuid().nullish(),
});

export const separate = z.object({
  separatedOn: isoDate,
  reason: z.string().trim().min(1),
  /** Having read the blockers and decided anyway. */
  acknowledgeBlockers: z.boolean().default(false),
});

/**
 * The four operations of D-016.
 *
 * Add · Correct · Record a change · End employment. There is no generic update
 * method here, and that absence is the design: employment is effective-dated,
 * so correcting a misspelt surname and recording a promotion are opposites in
 * the data even though they are one word in English.
 *
 * The close-and-open itself lives in `app.record_employment_event` rather than
 * in this file, because the 201 importer writes employment too and an invariant
 * enforced in one of two writers is not an invariant.
 */
@Injectable()
export class EmployeeLifecycleService {
  constructor(private readonly db: DbService) {}

  async create(ctx: RequestContext, input: z.infer<typeof createEmployee>) {
    return this.db.withContext(ctx, async (client) => {
      const orgId = await this.orgOf(client, ctx);

      // One transaction for all three rows. A person with an employee row and
      // no employment is invisible to every screen that joins through it, and
      // looks like a data-entry mistake rather than a failed write.
      const emp = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO employee (org_id, employee_no, first_name, middle_name,
                               last_name, preferred_name, work_email, hired_on,
                               status, created_by, updated_by)
              VALUES ($1,$2,$3,$4,$5,$6,$7::citext,$8,'active',
                      app.current_employee_id(), app.current_employee_id())
         RETURNING id`,
        [orgId, input.employeeNo, input.firstName, input.middleName ?? null,
         input.lastName, input.preferredName ?? null, input.workEmail,
         input.hiredOn]));

      const id = emp.rows[0]?.id;
      if (!id) throw new ForbiddenException('Not permitted to add employees');

      await this.wrap(() => client.query(
        `INSERT INTO employment (org_id, employee_id, position_id, department_id,
                                 employment_type_id, status, effective_from,
                                 event_type, change_reason,
                                 created_by, updated_by)
              VALUES ($1,$2,$3,$4,$5,$6::employment_status,$7,'hire','Hired',
                      app.current_employee_id(), app.current_employee_id())`,
        [orgId, id, input.positionId ?? null, input.departmentId,
         input.employmentTypeId, input.status, input.hiredOn]));

      if (input.supervisorEmployeeId) {
        await this.wrap(() => client.query(
          `INSERT INTO reporting_line (org_id, employee_id,
                                       supervisor_employee_id, line_type,
                                       effective_from, created_by, updated_by)
                VALUES ($1,$2,$3,'primary',$4,
                        app.current_employee_id(), app.current_employee_id())`,
          [orgId, id, input.supervisorEmployeeId, input.hiredOn]));
      }

      return { id };
    });
  }

  /** Amends the row that was always wrong. Touches no period. */
  async correct(
    ctx: RequestContext, id: string, patch: z.infer<typeof correctEmployee>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ id: string }>(
        `UPDATE employee
            SET employee_no    = COALESCE($2, employee_no),
                first_name     = COALESCE($3, first_name),
                -- CASE rather than COALESCE for the nullable ones: an explicit
                -- null means "clear it", which COALESCE cannot express.
                middle_name    = CASE WHEN $5 THEN $4 ELSE middle_name END,
                last_name      = COALESCE($6, last_name),
                preferred_name = CASE WHEN $8 THEN $7 ELSE preferred_name END,
                work_email     = COALESCE($9::citext, work_email),
                personal_email = CASE WHEN $11 THEN $10::citext ELSE personal_email END,
                hired_on       = COALESCE($12::date, hired_on),
                updated_at     = now(),
                updated_by     = app.current_employee_id()
          WHERE id = $1 AND deleted_at IS NULL
        RETURNING id`,
        [id, patch.employeeNo ?? null, patch.firstName ?? null,
         patch.middleName ?? null, patch.middleName !== undefined,
         patch.lastName ?? null,
         patch.preferredName ?? null, patch.preferredName !== undefined,
         patch.workEmail ?? null,
         patch.personalEmail ?? null, patch.personalEmail !== undefined,
         patch.hiredOn ?? null]));

      if (!res.rows[0]) {
        throw new NotFoundException('Employee not found, or not permitted');
      }
      return { id };
    });
  }

  /** Something happened. Closes the covering period and opens a new one. */
  async recordEvent(
    ctx: RequestContext, id: string, input: z.infer<typeof recordEvent>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ id: string }>(
        `SELECT app.record_employment_event(
                  $1, $2::employment_event, $3::date, $4,
                  $5, $6, $7, $8::employment_status) AS id`,
        [id, input.event, input.effectiveFrom, input.reason,
         input.positionId ?? null, input.departmentId ?? null,
         input.employmentTypeId ?? null, input.status ?? null]));

      if (input.supervisorEmployeeId) {
        // Same transaction as the event above: see the schema comment on this
        // field. Close the open primary line first — the exclusion constraint
        // forbids overlap, so this is the same close-and-open shape.
        await this.wrap(() => client.query(
          `UPDATE reporting_line
              SET effective_to = $2::date, updated_at = now(),
                  updated_by = app.current_employee_id()
            WHERE employee_id = $1 AND line_type = 'primary'
              AND effective_from < $2::date
              AND (effective_to IS NULL OR $2::date < effective_to)`,
          [id, input.effectiveFrom]));

        await this.wrap(() => client.query(
          `INSERT INTO reporting_line (org_id, employee_id,
                                       supervisor_employee_id, line_type,
                                       effective_from, created_by, updated_by)
                SELECT e.org_id, $1, $2, 'primary', $3::date,
                       app.current_employee_id(), app.current_employee_id()
                  FROM employee e WHERE e.id = $1`,
          [id, input.supervisorEmployeeId, input.effectiveFrom]));
      }

      return { id: res.rows[0]?.id };
    });
  }

  /** What separating them would orphan. Read before acting. */
  async separationBlockers(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ kind: string; detail: string }>(
        'SELECT kind, detail FROM app.separation_blockers($1)', [id]);
      return res.rows;
    });
  }

  async separate(
    ctx: RequestContext, id: string, input: z.infer<typeof separate>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      await this.wrap(() => client.query(
        'SELECT app.separate_employee($1, $2::date, $3, $4)',
        [id, input.separatedOn, input.reason, input.acknowledgeBlockers]));
      return { id };
    });
  }

  /**
   * The caller's tenant, read from their own row.
   *
   * org_id is what RLS scopes every insert by, so a value the caller could
   * influence would be a tenant boundary decided by the caller.
   */
  private async orgOf(client: PoolClient, ctx: RequestContext): Promise<string> {
    const org = await client.query<{ org_id: string }>(
      'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
    const orgId = org.rows[0]?.org_id;
    if (!orgId) throw new NotFoundException('Requesting employee not found');
    return orgId;
  }

  /**
   * The functions in 0045 raise messages written for the operator — which
   * period covers the date, what work a separation would orphan. Surfacing
   * them as 400s is the whole point; swallowing them leaves an unexplained 500.
   */
  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; message?: string; constraint?: string };
      if (e.code === 'P0001' || e.code === '23514') {
        throw new BadRequestException(e.message ?? 'Not allowed');
      }
      if (e.code === '23P01') {
        throw new BadRequestException(
          'That would overlap an existing period. Check the effective date.');
      }
      if (e.code === '23505') {
        throw new BadRequestException(
          e.constraint?.includes('work_email')
            ? 'Another employee already uses that work email.'
            : 'Another employee already uses that number.');
      }
      throw err;
    }
  }
}
