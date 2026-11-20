import { Injectable, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService, RequestContext } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { calculatePhilippineAttendancePay } from './calculators/ph-overtime.calculator';
import { hashPassword, verifyPassword } from '../common/crypto';

export interface ClockInOutDto {
  workDate?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
}

export interface KioskPunchDto {
  employeeNo?: string;
  employeeNumber?: string;
  pin: string;
  punchType?: 'clock_in' | 'clock_out';
  branchId?: string;
  workDate?: string;
}

export interface EnrollPinDto {
  employeeId: string;
  pin: string;
}

export interface ManualDtrDto {
  employeeId: string;
  workDate: string;
  shiftId?: string;
  clockIn?: string;
  clockOut?: string;
  totalHoursWorked?: number;
  regularHours?: number;
  tardinessMinutes?: number;
  undertimeMinutes?: number;
  regularOtHours?: number;
  restDayOtHours?: number;
  holidayOtHours?: number;
  nightDiffHours?: number;
  isRestDay?: boolean;
  isAbsent?: boolean;
  isHalfDay?: boolean;
  halfDayPeriod?: 'am' | 'pm' | 'first_half' | 'second_half';
  notes?: string;
}

export interface CreateShiftDto {
  code: string;
  name: string;
  startTime: string; // HH:mm:ss
  endTime: string;
  breakMinutes?: number;
  gracePeriodMins?: number;
  isNightShift?: boolean;
  isBrokenShift?: boolean;
  secondStartTime?: string;
  secondEndTime?: string;
}

export interface CreateHolidayDto {
  name: string;
  holidayDate: string;
  holidayType: 'regular' | 'special_non_working' | 'special_working';
  branchId?: string | null;
}

export interface RosterAssignDto {
  employeeIds: string[];
  shiftId: string;
  startDate: string;
  endDate: string;
  restDaysOfWeek?: number[]; // e.g. [0] for Sunday
  notes?: string;
}

export interface ShiftSwapDto {
  targetEmployeeId: string;
  requesterDate: string;
  targetDate: string;
  reason: string;
}

export interface CompOffAwardDto {
  employeeId: string;
  earnedHours: number;
  earnedDate: string;
  expiryMonths?: number;
  sourceOtRecordId?: string;
  reason: string;
}

export interface TimesheetAdjustmentDto {
  workDate: string;
  requestedClockIn?: string;
  requestedClockOut?: string;
  reason: string;
}

export interface DisciplinaryMemoDto {
  employeeId: string;
  memoType: 'tardiness_nte' | 'undertime_nte' | 'awol_nte' | 'written_reprimand';
  incidentPeriodStart: string;
  incidentPeriodEnd: string;
  totalInfractions: number;
  details: string;
  responseDueDate: string;
}

export interface BusinessTripDto {
  destination: string;
  purpose: string;
  startDate: string;
  endDate: string;
  perDiemAmount?: number;
}

export interface MealVoucherDto {
  employeeId: string;
  mealType?: 'duty_meal' | 'overtime_meal' | 'banquet_meal';
}

@Injectable()
export class AttendanceService {
  constructor(private readonly db: DbService) {}

  // ---------------------------------------------------------------------------
  // 1. Terminal Kiosk Passcode (PIN) Enrollment & Clocking
  // ---------------------------------------------------------------------------

