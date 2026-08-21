/**
 * Which navigation groups each role is offered.
 *
 * This is presentation, not authorization — RLS decides what anyone can
 * actually read, and forcing a hidden route returns empty results rather than
 * someone else's data. What these tests protect is the thing the redesign was
 * for: an employee should not be offered a calibration console they have no
 * rows for, and a manager should not be handed the company's configuration.
 *
 * The `hasReports` fallback matters. Role grants are derived from the org chart
 * by an operator command, so a newly promoted manager can have direct reports
 * before anyone re-runs it. Falling back to "has reports" means their team is
 * reachable immediately instead of after an admin task nobody remembers.
 */
import { describe, expect, it } from 'vitest';
import { buildGroups } from '../src/components/Sidebar';

const titles = (roles: string[], hasReports = false) =>
  buildGroups(roles, hasReports).map((g) => g.title);

const labels = (roles: string[], hasReports = false) =>
  buildGroups(roles, hasReports).flatMap((g) => g.items.map((i) => i.label));

describe('group visibility by role', () => {
  it('offers a plain employee only their own work', () => {
    expect(titles(['employee'])).toEqual(['Mine']);
  });

  it('offers a manager their team as well', () => {
    expect(titles(['employee', 'manager'])).toEqual(['Mine', 'My team']);
  });

  it('offers an HR admin everything', () => {
    expect(titles(['employee', 'hr_admin'])).toEqual(['Mine', 'My team', 'Company']);
  });

  it('offers an HR business partner everything', () => {
    // hr_partner is scoped to a department by RLS, not by hiding the console.
    expect(titles(['employee', 'hr_partner'])).toEqual(['Mine', 'My team', 'Company']);
  });

  it('shows the team group to someone with reports but no manager grant yet', () => {
    expect(titles(['employee'], true)).toEqual(['Mine', 'My team']);
  });

  it('shows only Mine when roles have not loaded yet', () => {
    // me() is in flight on first paint. Showing the least is the safe default:
    // groups appearing is unremarkable, groups vanishing looks like a fault.
    expect(titles([])).toEqual(['Mine']);
  });
});

describe('what each group contains', () => {
  it('keeps personal work in Mine', () => {
    expect(labels(['employee'])).toEqual([
      'My goals', 'Reviews', 'Competencies', 'Development', 'Feedback', 'Notifications',
    ]);
  });

  it('does not offer an employee the company configuration', () => {
    const visible = labels(['employee']);
    for (const hidden of ['HR console', 'Review cycles', 'Analytics', 'KPI library', 'Setup']) {
      expect(visible).not.toContain(hidden);
    }
  });

  it('does not offer a manager the company configuration', () => {
    expect(labels(['employee', 'manager'])).not.toContain('Setup');
    expect(labels(['employee', 'manager'])).toContain('Team');
  });
});

describe('route wiring', () => {
  it('marks only the dashboard as an exact match', () => {
    // Without `end`, "/" would stay lit on every route, since every path
    // starts with it.
    const all = buildGroups(['employee', 'hr_admin'], true).flatMap((g) => g.items);
    expect(all.filter((i) => i.end).map((i) => i.to)).toEqual(['/']);
  });

  it('points every item at a distinct route', () => {
    const routes = buildGroups(['employee', 'hr_admin'], true)
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
