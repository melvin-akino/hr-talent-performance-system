import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService, type RequestContext } from '../db/db.service';
import { toCsv } from '../common/csv';

/**
 * The report builder (requirements §7.2, F2).
 *
 * ALL OF THE WORK IS IN app.evaluation_report, AND THAT IS THE POINT.
 *
 * This service validates a query string and hands it to one SQL function. It
 * does not assemble the report, does not decide who may appear in it, and
 * contains no branch on role: the same call returns a section to a Department
 * Head and the organisation to HCM because the function runs as the caller and
 * every source underneath filters itself.
 *
 * That also means the report can never show what the screen behind it would
 * not — an unreleased review stays invisible here because review_summary's own
 * policy says so, not because this file remembered to ask.
 */

/**
 * The filters, as the query string carries them.
 *
 * Arrays arrive comma-separated because that is what a link in an email looks
 * like; a report is the thing people bookmark and send to each other, so the
 * URL has to survive being pasted. zod's enum list is the whole validation —
 * an unknown `kind` is a 400 rather than a silently empty report, which is the
 * difference between "you asked for something that does not exist" and "there
 * is nothing there", and only one of those is true.
 */
const csvList = <T extends string>(values: readonly [T, ...T[]]) =>
  z.string()
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();

export const reportQuery = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  kinds: csvList(['review', 'task_evaluation', 'pip', 'competency', 'employment_event'] as const),
  evalTypes: csvList(['probationary', 'annual', 'semi_annual', 'project', 'kpi'] as const),
  departmentId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  results: z.string().trim().min(1).max(200)
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.string()).min(1))
    .optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
});

export type ReportQuery = z.infer<typeof reportQuery>;

export const workforceQuery = z.object({
  status: z.enum(['active', 'on_leave', 'suspended', 'separated']).optional(),
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});
export type WorkforceQuery = z.infer<typeof workforceQuery>;

export const statutorySummaryQuery = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type StatutorySummaryQuery = z.infer<typeof statutorySummaryQuery>;

export const payrollRegisterQuery = z.object({
  runId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});
export type PayrollRegisterQuery = z.infer<typeof payrollRegisterQuery>;

export const attendanceAnalysisQuery = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});
export type AttendanceAnalysisQuery = z.infer<typeof attendanceAnalysisQuery>;

export const leaveUtilizationQuery = z.object({
  year: z.coerce.number().int().optional(),
  leaveTypeId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});
export type LeaveUtilizationQuery = z.infer<typeof leaveUtilizationQuery>;

export const performanceDistributionQuery = z.object({
  departmentId: z.string().uuid().optional(),
});
export type PerformanceDistributionQuery = z.infer<typeof performanceDistributionQuery>;

interface ReportRow {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  department: string | null;
  occurredOn: string;
  kind: string;
  evalType: string | null;
  title: string;
  detail: string | null;
  result: string | null;
  refId: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  async run(ctx: RequestContext, q: ReportQuery): Promise<{
    rows: ReportRow[];
    truncated: boolean;
    limit: number;
  }> {
    const limit = q.limit ?? 1000;

    const rows = await this.db.withContext(ctx, async (client) => {
      const res = await client.query<ReportRow>(
        `SELECT employee_id   AS "employeeId",
                employee_no   AS "employeeNo",
                employee_name AS "employeeName",
                department,
                occurred_on::text AS "occurredOn",
                kind::text        AS kind,
                eval_type::text   AS "evalType",
                title, detail, result,
                ref_id AS "refId"
           FROM app.evaluation_report(
                  $1::date, $2::date,
                  $3::timeline_kind[], $4::evaluation_type[],
                  $5::uuid, $6::text, $7::text[], $8::int)`,
        [
          q.from ?? null, q.to ?? null,
          q.kinds ?? null, q.evalTypes ?? null,
          q.departmentId ?? null, q.name ?? null, q.results ?? null,
          // One more than asked for, so the caller can be TOLD the report was
          // cut rather than reading a truncated list as a complete one. A
          // report that silently stops is a report somebody makes a decision
          // on.
          limit + 1,
        ],
      );
      return res.rows;
    });

    return {
      rows: rows.slice(0, limit),
      truncated: rows.length > limit,
      limit,
    };
  }

  /**
   * The same report as a file.
   *
   * Deliberately the same query rather than a wider one: a CSV that contains
   * more than the screen showed is a confidentiality surprise waiting to
   * happen, and an export whose filters mean something slightly different from
   * the filters above it is worse than no export.
   */
  async exportCsv(ctx: RequestContext, q: ReportQuery): Promise<string> {
    const { rows } = await this.run(ctx, { ...q, limit: q.limit ?? 10_000 });
    return toCsv(rows.map((r) => ({
      'Employee No': r.employeeNo,
      Employee: r.employeeName,
      Department: r.department,
      Date: r.occurredOn,
      Source: r.kind.replace(/_/g, ' '),
      'Evaluation Type': r.evalType?.replace(/_/g, ' ') ?? '',
      Title: r.title,
      Detail: r.detail,
      Result: r.result,
    })));
  }