  /**
   * HR enrolls or updates an employee's kiosk passcode / PIN
   */
  async enrollKioskPin(ctx: RequestContext, dto: EnrollPinDto) {
    if (!dto.pin || dto.pin.trim().length < 4 || dto.pin.trim().length > 8) {
      throw new BadRequestException('Passcode PIN must be between 4 and 8 digits');
    }
    const cleanPin = dto.pin.trim();
    const pinHash = hashPassword(cleanPin);

    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO app.terminal_credential (
           org_id, employee_id, kiosk_pin_hash, is_active, enrolled_by, enrolled_at, updated_at
         ) VALUES (app.current_org_id(), $1, $2, TRUE, $3, now(), now())
         ON CONFLICT (employee_id) DO UPDATE SET
           kiosk_pin_hash = EXCLUDED.kiosk_pin_hash,
           is_active = TRUE,
           enrolled_by = EXCLUDED.enrolled_by,
           updated_at = now()
         RETURNING employee_id, is_active, enrolled_at, last_punch_at`,
        [dto.employeeId, pinHash, ctx.employeeId],
      );
      return { success: true, credential: res.rows[0] };
    });
  }

  /**
   * Lists enrollment status of employees in tenant for HR console
   */
  async listTerminalEnrollments(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT e.id AS "employeeId",
                e.employee_no AS "employeeNo",
                e.first_name AS "firstName",
                e.last_name AS "lastName",
                e.work_email AS "workEmail",
                COALESCE(tc.is_active, FALSE) AS "isEnrolled",
                tc.enrolled_at AS "enrolledAt",
                tc.last_punch_at AS "lastPunchAt",
                COALESCE(b.name, 'Headquarters') AS "branchName"
           FROM employee e
           LEFT JOIN app.terminal_credential tc ON tc.employee_id = e.id
           LEFT JOIN employee_compensation ec ON ec.employee_id = e.id
           LEFT JOIN branch b ON b.id = ec.branch_id
          WHERE e.org_id = app.current_org_id() AND e.deleted_at IS NULL
          ORDER BY e.employee_no ASC`,
      );
      return res.rows;
    });
  }

  /**
   * Kiosk Punch (Emp No + Passcode) on tablet/terminal
   */
  async kioskPunch(dto: KioskPunchDto) {
    const cleanEmpNo = (dto.employeeNo || dto.employeeNumber || '').trim().toUpperCase();
    const cleanPin = (dto.pin || '').trim();

    if (!cleanEmpNo || !cleanPin) {
      throw new BadRequestException('Employee number and passcode are required');
    }

    const requestId = randomUUID();
    return this.db.withSystemContext(requestId, async (client) => {
      // Find employee by employee_no using SECURITY DEFINER lookup
      const empRes = await client.query(
        `SELECT employee_id AS id, org_id, employee_no, first_name, last_name,
                kiosk_pin_hash, is_active AS "isPinActive"
           FROM app.lookup_kiosk_credential($1)`,
        [cleanEmpNo],
      );

      if (empRes.rows.length === 0) {
        throw new NotFoundException(`Employee '${cleanEmpNo}' not found or no kiosk passcode enrolled`);
      }

      const emp = empRes.rows[0];
      if (!emp.kiosk_pin_hash || !emp.isPinActive) {
        throw new BadRequestException(`Employee has not been enrolled with a kiosk passcode yet`);
      }

      // Verify passcode
      const valid = verifyPassword(cleanPin, emp.kiosk_pin_hash);
      if (!valid) {
        throw new UnauthorizedException('Incorrect passcode PIN');
      }

      // Set local tenant context for RLS
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [emp.org_id]);
      await client.query(`SELECT set_config('app.current_employee_id', $1, true)`, [emp.id]);

      const now = new Date();
      const today = dto.workDate || now.toISOString().slice(0, 10);

      // Check today's attendance record
      const existing = await client.query(
        `SELECT * FROM attendance_record WHERE employee_id = $1 AND work_date = $2`,
        [emp.id, today],
      );

      let action = 'clock_in';
      let record: any;

      if (!existing.rows[0]) {
        // Clock In
        const insertRes = await client.query(
          `INSERT INTO attendance_record (
             org_id, employee_id, branch_id, work_date, clock_in,
             punch_source, status
           ) VALUES ($1, $2, $3, $4, $5, 'kiosk', 'submitted')
           RETURNING *`,
          [emp.org_id, emp.id, dto.branchId || null, today, now],
        );
        record = insertRes.rows[0];
        action = 'clock_in';
      } else {
        // Clock Out
        const rec = existing.rows[0];
        const clockInTime = new Date(rec.clock_in);
        const hoursWorked = Math.max(
          0,
          Math.round(((now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60)) * 100) / 100,
        );
        const regularHours = Math.min(8.0, hoursWorked);
        const regularOt = Math.max(0, Math.round((hoursWorked - 8.0) * 100) / 100);

        const updateRes = await client.query(
          `UPDATE attendance_record
              SET clock_out = $1,
                  total_hours_worked = $2,
                  regular_hours = $3,
                  regular_ot_hours = $4,
                  updated_at = now()
            WHERE id = $5
            RETURNING *`,
          [now, hoursWorked, regularHours, regularOt, rec.id],
        );
        record = updateRes.rows[0];
        action = 'clock_out';
      }

      // Update terminal last_punch_at
      await client.query(
        `UPDATE app.terminal_credential SET last_punch_at = $1 WHERE employee_id = $2`,
        [now, emp.id],
      );

      return {
        success: true,
        action,
        timestamp: now.toISOString(),
        employee: {
          id: emp.id,
          employeeNo: emp.employee_no,
          firstName: emp.first_name,
          lastName: emp.last_name,
        },
        record,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Personal Web/App Clock In & Out
  // ---------------------------------------------------------------------------

  async clock(ctx: RequestContext, dto: ClockInOutDto) {
    return this.db.withContext(ctx, async (client) => {
      const today = dto.workDate || new Date().toISOString().slice(0, 10);
      const now = new Date();

      const existing = await client.query(
        `SELECT * FROM attendance_record WHERE employee_id = $1 AND work_date = $2`,
        [ctx.employeeId, today],
      );

      if (!existing.rows[0]) {
        const res = await client.query(
          `INSERT INTO attendance_record (
             org_id, employee_id, work_date, clock_in, status, notes,
             clock_in_latitude, clock_in_longitude, punch_source
           ) VALUES (app.current_org_id(), $1, $2, $3, 'submitted', $4, $5, $6, 'web')
           RETURNING *`,
          [ctx.employeeId, today, now, dto.notes || null, dto.latitude || null, dto.longitude || null],
        );
        return { action: 'clock_in', record: res.rows[0] };
      } else {
        const rec = existing.rows[0];
        const clockInTime = new Date(rec.clock_in);
        const hoursWorked = Math.max(
          0,
          Math.round(((now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60)) * 100) / 100,
        );
        const regularHours = Math.min(8.0, hoursWorked);
        const regularOt = Math.max(0, Math.round((hoursWorked - 8.0) * 100) / 100);

        const res = await client.query(
          `UPDATE attendance_record
              SET clock_out = $1,
                  total_hours_worked = $2,
                  regular_hours = $3,
                  regular_ot_hours = $4,
                  updated_at = now()
            WHERE id = $5
            RETURNING *`,
          [now, hoursWorked, regularHours, regularOt, rec.id],
        );
        return { action: 'clock_out', record: res.rows[0] };
      }
    });
  }

  /**
   * List Daily Time Records (DTR)
   */
  async listRecords(
    ctx: RequestContext,
    params: { startDate: string; endDate: string; employeeId?: string | undefined; branchId?: string | undefined },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const sqlParams: any[] = [params.startDate, params.endDate];
      let empFilter = '';
      if (params.employeeId) {
        sqlParams.push(params.employeeId);
        empFilter = `AND r.employee_id = $${sqlParams.length}`;
      }

      let branchFilter = '';
      if (params.branchId) {
        sqlParams.push(params.branchId);
        branchFilter = `AND (r.branch_id = $${sqlParams.length} OR r.branch_id IS NULL)`;
      }

      const res = await client.query(
        `SELECT r.*,
                e.employee_no AS "employeeNo",
                e.first_name AS "firstName",
                e.last_name AS "lastName",
                s.name AS "shiftName",
                s.code AS "shiftCode",
                b.name AS "branchName"
           FROM attendance_record r
           JOIN employee e ON e.id = r.employee_id
           LEFT JOIN attendance_shift s ON s.id = r.shift_id
           LEFT JOIN branch b ON b.id = r.branch_id
          WHERE r.org_id = app.current_org_id()
            AND r.work_date >= $1 AND r.work_date <= $2
            ${empFilter}
            ${branchFilter}
          ORDER BY r.work_date DESC, e.last_name ASC`,
        sqlParams,
      );
      return res.rows;
    });
  }

  async recordManualDtr(ctx: RequestContext, dto: ManualDtrDto) {
    return this.db.withContext(ctx, async (client) => {
      const totalHours = dto.totalHoursWorked ?? (dto.regularHours ?? 8.0) + (dto.regularOtHours ?? 0);
      const regularHours = dto.regularHours ?? Math.min(8.0, totalHours);

      const res = await client.query(
        `INSERT INTO attendance_record (
           org_id, employee_id, shift_id, work_date, clock_in, clock_out,
           total_hours_worked, regular_hours, tardiness_minutes, undertime_minutes,
           regular_ot_hours, rest_day_ot_hours, holiday_ot_hours, night_diff_hours,
           is_rest_day, is_absent, is_half_day, half_day_period, status, notes
         ) VALUES (
           app.current_org_id(), $1, $2, $3, $4::timestamptz, $5::timestamptz,
           $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'approved', $18
         )
         ON CONFLICT (employee_id, work_date) DO UPDATE SET
           shift_id = EXCLUDED.shift_id,
           clock_in = EXCLUDED.clock_in,
           clock_out = EXCLUDED.clock_out,
           total_hours_worked = EXCLUDED.total_hours_worked,
           regular_hours = EXCLUDED.regular_hours,
           tardiness_minutes = EXCLUDED.tardiness_minutes,
           undertime_minutes = EXCLUDED.undertime_minutes,
           regular_ot_hours = EXCLUDED.regular_ot_hours,
           rest_day_ot_hours = EXCLUDED.rest_day_ot_hours,
           holiday_ot_hours = EXCLUDED.holiday_ot_hours,
           night_diff_hours = EXCLUDED.night_diff_hours,
           is_rest_day = EXCLUDED.is_rest_day,
           is_absent = EXCLUDED.is_absent,
           is_half_day = EXCLUDED.is_half_day,
           half_day_period = EXCLUDED.half_day_period,
           status = 'approved',
           notes = EXCLUDED.notes,
           updated_at = now()
         RETURNING *`,
        [
          dto.employeeId,
          dto.shiftId || null,
          dto.workDate,
          dto.clockIn || null,
          dto.clockOut || null,
          totalHours,
          regularHours,
          dto.tardinessMinutes ?? 0,
          dto.undertimeMinutes ?? 0,
          dto.regularOtHours ?? 0,
          dto.restDayOtHours ?? 0,
          dto.holidayOtHours ?? 0,
          dto.nightDiffHours ?? 0,
          dto.isRestDay ?? false,
          dto.isAbsent ?? false,
          dto.isHalfDay ?? false,
          dto.halfDayPeriod || null,
          dto.notes || null,
        ],
      );
      return res.rows[0];
    });
  }

  async approveDtr(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE attendance_record
            SET status = 'approved',
                approved_by = $1,
                updated_at = now()
          WHERE id = $2 AND org_id = app.current_org_id()
          RETURNING *`,
        [ctx.employeeId, id],
      );
      if (res.rowCount === 0) throw new NotFoundException('DTR record not found');
      return res.rows[0];
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Shift Management, Rostering & Broken Shifts
  // ---------------------------------------------------------------------------

  async listShifts(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT * FROM attendance_shift
          WHERE org_id = app.current_org_id() AND is_active = TRUE
          ORDER BY start_time ASC`,
      );
      return res.rows;
    });
  }

  async createShift(ctx: RequestContext, dto: CreateShiftDto) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO attendance_shift (
           org_id, code, name, start_time, end_time, break_minutes, grace_period_mins,
           is_night_shift, is_broken_shift, second_start_time, second_end_time
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          dto.code.toUpperCase(),
          dto.name,
          dto.startTime,
          dto.endTime,
          dto.breakMinutes ?? 60,
          dto.gracePeriodMins ?? 15,
          dto.isNightShift ?? false,
          dto.isBrokenShift ?? false,
          dto.secondStartTime || null,
          dto.secondEndTime || null,
        ],
      );
      return res.rows[0];
    });
  }

  async batchAssignRoster(ctx: RequestContext, dto: RosterAssignDto) {
    return this.db.withContext(ctx, async (client) => {
      const restDays = dto.restDaysOfWeek || [0]; // default Sunday
      const start = new Date(dto.startDate);
      const end = new Date(dto.endDate);
      let count = 0;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const dayOfWeek = d.getDay();
        const isRest = restDays.includes(dayOfWeek);

        for (const empId of dto.employeeIds) {
          await client.query(
            `INSERT INTO attendance_roster (
               org_id, employee_id, shift_id, roster_date, is_rest_day, notes
             ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5)
             ON CONFLICT (employee_id, roster_date) DO UPDATE SET
               shift_id = EXCLUDED.shift_id,
               is_rest_day = EXCLUDED.is_rest_day,
               notes = EXCLUDED.notes,
               updated_at = now()`,
            [empId, isRest ? null : dto.shiftId, dateStr, isRest, dto.notes || null],
          );
          count++;
        }
      }
      return { success: true, totalEntriesAssigned: count };
    });
  }

  async listRoster(ctx: RequestContext, params: { startDate: string; endDate: string; employeeId?: string | undefined }) {
    return this.db.withContext(ctx, async (client) => {
      const sqlParams: any[] = [params.startDate, params.endDate];
      let empFilter = '';
      if (params.employeeId) {
        sqlParams.push(params.employeeId);
        empFilter = `AND ar.employee_id = $${sqlParams.length}`;
      }

      const res = await client.query(
        `SELECT ar.*,
                e.employee_no AS "employeeNo",
                e.first_name AS "firstName",
                e.last_name AS "lastName",
                s.name AS "shiftName",
                s.code AS "shiftCode",
                s.start_time AS "startTime",
                s.end_time AS "endTime"
           FROM attendance_roster ar
           JOIN employee e ON e.id = ar.employee_id
           LEFT JOIN attendance_shift s ON s.id = ar.shift_id
          WHERE ar.org_id = app.current_org_id()
            AND ar.roster_date >= $1 AND ar.roster_date <= $2
            ${empFilter}
          ORDER BY ar.roster_date ASC, e.last_name ASC`,
        sqlParams,
      );
      return res.rows;
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Shift Swapping & Compensatory Time Off (Comp-Off)
  // ---------------------------------------------------------------------------

  async applyShiftSwap(ctx: RequestContext, dto: ShiftSwapDto) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO shift_swap_request (
           org_id, requester_employee_id, target_employee_id,
           requester_date, target_date, reason
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5)
         RETURNING *`,
        [ctx.employeeId, dto.targetEmployeeId, dto.requesterDate, dto.targetDate, dto.reason],
      );
      return res.rows[0];
    });
  }

  async listShiftSwaps(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT ss.*,
                req.first_name || ' ' || req.last_name AS "requesterName",
                tar.first_name || ' ' || tar.last_name AS "targetName"
           FROM shift_swap_request ss
           JOIN employee req ON req.id = ss.requester_employee_id
           JOIN employee tar ON tar.id = ss.target_employee_id
          WHERE ss.org_id = app.current_org_id()
          ORDER BY ss.created_at DESC`,
      );
      return res.rows;
    });
  }

  async approveShiftSwap(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE shift_swap_request
            SET status = 'approved',
                approved_by = $1,
                approved_at = now(),
                updated_at = now()
          WHERE id = $2 AND org_id = app.current_org_id()
          RETURNING *`,
        [ctx.employeeId, id],
      );
      if (res.rowCount === 0) throw new NotFoundException('Shift swap not found');
      return res.rows[0];
    });
  }

  async awardCompOff(ctx: RequestContext, dto: CompOffAwardDto) {
    return this.db.withContext(ctx, async (client) => {
      const earned = new Date(dto.earnedDate);
      const expiry = new Date(earned);
      expiry.setMonth(expiry.getMonth() + (dto.expiryMonths || 6)); // Default 6 months valid

      const res = await client.query(
        `INSERT INTO comp_off_ledger (
           org_id, employee_id, earned_hours, earned_date, expiry_date,
           source_ot_record_id, reason
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          dto.employeeId,
          dto.earnedHours,
          dto.earnedDate,
          expiry.toISOString().slice(0, 10),
          dto.sourceOtRecordId || null,
          dto.reason,
        ],
      );
      return res.rows[0];
    });
  }

  async listCompOffBalances(ctx: RequestContext, employeeId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const targetEmp = employeeId || ctx.employeeId;
      const res = await client.query(
        `SELECT COALESCE(SUM(remaining_hours), 0.00)::numeric(6, 2) AS "totalRemainingHours",
                jsonb_agg(co ORDER BY co.earned_date DESC) AS "ledger"
           FROM comp_off_ledger co
          WHERE co.org_id = app.current_org_id()
            AND co.employee_id = $1
            AND co.expiry_date >= CURRENT_DATE
            AND co.remaining_hours > 0`,
        [targetEmp],
      );
      return res.rows[0] || { totalRemainingHours: 0, ledger: [] };
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Timesheet Dispute & Adjustment Requests
  // ---------------------------------------------------------------------------

  async requestTimesheetAdjustment(ctx: RequestContext, dto: TimesheetAdjustmentDto) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO timesheet_adjustment_request (
           org_id, employee_id, work_date, requested_clock_in, requested_clock_out, reason
         ) VALUES (app.current_org_id(), $1, $2, $3::timestamptz, $4::timestamptz, $5)
         RETURNING *`,
        [
          ctx.employeeId,
          dto.workDate,
          dto.requestedClockIn || null,
          dto.requestedClockOut || null,
          dto.reason,
        ],
      );
      return res.rows[0];
    });
  }

  async listTimesheetAdjustments(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT tar.*,
                e.first_name || ' ' || e.last_name AS "employeeName",
                e.employee_no AS "employeeNo"
           FROM timesheet_adjustment_request tar
           JOIN employee e ON e.id = tar.employee_id
          WHERE tar.org_id = app.current_org_id()
          ORDER BY tar.created_at DESC`,
      );
      return res.rows;
    });
  }

  async approveTimesheetAdjustment(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const reqRes = await client.query(
        `SELECT * FROM timesheet_adjustment_request WHERE id = $1 AND org_id = app.current_org_id()`,
        [id],
      );
      if (reqRes.rowCount === 0) throw new NotFoundException('Adjustment request not found');
      const adj = reqRes.rows[0];

      // Update attendance record with requested times
      if (adj.requested_clock_in && adj.requested_clock_out) {
        const inTime = new Date(adj.requested_clock_in);
        const outTime = new Date(adj.requested_clock_out);
        const hours = Math.round(((outTime.getTime() - inTime.getTime()) / (1000 * 60 * 60)) * 100) / 100;

        await client.query(
          `INSERT INTO attendance_record (
             org_id, employee_id, work_date, clock_in, clock_out,
             total_hours_worked, regular_hours, regular_ot_hours, status, notes
           ) VALUES (
             app.current_org_id(), $1, $2, $3, $4, $5, 8.0, $6, 'approved', 'Adjustment applied'
           ) ON CONFLICT (employee_id, work_date) DO UPDATE SET
             clock_in = EXCLUDED.clock_in,
             clock_out = EXCLUDED.clock_out,
             total_hours_worked = EXCLUDED.total_hours_worked,
             regular_hours = 8.0,
             regular_ot_hours = EXCLUDED.regular_ot_hours,
             tardiness_minutes = 0,
             status = 'approved'`,
          [adj.employee_id, adj.work_date, inTime, outTime, hours, Math.max(0, hours - 8.0)],
        );
      }

      const updateRes = await client.query(
        `UPDATE timesheet_adjustment_request
            SET status = 'approved', approved_by = $1, approved_at = now(), updated_at = now()
          WHERE id = $2 RETURNING *`,
        [ctx.employeeId, id],
      );
      return updateRes.rows[0];
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Habitual Tardiness Monitoring & Notice to Explain (NTE) Memos
  // ---------------------------------------------------------------------------

  async getTardinessInfractionsSummary(ctx: RequestContext, monthStr: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT e.id AS "employeeId",
                e.employee_no AS "employeeNo",
                e.first_name || ' ' || e.last_name AS "employeeName",
                d.name AS "departmentName",
                COUNT(*) FILTER (WHERE r.tardiness_minutes > 0)::integer AS "tardinessCount",
                COALESCE(SUM(r.tardiness_minutes), 0)::integer AS "totalTardinessMinutes",
                COUNT(*) FILTER (WHERE r.undertime_minutes > 0)::integer AS "undertimeCount",
                COALESCE(SUM(r.undertime_minutes), 0)::integer AS "totalUndertimeMinutes",
                CASE WHEN COUNT(*) FILTER (WHERE r.tardiness_minutes > 0) >= 3 THEN TRUE ELSE FALSE END AS "isHabitualTardy"
           FROM employee e
           LEFT JOIN employment emp ON emp.employee_id = e.id AND emp.effective_to IS NULL
           LEFT JOIN department d ON d.id = emp.department_id
           JOIN attendance_record r ON r.employee_id = e.id AND to_char(r.work_date, 'YYYY-MM') = $1
          WHERE e.org_id = app.current_org_id()
          GROUP BY e.id, e.employee_no, e.first_name, e.last_name, d.name
         HAVING COUNT(*) FILTER (WHERE r.tardiness_minutes > 0) > 0
          ORDER BY "tardinessCount" DESC, "totalTardinessMinutes" DESC`,
        [monthStr],
      );
      return res.rows;
    });
  }

  async issueDisciplinaryMemo(ctx: RequestContext, dto: DisciplinaryMemoDto) {
    return this.db.withContext(ctx, async (client) => {
      const memoNum = `NTE-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      const res = await client.query(
        `INSERT INTO disciplinary_memo (
           org_id, employee_id, memo_number, memo_type, incident_period_start,
           incident_period_end, total_infractions, infraction_details,
           issued_by, response_due_date, status
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'issued')
         RETURNING *`,
        [
          dto.employeeId,
          memoNum,
          dto.memoType,
          dto.incidentPeriodStart,
          dto.incidentPeriodEnd,
          dto.totalInfractions,
          dto.details,
          ctx.employeeId,
          dto.responseDueDate,
        ],
      );
      await NotificationsService.tryEnqueue(client, dto.employeeId, 'disciplinary_memo_issued', {
        memoNumber: memoNum,
        memoType: dto.memoType,
        responseDueDate: dto.responseDueDate,
      });
      return res.rows[0];
    });
  }

  async listDisciplinaryMemos(ctx: RequestContext, employeeId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const sqlParams: any[] = [];
      let empFilter = '';
      if (employeeId) {
        sqlParams.push(employeeId);
        empFilter = `AND m.employee_id = $${sqlParams.length}`;
      }

      const res = await client.query(
        `SELECT m.*,
                e.first_name || ' ' || e.last_name AS "employeeName",
                e.employee_no AS "employeeNo",
                iss.first_name || ' ' || iss.last_name AS "issuedByName"
           FROM disciplinary_memo m
           JOIN employee e ON e.id = m.employee_id
           LEFT JOIN employee iss ON iss.id = m.issued_by
          WHERE m.org_id = app.current_org_id()
            ${empFilter}
          ORDER BY m.created_at DESC`,
        sqlParams,
      );
      return res.rows;
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Official Business (OB) & Travel Orders
  // ---------------------------------------------------------------------------

  async applyBusinessTrip(ctx: RequestContext, dto: BusinessTripDto) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO business_trip_request (
           org_id, employee_id, destination, purpose, start_date, end_date, per_diem_amount
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          ctx.employeeId,
          dto.destination,
          dto.purpose,
          dto.startDate,
          dto.endDate,
          dto.perDiemAmount ?? 0,
        ],
      );
      return res.rows[0];
    });
  }

  async listBusinessTrips(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT bt.*,
                e.first_name || ' ' || e.last_name AS "employeeName",
                e.employee_no AS "employeeNo"
           FROM business_trip_request bt
           JOIN employee e ON e.id = bt.employee_id
          WHERE bt.org_id = app.current_org_id()
          ORDER BY bt.created_at DESC`,
      );
      return res.rows;
    });
  }

  async approveBusinessTrip(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE business_trip_request
            SET status = 'approved', approved_by = $1, approved_at = now(), updated_at = now()
          WHERE id = $2 AND org_id = app.current_org_id()
          RETURNING *`,
        [ctx.employeeId, id],
      );
      if (res.rowCount === 0) throw new NotFoundException('Business trip not found');
      return res.rows[0];
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Hotel Staff Duty Meal Vouchers
  // ---------------------------------------------------------------------------

  async issueMealVoucher(ctx: RequestContext, dto: MealVoucherDto) {
    return this.db.withContext(ctx, async (client) => {
      const code = `MEAL-${Math.floor(100000 + Math.random() * 900000)}`;
      const res = await client.query(
        `INSERT INTO meal_voucher_log (
           org_id, employee_id, voucher_code, meal_type, status
         ) VALUES (app.current_org_id(), $1, $2, $3, 'issued')
         RETURNING *`,
        [dto.employeeId, code, dto.mealType || 'duty_meal'],
      );
      return res.rows[0];
    });
  }

  async listMealVouchers(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT mv.*,
                e.first_name || ' ' || e.last_name AS "employeeName",
                e.employee_no AS "employeeNo"
           FROM meal_voucher_log mv
           JOIN employee e ON e.id = mv.employee_id
          WHERE mv.org_id = app.current_org_id()
          ORDER BY mv.created_at DESC`,
      );
      return res.rows;
    });
  }

  async redeemMealVoucher(ctx: RequestContext, voucherCode: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE meal_voucher_log
            SET status = 'redeemed', redeemed_at = now()
          WHERE voucher_code = $1 AND org_id = app.current_org_id() AND status = 'issued'
          RETURNING *`,
        [voucherCode.trim().toUpperCase()],
      );
      if (res.rowCount === 0) throw new BadRequestException('Invalid or already redeemed voucher code');
      return res.rows[0];
    });
  }

  // ---------------------------------------------------------------------------
  // 9. Statutory Holidays
  // ---------------------------------------------------------------------------

  async listHolidays(ctx: RequestContext, year: number) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT h.*, b.name AS branch_name
           FROM holiday_calendar h
           LEFT JOIN branch b ON b.id = h.branch_id
          WHERE h.org_id = app.current_org_id() AND h.year = $1
          ORDER BY h.holiday_date ASC`,
        [year],
      );
      return res.rows;
    });
  }

  async createHoliday(ctx: RequestContext, dto: CreateHolidayDto) {
    return this.db.withContext(ctx, async (client) => {
      const year = new Date(dto.holidayDate).getFullYear();
      const res = await client.query(
        `INSERT INTO holiday_calendar (
           org_id, branch_id, name, holiday_date, holiday_type, year
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5)
         RETURNING *`,
        [dto.branchId || null, dto.name, dto.holidayDate, dto.holidayType, year],
      );
      return res.rows[0];
    });
  }

  async getCutoffAttendanceSummary(
    ctx: RequestContext,
    employeeId: string,
    startDate: string,
    endDate: string,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT
           COALESCE(SUM(regular_ot_hours), 0.00)::numeric(8, 2) AS "regularOtHours",
           COALESCE(SUM(rest_day_ot_hours), 0.00)::numeric(8, 2) AS "restDayOtHours",
           COALESCE(SUM(holiday_ot_hours), 0.00)::numeric(8, 2) AS "holidayOtHours",
           COALESCE(SUM(night_diff_hours), 0.00)::numeric(8, 2) AS "nightDiffHours",
           COALESCE(SUM(tardiness_minutes), 0)::integer AS "tardinessMinutes",
           COALESCE(SUM(undertime_minutes), 0)::integer AS "undertimeMinutes",
           COUNT(*) FILTER (WHERE is_absent = TRUE)::integer AS "absentDays"
         FROM attendance_record
        WHERE org_id = app.current_org_id()
          AND employee_id = $1
          AND work_date >= $2 AND work_date <= $3
          AND status = 'approved'`,
        [employeeId, startDate, endDate],
      );

      return res.rows[0] || {
        regularOtHours: 0,
        restDayOtHours: 0,
        holidayOtHours: 0,
        nightDiffHours: 0,
        tardinessMinutes: 0,
        undertimeMinutes: 0,
        absentDays: 0,
      };
    });
  }

  async listBranches(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT id, code, name, region
           FROM branch
          WHERE org_id = app.current_org_id()
          ORDER BY code ASC`,
      );
      return res.rows;
    });
  }
}
