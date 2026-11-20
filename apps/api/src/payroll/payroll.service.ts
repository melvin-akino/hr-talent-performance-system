import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService, RequestContext } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  calculateSssContribution,
  apportionSssQuindena,
} from './calculators/sss.calculator';
import {
  calculatePhilHealthContribution,
  apportionPhilHealthQuindena,
} from './calculators/philhealth.calculator';
import {
  calculatePagIbigContribution,
  apportionPagIbigQuindena,
} from './calculators/pagibig.calculator';
import {
  calculateSemiMonthlyWithholdingTax,
  calculateMonthlyWithholdingTax,
  calculateAnnualWithholdingTax,
} from './calculators/train-tax.calculator';
import {
  calculateCycleThirteenthMonthAccrual,
} from './calculators/thirteenth-month.calculator';
import {
  calculatePhilippineAttendancePay,
} from '../attendance/calculators/ph-overtime.calculator';

export interface CreateBranchDto {
  code: string;
  name: string;
  region?: string;
  address?: string;
  birRdoCode?: string;
  sssBranchCode?: string;
  philhealthEmployerNo?: string;
  pagibigEmployerNo?: string;
  isHeadOffice?: boolean;
}

export interface UpsertCompensationDto {
  monthlyRate: number;
  dailyRate?: number;
  hourlyRate?: number;
  payType?: 'monthly' | 'daily';
  payFrequency?: 'semi_monthly' | 'monthly';
  isMinimumWage?: boolean;
  tin?: string;
  sssNo?: string;
  philhealthNo?: string;
  pagibigNo?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
  riceSubsidy?: number;
  clothingAllowance?: number;
  laundryAllowance?: number;
  medicalAllowance?: number;
  taxableAllowance?: number;
  branchId?: string | null;
}

export interface ComputePayrollRunDto {
  code: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  payoutDate: string;
  runType: 'quindena_1' | 'quindena_2' | 'monthly' | 'thirteenth_month';
  branchId?: string | null;
}

export interface CreateLoanDto {
  employeeId: string;
  loanType: string;
  referenceNo: string;
  principalAmount: number;
  monthlyAmortization: number;
  amortizationPerCutoff?: number;
  totalTermsMonths?: number;
  startDate: string;
}

export interface CreatePayrollEntryItemDto {
  employeeId: string;
  entryType: 'allowance' | 'deduction';
  code: string;
  name: string;
  amount: number;
  isTaxable?: boolean;
  frequency?: 'every_cutoff' | 'first_cutoff_only' | 'second_cutoff_only' | 'one_off';
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface DistributeServiceChargeDto {
  payrollRunId: string;
  totalPoolAmount: number;
}

export interface SalaryGradeMatrixDto {
  jobRankId: string;
  region: string;
  minSalary: number;
  midSalary: number;
  maxSalary: number;
}

export interface PayrollAdjustmentDto {
  employeeId: string;
  payrollRunId: string;
  adjustmentType: 'retro_pay' | 'tax_refund' | 'bonus' | 'salary_differential' | 'attendance_correction';
  amount: number;
  isTaxable?: boolean;
  reason: string;
}

export interface CalculateRetroPayDto {
  employeeId: string;
  newMonthlyRate: number;
  effectiveFrom: string;
  targetPayrollRunId: string;
}

@Injectable()
export class PayrollService {
  constructor(private readonly db: DbService) {}

