/**
 * Navigation grouping tests:
 * 1. KPIs & Performance
 * 2. Time & Attendance
 * 3. Payroll & Payslips
 * 4. Core HR
 */
import { describe, expect, it } from 'vitest';
import { buildGroups } from '../src/components/Sidebar';
import { HOME_PATH } from '../src/routes';

const titles = (roles: string[], hasReports = false, features?: any) =>
  buildGroups(roles, hasReports, features).map((g) => g.title);

const labels = (roles: string[], hasReports = false, features?: any) =>
  buildGroups(roles, hasReports, features).flatMap((g) => g.items.map((i) => i.label));

describe('group visibility by role and features', () => {
  it('offers a plain employee personal KPI and Core HR items', () => {
    expect(titles(['employee'])).toEqual(['Goals & KPIs', 'Core HR']);
  });

  it('includes Time & Attendance and Payroll when licensed', () => {
    const features = {
      feature_core_hr: true,
      feature_performance: true,
      feature_kpis: true,
      feature_peer_reviews: true,
      feature_competencies_pip: true,
      feature_leave_management: true,
      feature_time_attendance: true,
      feature_ph_payroll: true,
      feature_bank_disbursement: true,
      feature_bir_statutory_gen: true,
    };
    expect(titles(['employee'], false, features)).toEqual([
      'Goals & KPIs',
      'Time & Attendance',
      'Payroll & Payslips',
      'Core HR',
    ]);
  });

  it('shows manager sub-features under Core HR and Goals & KPIs', () => {
    const managerLabels = labels(['employee', 'manager']);
    expect(managerLabels).toContain('Team Hierarchy');
    expect(managerLabels).toContain('Workforce Monitoring');
    expect(managerLabels).toContain('Evaluations');
    expect(managerLabels).toContain('Improvement Plans (PIPs)');
  });

  it('shows HR administrative sub-features to HR Admin', () => {
    const hrLabels = labels(['employee', 'hr_admin']);
    expect(hrLabels).toContain('HR Console & Directory');
    expect(hrLabels).toContain('KPI Library');
    expect(hrLabels).toContain('Task Metrics');
    expect(hrLabels).toContain('Review Cycles');
    expect(hrLabels).toContain('System Setup');
    expect(hrLabels).toContain('Analytics');
  });

  it('does not offer an employee administrative tools', () => {
    const employeeLabels = labels(['employee']);
    for (const adminItem of ['HR Console & Directory', 'Review Cycles', 'Analytics', 'KPI Library', 'System Setup']) {
      expect(employeeLabels).not.toContain(adminItem);
    }
  });

  it('does not offer a manager system setup', () => {
    expect(labels(['employee', 'manager'])).not.toContain('System Setup');
    expect(labels(['employee', 'manager'])).toContain('Team Hierarchy');
  });

  it('hides all performance, KPI, monitoring, unit, requests, and HR goal console items when performance features are disabled', () => {
    const coreOnlyFeatures = {
      feature_core_hr: true,
      feature_performance: false,
      feature_kpis: false,
      feature_peer_reviews: false,
      feature_competencies_pip: false,
      feature_leave_management: true,
      feature_time_attendance: true,
      feature_ph_payroll: true,
      feature_bank_disbursement: true,
      feature_bir_statutory_gen: true,
    };
    const hrTitles = titles(['employee', 'hr_admin', 'manager'], true, coreOnlyFeatures);
    expect(hrTitles).not.toContain('Goals & KPIs');
    expect(hrTitles).toEqual(['Time & Attendance', 'Payroll & Payslips', 'Core HR']);

    const hrLabels = labels(['employee', 'hr_admin', 'manager'], true, coreOnlyFeatures);
    for (const hidden of [
      'My Goals', 'KPI Library', 'Task Metrics', 'Evaluations', 'Reviews',
      'Review Cycles', 'Competencies', 'Development', 'Improvement Plans (PIPs)',
      '360° Feedback', 'Analytics', 'Workforce Monitoring', 'Employee Requests',
      'My Unit', 'HR Console & Directory',
    ]) {
      expect(hrLabels).not.toContain(hidden);
    }
    for (const kept of [
      'Executive Outflow', 'Employee Directory', 'Team Hierarchy',
      'Personnel Reports', 'System Setup', 'Attendance & DTR',
      'Leave Management', 'PH Payroll (RA 10963)', 'My Payslips',
    ]) {
      expect(hrLabels).toContain(kept);
    }
  });
});

describe('route wiring', () => {
  it('marks only the dashboard as an exact match', () => {
    const all = buildGroups(['employee', 'hr_admin'], true).flatMap((g) => g.items);
    expect(all.filter((i) => i.end).map((i) => i.to)).toEqual([HOME_PATH]);
  });

  it('points every item at a distinct route', () => {
    const features = {
      feature_core_hr: true,
      feature_performance: true,
      feature_kpis: true,
      feature_peer_reviews: true,
      feature_competencies_pip: true,
      feature_leave_management: true,
      feature_time_attendance: true,
      feature_ph_payroll: true,
      feature_bank_disbursement: true,
      feature_bir_statutory_gen: true,
    };
    const routes = buildGroups(['employee', 'hr_admin'], true, features)
      .flatMap((g) => g.items).map((i) => i.to);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('gives every item an icon and a label', () => {
    for (const item of buildGroups(['employee', 'hr_admin'], true).flatMap((g) => g.items)) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon).toBeTruthy();
    }
  });
});
