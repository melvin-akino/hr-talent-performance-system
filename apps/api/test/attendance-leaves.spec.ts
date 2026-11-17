import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startHarness, type Harness } from './support/http-harness';
import { hashPassword } from '../src/common/crypto';
import {
  calculatePhilippineAttendancePay,
  PH_RATES,
} from '../src/attendance/calculators/ph-overtime.calculator';

describe('Philippine Time & Attendance, Statutory Leaves, and Payroll Interconnection', () => {
  // -------------------------------------------------------------------------
  // 1. STATUTORY ATTENDANCE & OVERTIME CALCULATOR UNIT TESTS
  // -------------------------------------------------------------------------
  describe('Philippine Labor Code Overtime & Differential Calculator', () => {
    const hourlyRate = 100.0; // ₱100/hr base

    it('calculates regular overtime (+25% premium)', () => {
      // 4 hours regular OT @ ₱100/hr * 1.25 = ₱500.00
      const res = calculatePhilippineAttendancePay({
        hourlyRate,
        regularOtHours: 4,
      });
      expect(res.regularOtPay).toBe(500.0);
      expect(res.totalOvertimeAndPremiumPay).toBe(500.0);
    });

    it('calculates rest day overtime (169% premium)', () => {
      // 2 hours rest day OT @ ₱100/hr * 1.69 = ₱338.00
      const res = calculatePhilippineAttendancePay({
        hourlyRate,
        restDayOtHours: 2,
      });
      expect(res.restDayOtPay).toBe(338.0);
    });

    it('calculates regular holiday overtime (260% premium)', () => {
      // 3 hours regular holiday OT @ ₱100/hr * 2.60 = ₱780.00
      const res = calculatePhilippineAttendancePay({
        hourlyRate,
        regularHolidayOtHours: 3,
      });
      expect(res.regularHolidayOtPay).toBe(780.0);
    });

    it('calculates night shift differential (10% additional)', () => {
      // 6 hours night shift differential @ ₱100/hr * 0.10 = ₱60.00
      const res = calculatePhilippineAttendancePay({
        hourlyRate,
        nightDiffHours: 6,
      });
      expect(res.nightDiffPay).toBe(60.0);
    });

    it('calculates tardiness and undertime deductions per minute', () => {
      // Rate = ₱100/hr -> ₱1.6667 / min. 30 mins tardy + 15 mins undertime = 45 mins -> ₱75.00
      const res = calculatePhilippineAttendancePay({
        hourlyRate,
        tardinessMinutes: 30,
        undertimeMinutes: 15,
      });
      expect(res.tardinessDeduction).toBeCloseTo(50.0, 1);
      expect(res.undertimeDeduction).toBeCloseTo(25.0, 1);
      expect(res.totalAttendanceDeductions).toBeCloseTo(75.0, 1);
    });

    it('computes combined net attendance impact', () => {
      // 2 hrs OT (₱250) + 4 hrs NSD (₱40) - 15 mins tardy (₱25) = ₱265 net impact
      const res = calculatePhilippineAttendancePay({
        hourlyRate,
        regularOtHours: 2,
        nightDiffHours: 4,
        tardinessMinutes: 15,
      });
      expect(res.totalOvertimeAndPremiumPay).toBe(290.0);
      expect(res.totalAttendanceDeductions).toBe(25.0);
      expect(res.netAttendanceImpact).toBe(265.0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. END-TO-END INTERCONNECTION & FEATURE GATING INTEGRATION TESTS
  // -------------------------------------------------------------------------
  describe('Attendance, Leaves, and Interconnected Payroll Flow', () => {
    let h: Harness;
    let superadminToken: string;
    let orgId: string;
    let tenantAdminToken: string;
    let employeeId: string;
    let shiftId: string;
    let leaveTypeId: string;
    let leaveRequestId: string;

    const superEmail = `super-phase3-${randomUUID().slice(0, 8)}@summitlogic.io`;
    const superPass = 'SuperPassPhase3!';
    const orgCode = `ATT${Math.floor(100 + Math.random() * 900)}`;
    const adminEmail = `attadmin-${randomUUID().slice(0, 6)}@enterprise.ph`;
    const adminPass = 'AttAdminPass123!';

    beforeAll(async () => {
      h = await startHarness();

      // Seed superadmin
      await h.admin.query(
        `INSERT INTO app.platform_superadmin (email, password_hash, full_name, is_active)
         VALUES ($1, $2, 'Super Admin Phase 3', TRUE)`,
        [superEmail.toLowerCase(), hashPassword(superPass)],
      );

      // Superadmin login
      const loginRes = await request(h.url)
        .post('/superadmin/auth/login')
        .send({ email: superEmail, password: superPass });
      superadminToken = loginRes.body.token;

      // Onboard tenant with features disabled initially
      const tenantRes = await request(h.url)
        .post('/superadmin/tenants')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({
          companyName: 'BGC Operations Holding Inc',
          code: orgCode,
          adminEmail,
          adminPassword: adminPass,
          adminFirstName: 'Maria',
          adminLastName: 'Santos',
          planTier: 'enterprise',
          maxEmployees: 50,
          features: {
            feature_core_hr: true,
            feature_ph_payroll: false,
            feature_time_attendance: false, // Initially disabled
            feature_leave_management: false, // Initially disabled
          },
        });
      orgId = tenantRes.body.tenant.id;

      // Login as tenant admin
      const authRes = await request(h.url)
        .post('/auth/login')
        .send({ email: adminEmail, password: adminPass });
      tenantAdminToken = authRes.body.token;
      employeeId = authRes.body.employee.id;
    }, 120_000);

    afterAll(async () => {
      await h?.stop();
    });

    it('blocks Attendance endpoints when feature_time_attendance is inactive', async () => {
      const res = await request(h.url)
        .get('/attendance/shifts')
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('feature_time_attendance');
    });

    it('blocks Leave endpoints when feature_leave_management is inactive', async () => {
      const res = await request(h.url)
        .get('/leaves/types')
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('feature_leave_management');
    });

    it('enables Attendance and Leave modules via Superadmin license control', async () => {
      const patchRes = await request(h.url)
        .patch(`/superadmin/tenants/${orgId}/features`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({
          features: {
            feature_ph_payroll: true,
            feature_time_attendance: true,
            feature_leave_management: true,
          },
        });
      expect(patchRes.status).toBe(200);

      // Verify attendance shifts accessible
      const shiftRes = await request(h.url)
        .get('/attendance/shifts')
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(shiftRes.status).toBe(200);

      // Verify leaves accessible
      const leaveRes = await request(h.url)
        .get('/leaves/types')
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(leaveRes.status).toBe(200);
    });

    it('creates shifts and records web clock in / clock out', async () => {
      // 1. Create standard shift
      const shiftRes = await request(h.url)
        .post('/attendance/shifts')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          code: 'REG-8AM',
          name: 'Regular Day Shift (8:00 AM - 5:00 PM)',
          startTime: '08:00:00',
          endTime: '17:00:00',
          breakMinutes: 60,
          gracePeriodMins: 15,
        });
      expect(shiftRes.status).toBe(201);
      shiftId = shiftRes.body.id;

      // 2. Web Clock In
      const clockInRes = await request(h.url)
        .post('/attendance/clock')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ workDate: '2026-10-05', notes: 'Web clock in Makati' });
      expect(clockInRes.status).toBe(201);
      expect(clockInRes.body.action).toBe('clock_in');

      // 3. Web Clock Out
      const clockOutRes = await request(h.url)
        .post('/attendance/clock')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ workDate: '2026-10-05', notes: 'Web clock out' });
      expect(clockOutRes.status).toBe(201);
      expect(clockOutRes.body.action).toBe('clock_out');
    });

    it('creates Philippine statutory leaves and processes an application', async () => {
      // 1. Seed statutory leave types (SIL, Solo Parent, VAWC, etc.)
      const seedRes = await request(h.url)
        .post('/leaves/types/seed-statutory')
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(seedRes.status).toBe(201);
      expect(seedRes.body.length).toBeGreaterThanOrEqual(5);

      const sil = seedRes.body.find((t: any) => t.code === 'SIL');
      expect(sil).toBeDefined();
      leaveTypeId = sil.id;

      // 2. Allocate 5 days SIL to employee
      const allocRes = await request(h.url)
        .post('/leaves/allocate')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          employeeId,
          leaveTypeId,
          year: 2026,
          allocatedDays: 5.0,
        });
      expect(allocRes.status).toBe(201);
      expect(Number(allocRes.body.allocated_days)).toBe(5.0);

      // 3. Apply for 1 day leave
      const appRes = await request(h.url)
        .post('/leaves/requests')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          leaveTypeId,
          startDate: '2026-10-06',
          endDate: '2026-10-06',
          totalDays: 1.0,
          reason: 'Personal errand in Manila',
        });
      expect(appRes.status).toBe(201);
      expect(appRes.body.status).toBe('pending');
      leaveRequestId = appRes.body.id;

      // 4. Approve leave request
      const approveRes = await request(h.url)
        .post(`/leaves/requests/${leaveRequestId}/approve`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(approveRes.status).toBe(201);
      expect(approveRes.body.status).toBe('approved');

      // 5. Verify remaining balance reduced
      const balRes = await request(h.url)
        .get(`/leaves/balances?employeeId=${employeeId}&year=2026`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(balRes.status).toBe(200);
      const updatedSil = balRes.body.find((b: any) => b.leave_type_id === leaveTypeId);
      expect(Number(updatedSil.used_days)).toBe(1.0);
      expect(Number(updatedSil.remaining_days)).toBe(4.0);

      // 6. Bug Fix Validation: Reject applying for the exact same date range
      const duplicateRes = await request(h.url)
        .post('/leaves/requests')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          leaveTypeId,
          startDate: '2026-10-06',
          endDate: '2026-10-06',
          totalDays: 1.0,
          reason: 'Duplicate attempt on same day',
        });
      expect(duplicateRes.status).toBe(400);
      expect(duplicateRes.body.message).toMatch(/overlapping leave/i);

      // 7. Bug Fix Validation: Reject overlapping date range (e.g. 2026-10-05 to 2026-10-07)
      const overlapRes = await request(h.url)
        .post('/leaves/requests')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          leaveTypeId,
          startDate: '2026-10-05',
          endDate: '2026-10-07',
          totalDays: 3.0,
          reason: 'Overlapping 3-day window',
        });
      expect(overlapRes.status).toBe(400);
      expect(overlapRes.body.message).toMatch(/overlapping leave/i);

      // 8. Reject invalid date ranges (start > end or totalDays <= 0)
      const invertedRes = await request(h.url)
        .post('/leaves/requests')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          leaveTypeId,
          startDate: '2026-10-20',
          endDate: '2026-10-18',
          totalDays: 1.0,
          reason: 'Inverted dates test',
        });
      expect(invertedRes.status).toBe(400);
      expect(invertedRes.body.message).toMatch(/cannot be after end date/i);

      // 9. Allow applying for distinct non-overlapping dates
      const validFutureRes = await request(h.url)
        .post('/leaves/requests')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          leaveTypeId,
          startDate: '2026-10-21',
          endDate: '2026-10-21',
          totalDays: 1.0,
          reason: 'Legitimate distinct leave',
        });
      expect(validFutureRes.status).toBe(201);
      const futureId = validFutureRes.body.id;

      // 10. Cancel pending leave and verify it frees up the date slot
      const cancelRes = await request(h.url)
        .post(`/leaves/requests/${futureId}/cancel`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      expect(cancelRes.status).toBe(201);
      expect(cancelRes.body.status).toBe('cancelled');

      // Now re-applying for 2026-10-21 should succeed because prior application is cancelled
      const reapplyRes = await request(h.url)
        .post('/leaves/requests')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          leaveTypeId,
          startDate: '2026-10-21',
          endDate: '2026-10-21',
          totalDays: 1.0,
          reason: 'Reapplication after cancellation',
        });
      expect(reapplyRes.status).toBe(201);
    });

    it('interconnects approved DTR overtime & night diff with batch payroll computation', async () => {
      // 1. Configure employee compensation (₱40,000 monthly)
      await request(h.url)
        .put(`/payroll/compensation/${employeeId}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          monthlyRate: 40000,
          payType: 'monthly',
          payFrequency: 'semi_monthly',
          bankName: 'BPI',
          bankAccountNo: '9988776655',
        });

      // 2. Insert verified DTR records in the cut-off period:
      // Oct 7: 4 hours Regular Overtime
      // Oct 8: 6 hours Night Shift Differential
      await request(h.url)
        .post('/attendance/records/manual')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          employeeId,
          workDate: '2026-10-07',
          shiftId,
          totalHoursWorked: 12.0,
          regularHours: 8.0,
          regularOtHours: 4.0,
          tardinessMinutes: 0,
        });

      await request(h.url)
        .post('/attendance/records/manual')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          employeeId,
          workDate: '2026-10-08',
          shiftId,
          totalHoursWorked: 8.0,
          regularHours: 8.0,
          nightDiffHours: 6.0,
        });

      // 3. Compute Quindena Payroll (Oct 1 - Oct 15, 2026)
      const payRes = await request(h.url)
        .post('/payroll/runs/compute')
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({
          code: `PAY-ATT-${Date.now()}`,
          title: 'October 2026 1st Quindena with DTR Integration',
          periodStart: '2026-10-01',
          periodEnd: '2026-10-15',
          payoutDate: '2026-10-15',
          runType: 'quindena_1',
        });

      expect(payRes.status).toBe(201);
      const runId = payRes.body.id;

      // 4. Fetch line item and verify automatic overtime and night diff inclusion
      const detailRes = await request(h.url)
        .get(`/payroll/runs/${runId}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(detailRes.status).toBe(200);
      const lineItem = detailRes.body.lineItems.find(
        (item: any) => item.employee_id === employeeId,
      );
      expect(lineItem).toBeDefined();

      // Basic quindena pay for ₱40,000 = ₱20,000
      expect(Number(lineItem.basic_pay)).toBe(20000.0);

      // Overtime Pay from approved 4 hrs OT:
      // Hourly rate for ₱40,000 = (40000 * 12) / 261 / 8 = ₱229.89/hr
      // 4 hrs OT * 1.25 * 229.89 = ₱1,149.43
      expect(Number(lineItem.overtime_pay)).toBeGreaterThan(0);

      // Night Diff Pay from approved 6 hrs NSD:
      // 6 hrs * 0.10 * 229.89 = ₱137.93
      expect(Number(lineItem.night_diff_pay)).toBeGreaterThan(0);

      // Gross pay should exceed basic pay due to OT + NSD
      expect(Number(lineItem.gross_pay)).toBeGreaterThan(20000.0);
      expect(Number(lineItem.net_pay)).toBeGreaterThan(0);
    });
  });
});