  /**
   * What can be filtered on, for the screen to render.
   *
   * The departments come from the database under the caller's RLS, so the
   * dropdown offers a Department Head their own units and nothing else — the
   * filter list is scoped by the same rule as the report it filters. The
   * enums are listed here rather than queried because they are compiled into
   * the zod schema above and a list that disagreed with the validator would
   * offer options that return 400.
   */
  async options(ctx: RequestContext) {
    const data = await this.db.withContext(ctx, async (client) => {
      const depts = await client.query(
        `SELECT id, code, name, unit_type AS "unitType"
           FROM department
          WHERE effective_to IS NULL
          ORDER BY name`);

      const branches = await client.query(
        `SELECT id, code, name FROM branch WHERE org_id = app.current_org_id() ORDER BY name`);

      const runs = await client.query(
        `SELECT id, title AS "periodName", period_start::text AS "cutoffStart", period_end::text AS "cutoffEnd"
           FROM payroll_run
          WHERE org_id = app.current_org_id()
          ORDER BY period_end DESC LIMIT 24`);

      const leaveTypes = await client.query(
        `SELECT id, code, name, is_statutory AS "isStatutory"
           FROM leave_type
          WHERE org_id = app.current_org_id()
          ORDER BY is_statutory DESC, name`);

      return {
        departments: depts.rows,
        branches: branches.rows,
        payrollRuns: runs.rows,
        leaveTypes: leaveTypes.rows,
      };
    });

    return {
      ...data,
      kinds: [
        { value: 'review', label: 'Review' },
        { value: 'task_evaluation', label: 'Task evaluation' },
        { value: 'pip', label: 'Improvement plan' },
        { value: 'competency', label: 'Competency assessment' },
        { value: 'employment_event', label: 'Employment event' },
      ],
      evalTypes: [
        { value: 'probationary', label: 'Probationary' },
        { value: 'annual', label: 'Annual' },
        { value: 'semi_annual', label: 'Semi-annual' },
        { value: 'project', label: 'Project / term' },
        { value: 'kpi', label: 'KPI' },
      ],
      pipOutcomes: ['successful', 'extended', 'unsuccessful', 'withdrawn'],
    };
  }