  /**
   * List all branches in the organization
   */
  async listBranches(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT id, org_id AS "orgId", code, name, region, address,
                bir_rdo_code AS "birRdoCode", sss_branch_code AS "sssBranchCode",
                philhealth_employer_no AS "philhealthEmployerNo",
                pagibig_employer_no AS "pagibigEmployerNo",
                is_head_office AS "isHeadOffice", created_at AS "createdAt"
           FROM branch
          WHERE org_id = app.current_org_id()
          ORDER BY is_head_office DESC, name ASC`,
      );
      return res.rows;
    });
  }

  /**
   * Create a new branch / regional subsidiary
   */
  async createBranch(ctx: RequestContext, dto: CreateBranchDto) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO branch (
           org_id, code, name, region, address, bir_rdo_code, sss_branch_code,
           philhealth_employer_no, pagibig_employer_no, is_head_office
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, code, name, region, address, is_head_office AS "isHeadOffice"`,
        [
          dto.code.trim().toUpperCase(),
          dto.name.trim(),
          dto.region || 'NCR',
          dto.address || null,
          dto.birRdoCode || null,
          dto.sssBranchCode || null,
          dto.philhealthEmployerNo || null,
          dto.pagibigEmployerNo || null,
          dto.isHeadOffice || false,
        ],
      );
      return res.rows[0];
    });
  }

  /**
   * List employee compensation records
   */
  async listCompensation(ctx: RequestContext, branchId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const params: any[] = [];
      let branchFilter = '';
      if (branchId) {
        params.push(branchId);
        branchFilter = `AND (c.branch_id = $1 OR (c.branch_id IS NULL AND e.org_id = app.current_org_id()))`;
      }

      const res = await client.query(
        `SELECT e.id AS "employeeId",
                e.employee_no AS "employeeNo",
                e.first_name AS "firstName",
                e.last_name AS "lastName",
                e.work_email AS "workEmail",
                e.status AS "employmentStatus",
                b.name AS "branchName",
                b.id AS "branchId",
                COALESCE(c.monthly_rate, 0.00) AS "monthlyRate",
                COALESCE(c.daily_rate, 0.00) AS "dailyRate",
                COALESCE(c.hourly_rate, 0.00) AS "hourlyRate",
                COALESCE(c.pay_type, 'monthly') AS "payType",
                COALESCE(c.pay_frequency, 'semi_monthly') AS "payFrequency",
                COALESCE(c.is_minimum_wage, false) AS "isMinimumWage",
                c.tin,
                c.sss_no AS "sssNo",
                c.philhealth_no AS "philhealthNo",
                c.pagibig_no AS "pagibigNo",
                COALESCE(c.bank_name, 'BPI') AS "bankName",
                c.bank_account_no AS "bankAccountNo",
                c.bank_account_name AS "bankAccountName",
                COALESCE(c.rice_subsidy, 0.00) AS "riceSubsidy",
                COALESCE(c.clothing_allowance, 0.00) AS "clothingAllowance",
                COALESCE(c.laundry_allowance, 0.00) AS "laundryAllowance",
                COALESCE(c.medical_allowance, 0.00) AS "medicalAllowance",
                COALESCE(c.taxable_allowance, 0.00) AS "taxableAllowance"
           FROM employee e
           LEFT JOIN employee_compensation c ON c.employee_id = e.id
           LEFT JOIN branch b ON b.id = c.branch_id
          WHERE e.org_id = app.current_org_id()
            AND e.status != 'separated'
            ${branchFilter}
          ORDER BY e.last_name ASC, e.first_name ASC`,
        params,
      );
      return res.rows;
    });
  }

  /**
   * Get compensation profile of single employee
   */
  async getCompensation(ctx: RequestContext, employeeId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT c.*, e.employee_no, e.first_name, e.last_name
           FROM employee e
           LEFT JOIN employee_compensation c ON c.employee_id = e.id
          WHERE e.id = $1 AND e.org_id = app.current_org_id()`,
        [employeeId],
      );
      if (!res.rows[0]) {
        throw new NotFoundException(`Employee ${employeeId} not found`);
      }
      return res.rows[0];
    });
  }

  /**
   * Upsert compensation profile
   */
  async upsertCompensation(ctx: RequestContext, employeeId: string, dto: UpsertCompensationDto) {
    return this.db.withContext(ctx, async (client) => {
      // Validate employee belongs to organization
      const empRes = await client.query(
        `SELECT id FROM employee WHERE id = $1 AND org_id = app.current_org_id()`,
        [employeeId],
      );
      if (!empRes.rows[0]) {
        throw new NotFoundException(`Employee ${employeeId} not found in this organization`);
      }

      const monthlyRate = Number(dto.monthlyRate || 0);
      // Auto-compute standard rates if not explicitly passed:
      // PH DOLE standard work factor: 261 days/yr (5 days/wk) or 313 days/yr (6 days/wk)
      // Standard: daily = (monthly * 12) / 261; hourly = daily / 8
      const dailyRate = dto.dailyRate ?? Math.round(((monthlyRate * 12) / 261) * 100) / 100;
      const hourlyRate = dto.hourlyRate ?? Math.round((dailyRate / 8) * 100) / 100;

      const res = await client.query(
        `INSERT INTO employee_compensation (
           employee_id, org_id, branch_id, monthly_rate, daily_rate, hourly_rate,
           pay_type, pay_frequency, is_minimum_wage, tin, sss_no, philhealth_no,
           pagibig_no, bank_name, bank_account_no, bank_account_name,
           rice_subsidy, clothing_allowance, laundry_allowance, medical_allowance,
           taxable_allowance, updated_at
         ) VALUES (
           $1, app.current_org_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16, $17, $18, $19, $20, now()
         )
         ON CONFLICT (employee_id) DO UPDATE SET
           branch_id = EXCLUDED.branch_id,
           monthly_rate = EXCLUDED.monthly_rate,
           daily_rate = EXCLUDED.daily_rate,
           hourly_rate = EXCLUDED.hourly_rate,
           pay_type = EXCLUDED.pay_type,
           pay_frequency = EXCLUDED.pay_frequency,
           is_minimum_wage = EXCLUDED.is_minimum_wage,
           tin = EXCLUDED.tin,
           sss_no = EXCLUDED.sss_no,
           philhealth_no = EXCLUDED.philhealth_no,
           pagibig_no = EXCLUDED.pagibig_no,
           bank_name = EXCLUDED.bank_name,
           bank_account_no = EXCLUDED.bank_account_no,
           bank_account_name = EXCLUDED.bank_account_name,
           rice_subsidy = EXCLUDED.rice_subsidy,
           clothing_allowance = EXCLUDED.clothing_allowance,
           laundry_allowance = EXCLUDED.laundry_allowance,
           medical_allowance = EXCLUDED.medical_allowance,
           taxable_allowance = EXCLUDED.taxable_allowance,
           updated_at = now()
         RETURNING *`,
        [
          employeeId,
          dto.branchId || null,
          monthlyRate,
          dailyRate,
          hourlyRate,
          dto.payType || 'monthly',
          dto.payFrequency || 'semi_monthly',
          dto.isMinimumWage || false,
          dto.tin || null,
          dto.sssNo || null,
          dto.philhealthNo || null,
          dto.pagibigNo || null,
          dto.bankName || 'BPI',
          dto.bankAccountNo || null,
          dto.bankAccountName || null,
          dto.riceSubsidy || 0,
          dto.clothingAllowance || 0,
          dto.laundryAllowance || 0,
          dto.medicalAllowance || 0,
          dto.taxableAllowance || 0,
        ],
      );
      return res.rows[0];
    });
  }

  /**
   * List batch payroll runs
   */
  async listPayrollRuns(ctx: RequestContext, branchId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const params: any[] = [];
      let branchFilter = '';
      if (branchId) {
        params.push(branchId);
        branchFilter = 'AND (r.branch_id = $1 OR r.branch_id IS NULL)';
      }

      const res = await client.query(
        `SELECT r.id, r.code, r.title, r.period_start AS "periodStart",
                r.period_end AS "periodEnd", r.payout_date AS "payoutDate",
                r.run_type AS "runType", r.status,
                r.total_gross AS "totalGross",
                r.total_taxable AS "totalTaxable",
                r.total_withholding_tax AS "totalWithholdingTax",
                r.total_sss_ee AS "totalSssEe",
                r.total_sss_er AS "totalSssEr",
                r.total_philhealth_ee AS "totalPhilhealthEe",
                r.total_philhealth_er AS "totalPhilhealthEr",
                r.total_pagibig_ee AS "totalPagibigEe",
                r.total_pagibig_er AS "totalPagibigEr",
                r.total_net_pay AS "totalNetPay",
                r.employee_count AS "employeeCount",
                b.name AS "branchName",
                r.created_at AS "createdAt"
           FROM payroll_run r
           LEFT JOIN branch b ON b.id = r.branch_id
          WHERE r.org_id = app.current_org_id()
            ${branchFilter}
          ORDER BY r.period_start DESC, r.created_at DESC`,
        params,
      );
      return res.rows;
    });
  }

  /**
   * Get single payroll run with all line items
   */
  async getPayrollRun(ctx: RequestContext, runId: string) {
    return this.db.withContext(ctx, async (client) => {
      const runRes = await client.query(
        `SELECT r.*, b.name AS branch_name,
                comp.first_name || ' ' || comp.last_name AS computed_by_name,
                app.first_name || ' ' || app.last_name AS approved_by_name,
                disb.first_name || ' ' || disb.last_name AS disbursed_by_name
           FROM payroll_run r
           LEFT JOIN branch b ON b.id = r.branch_id
           LEFT JOIN employee comp ON comp.id = r.computed_by
           LEFT JOIN employee app ON app.id = r.approved_by
           LEFT JOIN employee disb ON disb.id = r.disbursed_by
          WHERE r.id = $1 AND r.org_id = app.current_org_id()`,
        [runId],
      );
      if (!runRes.rows[0]) {
        throw new NotFoundException(`Payroll run ${runId} not found`);
      }

      const itemsRes = await client.query(
        `SELECT li.*,
                e.employee_no AS "employeeNo",
                e.first_name AS "firstName",
                e.last_name AS "lastName",
                b.name AS "branchName"
           FROM payroll_line_item li
           JOIN employee e ON e.id = li.employee_id
           LEFT JOIN branch b ON b.id = li.branch_id
          WHERE li.payroll_run_id = $1 AND li.org_id = app.current_org_id()
          ORDER BY e.last_name ASC, e.first_name ASC`,
        [runId],
      );

      return {
        run: runRes.rows[0],
        lineItems: itemsRes.rows,
      };
    });
  }

  /**
   * Batch Compute Payroll Run
   */
  async computePayrollRun(ctx: RequestContext, dto: ComputePayrollRunDto) {
    return this.db.withContext(ctx, async (client) => {
      // 1. Fetch eligible employees with active compensation
      const params: any[] = [];
      let branchFilter = '';
      if (dto.branchId) {
        params.push(dto.branchId);
        branchFilter = 'AND (c.branch_id = $1 OR (c.branch_id IS NULL AND e.org_id = app.current_org_id()))';
      }

      const empRes = await client.query(
        `SELECT e.id AS employee_id, e.employee_no, e.first_name, e.last_name,
                c.monthly_rate, c.daily_rate, c.hourly_rate, c.pay_type, c.pay_frequency,
                c.is_minimum_wage, c.rice_subsidy, c.clothing_allowance,
                c.laundry_allowance, c.medical_allowance, c.taxable_allowance,
                c.bank_name, c.bank_account_no, c.branch_id
           FROM employee e
           JOIN employee_compensation c ON c.employee_id = e.id
          WHERE e.org_id = app.current_org_id()
            AND e.status != 'separated'
            ${branchFilter}`,
        params,
      );

      if (empRes.rows.length === 0) {
        throw new BadRequestException('No active employees with compensation profiles found to compute.');
      }

      const isQuindena = dto.runType === 'quindena_1' || dto.runType === 'quindena_2';
      const quindenaSplit: 'first' | 'second' | 'split' = 'split';

      let totalGross = 0;
      let totalTaxable = 0;
      let totalWithholdingTax = 0;
      let totalSssEe = 0;
      let totalSssEr = 0;
      let totalPhilhealthEe = 0;
      let totalPhilhealthEr = 0;
      let totalPagibigEe = 0;
      let totalPagibigEr = 0;
      let totalNetPay = 0;

      const computedLineItems: any[] = [];

      for (const emp of empRes.rows) {
        const monthlyRate = Number(emp.monthly_rate);
        const isMwe = Boolean(emp.is_minimum_wage);

        // Earnings
        const basicPay = isQuindena
          ? Math.round((monthlyRate / 2) * 100) / 100
          : monthlyRate;

        // De minimis allowances (tax-free under NIRC / BIR):
        // Rice subsidy, clothing, laundry, medical
        const totalMonthlyDeMinimis =
          Number(emp.rice_subsidy) +
          Number(emp.clothing_allowance) +
          Number(emp.laundry_allowance) +
          Number(emp.medical_allowance);

        let deMinimisAllowances = isQuindena
          ? Math.round((totalMonthlyDeMinimis / 2) * 100) / 100
          : totalMonthlyDeMinimis;

        let taxableAllowances = isQuindena
          ? Math.round((Number(emp.taxable_allowance) / 2) * 100) / 100
          : Number(emp.taxable_allowance);

        // Interconnected Attendance & Leaves (automatically pulls approved DTR and Leaves if present)
        let overtimePay = 0.0;
        let nightDiffPay = 0.0;
        let holidayPay = 0.0;
        let tardinessUndertime = 0.0;
        let absencesUnpaid = 0.0;

        const hourlyRate = Number(emp.hourly_rate) || ((monthlyRate * 12) / 261 / 8);
        const dailyRate = Number(emp.daily_rate) || ((monthlyRate * 12) / 261);

        // Attendance DTR query for current employee & cut-off period
        const attRes = await client.query(
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
          [emp.employee_id, dto.periodStart, dto.periodEnd],
        );

        if (attRes.rows[0]) {
          const att = attRes.rows[0];
          const attPay = calculatePhilippineAttendancePay({
            hourlyRate,
            regularOtHours: Number(att.regularOtHours),
            restDayOtHours: Number(att.restDayOtHours),
            regularHolidayOtHours: Number(att.holidayOtHours),
            nightDiffHours: Number(att.nightDiffHours),
            tardinessMinutes: Number(att.tardinessMinutes),
            undertimeMinutes: Number(att.undertimeMinutes),
          });

          overtimePay = Math.round((attPay.regularOtPay + attPay.restDayOtPay) * 100) / 100;
          holidayPay = attPay.regularHolidayOtPay;
          nightDiffPay = attPay.nightDiffPay;
          tardinessUndertime = attPay.totalAttendanceDeductions;
          absencesUnpaid = Math.round(Number(att.absentDays) * dailyRate * 100) / 100;
        }

        // Leave query: check unpaid leave days in cut-off
        const leaveRes = await client.query(
          `SELECT COALESCE(SUM(r.total_days), 0)::numeric(5, 2) AS "unpaidDays"
             FROM leave_request r
             JOIN leave_type t ON t.id = r.leave_type_id
            WHERE r.org_id = app.current_org_id()
              AND r.employee_id = $1
              AND r.status = 'approved'
              AND t.is_paid = FALSE
              AND r.start_date <= $3::date AND r.end_date >= $2::date`,
          [emp.employee_id, dto.periodStart, dto.periodEnd],
        );

        if (leaveRes.rows[0] && Number(leaveRes.rows[0].unpaidDays) > 0) {
          absencesUnpaid += Math.round(Number(leaveRes.rows[0].unpaidDays) * dailyRate * 100) / 100;
        }

        const grossPay = Math.round(
          (basicPay +
            overtimePay +
            nightDiffPay +
            holidayPay +
            deMinimisAllowances +
            taxableAllowances) *
            100,
        ) / 100;

        // Statutory Deductions:
        // SSS (RA 11199)
        const sssFull = calculateSssContribution(monthlyRate);
        const sssApportioned = apportionSssQuindena(sssFull, isQuindena ? quindenaSplit : 'split');
        const sssEe = sssApportioned.ee;
        const sssEr = sssApportioned.er;
        const sssEcEr = sssApportioned.ec;
        const sssWispEe = isQuindena
          ? Math.round((sssFull.wispEe / 2) * 100) / 100
          : sssFull.wispEe;
        const sssWispEr = isQuindena
          ? Math.round((sssFull.wispEr / 2) * 100) / 100
          : sssFull.wispEr;

        // PhilHealth (RA 11223)
        const philhealthFull = calculatePhilHealthContribution(monthlyRate);
        const phicApportioned = apportionPhilHealthQuindena(
          philhealthFull,
          isQuindena ? quindenaSplit : 'split',
        );
        const philhealthEe = phicApportioned.ee;
        const philhealthEr = phicApportioned.er;

        // Pag-IBIG (Circular 460)
        const pagibigFull = calculatePagIbigContribution(monthlyRate);
        const hdmfApportioned = apportionPagIbigQuindena(
          pagibigFull,
          isQuindena ? quindenaSplit : 'split',
        );
        const pagibigEe = hdmfApportioned.ee;
        const pagibigEr = hdmfApportioned.er;

        // Total Employee Pre-Tax Statutory Deductions
        const totalPreTaxStatutoryEe = Math.round(
          (sssEe + sssWispEe + philhealthEe + pagibigEe) * 100,
        ) / 100;

        // Taxable Base = (Basic + Taxable Allowances + OT + NightDiff + Holiday - Absences/Tardiness) - Mandatory Statutory Contributions
        const grossTaxableEarnings = Math.round(
          (basicPay + taxableAllowances + overtimePay + nightDiffPay + holidayPay - (tardinessUndertime + absencesUnpaid)) *
            100,
        ) / 100;

        const taxableIncome = Math.max(
          0,
          Math.round((grossTaxableEarnings - totalPreTaxStatutoryEe) * 100) / 100,
        );

        // TRAIN Withholding Tax (RA 10963)
        const taxResult = isQuindena
          ? calculateSemiMonthlyWithholdingTax(taxableIncome, isMwe)
          : calculateMonthlyWithholdingTax(taxableIncome, isMwe);

        const withholdingTax = taxResult.withholdingTax;

        // Active Loan Deductions for this employee
        const loanRes = await client.query(
          `SELECT id, remaining_balance, amortization_per_cutoff
             FROM employee_loan
            WHERE org_id = app.current_org_id()
              AND employee_id = $1
              AND status = 'active'
              AND remaining_balance > 0`,
          [emp.employee_id],
        );
        let loansDeductions = 0.0;
        for (const l of loanRes.rows) {
          loansDeductions += Math.min(Number(l.remaining_balance), Number(l.amortization_per_cutoff));
        }
        loansDeductions = Math.round(loansDeductions * 100) / 100;

        // Custom Deductions & Extra Allowances
        const entryRes = await client.query(
          `SELECT entry_type, amount, is_taxable
             FROM payroll_entry_item
            WHERE org_id = app.current_org_id()
              AND employee_id = $1
              AND is_active = TRUE
              AND effective_from <= $2::date
              AND (effective_to IS NULL OR effective_to >= $2::date)`,
          [emp.employee_id, dto.periodEnd],
        );
        let otherDeductions = 0.0;
        for (const e of entryRes.rows) {
          if (e.entry_type === 'deduction') {
            otherDeductions += Number(e.amount);
          } else if (e.entry_type === 'allowance') {
            if (e.is_taxable) {
              taxableAllowances += Number(e.amount);
            } else {
              deMinimisAllowances += Number(e.amount);
            }
          }
        }
        otherDeductions = Math.round(otherDeductions * 100) / 100;

        const totalDeductions = Math.round(
          (tardinessUndertime +
            absencesUnpaid +
            sssEe +
            sssWispEe +
            philhealthEe +
            pagibigEe +
            withholdingTax +
            loansDeductions +
            otherDeductions) *
            100,
        ) / 100;

        const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

        // 13th Month Accrual (PD 851)
        const thirteenthMonthAccrual = calculateCycleThirteenthMonthAccrual(
          Math.max(0, basicPay - absencesUnpaid),
        );

        // Accumulate Run Totals
        totalGross += grossPay;
        totalTaxable += taxableIncome;
        totalWithholdingTax += withholdingTax;
        totalSssEe += sssEe + sssWispEe;
        totalSssEr += sssEr + sssWispEr + sssEcEr;
        totalPhilhealthEe += philhealthEe;
        totalPhilhealthEr += philhealthEr;
        totalPagibigEe += pagibigEe;
        totalPagibigEr += pagibigEr;
        totalNetPay += netPay;

        computedLineItems.push({
          employeeId: emp.employee_id,
          branchId: emp.branch_id,
          basicPay,
          overtimePay,
          nightDiffPay,
          holidayPay,
          deMinimisAllowances,
          taxableAllowances,
          grossPay,
          tardinessUndertime,
          absencesUnpaid,
          sssEe,
          sssWispEe,
          philhealthEe,
          pagibigEe,
          taxableIncome,
          withholdingTax,
          loansDeductions,
          otherDeductions,
          totalDeductions,
          sssEr,
          sssWispEr,
          sssEcEr,
          philhealthEr,
          pagibigEr,
          netPay,
          thirteenthMonthAccrual,
          bankName: emp.bank_name,
          bankAccountNo: emp.bank_account_no,
        });
      }

      // 2. Insert Payroll Run Record (recording preparer for Maker-Checker control)
      await this.requirePayrollRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const runRes = await client.query(
        `INSERT INTO payroll_run (
           org_id, branch_id, code, title, period_start, period_end, payout_date,
           run_type, status, total_gross, total_taxable, total_withholding_tax,
           total_sss_ee, total_sss_er, total_philhealth_ee, total_philhealth_er,
           total_pagibig_ee, total_pagibig_er, total_net_pay, employee_count,
           computed_by
         ) VALUES (
           app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, 'computed', $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19
         )
         RETURNING *`,
        [
          dto.branchId || null,
          dto.code,
          dto.title,
          dto.periodStart,
          dto.periodEnd,
          dto.payoutDate,
          dto.runType,
          Math.round(totalGross * 100) / 100,
          Math.round(totalTaxable * 100) / 100,
          Math.round(totalWithholdingTax * 100) / 100,
          Math.round(totalSssEe * 100) / 100,
          Math.round(totalSssEr * 100) / 100,
          Math.round(totalPhilhealthEe * 100) / 100,
          Math.round(totalPhilhealthEr * 100) / 100,
          Math.round(totalPagibigEe * 100) / 100,
          Math.round(totalPagibigEr * 100) / 100,
          Math.round(totalNetPay * 100) / 100,
          computedLineItems.length,
          ctx.employeeId,
        ],
      );

      const payrollRun = runRes.rows[0];
      const runYear = new Date(dto.periodStart).getFullYear();

      // 3. Insert Line Items and 13th-month accruals
      for (const item of computedLineItems) {
        await client.query(
          `INSERT INTO payroll_line_item (
             payroll_run_id, org_id, employee_id, branch_id,
             basic_pay, overtime_pay, night_diff_pay, holiday_pay,
             de_minimis_allowances, taxable_allowances, gross_pay,
             tardiness_undertime, absences_unpaid, sss_ee, sss_wisp_ee,
             philhealth_ee, pagibig_ee, taxable_income, withholding_tax,
             loans_deductions, other_deductions, total_deductions,
             sss_er, sss_wisp_er, sss_ec_er, philhealth_er, pagibig_er,
             net_pay, thirteenth_month_accrual, bank_name, bank_account_no
           ) VALUES (
             $1, app.current_org_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
             $23, $24, $25, $26, $27, $28, $29, $30
           )`,
          [
            payrollRun.id,
            item.employeeId,
            item.branchId,
            item.basicPay,
            item.overtimePay,
            item.nightDiffPay,
            item.holidayPay,
            item.deMinimisAllowances,
            item.taxableAllowances,
            item.grossPay,
            item.tardinessUndertime,
            item.absencesUnpaid,
            item.sssEe,
            item.sssWispEe,
            item.philhealthEe,
            item.pagibigEe,
            item.taxableIncome,
            item.withholdingTax,
            item.loansDeductions,
            item.otherDeductions,
            item.totalDeductions,
            item.sssEr,
            item.sssWispEr,
            item.sssEcEr,
            item.philhealthEr,
            item.pagibigEr,
            item.netPay,
            item.thirteenthMonthAccrual,
            item.bankName,
            item.bankAccountNo,
          ],
        );

        // Record in 13th Month Accrual Ledger
        await client.query(
          `INSERT INTO thirteenth_month_accrual (
             org_id, employee_id, payroll_run_id, year, basic_earned, accrual_amount
           ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5)`,
          [
            item.employeeId,
            payrollRun.id,
            runYear,
            item.basicPay,
            item.thirteenthMonthAccrual,
          ],
        );
      }

      return payrollRun;
    });
  }

  /**
   * Role verification helper for sensitive Payroll lifecycle actions.
   */
  private async requirePayrollRole(
    client: PoolClient,
    ctx: RequestContext,
    allowedRoles: string[],
  ): Promise<string[]> {
    const res = await client.query<{ code: string }>(
      `SELECT DISTINCT r.code
         FROM role_assignment ra
         JOIN app_role r ON r.id = ra.role_id
        WHERE ra.employee_id = $1
          AND ra.org_id = app.current_org_id()
          AND ra.effective_from <= CURRENT_DATE
          AND (ra.effective_to IS NULL OR CURRENT_DATE < ra.effective_to)`,
      [ctx.employeeId],
    );
    const roles = res.rows.map((r) => r.code);
    if (!roles.some((r) => allowedRoles.includes(r))) {
      throw new ForbiddenException(
        `Insufficient role permissions. Required one of: ${allowedRoles.join(', ')}`,
      );
    }
    return roles;
  }

  /**
   * Approve Payroll Run (with Maker-Checker Enforcement)
   */
  async approvePayrollRun(ctx: RequestContext, runId: string) {
    return this.db.withContext(ctx, async (client) => {
      await this.requirePayrollRole(client, ctx, ['hr_admin', 'manager']);

      const existingRes = await client.query(
        `SELECT * FROM payroll_run WHERE id = $1 AND org_id = app.current_org_id()`,
        [runId],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw new NotFoundException(`Payroll run ${runId} not found`);
      }
      if (existing.status !== 'computed' && existing.status !== 'draft') {
        throw new BadRequestException(
          `Payroll run cannot be approved from status '${existing.status}'.`,
        );
      }

      // Check Maker-Checker policy in hr_settings (default TRUE)
      const settingsRes = await client.query<{ enforce_payroll_maker_checker: boolean }>(
        `SELECT enforce_payroll_maker_checker FROM hr_settings WHERE org_id = app.current_org_id() LIMIT 1`,
      );
      const enforceMakerChecker =
        settingsRes.rows[0]?.enforce_payroll_maker_checker ?? true;

      if (enforceMakerChecker && existing.computed_by && existing.computed_by === ctx.employeeId) {
        throw new ForbiddenException(
          'Maker-Checker Policy: The payroll preparer cannot approve their own payroll run. Please have another authorized approver (HR Admin / Finance / Manager) approve it.',
        );
      }

      const res = await client.query(
        `UPDATE payroll_run
            SET status = 'approved',
                approved_by = $1,
                approved_at = now(),
                updated_at = now()
          WHERE id = $2 AND org_id = app.current_org_id()
          RETURNING *`,
        [ctx.employeeId, runId],
      );
      return res.rows[0];
    });
  }

  /**
   * Disburse Payroll Run
   */
  async disbursePayrollRun(ctx: RequestContext, runId: string) {
    return this.db.withContext(ctx, async (client) => {
      await this.requirePayrollRole(client, ctx, ['hr_admin', 'manager']);

      const existingRes = await client.query(
        `SELECT status FROM payroll_run WHERE id = $1 AND org_id = app.current_org_id()`,
        [runId],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw new NotFoundException(`Payroll run ${runId} not found`);
      }
      if (existing.status !== 'approved') {
        throw new BadRequestException(
          'Payroll run must be approved before it can be disbursed.',
        );
      }

      const res = await client.query(
        `UPDATE payroll_run
            SET status = 'disbursed',
                disbursed_by = $1,
                disbursed_at = now(),
                updated_at = now()
          WHERE id = $2 AND org_id = app.current_org_id()
          RETURNING *`,
        [ctx.employeeId, runId],
      );

      await client.query(
        `UPDATE payroll_line_item
            SET disbursement_status = 'paid'
          WHERE payroll_run_id = $1 AND org_id = app.current_org_id()`,
        [runId],
      );

      // Settle active loan amortizations if loan deductions were present in this run
      const lineItems = await client.query(
        `SELECT employee_id, loans_deductions
           FROM payroll_line_item
          WHERE payroll_run_id = $1 AND loans_deductions > 0`,
        [runId],
      );
      for (const li of lineItems.rows) {
        const activeLoans = await client.query(
          `SELECT id, remaining_balance, amortization_per_cutoff
             FROM employee_loan
            WHERE org_id = app.current_org_id()
              AND employee_id = $1
              AND status = 'active'
              AND remaining_balance > 0
            ORDER BY created_at ASC`,
          [li.employee_id],
        );
        let remDeduction = Number(li.loans_deductions);
        for (const loan of activeLoans.rows) {
          if (remDeduction <= 0) break;
          const payAmt = Math.min(remDeduction, Number(loan.remaining_balance), Number(loan.amortization_per_cutoff));
          const newBal = Math.max(0, Number(loan.remaining_balance) - payAmt);
          await client.query(
            `UPDATE employee_loan
                SET remaining_balance = $1,
                    status = CASE WHEN $1 <= 0 THEN 'fully_paid' ELSE 'active' END,
                    updated_at = now()
              WHERE id = $2`,
            [newBal, loan.id],
          );
          await client.query(
            `INSERT INTO loan_amortization_payment (
               org_id, loan_id, payroll_run_id, amount_deducted, remaining_balance_after
             ) VALUES (app.current_org_id(), $1, $2, $3, $4)`,
            [loan.id, runId, payAmt, newBal],
          );
          remDeduction -= payAmt;
        }
      }

      const disbursedEmps = await client.query<{ employee_id: string; net_pay: string }>(
        `SELECT employee_id, net_pay FROM payroll_line_item WHERE payroll_run_id = $1`,
        [runId],
      );
      for (const emp of disbursedEmps.rows) {
        await NotificationsService.tryEnqueue(client, emp.employee_id, 'payslip_released', {
          payrollRunId: runId,
          code: res.rows[0].code,
          title: res.rows[0].title,
          netPay: emp.net_pay,
        });
      }

      return res.rows[0];
    });
  }

  /**
   * Generate Bank Disbursement Batch File (BPI BizLink, BDO PayLink, Metrobank, UnionBank)
   */
  async generateDisbursementFile(ctx: RequestContext, runId: string, bank: string) {
    return this.db.withContext(ctx, async (client) => {
      const runRes = await client.query(
        `SELECT pr.title, pr.code, pr.payout_date::text AS "payoutDate", pr.total_net_pay AS "totalNet",
                o.name AS "orgName", o.code AS "orgCode"
           FROM payroll_run pr
           JOIN organization o ON o.id = pr.org_id
          WHERE pr.id = $1 AND pr.org_id = app.current_org_id()`,
        [runId],
      );

      if (runRes.rowCount === 0) {
        throw new NotFoundException(`Payroll run not found`);
      }

      const runInfo = runRes.rows[0];

      const itemsRes = await client.query(
        `SELECT li.net_pay AS "netPay",
                li.bank_account_no AS "accountNo",
                e.first_name AS "firstName",
                e.last_name AS "lastName",
                e.employee_no AS "employeeNo"
           FROM payroll_line_item li
           JOIN employee e ON e.id = li.employee_id
          WHERE li.payroll_run_id = $1 AND li.org_id = app.current_org_id()
          ORDER BY e.last_name ASC`,
        [runId],
      );

      const targetBank = bank.toUpperCase();
      let content = '';

      if (targetBank === 'BPI') {
        // BPI BizLink format: Employee ID, Account Number, Amount, Account Name
        content = ['Employee ID,Account Number,Amount,Account Name'].join(',') + '\n';
        for (const item of itemsRes.rows) {
          content += `${item.employeeNo},${item.accountNo || 'NO-ACCT'},${Number(item.netPay).toFixed(2)},"${item.lastName}, ${item.firstName}"\n`;
        }
      } else if (targetBank === 'BDO') {
        // BDO Auto-Credit (EPPS) Corporate format
        content += `H,${runInfo.orgCode || 'BDO-CORP'},${runInfo.payoutDate},${Number(runInfo.totalNet || 0).toFixed(2)},${itemsRes.rows.length}\n`;
        for (const item of itemsRes.rows) {
          content += `D,${item.accountNo || 'NO-ACCT'},${Number(item.netPay).toFixed(2)},"${item.firstName} ${item.lastName}",SALARY\n`;
        }
      } else if (targetBank === 'UNIONBANK') {
        // UnionBank The Portal Corporate Batch format
        content = ['Source Account,Beneficiary Account,Amount,Currency,Beneficiary Name,Payment Description,Reference'].join(',') + '\n';
        for (const item of itemsRes.rows) {
          content += `SOURCE-ACCT,${item.accountNo || 'NO-ACCT'},${Number(item.netPay).toFixed(2)},PHP,"${item.lastName}, ${item.firstName}",SALARY,${item.employeeNo}\n`;
        }
      } else if (targetBank === 'METROBANK') {
        // Metrobank Direct Corporate format
        content = ['Debit Account,Credit Account,Amount,Employee Name,Remarks'].join(',') + '\n';
        for (const item of itemsRes.rows) {
          content += `MBTC-CORP,${item.accountNo || 'NO-ACCT'},${Number(item.netPay).toFixed(2)},"${item.lastName}, ${item.firstName}",${runInfo.code}\n`;
        }
      } else {
        // Standard universal disbursement CSV
        content = ['Bank,Account No,Employee Name,Employee No,Net Amount,Payout Date'].join(',') + '\n';
        for (const item of itemsRes.rows) {
          content += `${targetBank},${item.accountNo || 'NO-ACCT'},"${item.lastName}, ${item.firstName}",${item.employeeNo},${Number(item.netPay).toFixed(2)},${runInfo.payoutDate}\n`;
        }
      }

      return {
        bank: targetBank,
        filename: `Disbursement_${targetBank}_${runId}.csv`,
        content,
      };
    });
  }

  /**
   * Generate Statutory Reports (SSS R-3, PhilHealth EPRS, Pag-IBIG MCRF, BIR 1601-C / 2316)
   */
  async generateStatutoryReport(
    ctx: RequestContext,
    runId: string,
    agency: 'sss' | 'philhealth' | 'pagibig' | 'bir',
  ) {
    return this.db.withContext(ctx, async (client) => {
      const itemsRes = await client.query(
        `SELECT li.*,
                c.sss_no AS "sssNo",
                c.philhealth_no AS "philhealthNo",
                c.pagibig_no AS "pagibigNo",
                c.tin,
                c.monthly_rate AS "monthlyRate",
                e.employee_no AS "employeeNo",
                e.first_name AS "firstName",
                e.last_name AS "lastName"
           FROM payroll_line_item li
           JOIN employee e ON e.id = li.employee_id
           JOIN employee_compensation c ON c.employee_id = e.id
          WHERE li.payroll_run_id = $1 AND li.org_id = app.current_org_id()
          ORDER BY e.last_name ASC`,
        [runId],
      );

      let filename = '';
      let content = '';

      switch (agency) {
        case 'sss':
          filename = `SSS_R3_${runId}.csv`;
          content = 'SSS Number,Employee Name,Monthly Salary,EE Share,ER Share,EC,WISP EE,WISP ER,Total\n';
          for (const i of itemsRes.rows) {
            const total =
              Number(i.sss_ee) +
              Number(i.sss_er) +
              Number(i.sss_ec_er) +
              Number(i.sss_wisp_ee) +
              Number(i.sss_wisp_er);
            content += `${i.sssNo || 'N/A'},"${i.lastName}, ${i.firstName}",${Number(i.monthlyRate).toFixed(2)},${Number(i.sss_ee).toFixed(2)},${Number(i.sss_er).toFixed(2)},${Number(i.sss_ec_er).toFixed(2)},${Number(i.sss_wisp_ee).toFixed(2)},${Number(i.sss_wisp_er).toFixed(2)},${total.toFixed(2)}\n`;
          }
          break;

        case 'philhealth':
          filename = `PhilHealth_EPRS_${runId}.csv`;
          content = 'PhilHealth PIN,Employee Name,Monthly Basic,EE Premium (2.5%),ER Premium (2.5%),Total (5.0%)\n';
          for (const i of itemsRes.rows) {
            const total = Number(i.philhealth_ee) + Number(i.philhealth_er);
            content += `${i.philhealthNo || 'N/A'},"${i.lastName}, ${i.firstName}",${Number(i.monthlyRate).toFixed(2)},${Number(i.philhealth_ee).toFixed(2)},${Number(i.philhealth_er).toFixed(2)},${total.toFixed(2)}\n`;
          }
          break;

        case 'pagibig':
          filename = `PagIBIG_MCRF_${runId}.csv`;
          content = 'Pag-IBIG MID,Employee Name,Monthly Comp,EE Contribution,ER Contribution,Total\n';
          for (const i of itemsRes.rows) {
            const total = Number(i.pagibig_ee) + Number(i.pagibig_er);
            content += `${i.pagibigNo || 'N/A'},"${i.lastName}, ${i.firstName}",${Number(i.monthlyRate).toFixed(2)},${Number(i.pagibig_ee).toFixed(2)},${Number(i.pagibig_er).toFixed(2)},${total.toFixed(2)}\n`;
          }
          break;

        case 'bir':
          filename = `BIR_1601C_${runId}.csv`;
          content = 'TIN,Employee Name,Gross Pay,Non-Taxable,Taxable Income,Tax Withheld\n';
          for (const i of itemsRes.rows) {
            const nonTaxable =
              Number(i.de_minimis_allowances) +
              Number(i.sss_ee) +
              Number(i.sss_wisp_ee) +
              Number(i.philhealth_ee) +
              Number(i.pagibig_ee);
            content += `${i.tin || 'N/A'},"${i.lastName}, ${i.firstName}",${Number(i.gross_pay).toFixed(2)},${nonTaxable.toFixed(2)},${Number(i.taxable_income).toFixed(2)},${Number(i.withholding_tax).toFixed(2)}\n`;
          }
          break;
      }

      return {
        agency,
        filename,
        content,
      };
    });
  }

  /**
   * Employee Self-Service (ESS): Historical Payslips for logged-in employee
   */
  async getMyPayslips(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT li.id,
                li.payroll_run_id AS "runId",
                pr.code AS "runCode",
                pr.title AS "runTitle",
                pr.period_start::text AS "periodStart",
                pr.period_end::text AS "periodEnd",
                pr.payout_date::text AS "payoutDate",
                pr.run_type AS "runType",
                li.basic_pay AS "basicPay",
                li.gross_pay AS "grossPay",
                li.total_deductions AS "totalDeductions",
                li.net_pay AS "netPay",
                li.disbursement_status AS "disbursementStatus",
                li.created_at AS "createdAt"
           FROM payroll_line_item li
           JOIN payroll_run pr ON pr.id = li.payroll_run_id
          WHERE li.employee_id = $1
            AND li.org_id = app.current_org_id()
            AND pr.status IN ('approved', 'disbursed')
          ORDER BY pr.period_end DESC`,
        [ctx.employeeId],
      );
      return res.rows;
    });
  }

  /**
   * Employee Self-Service (ESS): Full itemized payslip breakdown
   */
  async getMyPayslipDetail(ctx: RequestContext, lineItemId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT li.id,
                li.payroll_run_id AS "payrollRunId",
                li.employee_id AS "employeeId",
                li.basic_pay AS "basicPay",
                li.overtime_pay AS "overtimePay",
                li.night_diff_pay AS "nightDiffPay",
                li.holiday_pay AS "holidayPay",
                li.de_minimis_allowances AS "deMinimisAllowances",
                li.taxable_allowances AS "taxableAllowances",
                li.gross_pay AS "grossPay",
                li.tardiness_undertime AS "tardinessUndertime",
                li.absences_unpaid AS "absencesUnpaid",
                li.sss_ee AS "sssEe",
                li.sss_wisp_ee AS "sssWispEe",
                li.philhealth_ee AS "philhealthEe",
                li.pagibig_ee AS "pagibigEe",
                li.taxable_income AS "taxableIncome",
                li.withholding_tax AS "withholdingTax",
                li.total_deductions AS "totalDeductions",
                li.net_pay AS "netPay",
                li.thirteenth_month_accrual AS "thirteenthMonthAccrual",
                li.disbursement_status AS "disbursementStatus",
                pr.code AS "runCode",
                pr.title AS "runTitle",
                pr.period_start::text AS "periodStart",
                pr.period_end::text AS "periodEnd",
                pr.payout_date::text AS "payoutDate",
                pr.run_type AS "runType",
                o.name AS "companyName",
                COALESCE(b.name, 'Headquarters') AS "branchName",
                COALESCE(b.address, '') AS "branchAddress",
                e.employee_no AS "employeeNo",
                e.first_name AS "firstName",
                e.last_name AS "lastName",
                COALESCE(d.name, 'General') AS "departmentName",
                c.tin,
                c.sss_no AS "sssNo",
                c.philhealth_no AS "philhealthNo",
                c.pagibig_no AS "pagibigNo",
                c.bank_name AS "bankName",
                c.bank_account_no AS "bankAccountNo",
                c.monthly_rate AS "monthlyRate"
           FROM payroll_line_item li
           JOIN payroll_run pr ON pr.id = li.payroll_run_id
           JOIN organization o ON o.id = li.org_id
           JOIN employee e ON e.id = li.employee_id
           LEFT JOIN employee_compensation c ON c.employee_id = e.id
           LEFT JOIN branch b ON b.id = li.branch_id
           LEFT JOIN employment emp ON emp.employee_id = e.id AND emp.effective_to IS NULL
           LEFT JOIN department d ON d.id = emp.department_id
          WHERE li.id = $1
            AND (li.employee_id = $2 OR app.is_security_admin() OR app.is_platform_superadmin())
            AND li.org_id = app.current_org_id()`,
        [lineItemId, ctx.employeeId],
      );

      if (res.rowCount === 0) {
        throw new NotFoundException(`Payslip not found`);
      }

      const item = res.rows[0];

      // Calculate Year-To-Date (YTD) cumulative amounts for this employee
      const year = new Date(item.periodStart).getFullYear();
      const ytdRes = await client.query(
        `SELECT COALESCE(SUM(pli.gross_pay), 0) AS "ytdGross",
                COALESCE(SUM(pli.withholding_tax), 0) AS "ytdTax",
                COALESCE(SUM(pli.thirteenth_month_accrual), 0) AS "ytdThirteenthMonth"
           FROM payroll_line_item pli
           JOIN payroll_run pr ON pr.id = pli.payroll_run_id
          WHERE pli.employee_id = $1
            AND pli.org_id = app.current_org_id()
            AND EXTRACT(YEAR FROM pr.period_start) = $2
            AND pr.period_end <= $3
            AND pr.status IN ('approved', 'disbursed')`,
        [item.employeeId, year, item.periodEnd],
      );

      return {
        ...item,
        ytd: ytdRes.rows[0] ?? { ytdGross: 0, ytdTax: 0, ytdThirteenthMonth: 0 },
      };
    });
  }

  /**
   * Generate Philippine BIR Form 2316 Certificate of Compensation Payment / Tax Withheld
   */
  async generateBir2316(ctx: RequestContext, employeeId: string, year: number) {
    return this.db.withContext(ctx, async (client) => {
      // 1. Fetch Employer & Employee Registration Details
      const empRes = await client.query(
        `SELECT e.id, e.employee_no AS "employeeNo", e.first_name AS "firstName", e.last_name AS "lastName",
                e.work_email AS "workEmail",
                o.name AS "employerName", o.code AS "employerCode",
                COALESCE(b.name, 'Head Office') AS "branchName",
                COALESCE(b.address, 'Metro Manila, Philippines') AS "employerAddress",
                COALESCE(b.bir_rdo_code, '038') AS "employerRdo",
                c.tin AS "employeeTin",
                c.sss_no AS "sssNo",
                c.philhealth_no AS "philhealthNo",
                c.pagibig_no AS "pagibigNo",
                c.is_minimum_wage AS "isMinimumWage",
                c.monthly_rate AS "monthlyRate"
           FROM employee e
           JOIN organization o ON o.id = e.org_id
           LEFT JOIN employee_compensation c ON c.employee_id = e.id
           LEFT JOIN branch b ON b.id = c.branch_id
          WHERE e.id = $1 AND e.org_id = app.current_org_id()`,
        [employeeId],
      );

      if (empRes.rowCount === 0) {
        throw new NotFoundException(`Employee not found`);
      }

      const emp = empRes.rows[0];

      // 2. Aggregate all approved pay runs for the calendar year
      const runsRes = await client.query(
        `SELECT pli.*
           FROM payroll_line_item pli
           JOIN payroll_run pr ON pr.id = pli.payroll_run_id
          WHERE pli.employee_id = $1
            AND pli.org_id = app.current_org_id()
            AND EXTRACT(YEAR FROM pr.period_start) = $2
            AND pr.status IN ('approved', 'disbursed')`,
        [employeeId, year],
      );

      const items = runsRes.rows;

      // Part IVA: Gross Compensation Income
      const basicSalary = items.reduce((s, i) => s + Number(i.basic_pay || 0), 0);
      const overtimePay = items.reduce((s, i) => s + Number(i.overtime_pay || 0), 0);
      const nightDiffPay = items.reduce((s, i) => s + Number(i.night_diff_pay || 0), 0);
      const holidayPay = items.reduce((s, i) => s + Number(i.holiday_pay || 0), 0);
      const taxableAllowances = items.reduce((s, i) => s + Number(i.taxable_allowances || 0), 0);
      const totalGrossCompensation = items.reduce((s, i) => s + Number(i.gross_pay || 0), 0);

      // Part IVB: Non-Taxable / Exempt Compensation Income
      const total13thMonthAccrued = items.reduce((s, i) => s + Number(i.thirteenth_month_accrual || 0), 0);
      const nonTaxable13thMonth = Math.min(90000, total13thMonthAccrued); // Cap: PHP 90,000 under TRAIN
      const taxable13thMonth = Math.max(0, total13thMonthAccrued - 90000);

      const deMinimisBenefits = items.reduce((s, i) => s + Number(i.de_minimis_allowances || 0), 0);
      const sssContributions = items.reduce((s, i) => s + Number(i.sss_ee || 0) + Number(i.sss_wisp_ee || 0), 0);
      const phicContributions = items.reduce((s, i) => s + Number(i.philhealth_ee || 0), 0);
      const hdmfContributions = items.reduce((s, i) => s + Number(i.pagibig_ee || 0), 0);
      const totalMandatoryStatutory = sssContributions + phicContributions + hdmfContributions;

      const totalNonTaxableCompensation = Math.round(
        (nonTaxable13thMonth + deMinimisBenefits + totalMandatoryStatutory) * 100,
      ) / 100;

      // Part IVC: Taxable Compensation Income & Tax Due
      const taxableCompensationIncome = Math.max(
        0,
        Math.round((totalGrossCompensation + taxable13thMonth - totalNonTaxableCompensation) * 100) / 100,
      );

      const annualTaxResult = calculateAnnualWithholdingTax(taxableCompensationIncome, emp.isMinimumWage);
      const taxDue = annualTaxResult.withholdingTax;
      const totalTaxWithheld = items.reduce((s, i) => s + Number(i.withholding_tax || 0), 0);
      const taxPayableOrRefund = Math.round((taxDue - totalTaxWithheld) * 100) / 100;

      return {
        year,
        employer: {
          name: emp.employerName,
          code: emp.employerCode,
          branch: emp.branchName,
          address: emp.employerAddress,
          rdoCode: emp.employerRdo,
          tin: '000-000-000-000',
        },
        employee: {
          id: emp.id,
          employeeNo: emp.employeeNo,
          name: `${emp.lastName}, ${emp.firstName}`,
          tin: emp.employeeTin || 'N/A',
          sssNo: emp.sssNo || 'N/A',
          philhealthNo: emp.philhealthNo || 'N/A',
          pagibigNo: emp.pagibigNo || 'N/A',
          isMinimumWage: Boolean(emp.isMinimumWage),
        },
        partIVA_GrossCompensation: {
          basicSalary,
          overtimePay,
          nightDiffPay,
          holidayPay,
          taxableAllowances,
          totalGrossCompensation,
        },
        partIVB_NonTaxableExempt: {
          thirteenthMonthExempt: nonTaxable13thMonth,
          deMinimisBenefits,
          sssContributions,
          phicContributions,
          hdmfContributions,
          totalMandatoryStatutory,
          totalNonTaxableCompensation,
        },
        partIVC_Summary: {
          taxableCompensationIncome,
          taxDue,
          totalTaxWithheld,
          taxPayableOrRefund,
          formula: annualTaxResult.formula,
        },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Employee Loan Ledger
  // ---------------------------------------------------------------------------

  async createEmployeeLoan(ctx: RequestContext, dto: CreateLoanDto) {
    return this.db.withContext(ctx, async (client) => {
      const perCutoff = dto.amortizationPerCutoff || Math.round((dto.monthlyAmortization / 2) * 100) / 100;
      const res = await client.query(
        `INSERT INTO employee_loan (
           org_id, employee_id, loan_type, reference_no, principal_amount,
           monthly_amortization, amortization_per_cutoff, total_terms_months,
           remaining_balance, start_date, status
         ) VALUES (
           app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $4, $8, 'active'
         ) RETURNING *`,
        [
          dto.employeeId,
          dto.loanType,
          dto.referenceNo,
          dto.principalAmount,
          dto.monthlyAmortization,
          perCutoff,
          dto.totalTermsMonths || 24,
          dto.startDate,
        ],
      );
      return res.rows[0];
    });
  }

  async listEmployeeLoans(ctx: RequestContext, employeeId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const sqlParams: any[] = [];
      let empFilter = '';
      if (employeeId) {
        sqlParams.push(employeeId);
        empFilter = `AND el.employee_id = $${sqlParams.length}`;
      }

      const res = await client.query(
        `SELECT el.*,
                e.first_name || ' ' || e.last_name AS "employeeName",
                e.employee_no AS "employeeNo"
           FROM employee_loan el
           JOIN employee e ON e.id = el.employee_id
          WHERE el.org_id = app.current_org_id()
            ${empFilter}
          ORDER BY el.created_at DESC`,
        sqlParams,
      );
      return res.rows;
    });
  }

  async updateLoanStatus(ctx: RequestContext, loanId: string, status: 'active' | 'paused') {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE employee_loan
            SET status = $1, updated_at = now()
          WHERE id = $2 AND org_id = app.current_org_id()
          RETURNING *`,
        [status, loanId],
      );
      if (res.rowCount === 0) throw new NotFoundException('Loan not found');
      return res.rows[0];
    });
  }

  // ---------------------------------------------------------------------------
  // Recurring / Variable Payroll Items (Allowances & Deductions)
  // ---------------------------------------------------------------------------

  async createPayrollEntryItem(ctx: RequestContext, dto: CreatePayrollEntryItemDto) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO payroll_entry_item (
           org_id, employee_id, entry_type, code, name, amount,
           is_taxable, frequency, is_active, effective_from, effective_to
         ) VALUES (
           app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9
         ) RETURNING *`,
        [
          dto.employeeId,
          dto.entryType,
          dto.code.toUpperCase(),
          dto.name,
          dto.amount,
          dto.isTaxable ?? false,
          dto.frequency || 'every_cutoff',
          dto.effectiveFrom || new Date().toISOString().slice(0, 10),
          dto.effectiveTo || null,
        ],
      );
      return res.rows[0];
    });
  }

  async listPayrollEntryItems(ctx: RequestContext, employeeId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const sqlParams: any[] = [];
      let empFilter = '';
      if (employeeId) {
        sqlParams.push(employeeId);
        empFilter = `AND pei.employee_id = $${sqlParams.length}`;
      }

      const res = await client.query(
        `SELECT pei.*,
                e.first_name || ' ' || e.last_name AS "employeeName",
                e.employee_no AS "employeeNo"
           FROM payroll_entry_item pei
           JOIN employee e ON e.id = pei.employee_id
          WHERE pei.org_id = app.current_org_id()
            ${empFilter}
          ORDER BY pei.created_at DESC`,
        sqlParams,
      );
      return res.rows;
    });
  }

  // ---------------------------------------------------------------------------
  // Hospitality Service Charge Pool Distribution (DOLE Article 96)
  // ---------------------------------------------------------------------------

  async distributeServiceCharge(ctx: RequestContext, dto: DistributeServiceChargeDto) {
    return this.db.withContext(ctx, async (client) => {
      // 85% to rank-and-file & supervisory staff; 15% management retainage
      const staffTotal = Math.round(dto.totalPoolAmount * 0.85 * 100) / 100;
      const mgmtTotal = Math.round(dto.totalPoolAmount * 0.15 * 100) / 100;

      // Eligible employees in this run (excluding executive level)
      const empRes = await client.query(
        `SELECT li.employee_id
           FROM payroll_line_item li
           JOIN employee e ON e.id = li.employee_id
           JOIN employment emp ON emp.employee_id = e.id AND emp.effective_to IS NULL
           LEFT JOIN position p ON p.id = emp.position_id
          WHERE li.payroll_run_id = $1
            AND li.org_id = app.current_org_id()
            AND (p.job_level IS NULL OR p.job_level NOT ILIKE '%executive%')`,
        [dto.payrollRunId],
      );

      const count = empRes.rows.length;
      if (count === 0) throw new BadRequestException('No eligible staff found for service charge distribution');

      const perEmpShare = Math.round((staffTotal / count) * 100) / 100;

      const poolRes = await client.query(
        `INSERT INTO service_charge_pool (
           org_id, payroll_run_id, total_pool_amount, staff_share_amount,
           management_share_amount, eligible_staff_count, per_employee_share
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [dto.payrollRunId, dto.totalPoolAmount, staffTotal, mgmtTotal, count, perEmpShare],
      );

      // Add service charge to eligible line items as taxable allowance
      for (const row of empRes.rows) {
        await client.query(
          `UPDATE payroll_line_item
              SET taxable_allowances = taxable_allowances + $1,
                  gross_pay = gross_pay + $1,
                  net_pay = net_pay + $1
            WHERE payroll_run_id = $2 AND employee_id = $3`,
          [perEmpShare, dto.payrollRunId, row.employee_id],
        );
      }

      return poolRes.rows[0];
    });
  }

  async listServiceCharges(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT sc.*, pr.code AS "runCode", pr.title AS "runTitle"
           FROM service_charge_pool sc
           JOIN payroll_run pr ON pr.id = sc.payroll_run_id
          WHERE sc.org_id = app.current_org_id()
          ORDER BY sc.created_at DESC`,
      );
      return res.rows;
    });
  }

  // ---------------------------------------------------------------------------
  // Salary Grade Matrix & Regional Wage Compliance
  // ---------------------------------------------------------------------------

  async upsertSalaryGradeMatrix(ctx: RequestContext, dto: SalaryGradeMatrixDto) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO salary_grade_matrix (
           org_id, job_rank_id, region, min_salary, mid_salary, max_salary
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5)
         ON CONFLICT (org_id, job_rank_id, region) DO UPDATE SET
           min_salary = EXCLUDED.min_salary,
           mid_salary = EXCLUDED.mid_salary,
           max_salary = EXCLUDED.max_salary,
           updated_at = now()
         RETURNING *`,
        [dto.jobRankId, dto.region, dto.minSalary, dto.midSalary, dto.maxSalary],
      );
      return res.rows[0];
    });
  }

  async listSalaryGradeMatrix(ctx: RequestContext, region?: string) {
    return this.db.withContext(ctx, async (client) => {
      const sqlParams: any[] = [];
      let regionFilter = '';
      if (region) {
        sqlParams.push(region);
        regionFilter = `AND sgm.region = $${sqlParams.length}`;
      }

      const res = await client.query(
        `SELECT sgm.*,
                jr.code AS "rankCode",
                jr.name AS "rankName",
                jr.rank_no AS "rankNo"
           FROM salary_grade_matrix sgm
           JOIN job_rank jr ON jr.id = sgm.job_rank_id
          WHERE sgm.org_id = app.current_org_id()
            ${regionFilter}
          ORDER BY jr.rank_no ASC, sgm.region ASC`,
        sqlParams,
      );
      return res.rows;
    });
  }

  // ---------------------------------------------------------------------------
  // Payroll Adjustments & Retroactive Pay
  // ---------------------------------------------------------------------------

  async createPayrollAdjustment(ctx: RequestContext, dto: PayrollAdjustmentDto) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO payroll_adjustment (
           org_id, employee_id, payroll_run_id, adjustment_type, amount, is_taxable, reason
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          dto.employeeId,
          dto.payrollRunId,
          dto.adjustmentType,
          dto.amount,
          dto.isTaxable ?? true,
          dto.reason,
        ],
      );
      return res.rows[0];
    });
  }

  async calculateRetroPay(ctx: RequestContext, dto: CalculateRetroPayDto) {
    return this.db.withContext(ctx, async (client) => {
      // Find all closed runs since effectiveFrom
      const runsRes = await client.query(
        `SELECT pr.id, pr.code, pr.period_start, pr.period_end, li.basic_pay
           FROM payroll_run pr
           JOIN payroll_line_item li ON li.payroll_run_id = pr.id
          WHERE pr.org_id = app.current_org_id()
            AND li.employee_id = $1
            AND pr.period_start >= $2::date
            AND pr.status = 'disbursed'`,
        [dto.employeeId, dto.effectiveFrom],
      );

      let totalDifferential = 0;
      const breakdowns: any[] = [];
      const newQuindenaBasic = dto.newMonthlyRate / 2;

      for (const run of runsRes.rows) {
        const oldBasic = Number(run.basic_pay);
        const diff = Math.max(0, newQuindenaBasic - oldBasic);
        totalDifferential += diff;
        breakdowns.push({
          runCode: run.code,
          oldBasic,
          newBasic: newQuindenaBasic,
          differential: diff,
        });
      }

      totalDifferential = Math.round(totalDifferential * 100) / 100;

      // If positive, optionally record adjustment for target run
      if (totalDifferential > 0 && dto.targetPayrollRunId) {
        await client.query(
          `INSERT INTO payroll_adjustment (
             org_id, employee_id, payroll_run_id, adjustment_type, amount, is_taxable, reason
           ) VALUES (
             app.current_org_id(), $1, $2, 'retro_pay', $3, TRUE, $4
           )`,
          [
            dto.employeeId,
            dto.targetPayrollRunId,
            totalDifferential,
            `Retroactive salary adjustment from ${dto.effectiveFrom}`,
          ],
        );
      }

      return {
        totalDifferential,
        effectiveFrom: dto.effectiveFrom,
        cutoffsAdjusted: runsRes.rows.length,
        breakdowns,
      };
    });
  }

  async listPayrollAdjustments(ctx: RequestContext, payrollRunId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const sqlParams: any[] = [];
      let runFilter = '';
      if (payrollRunId) {
        sqlParams.push(payrollRunId);
        runFilter = `AND pa.payroll_run_id = $${sqlParams.length}`;
      }

      const res = await client.query(
        `SELECT pa.*,
                e.first_name || ' ' || e.last_name AS "employeeName",
                e.employee_no AS "employeeNo"
           FROM payroll_adjustment pa
           JOIN employee e ON e.id = pa.employee_id
          WHERE pa.org_id = app.current_org_id()
            ${runFilter}
          ORDER BY pa.created_at DESC`,
        sqlParams,
      );
      return res.rows;
    });
  }

  /**
   * BIR Form 2316 (Annual Certificate of Compensation Payment / Tax Withheld)
   */
  async getBir2316(ctx: RequestContext, employeeId: string, year: number) {
    return this.db.withContext(ctx, async (client) => {
      if (employeeId !== ctx.employeeId) {
        await this.requirePayrollRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      }

      const empRes = await client.query(
        `SELECT e.id, e.employee_no AS "employeeNo",
                e.first_name || ' ' || e.last_name AS "fullName",
                e.work_email AS "workEmail",
                e.hired_on::text AS "hiredOn",
                p.title AS "positionTitle",
                d.name AS "departmentName",
                b.name AS "branchName",
                c.tin, c.sss_no AS "sssNo", c.philhealth_no AS "philhealthNo", c.pagibig_no AS "pagibigNo",
                COALESCE(c.is_minimum_wage, false) AS "isMinimumWage"
           FROM employee e
           LEFT JOIN employment em ON em.employee_id = e.id AND em.effective_to IS NULL
           LEFT JOIN position p ON p.id = em.position_id
           LEFT JOIN department d ON d.id = em.department_id
           LEFT JOIN employee_compensation c ON c.employee_id = e.id
           LEFT JOIN branch b ON b.id = c.branch_id
          WHERE e.id = $1 AND e.org_id = app.current_org_id()`,
        [employeeId],
      );
      if (!empRes.rows[0]) {
        throw new NotFoundException('Employee not found');
      }

      const orgRes = await client.query(
        `SELECT o.name AS "orgName",
                COALESCE(hs.company_registered_name, o.name) AS "registeredName",
                COALESCE(hs.tin, '000-000-000-000') AS "employerTin",
                COALESCE(hs.rdo_code, '044') AS "rdoCode",
                COALESCE(hs.official_business_address, 'Metro Manila, Philippines') AS "employerAddress"
           FROM organization o
           LEFT JOIN hr_settings hs ON hs.org_id = o.id
          WHERE o.id = app.current_org_id()`,
      );

      const aggRes = await client.query(
        `SELECT
           COALESCE(SUM(li.basic_pay), 0)::numeric(14,2) AS "totalBasicPay",
           COALESCE(SUM(li.overtime_pay + li.night_diff_pay + li.holiday_pay), 0)::numeric(14,2) AS "totalOtHolidayNd",
           COALESCE(SUM(li.taxable_allowances), 0)::numeric(14,2) AS "totalTaxableAllowances",
           COALESCE(SUM(li.de_minimis_allowances), 0)::numeric(14,2) AS "totalDeMinimis",
           COALESCE(SUM(li.gross_pay), 0)::numeric(14,2) AS "totalGrossCompensation",
           COALESCE(SUM(li.sss_ee + li.sss_wisp_ee + li.philhealth_ee + li.pagibig_ee), 0)::numeric(14,2) AS "totalStatutoryEe",
           COALESCE(SUM(li.taxable_income), 0)::numeric(14,2) AS "totalTaxableIncome",
           COALESCE(SUM(li.withholding_tax), 0)::numeric(14,2) AS "totalTaxWithheld",
           COALESCE(SUM(li.thirteenth_month_accrual), 0)::numeric(14,2) AS "total13thMonth",
           COUNT(li.id)::int AS "payPeriodsCount"
         FROM payroll_line_item li
         JOIN payroll_run pr ON pr.id = li.payroll_run_id
        WHERE li.employee_id = $1
          AND li.org_id = app.current_org_id()
          AND EXTRACT(YEAR FROM pr.period_end) = $2
          AND pr.status IN ('approved', 'disbursed', 'computed')`,
        [employeeId, year],
      );

      const agg = aggRes.rows[0] || {};
      const thirteenthMonth = Number(agg.total13thMonth || 0);
      const exempt13thCap = 90000;
      const nonTaxable13th = Math.min(thirteenthMonth, exempt13thCap);
      const taxable13thExcess = Math.max(0, thirteenthMonth - exempt13thCap);

      const totalNonTaxable =
        Number(agg.totalDeMinimis || 0) +
        Number(agg.totalStatutoryEe || 0) +
        nonTaxable13th;

      return {
        year,
        employer: orgRes.rows[0] || {},
        employee: empRes.rows[0],
        summary: {
          payPeriodsCount: Number(agg.payPeriodsCount || 0),
          grossCompensationIncome: Number(agg.totalGrossCompensation || 0) + thirteenthMonth,
          nonTaxable: {
            thirteenthMonthExempt: Number(nonTaxable13th.toFixed(2)),
            deMinimisBenefits: Number(agg.totalDeMinimis || 0),
            mandatoryStatutoryEe: Number(agg.totalStatutoryEe || 0),
            totalNonTaxable: Number(totalNonTaxable.toFixed(2)),
          },
          taxable: {
            basicAndOt: Number(agg.totalBasicPay || 0) + Number(agg.totalOtHolidayNd || 0),
            taxableAllowances: Number(agg.totalTaxableAllowances || 0),
            excess13thMonth: Number(taxable13thExcess.toFixed(2)),
            netTaxableCompensation: Number(agg.totalTaxableIncome || 0),
          },
          totalTaxWithheld: Number(agg.totalTaxWithheld || 0),
        },
      };
    });
  }

  /**
   * BIR Form 1601-C Monthly Remittance Return Summary
   */
  async getBir1601cSummary(ctx: RequestContext, year: number, month: number) {
    return this.db.withContext(ctx, async (client) => {
      await this.requirePayrollRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);

      const orgRes = await client.query(
        `SELECT COALESCE(hs.company_registered_name, o.name) AS "registeredName",
                COALESCE(hs.tin, '000-000-000-000') AS "employerTin",
                COALESCE(hs.rdo_code, '044') AS "rdoCode"
           FROM organization o
           LEFT JOIN hr_settings hs ON hs.org_id = o.id
          WHERE o.id = app.current_org_id()`,
      );

      const res = await client.query(
        `SELECT
           COUNT(DISTINCT li.employee_id)::int AS "employeeCount",
           COUNT(DISTINCT pr.id)::int AS "runCount",
           COALESCE(SUM(li.gross_pay), 0)::numeric(14,2) AS "totalCompensationPaid",
           COALESCE(SUM(CASE WHEN COALESCE(c.is_minimum_wage, false) THEN li.gross_pay ELSE 0 END), 0)::numeric(14,2) AS "statutoryMweExempt",
           COALESCE(SUM(li.de_minimis_allowances), 0)::numeric(14,2) AS "nonTaxableDeMinimis",
           COALESCE(SUM(li.sss_ee + li.sss_wisp_ee + li.philhealth_ee + li.pagibig_ee), 0)::numeric(14,2) AS "mandatoryEeContributions",
           COALESCE(SUM(li.taxable_income), 0)::numeric(14,2) AS "totalTaxableCompensation",
           COALESCE(SUM(li.withholding_tax), 0)::numeric(14,2) AS "totalTaxWithheld"
         FROM payroll_line_item li
         JOIN payroll_run pr ON pr.id = li.payroll_run_id
         LEFT JOIN employee_compensation c ON c.employee_id = li.employee_id
        WHERE li.org_id = app.current_org_id()
          AND EXTRACT(YEAR FROM pr.period_end) = $1
          AND EXTRACT(MONTH FROM pr.period_end) = $2
          AND pr.status IN ('approved', 'disbursed', 'computed')`,
        [year, month],
      );

      return {
        year,
        month,
        employer: orgRes.rows[0] || {},
        lines: res.rows[0] || {},
      };
    });
  }

  /**
   * PD 851: 13th Month Pay Preview (YTD Basic Pay / 12, or pro-rata salary estimate)
   */
  async previewThirteenthMonth(ctx: RequestContext, year: number, branchId?: string) {
    return this.db.withContext(ctx, async (client) => {
      await this.requirePayrollRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const params: any[] = [year];
      let branchFilter = '';
      if (branchId) {
        params.push(branchId);
        branchFilter = `AND c.branch_id = $2`;
      }

      const res = await client.query(
        `SELECT e.id AS "employeeId",
                e.employee_no AS "employeeNo",
                e.first_name || ' ' || e.last_name AS "employeeName",
                e.hired_on::text AS "hireDate",
                b.name AS "branchName",
                c.branch_id AS "branchId",
                COALESCE(c.monthly_rate, 0)::numeric(12,2) AS "monthlyRate",
                COALESCE(c.is_minimum_wage, false) AS "isMinimumWage",
                c.bank_name AS "bankName",
                c.bank_account_no AS "bankAccountNo",
                COALESCE((
                  SELECT SUM(li.basic_pay)
                    FROM payroll_line_item li
                    JOIN payroll_run pr ON pr.id = li.payroll_run_id
                   WHERE li.employee_id = e.id
                     AND EXTRACT(YEAR FROM pr.period_end) = $1
                     AND pr.run_type <> 'thirteenth_month'
                     AND pr.status IN ('computed', 'approved', 'disbursed')
                ), 0)::numeric(14,2) AS "ytdBasicPay"
           FROM employee e
           JOIN employee_compensation c ON c.employee_id = e.id
           LEFT JOIN branch b ON b.id = c.branch_id
          WHERE e.org_id = app.current_org_id()
            AND e.status <> 'separated'
            ${branchFilter}
          ORDER BY e.last_name ASC, e.first_name ASC`,
        params,
      );

      const now = new Date();
      const monthsElapsed = now.getFullYear() === year ? now.getMonth() + 1 : 12;

      return res.rows.map((r) => {
        const ytdBasic = Number(r.ytdBasicPay);
        const monthlyRate = Number(r.monthlyRate);
        const fromActualRuns = ytdBasic > 0;
        const thirteenthMonthPay = fromActualRuns
          ? Math.round((ytdBasic / 12) * 100) / 100
          : Math.round(((monthlyRate * monthsElapsed) / 12) * 100) / 100;
        const nonTaxablePart = Math.min(thirteenthMonthPay, 90000);
        const taxableExcess = Math.max(0, Math.round((thirteenthMonthPay - 90000) * 100) / 100);
        return {
          ...r,
          ytdBasicPay: ytdBasic,
          monthlyRate,
          source: fromActualRuns ? 'actual_runs' : 'salary_estimate',
          thirteenthMonthPay,
          nonTaxablePart,
          taxableExcess,
        };
      });
    });
  }

  /**
   * Generate 13th Month Payroll Run (PD 851)
   */
  async computeThirteenthMonthRun(
    ctx: RequestContext,
    dto: { year: number; payoutDate?: string; branchId?: string },
  ) {
    const year = dto.year || new Date().getFullYear();
    const preview = await this.previewThirteenthMonth(ctx, year, dto.branchId);
    const eligible = preview.filter((p) => p.thirteenthMonthPay > 0);
    if (eligible.length === 0) {
      throw new BadRequestException('No eligible employees with 13th month pay > 0 found.');
    }

    return this.db.withContext(ctx, async (client) => {
      await this.requirePayrollRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const code = `13TH-${year}-${Date.now().toString().slice(-4)}`;
      const title = `${year} 13th Month Pay (PD 851)`;
      const payoutDate = dto.payoutDate || `${year}-12-15`;

      let totalGross = 0;
      let totalTaxable = 0;
      let totalTax = 0;
      let totalNet = 0;

      const items = eligible.map((emp) => {
        const gross = emp.thirteenthMonthPay;
        const taxable = emp.isMinimumWage ? 0 : emp.taxableExcess;
        const tax = taxable > 0 ? Math.round(taxable * 0.15 * 100) / 100 : 0;
        const net = Math.round((gross - tax) * 100) / 100;
        totalGross += gross;
        totalTaxable += taxable;
        totalTax += tax;
        totalNet += net;
        return { ...emp, gross, taxable, tax, net };
      });

      const runRes = await client.query(
        `INSERT INTO payroll_run (
           org_id, branch_id, code, title, period_start, period_end, payout_date,
           run_type, status, total_gross, total_taxable, total_withholding_tax,
           total_sss_ee, total_sss_er, total_philhealth_ee, total_philhealth_er,
           total_pagibig_ee, total_pagibig_er, total_net_pay, employee_count,
           computed_by
         ) VALUES (
           app.current_org_id(), $1, $2, $3, $4, $5, $6,
           'thirteenth_month', 'computed', $7, $8, $9,
           0, 0, 0, 0, 0, 0, $10, $11, $12
         )
         RETURNING *`,
        [
          dto.branchId || null,
          code,
          title,
          `${year}-01-01`,
          `${year}-12-31`,
          payoutDate,
          Math.round(totalGross * 100) / 100,
          Math.round(totalTaxable * 100) / 100,
          Math.round(totalTax * 100) / 100,
          Math.round(totalNet * 100) / 100,
          items.length,
          ctx.employeeId,
        ],
      );

      const run = runRes.rows[0];
      for (const item of items) {
        await client.query(
          `INSERT INTO payroll_line_item (
             payroll_run_id, org_id, employee_id, branch_id,
             basic_pay, gross_pay, taxable_income, withholding_tax,
             total_deductions, net_pay, thirteenth_month_accrual,
             bank_name, bank_account_no
           ) VALUES (
             $1, app.current_org_id(), $2, $3,
             $4, $4, $5, $6, $6, $7, $4, $8, $9
           )`,
          [
            run.id,
            item.employeeId,
            item.branchId || null,
            item.gross,
            item.taxable,
            item.tax,
            item.net,
            item.bankName || null,
            item.bankAccountNo || null,
          ],
        );
      }
      return run;
    });
  }

  /**
   * Annualized Year-End TRAIN Law Tax Reconciliation (BIR Form 1604-C / Alphalist)
   */
  async getYearEndTaxReconciliation(ctx: RequestContext, year: number) {
    return this.db.withContext(ctx, async (client) => {
      await this.requirePayrollRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);

      const res = await client.query(
        `SELECT e.id AS "employeeId",
                e.employee_no AS "employeeNo",
                e.first_name || ' ' || e.last_name AS "employeeName",
                c.tin,
                COALESCE(c.is_minimum_wage, false) AS "isMinimumWage",
                COALESCE(SUM(CASE WHEN pr.run_type <> 'thirteenth_month' THEN li.gross_pay ELSE 0 END), 0)::numeric(14,2) AS "ytdRegularGross",
                COALESCE(SUM(CASE WHEN pr.run_type = 'thirteenth_month' THEN li.gross_pay ELSE 0 END), 0)::numeric(14,2) AS "ytdThirteenthMonth",
                COALESCE(SUM(li.de_minimis_allowances), 0)::numeric(14,2) AS "ytdDeMinimis",
                COALESCE(SUM(li.sss_ee + li.sss_wisp_ee + li.philhealth_ee + li.pagibig_ee), 0)::numeric(14,2) AS "ytdEeContributions",
                COALESCE(SUM(li.withholding_tax), 0)::numeric(14,2) AS "ytdTaxWithheld"
           FROM employee e
           LEFT JOIN employee_compensation c ON c.employee_id = e.id
           LEFT JOIN payroll_line_item li ON li.employee_id = e.id
           LEFT JOIN payroll_run pr ON pr.id = li.payroll_run_id
                AND EXTRACT(YEAR FROM pr.period_end) = $1
                AND pr.status IN ('computed', 'approved', 'disbursed')
          WHERE e.org_id = app.current_org_id()
            AND e.status <> 'separated'
          GROUP BY e.id, e.employee_no, e.first_name, e.last_name, c.tin, c.is_minimum_wage
          ORDER BY e.last_name ASC, e.first_name ASC`,
        [year],
      );

      const computeAnnualTrainTax = (taxable: number) => {
        if (taxable <= 250000) return 0;
        if (taxable <= 400000) return (taxable - 250000) * 0.15;
        if (taxable <= 800000) return 22500 + (taxable - 400000) * 0.2;
        if (taxable <= 2000000) return 102500 + (taxable - 800000) * 0.25;
        if (taxable <= 8000000) return 402500 + (taxable - 2000000) * 0.3;
        return 2202500 + (taxable - 8000000) * 0.35;
      };

      let totalTaxDue = 0;
      let totalTaxWithheld = 0;
      let totalRefund = 0;
      let totalStillDue = 0;

      const employees = res.rows.map((r) => {
        const ytdRegularGross = Number(r.ytdRegularGross);
        const ytdThirteenthMonth = Number(r.ytdThirteenthMonth);
        const ytdDeMinimis = Number(r.ytdDeMinimis);
        const ytdEeContributions = Number(r.ytdEeContributions);
        const ytdTaxWithheld = Number(r.ytdTaxWithheld);
        const nonTaxable13th = Math.min(ytdThirteenthMonth, 90000);
        const totalGross = Math.round((ytdRegularGross + ytdThirteenthMonth) * 100) / 100;
        const annualTaxableIncome = r.isMinimumWage
          ? 0
          : Math.max(
              0,
              Math.round((totalGross - ytdDeMinimis - ytdEeContributions - nonTaxable13th) * 100) / 100,
            );
        const annualTaxDue = r.isMinimumWage
          ? 0
          : Math.round(computeAnnualTrainTax(annualTaxableIncome) * 100) / 100;
        const variance = Math.round((annualTaxDue - ytdTaxWithheld) * 100) / 100;

        totalTaxDue += annualTaxDue;
        totalTaxWithheld += ytdTaxWithheld;
        if (variance < 0) totalRefund += Math.abs(variance);
        if (variance > 0) totalStillDue += variance;

        return {
          ...r,
          ytdRegularGross,
          ytdThirteenthMonth,
          ytdDeMinimis,
          ytdEeContributions,
          ytdTaxWithheld,
          nonTaxable13th,
          totalGross,
          annualTaxableIncome,
          annualTaxDue,
          variance,
        };
      });

      return {
        year,
        summary: {
          totalEmployees: employees.length,
          totalTaxDue: Math.round(totalTaxDue * 100) / 100,
          totalTaxWithheld: Math.round(totalTaxWithheld * 100) / 100,
          totalRefund: Math.round(totalRefund * 100) / 100,
          totalStillDue: Math.round(totalStillDue * 100) / 100,
        },
        employees,
      };
    });
  }

  async exportBir1604cCsv(ctx: RequestContext, year: number) {
    const data = await this.getYearEndTaxReconciliation(ctx, year);
    const header = [
      'Employee No',
      'Employee Name',
      'TIN',
      'MWE',
      'Total Gross Compensation',
      'Non-Taxable 13th Month',
      'Non-Taxable De Minimis',
      'Mandatory EE Contributions',
      'Net Taxable Compensation',
      'Annual Tax Due (TRAIN)',
      'Total Tax Withheld',
      'Year-End Adjustment (+Due / -Refund)',
    ];
    const rows = data.employees.map((e) => [
      e.employeeNo,
      `"${String(e.employeeName).replace(/"/g, '""')}"`,
      e.tin || 'N/A',
      e.isMinimumWage ? 'YES' : 'NO',
      e.totalGross.toFixed(2),
      e.nonTaxable13th.toFixed(2),
      e.ytdDeMinimis.toFixed(2),
      e.ytdEeContributions.toFixed(2),
      e.annualTaxableIncome.toFixed(2),
      e.annualTaxDue.toFixed(2),
      e.ytdTaxWithheld.toFixed(2),
      e.variance.toFixed(2),
    ]);
    return {
      filename: `BIR_1604C_Alphalist_${year}.csv`,
      csv: [header.join(','), ...rows.map((r) => r.join(','))].join('\n'),
    };
  }
}
