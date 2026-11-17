import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService, RequestContext } from '../db/db.service';

export interface CreateLeaveTypeDto {
  code: string;
  name: string;
  description?: string;
  isPaid?: boolean;
  isStatutory?: boolean;
  defaultDaysPerYear?: number;
  canCashConvert?: boolean;
  canCarryOver?: boolean;
  maxCarryOverDays?: number;
  genderRestriction?: string;
}

export interface AllocateLeavesDto {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  allocatedDays: number;
}

export interface ApplyLeaveDto {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  employeeId?: string;
}

@Injectable()
export class LeavesService {
  constructor(private readonly db: DbService) {}

  /**
   * List Leave Types
   */
  async listLeaveTypes(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT * FROM leave_type
          WHERE org_id = app.current_org_id() AND is_active = TRUE
          ORDER BY is_statutory DESC, name ASC`,
      );
      return res.rows;
    });
  }

  /**
   * Seed Philippine Statutory Leaves for Organization
   */
  async seedStatutoryLeaveTypes(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const statutoryDefaults = [
        { code: 'SIL', name: 'Service Incentive Leave (Art. 95)', desc: 'Statutory 5 days paid leave commutable to cash', paid: true, stat: true, days: 5, cash: true, gender: 'all' },
        { code: 'SOLO_PARENT', name: 'Solo Parent Leave (RA 8972/11861)', desc: '7 days paid parental leave', paid: true, stat: true, days: 7, cash: false, gender: 'all' },
        { code: 'VAWC', name: 'VAWC Leave (RA 9262)', desc: '10 days paid leave for victims of violence against women', paid: true, stat: true, days: 10, cash: false, gender: 'female' },
        { code: 'PATERNITY', name: 'Paternity Leave (RA 8187)', desc: '7 days paid leave for married male employees', paid: true, stat: true, days: 7, cash: false, gender: 'male' },
        { code: 'MATERNITY', name: 'Maternity Leave (RA 11210)', desc: '105 days maternity leave with SSS integration', paid: true, stat: true, days: 105, cash: false, gender: 'female' },
        { code: 'VL', name: 'Vacation Leave (Company)', desc: 'Annual recreational vacation leave', paid: true, stat: false, days: 15, cash: true, gender: 'all' },
        { code: 'SL', name: 'Sick Leave (Company)', desc: 'Annual medical and wellness leave', paid: true, stat: false, days: 15, cash: false, gender: 'all' },
      ];

      for (const st of statutoryDefaults) {
        await client.query(
          `INSERT INTO leave_type (
             org_id, code, name, description, is_paid, is_statutory,
             default_days_per_year, can_cash_convert, gender_restriction
           ) VALUES (
             app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8
           )
           ON CONFLICT (org_id, code) DO NOTHING`,
          [st.code, st.name, st.desc, st.paid, st.stat, st.days, st.cash, st.gender],
        );
      }

      const res = await client.query(
        `SELECT * FROM leave_type WHERE org_id = app.current_org_id() ORDER BY is_statutory DESC, name ASC`,
      );
      return res.rows;
    });
  }

  /**
   * Create Custom Leave Type
   */
  async createLeaveType(ctx: RequestContext, dto: CreateLeaveTypeDto) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO leave_type (
           org_id, code, name, description, is_paid, is_statutory,
           default_days_per_year, can_cash_convert, can_carry_over,
           max_carry_over_days, gender_restriction
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          dto.code.toUpperCase(),
          dto.name,
          dto.description || null,
          dto.isPaid ?? true,
          dto.isStatutory ?? false,
          dto.defaultDaysPerYear ?? 5.0,
          dto.canCashConvert ?? false,
          dto.canCarryOver ?? false,
          dto.maxCarryOverDays ?? 0.0,
          dto.genderRestriction || 'all',
        ],
      );
      return res.rows[0];
    });
  }

  /**
   * Allocate Leaves to Employee
   */
  async allocateLeaves(ctx: RequestContext, dto: AllocateLeavesDto) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO leave_allocation (
           org_id, employee_id, leave_type_id, year, allocated_days
         ) VALUES (app.current_org_id(), $1, $2, $3, $4)
         ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET
           allocated_days = EXCLUDED.allocated_days,
           updated_at = now()
         RETURNING *`,
        [dto.employeeId, dto.leaveTypeId, dto.year, dto.allocatedDays],
      );
      return res.rows[0];
    });
  }

  /**
   * Get Employee Leave Balances
   */
  async getLeaveBalances(ctx: RequestContext, employeeId: string, year: number) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT a.*,
                t.code AS "leaveCode",
                t.name AS "leaveName",
                t.is_paid AS "isPaid",
                t.is_statutory AS "isStatutory",
                t.can_cash_convert AS "canCashConvert"
           FROM leave_allocation a
           JOIN leave_type t ON t.id = a.leave_type_id
          WHERE a.org_id = app.current_org_id()
            AND a.employee_id = $1
            AND a.year = $2
          ORDER BY t.name ASC`,
        [employeeId, year],
      );
      return res.rows;
    });
  }

  /**
   * Apply for Leave with strict overlap prevention, advisory concurrency locks,
   * date boundary checks, and balance validation.
   */
  async applyLeave(ctx: RequestContext, dto: ApplyLeaveDto) {
    return this.db.withContext(ctx, async (client) => {
      const targetEmployeeId = dto.employeeId || ctx.employeeId;
      if (!targetEmployeeId) {
        throw new BadRequestException('Employee ID is required to apply for leave');
      }

      if (!dto.startDate || !dto.endDate) {
        throw new BadRequestException('Start date and end date are required');
      }

      if (dto.startDate > dto.endDate) {
        throw new BadRequestException('Start date cannot be after end date');
      }

      const totalDays = Number(dto.totalDays);
      if (isNaN(totalDays) || totalDays <= 0) {
        throw new BadRequestException('Total number of days must be greater than zero');
      }

      // Concurrency lock per employee to prevent race conditions during simultaneous submissions
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `leave_request:${targetEmployeeId}`,
      ]);

      // 1. Check for overlapping active leave requests (pending or approved)
      const conflictRes = await client.query(
        `SELECT r.id, r.start_date, r.end_date, r.status, t.name AS leave_name
           FROM leave_request r
           JOIN leave_type t ON t.id = r.leave_type_id
          WHERE r.org_id = app.current_org_id()
            AND r.employee_id = $1
            AND r.status IN ('pending', 'approved')
            AND r.start_date <= $3::date
            AND r.end_date >= $2::date
          LIMIT 1`,
        [targetEmployeeId, dto.startDate, dto.endDate],
      );

      if (conflictRes.rows[0]) {
        const c = conflictRes.rows[0];
        const startStr =
          typeof c.start_date === 'string'
            ? c.start_date.slice(0, 10)
            : c.start_date.toISOString().slice(0, 10);
        const endStr =
          typeof c.end_date === 'string'
            ? c.end_date.slice(0, 10)
            : c.end_date.toISOString().slice(0, 10);
        throw new BadRequestException(
          `Overlapping leave application: You already have an active (${c.status}) leave (${c.leave_name}) from ${startStr} to ${endStr}. Overlapping leave requests are not permitted.`,
        );
      }

      const year = new Date(dto.startDate).getFullYear();

      // 2. Check balance if allocation exists
      const allocRes = await client.query(
        `SELECT remaining_days FROM leave_allocation
          WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
        [targetEmployeeId, dto.leaveTypeId, year],
      );

      if (allocRes.rows[0] && Number(allocRes.rows[0].remaining_days) < totalDays) {
        throw new BadRequestException(
          `Insufficient leave balance. Remaining days: ${allocRes.rows[0].remaining_days}`,
        );
      }

      const res = await client.query(
        `INSERT INTO leave_request (
           org_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, 'pending')
         RETURNING *`,
        [
          targetEmployeeId,
          dto.leaveTypeId,
          dto.startDate,
          dto.endDate,
          totalDays,
          dto.reason,
        ],
      );
      return res.rows[0];
    });
  }

  /**
   * Approve Leave Request with overlap safety check
   */
  async approveLeave(ctx: RequestContext, requestId: string) {
    return this.db.withContext(ctx, async (client) => {
      const reqRes = await client.query(
        `SELECT * FROM leave_request WHERE id = $1 AND org_id = app.current_org_id()`,
        [requestId],
      );
      if (!reqRes.rows[0]) {
        throw new NotFoundException(`Leave request ${requestId} not found`);
      }

      const leaveReq = reqRes.rows[0];
      if (leaveReq.status === 'approved') {
        return leaveReq;
      }

      // Concurrency lock
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `leave_request:${leaveReq.employee_id}`,
      ]);

      // Check if another approved leave overlaps
      const conflictRes = await client.query(
        `SELECT r.id, r.start_date, r.end_date, t.name AS leave_name
           FROM leave_request r
           JOIN leave_type t ON t.id = r.leave_type_id
          WHERE r.org_id = app.current_org_id()
            AND r.employee_id = $1
            AND r.id <> $2
            AND r.status = 'approved'
            AND r.start_date <= $4::date
            AND r.end_date >= $3::date
          LIMIT 1`,
        [leaveReq.employee_id, requestId, leaveReq.start_date, leaveReq.end_date],
      );

      if (conflictRes.rows[0]) {
        const c = conflictRes.rows[0];
        const startStr =
          typeof c.start_date === 'string'
            ? c.start_date.slice(0, 10)
            : c.start_date.toISOString().slice(0, 10);
        const endStr =
          typeof c.end_date === 'string'
            ? c.end_date.slice(0, 10)
            : c.end_date.toISOString().slice(0, 10);
        throw new BadRequestException(
          `Cannot approve leave: Another approved leave (${c.leave_name}) from ${startStr} to ${endStr} already covers this period.`,
        );
      }

      const year = new Date(leaveReq.start_date).getFullYear();

      // Update request status
      const updatedReq = await client.query(
        `UPDATE leave_request
            SET status = 'approved',
                approved_by = $1,
                approved_at = now(),
                updated_at = now()
          WHERE id = $2 AND org_id = app.current_org_id()
          RETURNING *`,
        [ctx.employeeId, requestId],
      );

      // Deduct from leave allocation if exists
      await client.query(
        `UPDATE leave_allocation
            SET used_days = used_days + $1,
                updated_at = now()
          WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
        [leaveReq.total_days, leaveReq.employee_id, leaveReq.leave_type_id, year],
      );

      return updatedReq.rows[0];
    });
  }

  /**
   * Reject Leave Request
   */
  async rejectLeave(ctx: RequestContext, requestId: string, reason: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE leave_request
            SET status = 'rejected',
                approved_by = $1,
                rejection_reason = $2,
                updated_at = now()
          WHERE id = $3 AND org_id = app.current_org_id()
          RETURNING *`,
        [ctx.employeeId, reason || 'Rejected by approver', requestId],
      );
      if (!res.rows[0]) {
        throw new NotFoundException(`Leave request ${requestId} not found`);
      }
      return res.rows[0];
    });
  }

  /**
   * Cancel Pending Leave Request (Employee Self-Service or Admin)
   */
  async cancelLeave(ctx: RequestContext, requestId: string) {
    return this.db.withContext(ctx, async (client) => {
      const reqRes = await client.query(
        `SELECT * FROM leave_request WHERE id = $1 AND org_id = app.current_org_id()`,
        [requestId],
      );
      if (!reqRes.rows[0]) {
        throw new NotFoundException(`Leave request ${requestId} not found`);
      }

      const leaveReq = reqRes.rows[0];
      if (leaveReq.status !== 'pending') {
        throw new BadRequestException(
          `Cannot cancel a leave request with status "${leaveReq.status}". Only pending applications can be cancelled.`,
        );
      }

      // Check ownership or admin rights
      const isOwner = leaveReq.employee_id === ctx.employeeId;
      if (!isOwner) {
        const empRole = await client.query(
          `SELECT role FROM employee WHERE id = $1 AND org_id = app.current_org_id()`,
          [ctx.employeeId],
        );
        const role = empRole.rows[0]?.role;
        const isAdmin = role === 'admin' || role === 'hr';
        if (!isAdmin) {
          throw new BadRequestException('You do not have permission to cancel this leave application');
        }
      }

      const res = await client.query(
        `UPDATE leave_request
            SET status = 'cancelled',
                updated_at = now()
          WHERE id = $1 AND org_id = app.current_org_id()
          RETURNING *`,
        [requestId],
      );
      return res.rows[0];
    });
  }

  /**
   * List Leave Requests
   */
  async listLeaveRequests(
    ctx: RequestContext,
    params: { employeeId?: string | undefined; status?: string | undefined },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const sqlParams: any[] = [];
      let empFilter = '';
      if (params.employeeId) {
        sqlParams.push(params.employeeId);
        empFilter = `AND r.employee_id = $${sqlParams.length}`;
      }

      let statusFilter = '';
      if (params.status) {
        sqlParams.push(params.status);
        statusFilter = `AND r.status = $${sqlParams.length}`;
      }

      const res = await client.query(
        `SELECT r.*,
                t.code AS "leaveCode",
                t.name AS "leaveName",
                t.is_paid AS "isPaid",
                e.first_name AS "firstName",
                e.last_name AS "lastName",
                e.employee_no AS "employeeNo"
           FROM leave_request r
           JOIN leave_type t ON t.id = r.leave_type_id
           JOIN employee e ON e.id = r.employee_id
          WHERE r.org_id = app.current_org_id()
            ${empFilter}
            ${statusFilter}
          ORDER BY r.created_at DESC`,
        sqlParams,
      );
      return res.rows;
    });
  }

  /**
   * Interconnection query: Get Cutoff Approved Leaves Summary for Payroll Engine
   */
  async getCutoffLeaveSummary(
    ctx: RequestContext,
    employeeId: string,
    startDate: string,
    endDate: string,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT
           COALESCE(SUM(CASE WHEN t.is_paid = TRUE THEN r.total_days ELSE 0 END), 0)::numeric(5, 2) AS "paidLeaveDays",
           COALESCE(SUM(CASE WHEN t.is_paid = FALSE THEN r.total_days ELSE 0 END), 0)::numeric(5, 2) AS "unpaidLeaveDays"
         FROM leave_request r
         JOIN leave_type t ON t.id = r.leave_type_id
        WHERE r.org_id = app.current_org_id()
          AND r.employee_id = $1
          AND r.status = 'approved'
          AND r.start_date <= $3::date AND r.end_date >= $2::date`,
        [employeeId, startDate, endDate],
      );

      return res.rows[0] || { paidLeaveDays: 0, unpaidLeaveDays: 0 };
    });
  }
}