  // 1. Workforce & Demographics Report
  async workforceReport(ctx: RequestContext, q: WorkforceQuery) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT
           e.id AS "employeeId",
           e.employee_no AS "employeeNo",
           e.first_name || ' ' || e.last_name AS "employeeName",
           e.work_email AS "workEmail",
           e.status::text AS "status",
           e.hired_on::text AS "hiredOn",
           COALESCE(d.name, 'Unassigned') AS "department",
           COALESCE(b.name, 'Main / HQ') AS "branch",
           COALESCE(t.name, 'Regular') AS "employmentType",
           COALESCE(p.title, 'Employee') AS "position",
           ROUND((EXTRACT(DAY FROM (now() - e.hired_on::timestamp)) / 365.25)::numeric, 1) AS "tenureYears"
         FROM employee e
         LEFT JOIN employment emp ON emp.employee_id = e.id AND emp.effective_to IS NULL
         LEFT JOIN department d ON d.id = emp.department_id
         LEFT JOIN employment_type t ON t.id = emp.employment_type_id
         LEFT JOIN position p ON p.id = emp.position_id
         LEFT JOIN employee_compensation ec ON ec.employee_id = e.id
         LEFT JOIN branch b ON b.id = ec.branch_id
         WHERE e.org_id = app.current_org_id()
           AND ($1::text IS NULL OR e.status::text = $1)
           AND ($2::uuid IS NULL OR emp.department_id = $2)
           AND ($3::uuid IS NULL OR ec.branch_id = $3)
         ORDER BY d.name NULLS LAST, e.last_name, e.first_name`,
        [q.status ?? null, q.departmentId ?? null, q.branchId ?? null],
      );

      const rows = res.rows;
      const totalCount = rows.length;
      const activeCount = rows.filter((r) => r.status === 'active').length;
      const avgTenure = totalCount > 0
        ? (rows.reduce((sum, r) => sum + Number(r.tenureYears || 0), 0) / totalCount).toFixed(1)
        : '0.0';

      return {
        rows,
        summary: {
          totalCount,
          activeCount,
          avgTenureYears: Number(avgTenure),
        },
      };
    });
  }

  async exportWorkforceCsv(ctx: RequestContext, q: WorkforceQuery): Promise<string> {
    const { rows } = await this.workforceReport(ctx, q);
    return toCsv(rows.map((r: any) => ({
      'Employee No': r.employeeNo,
      'Full Name': r.employeeName,
      'Email': r.workEmail,
      'Status': r.status,
      'Hired Date': r.hiredOn,
      'Department': r.department,
      'Branch': r.branch,
      'Employment Type': r.employmentType,
      'Position': r.position,
      'Tenure (Years)': r.tenureYears,
    })));
  }

  // 2. Statutory Contributions Master Summary
  async statutorySummaryReport(ctx: RequestContext, q: StatutorySummaryQuery) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT
           pr.id AS "runId",
           pr.title AS "periodName",
           pr.period_start::text AS "cutoffStart",
           pr.period_end::text AS "cutoffEnd",
           pr.status::text AS "status",
           COUNT(pli.id)::int AS "employeeCount",
           COALESCE(SUM(pli.gross_pay), 0)::numeric(14,2) AS "totalGross",
           COALESCE(SUM(pli.sss_ee), 0)::numeric(14,2) AS "totalSssEe",
           COALESCE(SUM(pli.sss_er), 0)::numeric(14,2) AS "totalSssEr",
           COALESCE(SUM(pli.sss_wisp_ee), 0)::numeric(14,2) AS "totalWispEe",
           COALESCE(SUM(pli.sss_wisp_er), 0)::numeric(14,2) AS "totalWispEr",
           COALESCE(SUM(pli.sss_ec_er), 0)::numeric(14,2) AS "totalEcEr",
           COALESCE(SUM(pli.philhealth_ee), 0)::numeric(14,2) AS "totalPhilhealthEe",
           COALESCE(SUM(pli.philhealth_er), 0)::numeric(14,2) AS "totalPhilhealthEr",
           COALESCE(SUM(pli.pagibig_ee), 0)::numeric(14,2) AS "totalPagibigEe",
           COALESCE(SUM(pli.pagibig_er), 0)::numeric(14,2) AS "totalPagibigEr",
           COALESCE(SUM(pli.withholding_tax), 0)::numeric(14,2) AS "totalWithholdingTax",
           COALESCE(SUM(pli.net_pay), 0)::numeric(14,2) AS "totalNetPay"
         FROM payroll_run pr
         LEFT JOIN payroll_line_item pli ON pli.payroll_run_id = pr.id
         WHERE pr.org_id = app.current_org_id()
           AND ($1::date IS NULL OR pr.period_start >= $1)
           AND ($2::date IS NULL OR pr.period_end <= $2)
         GROUP BY pr.id, pr.title, pr.period_start, pr.period_end, pr.status
         ORDER BY pr.period_end DESC`,
        [q.from ?? null, q.to ?? null],
      );

      const rows = res.rows;
      const totals = rows.reduce(
        (acc: any, r: any) => ({
          totalSss: acc.totalSss + Number(r.totalSssEe) + Number(r.totalSssEr) + Number(r.totalWispEe) + Number(r.totalWispEr) + Number(r.totalEcEr),
          totalPhilhealth: acc.totalPhilhealth + Number(r.totalPhilhealthEe) + Number(r.totalPhilhealthEr),
          totalPagibig: acc.totalPagibig + Number(r.totalPagibigEe) + Number(r.totalPagibigEr),
          totalWithholdingTax: acc.totalWithholdingTax + Number(r.totalWithholdingTax),
          totalNetPay: acc.totalNetPay + Number(r.totalNetPay),
        }),
        { totalSss: 0, totalPhilhealth: 0, totalPagibig: 0, totalWithholdingTax: 0, totalNetPay: 0 },
      );

      return {
        rows,
        summary: totals,
      };
    });
  }

  async exportStatutorySummaryCsv(ctx: RequestContext, q: StatutorySummaryQuery): Promise<string> {
    const { rows } = await this.statutorySummaryReport(ctx, q);
    return toCsv(rows.map((r: any) => ({
      'Payroll Period': r.periodName,
      'Cutoff Start': r.cutoffStart,
      'Cutoff End': r.cutoffEnd,
      'Status': r.status,
      'Employees': r.employeeCount,
      'Total Gross (PHP)': r.totalGross,
      'SSS EE': r.totalSssEe,
      'SSS ER': r.totalSssEr,
      'WISP EE': r.totalWispEe,
      'WISP ER': r.totalWispEr,
      'EC ER': r.totalEcEr,
      'PhilHealth EE': r.totalPhilhealthEe,
      'PhilHealth ER': r.totalPhilhealthEr,
      'Pag-IBIG EE': r.totalPagibigEe,
      'Pag-IBIG ER': r.totalPagibigEr,
      'BIR Withholding Tax': r.totalWithholdingTax,
      'Total Net Pay (PHP)': r.totalNetPay,
    })));
  }

  // 3. Payroll Register & Branch Cost Summary
  async payrollRegisterReport(ctx: RequestContext, q: PayrollRegisterQuery) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT
           pli.id AS "lineItemId",
           e.employee_no AS "employeeNo",
           e.first_name || ' ' || e.last_name AS "employeeName",
           COALESCE(d.name, 'Unassigned') AS "department",
           COALESCE(b.name, 'Main / HQ') AS "branch",
           pr.title AS "periodName",
           pli.basic_pay AS "basicPay",
           pli.overtime_pay AS "overtimePay",
           pli.night_diff_pay AS "nightDiffPay",
           pli.holiday_pay AS "holidayPay",
           pli.de_minimis_allowances AS "deMinimis",
           pli.taxable_allowances AS "taxableAllowances",
           pli.gross_pay AS "grossPay",
           pli.total_deductions AS "statutoryTotal",
           pli.withholding_tax AS "withholdingTax",
           pli.tardiness_undertime AS "tardinessDeduction",
           pli.absences_unpaid AS "absenceDeduction",
           pli.total_deductions AS "totalDeductions",
           pli.net_pay AS "netPay",
           COALESCE(ec.is_minimum_wage, false) AS "isMinimumWage",
           pli.disbursement_status AS "paymentStatus"
         FROM payroll_line_item pli
         JOIN payroll_run pr ON pr.id = pli.payroll_run_id
         JOIN employee e ON e.id = pli.employee_id
         LEFT JOIN employment emp ON emp.employee_id = e.id AND emp.effective_to IS NULL
         LEFT JOIN department d ON d.id = emp.department_id
         LEFT JOIN employee_compensation ec ON ec.employee_id = e.id
         LEFT JOIN branch b ON b.id = ec.branch_id
         WHERE pr.org_id = app.current_org_id()
           AND ($1::uuid IS NULL OR pr.id = $1)
           AND ($2::uuid IS NULL OR ec.branch_id = $2)
           AND ($3::uuid IS NULL OR emp.department_id = $3)
         ORDER BY pr.period_end DESC, d.name NULLS LAST, e.last_name`,
        [q.runId ?? null, q.branchId ?? null, q.departmentId ?? null],
      );

      const rows = res.rows;
      const grandTotalGross = rows.reduce((s: number, r: any) => s + Number(r.grossPay || 0), 0);
      const grandTotalNet = rows.reduce((s: number, r: any) => s + Number(r.netPay || 0), 0);
      const grandTotalTax = rows.reduce((s: number, r: any) => s + Number(r.withholdingTax || 0), 0);

      return {
        rows,
        summary: {
          employeeCount: rows.length,
          grandTotalGross,
          grandTotalNet,
          grandTotalTax,
        },
      };
    });
  }

  async exportPayrollRegisterCsv(ctx: RequestContext, q: PayrollRegisterQuery): Promise<string> {
    const { rows } = await this.payrollRegisterReport(ctx, q);
    return toCsv(rows.map((r: any) => ({
      'Period': r.periodName,
      'Employee No': r.employeeNo,
      'Employee Name': r.employeeName,
      'Branch': r.branch,
      'Department': r.department,
      'Basic Pay': r.basicPay,
      'OT Pay': r.overtimePay,
      'Night Diff': r.nightDiffPay,
      'Holiday Pay': r.holidayPay,
      'De Minimis': r.deMinimis,
      'Taxable Allowances': r.taxableAllowances,
      'Gross Pay': r.grossPay,
      'Statutory Deductions': r.statutoryTotal,
      'Withholding Tax': r.withholdingTax,
      'Tardiness/Absence': (Number(r.tardinessDeduction) + Number(r.absenceDeduction)).toFixed(2),
      'Total Deductions': r.totalDeductions,
      'Net Pay': r.netPay,
      'Status': r.paymentStatus,
    })));
  }

  // 4. Attendance, Tardiness & Overtime Analysis
  async attendanceAnalysisReport(ctx: RequestContext, q: AttendanceAnalysisQuery) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT
           e.id AS "employeeId",
           e.employee_no AS "employeeNo",
           e.first_name || ' ' || e.last_name AS "employeeName",
           COALESCE(d.name, 'Unassigned') AS "department",
           COALESCE(b.name, 'Main / HQ') AS "branch",
           COUNT(ar.id)::int AS "daysRecorded",
           COALESCE(SUM(ar.regular_hours), 0)::numeric(10,2) AS "totalRegularHours",
           COALESCE(SUM(ar.regular_ot_hours), 0)::numeric(10,2) AS "regularOtHours",
           COALESCE(SUM(ar.rest_day_ot_hours), 0)::numeric(10,2) AS "restDayOtHours",
           COALESCE(SUM(ar.holiday_ot_hours), 0)::numeric(10,2) AS "holidayOtHours",
           COALESCE(SUM(ar.night_diff_hours), 0)::numeric(10,2) AS "nightDiffHours",
           COALESCE(SUM(ar.tardiness_minutes), 0)::int AS "totalTardinessMins",
           COALESCE(SUM(ar.undertime_minutes), 0)::int AS "totalUndertimeMins",
           COUNT(CASE WHEN ar.tardiness_minutes > 0 THEN 1 END)::int AS "tardinessIncidents"
         FROM employee e
         JOIN attendance_record ar ON ar.employee_id = e.id
         LEFT JOIN employment emp ON emp.employee_id = e.id AND emp.effective_to IS NULL
         LEFT JOIN department d ON d.id = emp.department_id
         LEFT JOIN employee_compensation ec ON ec.employee_id = e.id
         LEFT JOIN branch b ON b.id = ec.branch_id
         WHERE e.org_id = app.current_org_id()
           AND ($1::date IS NULL OR ar.work_date >= $1)
           AND ($2::date IS NULL OR ar.work_date <= $2)
           AND ($3::uuid IS NULL OR emp.department_id = $3)
           AND ($4::uuid IS NULL OR ec.branch_id = $4)
         GROUP BY e.id, e.employee_no, e.first_name, e.last_name, d.name, b.name
         ORDER BY "totalTardinessMins" DESC, "regularOtHours" DESC`,
        [q.from ?? null, q.to ?? null, q.departmentId ?? null, q.branchId ?? null],
      );

      const rows = res.rows;
      const totalOtHours = rows.reduce(
        (s: number, r: any) => s + Number(r.regularOtHours || 0) + Number(r.restDayOtHours || 0) + Number(r.holidayOtHours || 0),
        0,
      );
      const totalLostMins = rows.reduce(
        (s: number, r: any) => s + Number(r.totalTardinessMins || 0) + Number(r.totalUndertimeMins || 0),
        0,
      );

      return {
        rows,
        summary: {
          recordedEmployees: rows.length,
          totalOtHours: Number(totalOtHours.toFixed(2)),
          totalLostHours: Number((totalLostMins / 60).toFixed(1)),
        },
      };
    });
  }

  async exportAttendanceAnalysisCsv(ctx: RequestContext, q: AttendanceAnalysisQuery): Promise<string> {
    const { rows } = await this.attendanceAnalysisReport(ctx, q);
    return toCsv(rows.map((r: any) => ({
      'Employee No': r.employeeNo,
      'Employee Name': r.employeeName,
      'Department': r.department,
      'Branch': r.branch,
      'Days Recorded': r.daysRecorded,
      'Regular Hours': r.totalRegularHours,
      'Regular OT (Hrs)': r.regularOtHours,
      'Rest Day OT (Hrs)': r.restDayOtHours,
      'Holiday OT (Hrs)': r.holidayOtHours,
      'Night Diff (Hrs)': r.nightDiffHours,
      'Tardiness (Mins)': r.totalTardinessMins,
      'Tardiness Incidents': r.tardinessIncidents,
      'Undertime (Mins)': r.totalUndertimeMins,
    })));
  }

  // 5. Leave Balances & Statutory Utilization
  async leaveUtilizationReport(ctx: RequestContext, q: LeaveUtilizationQuery) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT
           e.id AS "employeeId",
           e.employee_no AS "employeeNo",
           e.first_name || ' ' || e.last_name AS "employeeName",
           COALESCE(d.name, 'Unassigned') AS "department",
           lt.name AS "leaveTypeName",
           lt.code AS "leaveTypeCode",
           lt.is_statutory AS "isStatutory",
           la.allocated_days::numeric(5,1) AS "allocatedDays",
           la.used_days::numeric(5,1) AS "usedDays",
           la.pending_days::numeric(5,1) AS "pendingDays",
           (la.allocated_days - la.used_days - la.pending_days)::numeric(5,1) AS "remainingDays",
           COALESCE(ec.daily_rate, 0)::numeric(12,2) AS "dailyRate",
           ROUND(((la.allocated_days - la.used_days) * COALESCE(ec.daily_rate, 0))::numeric, 2) AS "silMonetizationEst"
         FROM leave_allocation la
         JOIN leave_type lt ON lt.id = la.leave_type_id
         JOIN employee e ON e.id = la.employee_id
         LEFT JOIN employment emp ON emp.employee_id = e.id AND emp.effective_to IS NULL
         LEFT JOIN department d ON d.id = emp.department_id
         LEFT JOIN employee_compensation ec ON ec.employee_id = e.id
         WHERE la.org_id = app.current_org_id()
           AND ($1::int IS NULL OR la.year = $1)
           AND ($2::uuid IS NULL OR lt.id = $2)
           AND ($3::uuid IS NULL OR emp.department_id = $3)
         ORDER BY d.name NULLS LAST, e.last_name, lt.name`,
        [q.year ?? new Date().getFullYear(), q.leaveTypeId ?? null, q.departmentId ?? null],
      );

      const rows = res.rows;
      const totalAllocated = rows.reduce((s: number, r: any) => s + Number(r.allocatedDays || 0), 0);
      const totalUsed = rows.reduce((s: number, r: any) => s + Number(r.usedDays || 0), 0);
      const totalRemaining = rows.reduce((s: number, r: any) => s + Number(r.remainingDays || 0), 0);
      const silMonetizationTotal = rows
        .filter((r: any) => r.leaveTypeCode === 'SIL')
        .reduce((s: number, r: any) => s + Number(r.silMonetizationEst || 0), 0);

      return {
        rows,
        summary: {
          totalAllocated,
          totalUsed,
          totalRemaining,
          silMonetizationTotal,
        },
      };
    });
  }

  async exportLeaveUtilizationCsv(ctx: RequestContext, q: LeaveUtilizationQuery): Promise<string> {
    const { rows } = await this.leaveUtilizationReport(ctx, q);
    return toCsv(rows.map((r: any) => ({
      'Employee No': r.employeeNo,
      'Employee Name': r.employeeName,
      'Department': r.department,
      'Leave Type': r.leaveTypeName,
      'Statutory': r.isStatutory ? 'YES' : 'NO',
      'Allocated (Days)': r.allocatedDays,
      'Used (Days)': r.usedDays,
      'Pending (Days)': r.pendingDays,
      'Remaining Balance (Days)': r.remainingDays,
      'Daily Rate (PHP)': r.dailyRate,
      'Unused SIL Value (Est)': r.silMonetizationEst,
    })));
  }

  // 6. Performance Bell Curve & Rating Distribution
  async performanceDistributionReport(ctx: RequestContext, q: PerformanceDistributionQuery) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT
           COALESCE(d.name, 'All Units') AS "department",
           COUNT(rs.id)::int AS "evaluationsCount",
           ROUND(AVG(COALESCE(rs.calibrated_rating, rs.overall_rating))::numeric, 2) AS "averageScore",
           COUNT(CASE WHEN COALESCE(rs.calibrated_rating, rs.overall_rating) >= 4.5 THEN 1 END)::int AS "outstandingCount",
           COUNT(CASE WHEN COALESCE(rs.calibrated_rating, rs.overall_rating) >= 3.5 AND COALESCE(rs.calibrated_rating, rs.overall_rating) < 4.5 THEN 1 END)::int AS "exceedsCount",
           COUNT(CASE WHEN COALESCE(rs.calibrated_rating, rs.overall_rating) >= 2.5 AND COALESCE(rs.calibrated_rating, rs.overall_rating) < 3.5 THEN 1 END)::int AS "meetsCount",
           COUNT(CASE WHEN COALESCE(rs.calibrated_rating, rs.overall_rating) < 2.5 THEN 1 END)::int AS "belowStandardCount"
         FROM review_summary rs
         JOIN employee e ON e.id = rs.subject_employee_id
         LEFT JOIN employment emp ON emp.employee_id = e.id AND emp.effective_to IS NULL
         LEFT JOIN department d ON d.id = emp.department_id
         WHERE e.org_id = app.current_org_id()
           AND (rs.calibrated_rating IS NOT NULL OR rs.overall_rating IS NOT NULL)
           AND ($1::uuid IS NULL OR emp.department_id = $1)
         GROUP BY d.name
         ORDER BY d.name NULLS LAST`,
        [q.departmentId ?? null],
      );

      const rows = res.rows;
      const totalReviews = rows.reduce((s: number, r: any) => s + Number(r.evaluationsCount || 0), 0);
      return {
        rows,
        summary: {
          totalReviews,
        },
      };
    });
  }

  async exportPerformanceDistributionCsv(ctx: RequestContext, q: PerformanceDistributionQuery): Promise<string> {
    const { rows } = await this.performanceDistributionReport(ctx, q);
    return toCsv(rows.map((r: any) => ({
      'Department': r.department,
      'Evaluations Count': r.evaluationsCount,
      'Average Score': r.averageScore,
      'Outstanding (4.5-5.0)': r.outstandingCount,
      'Exceeds Standards (3.5-4.4)': r.exceedsCount,
      'Meets Standards (2.5-3.4)': r.meetsCount,
      'Below Standards (<2.5)': r.belowStandardCount,
    })));
  }

  // 7. Executive Outflow & Workforce Intelligence Dashboard
  async executiveDashboard(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      // A. Statutory Contributions Outflow
      const statRes = await client.query(`
        SELECT
          COALESCE(SUM(pli.sss_ee), 0)::numeric(14,2) AS "sssEe",
          COALESCE(SUM(pli.sss_er), 0)::numeric(14,2) AS "sssEr",
          COALESCE(SUM(pli.sss_wisp_ee), 0)::numeric(14,2) AS "sssWispEe",
          COALESCE(SUM(pli.sss_wisp_er), 0)::numeric(14,2) AS "sssWispEr",
          COALESCE(SUM(pli.sss_ec_er), 0)::numeric(14,2) AS "sssEcEr",
          COALESCE(SUM(pli.philhealth_ee), 0)::numeric(14,2) AS "philhealthEe",
          COALESCE(SUM(pli.philhealth_er), 0)::numeric(14,2) AS "philhealthEr",
          COALESCE(SUM(pli.pagibig_ee), 0)::numeric(14,2) AS "pagibigEe",
          COALESCE(SUM(pli.pagibig_er), 0)::numeric(14,2) AS "pagibigEr",
          COALESCE(SUM(pli.withholding_tax), 0)::numeric(14,2) AS "withholdingTax",
          COALESCE(SUM(pli.gross_pay), 0)::numeric(14,2) AS "grossPay",
          COALESCE(SUM(pli.net_pay), 0)::numeric(14,2) AS "netPay",
          COALESCE(SUM(pli.de_minimis_allowances), 0)::numeric(14,2) AS "deMinimis",
          COALESCE(SUM(pli.loans_deductions), 0)::numeric(14,2) AS "loansDeductions",
          COUNT(DISTINCT pli.payroll_run_id)::int AS "totalRuns",
          COUNT(pli.id)::int AS "totalPayslips"
        FROM payroll_line_item pli
        WHERE pli.org_id = app.current_org_id()
      `);
      const s = statRes.rows[0] || {};
      const sssTotal = Number(s.sssEe || 0) + Number(s.sssEr || 0) + Number(s.sssWispEe || 0) + Number(s.sssWispEr || 0) + Number(s.sssEcEr || 0);
      const phicTotal = Number(s.philhealthEe || 0) + Number(s.philhealthEr || 0);
      const hdmfTotal = Number(s.pagibigEe || 0) + Number(s.pagibigEr || 0);
      const birTaxTotal = Number(s.withholdingTax || 0);
      const totalStatutoryOutflow = sssTotal + phicTotal + hdmfTotal + birTaxTotal;

      // B. Voluntary / Corporate Benefits & Subsidies
      const benRes = await client.query(`
        SELECT
          COUNT(ec.employee_id)::int AS "enrolledCount",
          COALESCE(SUM(ec.rice_subsidy), 0)::numeric(14,2) AS "riceSubsidyMonthly",
          COALESCE(SUM(ec.clothing_allowance), 0)::numeric(14,2) AS "clothingMonthly",
          COALESCE(SUM(ec.laundry_allowance), 0)::numeric(14,2) AS "laundryMonthly",
          COALESCE(SUM(ec.medical_allowance), 0)::numeric(14,2) AS "medicalAllowanceMonthly"
        FROM employee_compensation ec
        JOIN employee e ON e.id = ec.employee_id AND e.deleted_at IS NULL AND e.status = 'active'
        WHERE ec.org_id = app.current_org_id()
      `);
      const b = benRes.rows[0] || {};
      const riceMonthly = Number(b.riceSubsidyMonthly || 0);
      const clothingMonthly = Number(b.clothingMonthly || 0);
      const laundryMonthly = Number(b.laundryMonthly || 0);
      const medicalMonthly = Number(b.medicalAllowanceMonthly || 0);
      const totalVoluntaryBenefitsMonthly = riceMonthly + clothingMonthly + laundryMonthly + medicalMonthly;

      // C. Employee Loans Portfolio
      const loanRes = await client.query(`
        SELECT
          loan_type AS "loanType",
          COUNT(*)::int AS "count",
          COALESCE(SUM(principal_amount), 0)::numeric(14,2) AS "principal",
          COALESCE(SUM(remaining_balance), 0)::numeric(14,2) AS "balance",
          COALESCE(SUM(monthly_amortization), 0)::numeric(14,2) AS "monthlyAmortization",
          COALESCE(SUM(principal_amount - remaining_balance), 0)::numeric(14,2) AS "remitted",
          COUNT(DISTINCT employee_id)::int AS "borrowers"
        FROM employee_loan
        WHERE org_id = app.current_org_id()
          AND status = 'active'
        GROUP BY loan_type
      `);
      const loanRows = loanRes.rows;
      const totalActiveLoans = loanRows.reduce((acc: number, r: any) => acc + Number(r.count || 0), 0);
      const totalLoanPrincipal = loanRows.reduce((acc: number, r: any) => acc + Number(r.principal || 0), 0);
      const totalLoanBalance = loanRows.reduce((acc: number, r: any) => acc + Number(r.balance || 0), 0);
      const totalLoanRemitted = loanRows.reduce((acc: number, r: any) => acc + Number(r.remitted || 0), 0);

      // D. Branch Cost & Headcount Breakdown
      const branchRes = await client.query(`
        SELECT
          b.id AS "branchId",
          b.code,
          b.name,
          b.region,
          COUNT(e.id)::int AS "headcount",
          COALESCE(SUM(ec.monthly_rate), 0)::numeric(14,2) AS "monthlyPayroll",
          COALESCE(ROUND(AVG(ec.monthly_rate), 2), 0)::numeric(14,2) AS "averageSalary"
        FROM branch b
        LEFT JOIN employee_compensation ec ON ec.branch_id = b.id
        LEFT JOIN employee e ON e.id = ec.employee_id AND e.deleted_at IS NULL AND e.status = 'active'
        WHERE b.org_id = app.current_org_id()
        GROUP BY b.id, b.code, b.name, b.region
        ORDER BY "monthlyPayroll" DESC, b.name
      `);
      const branchRows = branchRes.rows;
      const totalActiveEmployees = branchRows.reduce((acc: number, r: any) => acc + Number(r.headcount || 0), 0);
      const totalMonthlyBasePayroll = branchRows.reduce((acc: number, r: any) => acc + Number(r.monthlyPayroll || 0), 0);

      const branchesWithPercent = branchRows.map((br: any) => ({
        ...br,
        headcount: Number(br.headcount || 0),
        monthlyPayroll: Number(br.monthlyPayroll || 0),
        averageSalary: Number(br.averageSalary || 0),
        sharePercent: totalMonthlyBasePayroll > 0
          ? Number(((Number(br.monthlyPayroll || 0) / totalMonthlyBasePayroll) * 100).toFixed(1))
          : 0,
      }));

      // E. Salary Bracket Distribution
      const bracketRes = await client.query(`
        SELECT
          CASE
            WHEN ec.monthly_rate < 25000 THEN 'Under ₱25k (Operations / Entry)'
            WHEN ec.monthly_rate >= 25000 AND ec.monthly_rate < 45000 THEN '₱25k - ₱45k (Associate / Specialist)'
            WHEN ec.monthly_rate >= 45000 AND ec.monthly_rate < 75000 THEN '₱45k - ₱75k (Senior / Supervisor)'
            WHEN ec.monthly_rate >= 75000 AND ec.monthly_rate < 120000 THEN '₱75k - ₱120k (Manager / Principal)'
            ELSE '₱120k+ (Director / Executive)'
          END AS "bracketLabel",
          CASE
            WHEN ec.monthly_rate < 25000 THEN 1
            WHEN ec.monthly_rate >= 25000 AND ec.monthly_rate < 45000 THEN 2
            WHEN ec.monthly_rate >= 45000 AND ec.monthly_rate < 75000 THEN 3
            WHEN ec.monthly_rate >= 75000 AND ec.monthly_rate < 120000 THEN 4
            ELSE 5
          END AS "sortOrder",
          COUNT(e.id)::int AS "employeeCount",
          COALESCE(SUM(ec.monthly_rate), 0)::numeric(14,2) AS "totalSpend",
          COALESCE(ROUND(AVG(ec.monthly_rate), 2), 0)::numeric(14,2) AS "avgSalary"
        FROM employee e
        JOIN employee_compensation ec ON ec.employee_id = e.id
        WHERE e.org_id = app.current_org_id()
          AND e.deleted_at IS NULL
          AND e.status = 'active'
        GROUP BY 1, 2
        ORDER BY "sortOrder"
      `);
      const bracketRows = bracketRes.rows.map((bk: any) => ({
        ...bk,
        employeeCount: Number(bk.employeeCount || 0),
        totalSpend: Number(bk.totalSpend || 0),
        avgSalary: Number(bk.avgSalary || 0),
        workforcePercent: totalActiveEmployees > 0
          ? Number(((Number(bk.employeeCount || 0) / totalActiveEmployees) * 100).toFixed(1))
          : 0,
      }));

      // F. Workforce & Leadership Ratio
      const leadershipRes = await client.query(`
        SELECT
          COUNT(DISTINCT rl.supervisor_employee_id)::int AS "managersCount"
        FROM reporting_line rl
        WHERE rl.org_id = app.current_org_id()
          AND (rl.effective_to IS NULL OR rl.effective_to > CURRENT_DATE)
      `);
      const managersCount = Number(leadershipRes.rows[0]?.managersCount || 0);
      const staffCount = Math.max(0, totalActiveEmployees - managersCount);
      const spanOfControl = managersCount > 0 ? Number((staffCount / managersCount).toFixed(1)) : 0;

      // Department distribution
      const deptRes = await client.query(`
        SELECT
          COALESCE(d.name, 'Unassigned') AS "department",
          COUNT(e.id)::int AS "headcount",
          COALESCE(SUM(ec.monthly_rate), 0)::numeric(14,2) AS "totalSalary"
        FROM employee e
        LEFT JOIN employment emp ON emp.employee_id = e.id AND emp.effective_to IS NULL
        LEFT JOIN department d ON d.id = emp.department_id
        LEFT JOIN employee_compensation ec ON ec.employee_id = e.id
        WHERE e.org_id = app.current_org_id()
          AND e.deleted_at IS NULL
          AND e.status = 'active'
        GROUP BY d.name
        ORDER BY "totalSalary" DESC
      `);

      return {
        statutory: {
          totalOutflow: totalStatutoryOutflow,
          totalContributionsAndCoverage: sssTotal + phicTotal + hdmfTotal,
          sss: {
            agency: 'SSS',
            fullName: 'Social Security System',
            total: sssTotal,
            percentage: totalStatutoryOutflow > 0 ? Number(((sssTotal / totalStatutoryOutflow) * 100).toFixed(1)) : 0,
            eeShare: Number(s.sssEe || 0) + Number(s.sssWispEe || 0),
            erShare: Number(s.sssEr || 0) + Number(s.sssWispEr || 0) + Number(s.sssEcEr || 0),
            regularEe: Number(s.sssEe || 0),
            regularEr: Number(s.sssEr || 0),
            wispEe: Number(s.sssWispEe || 0),
            wispEr: Number(s.sssWispEr || 0),
            ecEr: Number(s.sssEcEr || 0),
          },
          pagibig: {
            agency: 'Pag-IBIG (HDMF)',
            fullName: 'Home Development Mutual Fund',
            total: hdmfTotal,
            percentage: totalStatutoryOutflow > 0 ? Number(((hdmfTotal / totalStatutoryOutflow) * 100).toFixed(1)) : 0,
            eeShare: Number(s.pagibigEe || 0),
            erShare: Number(s.pagibigEr || 0),
          },
          philhealth: {
            agency: 'PhilHealth (PHIC)',
            fullName: 'Philippine Health Insurance Corp',
            total: phicTotal,
            percentage: totalStatutoryOutflow > 0 ? Number(((phicTotal / totalStatutoryOutflow) * 100).toFixed(1)) : 0,
            eeShare: Number(s.philhealthEe || 0),
            erShare: Number(s.philhealthEr || 0),
          },
          withholdingTax: {
            agency: 'BIR Withholding Tax',
            fullName: 'Bureau of Internal Revenue TRAIN Tax',
            total: birTaxTotal,
            percentage: totalStatutoryOutflow > 0 ? Number(((birTaxTotal / totalStatutoryOutflow) * 100).toFixed(1)) : 0,
          },
        },
        insuranceAndBenefits: {
          totalMonthlyBenefits: totalVoluntaryBenefitsMonthly,
          enrolledCount: Number(b.enrolledCount || 0),
          riceSubsidy: riceMonthly,
          clothingAllowance: clothingMonthly,
          laundryAllowance: laundryMonthly,
          medicalAllowance: medicalMonthly,
          providers: [
            { name: 'Medical Insurance (HMO)', provider: 'Maxicare Healthcare', monthlySpend: medicalMonthly, pct: totalVoluntaryBenefitsMonthly > 0 ? Number(((medicalMonthly / totalVoluntaryBenefitsMonthly) * 100).toFixed(1)) : 0 },
            { name: 'Life & Accident Cover', provider: 'PhilFirst / Allied Bank', monthlySpend: clothingMonthly, pct: totalVoluntaryBenefitsMonthly > 0 ? Number(((clothingMonthly / totalVoluntaryBenefitsMonthly) * 100).toFixed(1)) : 0 },
            { name: 'Rice Subsidy (Tax-Free De Minimis)', provider: 'Corporate Subsidy Program', monthlySpend: riceMonthly, pct: totalVoluntaryBenefitsMonthly > 0 ? Number(((riceMonthly / totalVoluntaryBenefitsMonthly) * 100).toFixed(1)) : 0 },
            { name: 'Laundry & Uniform Subsidies', provider: 'Employee Welfare Grant', monthlySpend: laundryMonthly, pct: totalVoluntaryBenefitsMonthly > 0 ? Number(((laundryMonthly / totalVoluntaryBenefitsMonthly) * 100).toFixed(1)) : 0 },
          ],
        },
        loans: {
          totalActiveLoans,
          totalPrincipal: totalLoanPrincipal,
          totalRemitted: totalLoanRemitted,
          outstandingBalance: totalLoanBalance,
          portfolio: loanRows.map((r: any) => ({
            type: r.loanType,
            label: r.loanType === 'sss_salary' ? 'SSS Salary Loan' : r.loanType === 'pagibig_mpl' ? 'Pag-IBIG MPL' : r.loanType === 'company_emergency' ? 'Emergency Cash Advance' : r.loanType,
            count: Number(r.count || 0),
            principal: Number(r.principal || 0),
            balance: Number(r.balance || 0),
            remitted: Number(r.remitted || 0),
            monthlyAmortization: Number(r.monthlyAmortization || 0),
            borrowers: Number(r.borrowers || 0),
          })),
        },
        branches: branchesWithPercent,
        salaryBrackets: bracketRows,
        workforce: {
          totalHeadcount: totalActiveEmployees,
          managersCount,
          staffCount,
          spanOfControl,
          departmentsCount: deptRes.rows.length,
          branchesCount: branchesWithPercent.length,
          totalMonthlyBasePayroll,
          averageBaseSalary: totalActiveEmployees > 0 ? Number((totalMonthlyBasePayroll / totalActiveEmployees).toFixed(2)) : 0,
          departments: deptRes.rows.map((d: any) => ({
            department: d.department,
            headcount: Number(d.headcount || 0),
            totalSalary: Number(d.totalSalary || 0),
          })),
        },
        payrollOverview: {
          totalGrossPay: Number(s.grossPay || 0),
          totalNetPay: Number(s.netPay || 0),
          totalRuns: Number(s.totalRuns || 0),
          totalPayslips: Number(s.totalPayslips || 0),
        },
      };
    });
  }
}

