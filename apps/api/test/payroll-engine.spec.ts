import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startHarness, type Harness } from './support/http-harness';
import { hashPassword } from '../src/common/crypto';
import {
  calculateSemiMonthlyWithholdingTax,
  calculateMonthlyWithholdingTax,
} from '../src/payroll/calculators/train-tax.calculator';
import {
  calculateSssContribution,
  apportionSssQuindena,
} from '../src/payroll/calculators/sss.calculator';
import {
  calculatePhilHealthContribution,
  apportionPhilHealthQuindena,
} from '../src/payroll/calculators/philhealth.calculator';
import {
  calculatePagIbigContribution,
  apportionPagIbigQuindena,
} from '../src/payroll/calculators/pagibig.calculator';
import {
  calculateCycleThirteenthMonthAccrual,
  calculateThirteenthMonthPayout,
} from '../src/payroll/calculators/thirteenth-month.calculator';

describe('Philippine Statutory Payroll Engine & Multi-Branch Architecture', () => {
  // -------------------------------------------------------------------------
  // 1. STATUTORY CALCULATOR UNIT TESTS
  // -------------------------------------------------------------------------
  describe('TRAIN Law Withholding Tax Calculator (RA 10963)', () => {
    it('exempts Minimum Wage Earners (MWE) regardless of income', () => {
      const res = calculateSemiMonthlyWithholdingTax(15000, true);
      expect(res.withholdingTax).toBe(0);
      expect(res.bracket).toBe(1);
    });

    it('exempts income below semi-monthly threshold of ₱10,416.67', () => {
      const res = calculateSemiMonthlyWithholdingTax(10000, false);
      expect(res.withholdingTax).toBe(0);
      expect(res.bracket).toBe(1);
    });

    it('calculates Bracket 2 (15% in excess of ₱10,416.67)', () => {
      // Income = ₱15,000. Excess = ₱4,583.33 -> 15% = ₱687.50
      const res = calculateSemiMonthlyWithholdingTax(15000, false);
      expect(res.bracket).toBe(2);
      expect(res.withholdingTax).toBeCloseTo(687.50, 1);
    });

    it('calculates Bracket 3 (₱937.50 + 20% in excess of ₱16,666.67)', () => {
      // Income = ₱25,000. Excess = ₱8,333.33 -> 20% = ₱1,666.67 + ₱937.50 = ₱2,604.17
      const res = calculateSemiMonthlyWithholdingTax(25000, false);
      expect(res.bracket).toBe(3);
      expect(res.withholdingTax).toBeCloseTo(2604.17, 1);
    });

    it('calculates Monthly Bracket 2 (15% in excess of ₱20,833.33)', () => {
      // Income = ₱30,000. Excess = ₱9,166.67 -> 15% = ₱1,375.00
      const res = calculateMonthlyWithholdingTax(30000, false);
      expect(res.bracket).toBe(2);
      expect(res.withholdingTax).toBeCloseTo(1375.00, 1);
    });
  });

  describe('SSS Contribution Calculator (RA 11199 & WISP)', () => {
    it('applies floor MSC of ₱4,000 for compensation under ₱4,250', () => {
      const sss = calculateSssContribution(3500);
      expect(sss.monthlySalaryCredit).toBe(4000);
      expect(sss.wispMonthlySalaryCredit).toBe(0);
      expect(sss.regularEe).toBe(180.00); // 4.5% of 4000
      expect(sss.regularEr).toBe(380.00); // 9.5% of 4000
      expect(sss.ecEr).toBe(10.00);
      expect(sss.totalEe).toBe(180.00);
    });

    it('computes regular MSC for salary of ₱15,000 with ₱30 EC', () => {
      const sss = calculateSssContribution(15000);
      expect(sss.monthlySalaryCredit).toBe(15000);
      expect(sss.wispMonthlySalaryCredit).toBe(0);
      expect(sss.regularEe).toBe(675.00); // 4.5% of 15000
      expect(sss.regularEr).toBe(1425.00); // 9.5% of 15000
      expect(sss.ecEr).toBe(30.00);
      expect(sss.totalEe).toBe(675.00);
    });

    it('computes WISP for compensation above ₱20,000 MSC', () => {
      // Salary = ₱30,000 -> Regular MSC = ₱20,000, WISP MSC = ₱10,000
      const sss = calculateSssContribution(30000);
      expect(sss.monthlySalaryCredit).toBe(20000);
      expect(sss.wispMonthlySalaryCredit).toBe(10000);
      expect(sss.regularEe).toBe(900.00); // 4.5% of 20000
      expect(sss.wispEe).toBe(450.00); // 4.5% of 10000
      expect(sss.totalEe).toBe(1350.00);
      expect(sss.totalEr).toBe(1900.00 + 950.00 + 30.00); // 2880
    });

    it('applies ceiling MSC of ₱35,000 for compensation ₱50,000', () => {
      const sss = calculateSssContribution(50000);
      expect(sss.monthlySalaryCredit).toBe(20000);
      expect(sss.wispMonthlySalaryCredit).toBe(15000);
      expect(sss.totalMonthlySalaryCredit).toBe(35000);
      expect(sss.totalEe).toBe(1575.00); // 4.5% of 35000
    });

    it('properly apportions SSS deductions across quindenas', () => {
      const sss = calculateSssContribution(30000);
      const split = apportionSssQuindena(sss, 'split');
      expect(split.ee).toBe(675.00); // 1350 / 2
    });
  });

  describe('PhilHealth Contribution Calculator (RA 11223)', () => {
    it('applies ₱10,000 floor (₱500 premium split ₱250 EE, ₱250 ER)', () => {
      const phic = calculatePhilHealthContribution(8000);
      expect(phic.coveredSalary).toBe(10000);
      expect(phic.totalPremium).toBe(500.00);
      expect(phic.eeShare).toBe(250.00);
      expect(phic.erShare).toBe(250.00);
    });

    it('calculates 5% split for standard salary ₱40,000', () => {
      const phic = calculatePhilHealthContribution(40000);
      expect(phic.coveredSalary).toBe(40000);
      expect(phic.totalPremium).toBe(2000.00);
      expect(phic.eeShare).toBe(1000.00);
      expect(phic.erShare).toBe(1000.00);
    });

    it('caps at ₱100,000 ceiling (₱5,000 total, ₱2,500 EE, ₱2,500 ER)', () => {
      const phic = calculatePhilHealthContribution(150000);
      expect(phic.coveredSalary).toBe(100000);
      expect(phic.totalPremium).toBe(5000.00);
      expect(phic.eeShare).toBe(2500.00);
      expect(phic.erShare).toBe(2500.00);
    });

    it('apportions PhilHealth 50/50 for semi-monthly payroll', () => {
      const phic = calculatePhilHealthContribution(40000);
      const semi = apportionPhilHealthQuindena(phic, 'split');
      expect(semi.ee).toBe(500.00);
      expect(semi.er).toBe(500.00);
    });
  });

  describe('Pag-IBIG / HDMF Contribution Calculator (Circular 460)', () => {
    it('calculates 2% EE and 2% ER capped at ₱10,000 fund salary (₱200 max mandatory)', () => {
      const hdmf = calculatePagIbigContribution(25000);
      expect(hdmf.fundSalary).toBe(10000);
      expect(hdmf.mandatoryEe).toBe(200.00);
      expect(hdmf.mandatoryEr).toBe(200.00);
      expect(hdmf.totalContribution).toBe(400.00);
    });

    it('supports voluntary MP2 additional deductions', () => {
      const hdmf = calculatePagIbigContribution(30000, 500);
      expect(hdmf.mandatoryEe).toBe(200.00);
      expect(hdmf.voluntaryEe).toBe(500.00);
      expect(hdmf.totalEe).toBe(700.00);
      expect(hdmf.totalEr).toBe(200.00);
    });

    it('apportions Pag-IBIG for semi-monthly payroll', () => {
      const hdmf = calculatePagIbigContribution(25000);
      const semi = apportionPagIbigQuindena(hdmf, 'split');
      expect(semi.ee).toBe(100.00);
      expect(semi.er).toBe(100.00);
    });
  });

  describe('Philippine 13th Month Pay Accrual (PD 851)', () => {
    it('accrues cycle basic earnings / 12', () => {
      const accrual = calculateCycleThirteenthMonthAccrual(20000);
      expect(accrual).toBeCloseTo(1666.67, 2);
    });

    it('exempts up to ₱90,000 statutory cap under TRAIN Law', () => {
      const payout = calculateThirteenthMonthPayout(600000, 0, 0); // ₱50,000/mo * 12 = ₱600k total
      expect(payout.accruedAmount).toBe(50000.00); // ₱600k / 12 = ₱50k
      expect(payout.taxExemptAmount).toBe(50000.00); // <= ₱90k
      expect(payout.taxableAmount).toBe(0.00);
    });

    it('taxes excess over ₱90,000 cap', () => {
      const payout = calculateThirteenthMonthPayout(1440000, 0, 0); // ₱120,000/mo * 12 = ₱1,440,000
      expect(payout.accruedAmount).toBe(120000.00);
      expect(payout.taxExemptAmount).toBe(90000.00);
      expect(payout.taxableAmount).toBe(30000.00);
    });
  });

  // -------------------------------------------------------------------------
  // 2. END-TO-END PAYROLL API INTEGRATION TESTS
  // -------------------------------------------------------------------------
  describe('End-to-End API Multi-Branch & Philippine Payroll Flow', () => {
    let h: Harness;
    let superadminToken: string;
    let orgId: string;
    let tenantAdminToken: string;
    let employeeId: string;
    let branchId: string;
    let payrollRunId: string;

    const superEmail = `super-${randomUUID().slice(0, 8)}@summitlogic.io`;
    const superPass = 'SuperPass999!';
    const orgCode = `PAY${Math.floor(100 + Math.random() * 900)}`;
    const adminEmail = `payadmin-${randomUUID().slice(0, 6)}@enterprise.ph`;
    const adminPass = 'PayAdminPass123!';

    beforeAll(async () => {
      h = await startHarness();

      // Seed superadmin
      await h.admin.query(
        `INSERT INTO app.platform_superadmin (email, password_hash, full_name, is_active)
         VALUES ($1, $2, 'Super Admin', TRUE)`,
        [superEmail.toLowerCase(), hashPassword(superPass)],
      );

      // Superadmin login
      const loginRes = await request(h.url)
        .post('/superadmin/auth/login')
        .send({ email: superEmail, password: superPass });
      superadminToken = loginRes.body.token;

      // Onboard tenant without payroll first
      const tenantRes = await request(h.url)
        .post('/superadmin/tenants')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({
          companyName: 'Ayala Tech Solutions Corp',
          code: orgCode,
          adminEmail,
          adminPassword: adminPass,
          adminFirstName: 'Juan',
          adminLastName: 'Dela Cruz',
          planTier: 'enterprise',
          maxEmployees: 100,
          features: {
            feature_core_hr: true,
            feature_ph_payroll: false, // Initially disabled!
          },
        });
      orgId = tenantRes.body.tenant.id;

      // Tenant Admin Login
      const authRes = await request(h.url)
        .post('/auth/login')
        .send({ email: adminEmail, password: adminPass });
      tenantAdminToken = authRes.body.token;
      employeeId = authRes.body.employee.id;
    }, 120_000);

    afterAll(async () => {
      await h?.stop();
    });

    it('blocks payroll endpoint with 403 Forbidden when feature_ph_payroll is not licensed', async () => {
      const res = await request(h.url)
        .get('/payroll/runs')
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('feature_ph_payroll');
    });

    it('allows access to payroll after superadmin enables feature_ph_payroll', async () => {
      // Enable feature via superadmin
      const patchRes = await request(h.url)
        .patch(`/superadmin/tenants/${orgId}/features`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({
          features: {
            feature_ph_payroll: true,
          },
        });
      expect(patchRes.status).toBe(200);

      // Verify tenant can now list runs
      const res = await request(h.url)
        .get('/payroll/runs')
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('creates branches for multi-corporate organizational structure', async () => {
      const res = await request(h.url)
        .post('/payroll/branches')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          code: 'MNL-HQ',
          name: 'Makati Headquarters',
          region: 'NCR',
          address: 'Ayala Triangle Gardens, Makati City',
          birRdoCode: '047',
          sssBranchCode: 'SSS-MAKATI',
          philhealthEmployerNo: 'PHIC-00998877',
          pagibigEmployerNo: 'HDMF-11223344',
          isHeadOffice: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe('MNL-HQ');
      expect(res.body.isHeadOffice).toBe(true);
      branchId = res.body.id;

      // Verify list branches
      const listRes = await request(h.url)
        .get('/payroll/branches')
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThanOrEqual(1);
    });

    it('configures employee compensation and statutory profile', async () => {
      const res = await request(h.url)
        .put(`/payroll/compensation/${employeeId}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          branchId,
          monthlyRate: 50000,
          payType: 'monthly',
          payFrequency: 'semi_monthly',
          isMinimumWage: false,
          tin: '123-456-789-000',
          sssNo: '04-1234567-8',
          philhealthNo: '12-345678901-2',
          pagibigNo: '1234-5678-9012',
          bankName: 'BPI',
          bankAccountNo: '0011223344',
          bankAccountName: 'Juan Dela Cruz',
          riceSubsidy: 2000, // De minimis
          clothingAllowance: 500, // De minimis
          laundryAllowance: 300, // De minimis
          medicalAllowance: 800, // De minimis
          taxableAllowance: 1000,
        });

      expect(res.status).toBe(200);
      expect(Number(res.body.monthly_rate)).toBe(50000);
      expect(res.body.bank_name).toBe('BPI');

      // Verify getCompensation
      const getRes = await request(h.url)
        .get(`/payroll/compensation/${employeeId}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.tin).toBe('123-456-789-000');
    });

    it('computes batch quindena payroll run with Philippine statutory deductions', async () => {
      const res = await request(h.url)
        .post('/payroll/runs/compute')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          code: `PAY-${Date.now()}`,
          title: 'October 2026 1st Quindena Payroll',
          periodStart: '2026-10-01',
          periodEnd: '2026-10-15',
          payoutDate: '2026-10-15',
          runType: 'quindena_1',
          branchId,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('computed');
      expect(res.body.employee_count).toBeGreaterThanOrEqual(1);
      expect(Number(res.body.total_gross)).toBeGreaterThan(0);
      expect(Number(res.body.total_net_pay)).toBeGreaterThan(0);
      payrollRunId = res.body.id;

      // Verify getPayrollRun line items
      const detailRes = await request(h.url)
        .get(`/payroll/runs/${payrollRunId}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.lineItems.length).toBeGreaterThanOrEqual(1);

      const item = detailRes.body.lineItems.find((li: any) => li.employee_id === employeeId);
      expect(item).toBeDefined();
      expect(Number(item.basic_pay)).toBe(25000.00); // ₱50,000 / 2
      expect(Number(item.de_minimis_allowances)).toBe(1800.00); // (2000+500+300+800)/2 = 1800
      expect(Number(item.gross_pay)).toBe(27300.00); // 25000 + 1800 + 500 taxable
      expect(Number(item.sss_ee)).toBeGreaterThan(0);
      expect(Number(item.philhealth_ee)).toBeGreaterThan(0);
      expect(Number(item.pagibig_ee)).toBeGreaterThan(0);
      expect(Number(item.withholding_tax)).toBeGreaterThan(0);
      expect(Number(item.net_pay)).toBeGreaterThan(0);
      expect(Number(item.thirteenth_month_accrual)).toBeCloseTo(2083.33, 1); // 25000 / 12
    });

    it('approves computed payroll run', async () => {
      const res = await request(h.url)
        .post(`/payroll/runs/${payrollRunId}/approve`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('approved');
      expect(res.body.approved_by).toBe(employeeId);
    });

    it('disburses approved payroll run and marks line items as paid', async () => {
      const res = await request(h.url)
        .post(`/payroll/runs/${payrollRunId}/disburse`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('disbursed');

      const detailRes = await request(h.url)
        .get(`/payroll/runs/${payrollRunId}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(detailRes.body.lineItems[0].disbursement_status).toBe('paid');
    });

    it('generates bank disbursement batch file (BPI BizLink)', async () => {
      const res = await request(h.url)
        .get(`/payroll/runs/${payrollRunId}/disbursement/bpi`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('Disbursement_BPI');
      expect(res.text).toContain('Employee ID,Account Number,Amount,Account Name');
      expect(res.text).toContain('0011223344');
    });

    it('generates official Philippine statutory agency reports (SSS, PhilHealth, Pag-IBIG, BIR)', async () => {
      // SSS R-3
      const sssRes = await request(h.url)
        .get(`/payroll/runs/${payrollRunId}/statutory/sss`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(sssRes.status).toBe(200);
      expect(sssRes.text).toContain('SSS Number,Employee Name,Monthly Salary');
      expect(sssRes.text).toContain('04-1234567-8');

      // PhilHealth EPRS
      const phicRes = await request(h.url)
        .get(`/payroll/runs/${payrollRunId}/statutory/philhealth`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(phicRes.status).toBe(200);
      expect(phicRes.text).toContain('PhilHealth PIN,Employee Name,Monthly Basic');
      expect(phicRes.text).toContain('12-345678901-2');

      // Pag-IBIG MCRF
      const hdmfRes = await request(h.url)
        .get(`/payroll/runs/${payrollRunId}/statutory/pagibig`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(hdmfRes.status).toBe(200);
      expect(hdmfRes.text).toContain('Pag-IBIG MID,Employee Name,Monthly Comp');
      expect(hdmfRes.text).toContain('1234-5678-9012');

      // BIR 1601-C
      const birRes = await request(h.url)
        .get(`/payroll/runs/${payrollRunId}/statutory/bir`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(birRes.status).toBe(200);
      expect(birRes.text).toContain('TIN,Employee Name,Gross Pay,Non-Taxable,Taxable Income,Tax Withheld');
      expect(birRes.text).toContain('123-456-789-000');
    });

    it('allows employee to view historical payslips and detailed breakdown via ESS', async () => {
      // 1. My Payslips List
      const payslipsRes = await request(h.url)
        .get('/payroll/my-payslips')
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(payslipsRes.status).toBe(200);
      expect(Array.isArray(payslipsRes.body)).toBe(true);
      expect(payslipsRes.body.length).toBeGreaterThanOrEqual(1);

      const firstSlip = payslipsRes.body[0];
      expect(firstSlip.runCode).toMatch(/^PAY-/);
      expect(Number(firstSlip.netPay)).toBeGreaterThan(0);

      // 2. Specific Payslip Detail
      const detailRes = await request(h.url)
        .get(`/payroll/my-payslips/${firstSlip.id}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.companyName).toBeDefined();
      expect(detailRes.body.employeeNo).toBe('EMP-0001');
      expect(detailRes.body.tin).toBe('123-456-789-000');
      expect(Number(detailRes.body.basicPay)).toBe(25000);
      expect(Number(detailRes.body.grossPay)).toBe(27300);
      expect(Number(detailRes.body.withholdingTax)).toBeGreaterThan(0);
      expect(detailRes.body.ytd).toBeDefined();
      expect(Number(detailRes.body.ytd.ytdGross)).toBeGreaterThanOrEqual(27300);
    });

    it('computes annual BIR Form 2316 Certificate of Compensation Payment and Tax Withheld', async () => {
      const year = new Date().getFullYear();
      const bir2316Res = await request(h.url)
        .get(`/payroll/employees/${employeeId}/bir2316?year=${year}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(bir2316Res.status).toBe(200);
      expect(bir2316Res.body.year).toBe(year);
      expect(bir2316Res.body.employer.code).toBeDefined();
      expect(bir2316Res.body.employee.employeeNo).toBe('EMP-0001');
      expect(bir2316Res.body.employee.tin).toBe('123-456-789-000');

      // Gross Compensation
      expect(Number(bir2316Res.body.partIVA_GrossCompensation.basicSalary)).toBe(25000);
      expect(Number(bir2316Res.body.partIVA_GrossCompensation.totalGrossCompensation)).toBe(27300);

      // Non-taxable
      expect(Number(bir2316Res.body.partIVB_NonTaxableExempt.deMinimisBenefits)).toBe(1800);
      expect(Number(bir2316Res.body.partIVB_NonTaxableExempt.totalMandatoryStatutory)).toBeGreaterThan(0);

      // Tax computation
      expect(bir2316Res.body.partIVC_Summary.taxableCompensationIncome).toBeDefined();
      expect(Number(bir2316Res.body.partIVC_Summary.totalTaxWithheld)).toBeGreaterThan(0);
    });
  });
});
