/**
 * F2 — the report builder (§7.2), over HTTP.
 *
 * TWO CLAIMS, AND THE SECOND ONE IS THE DANGEROUS ONE.
 *
 * The first is that the filters filter: period, source, evaluation type,
 * department subtree, name, result. That is ordinary and the tests are
 * ordinary.
 *
 * The second is that a cross-employee report shows nobody anything they could
 * not already see. This is the single most likely place in the system for
 * confidential assessment to leak, because the whole point of the feature is
 * to pull many people's results into one table. app.evaluation_report is
 * SECURITY INVOKER so that each source filters itself — and the way to prove
 * that is real rather than assumed is to put a draft evaluation in the
 * database, ask for it as its subject, and find it absent.
 *
 * There is also a structural claim worth one test on its own: 0047 replaced
 * app.employee_timeline with a wrapper over the same union the report uses. If
 * that wrapper ever stops agreeing with the report, the history screen and the
 * report will quietly describe the same person differently.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
let asHrAdmin: Record<string, string>;
let asManager: Record<string, string>;
let asReport: Record<string, string>;
let engDept: string;
let subDept: string;

const get = (auth: Record<string, string>, qs = '') =>
  request(h.url).get(`/reports/evaluations${qs}`).set(auth);

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  asHrAdmin = { Authorization: `Bearer ${await h.token(org.hrAdmin.subject)}` };
  asManager = { Authorization: `Bearer ${await h.token(org.manager.subject)}` };
  asReport = { Authorization: `Bearer ${await h.token(org.report.subject)}` };

  // Nobody is a superuser here. Stated as an assertion because a suite that
  // silently connects with BYPASSRLS proves the opposite of what it claims.
  const su = await h.admin.query<{ usesuper: boolean }>(
    `SELECT usesuper FROM pg_user WHERE usename = 'hr_app'`);
  expect(su.rows[0]?.usesuper).toBe(false);

  engDept = (await h.admin.query<{ id: string }>(
    `SELECT department_id AS id FROM employment
      WHERE employee_id = $1 AND effective_to IS NULL`,
    [org.manager.id])).rows[0]!.id;

  // A child unit under Engineering, with the outsider in it. Without a second
  // level the subtree filter compares one department with one department and
  // would pass for a filter that ignored descendants entirely.
  subDept = (await h.admin.query<{ id: string }>(
    `INSERT INTO department (org_id, code, name, unit_type,
                             parent_department_id, effective_from)
          VALUES ($1,'ENGSUB','Platform Section','section',$2,'2020-01-01')
     RETURNING id`, [org.orgId, engDept])).rows[0]!.id;
  await h.admin.query(
    `UPDATE employment SET department_id = $2
      WHERE employee_id = $1 AND effective_to IS NULL`,
    [org.outsider.id, subDept]);

  // A PIP with an outcome — the client's named case for "report on results".
  await h.admin.query(
    `INSERT INTO pip_plan (org_id, employee_id, initiated_by, supervisor_id,
                           reason, starts_on, ends_on, state, outcome, closed_at)
          VALUES ($1,$2,$3,$3,'Missed targets','2026-02-01','2026-04-30',
                  'completed','successful',now())`,
    [org.orgId, org.report.id, org.manager.id]);

  // A DRAFT task evaluation. Its subject must never see it (0033), and this
  // is the row the confidentiality test looks for.
  const scale = (await h.admin.query<{ id: string }>(
    `INSERT INTO scorecard (org_id, name)
          VALUES ($1,'Quarterly tasks') RETURNING id`,
    [org.orgId])).rows[0]!.id;
  await h.admin.query(
    `INSERT INTO scorecard_evaluation (org_id, employee_id, scorecard_id,
                                       evaluator_employee_id, period_start,
                                       period_end, state, target_points)
          VALUES ($1,$2,$3,$4,'2026-01-01','2026-03-31','draft',37)`,
    [org.orgId, org.report.id, scale, org.manager.id]);
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe('the report', () => {
  it('answers unfiltered, and the unfiltered answer is everyone visible', async () => {
    const res = await get(asHrAdmin);
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    // Employment events exist for everyone who was hired, so an unfiltered
    // report reaches more than one person. If it ever returns exactly one, the
    // report has silently become a timeline.
    const people = new Set(res.body.rows.map((r: { employeeId: string }) => r.employeeId));
    expect(people.size).toBeGreaterThan(1);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(h.url).get('/reports/evaluations')).status).toBe(401);
  });

  it('rejects a filter value that is not a thing, rather than returning nothing',
    async () => {
      // The difference between "you asked for something that does not exist"
      // and "there is nothing there" matters: only one of them is true, and a
      // silently empty report is read as a fact about the organisation.
      const res = await get(asHrAdmin, '?kinds=promotion_programme');
      expect(res.status).toBe(400);
    });

  it('filters by period', async () => {
    const res = await get(asHrAdmin, '?from=2026-01-01&to=2026-12-31');
    expect(res.status).toBe(200);
    for (const r of res.body.rows) {
      expect(r.occurredOn >= '2026-01-01').toBe(true);
      expect(r.occurredOn <= '2026-12-31').toBe(true);
    }
    // And the 2020 hires are gone, which is what makes the assertion above
    // more than vacuously true.
    const all = await get(asHrAdmin);
    expect(res.body.rows.length).toBeLessThan(all.body.rows.length);
  });

  it('filters by source', async () => {
    const res = await get(asHrAdmin, '?kinds=pip');
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    for (const r of res.body.rows) expect(r.kind).toBe('pip');
  });

  it('filters by PIP result — the case the client named', async () => {
    const hit = await get(asHrAdmin, '?results=successful');
    expect(hit.body.rows.length).toBeGreaterThan(0);
    for (const r of hit.body.rows) expect(r.result).toBe('successful');

    const miss = await get(asHrAdmin, '?results=unsuccessful');
    expect(miss.body.rows).toEqual([]);
  });

  it('filters by name, matching the person and not the event title', async () => {
    const byName = await get(asHrAdmin, '?name=Report');
    expect(byName.body.rows.length).toBeGreaterThan(0);
    for (const r of byName.body.rows) expect(r.employeeName).toContain('Report');

    // The employee number is the other half of "by name": half the people
    // running this have the number in front of them, not the spelling.
    const byNo = await get(asHrAdmin, '?name=E003');
    expect(byNo.body.rows.length).toBeGreaterThan(0);
    for (const r of byNo.body.rows) expect(r.employeeNo).toBe('E003');
  });

  it('includes the subtree when filtering by unit', async () => {
    // Otto is in a SECTION under Engineering. Filtering to Engineering must
    // reach him; a filter that only matched the department node directly would
    // report an almost empty division and be believed.
    const res = await get(asHrAdmin, `?departmentId=${engDept}`);
    const ids = new Set(res.body.rows.map((r: { employeeId: string }) => r.employeeId));
    expect(ids.has(org.outsider.id)).toBe(true);
    expect(ids.has(org.manager.id)).toBe(true);

    // And the narrow filter is genuinely narrower.
    const narrow = await get(asHrAdmin, `?departmentId=${subDept}`);
    const narrowIds = new Set(
      narrow.body.rows.map((r: { employeeId: string }) => r.employeeId));
    expect(narrowIds.has(org.outsider.id)).toBe(true);
    expect(narrowIds.has(org.manager.id)).toBe(false);
  });

  it('says when it cut the list short', async () => {
    const res = await get(asHrAdmin, '?limit=1');
    expect(res.body.rows.length).toBe(1);
    expect(res.body.truncated).toBe(true);
    expect(res.body.limit).toBe(1);

    // A report that silently stops is a report somebody makes a decision on.
    const whole = await get(asHrAdmin, '?limit=10000');
    expect(whole.body.truncated).toBe(false);
  });
});

describe('what the report may not show', () => {
  it('hides a draft task evaluation from its own subject', async () => {
    // The evaluator can see their work in progress...
    const mgr = await get(asManager, '?kinds=task_evaluation');
    expect(mgr.body.rows.some((r: { detail: string }) => r.detail === 'Draft')).toBe(true);

    // ...and the person being marked down cannot, which is 0033's policy doing
    // the work rather than anything in the report.
    const subject = await get(asReport, '?kinds=task_evaluation');
    expect(subject.body.rows.some((r: { detail: string }) => r.detail === 'Draft'))
      .toBe(false);
  });

  it('gives an ordinary employee their own record and nobody else’s', async () => {
    const res = await get(asReport);
    expect(res.status).toBe(200);
    const people = new Set(res.body.rows.map((r: { employeeId: string }) => r.employeeId));
    expect(people.has(org.report.id)).toBe(true);
    expect(people.has(org.hrAdmin.id)).toBe(false);
  });

  it('returns a manager strictly less than HR', async () => {
    // The design claim, same as F3: one query, no role branch, different
    // answers because RLS answers differently.
    const hr = await get(asHrAdmin);
    const mgr = await get(asManager);
    const hrPeople = new Set(hr.body.rows.map((r: { employeeId: string }) => r.employeeId));
    const mgrPeople = new Set(mgr.body.rows.map((r: { employeeId: string }) => r.employeeId));
    expect(mgrPeople.size).toBeLessThan(hrPeople.size);
    for (const id of mgrPeople) expect(hrPeople.has(id)).toBe(true);
  });
});

describe('the history screen and the report agree', () => {
  it('gives the same events for one person from both entry points', async () => {
    // 0047 made app.employee_timeline a wrapper over the same union the report
    // uses. If these two ever disagree, one union has been quietly forked and
    // a person's history means two different things on two screens.
    const viaReport = await get(asHrAdmin, `?name=E003&limit=10000`);
    const viaTimeline = await request(h.url)
      .get(`/employees/${org.report.id}/timeline`).set(asHrAdmin);

    expect(viaTimeline.status).toBe(200);
    const refs = (rows: { refId: string }[]) => new Set(rows.map((r) => r.refId));

    const a = refs(viaReport.body.rows);
    const b = refs(viaTimeline.body);
    expect([...b].every((id) => a.has(id))).toBe(true);
    expect(a.size).toBe(b.size);
  });
});

describe('the CSV', () => {
  it('is the same report as the screen, as a file', async () => {
    const res = await request(h.url)
      .get('/reports/evaluations.csv?kinds=pip').set(asHrAdmin);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toContain('Employee No');
    // One header plus the PIPs the JSON endpoint returned. A file that carries
    // more than the screen showed is a confidentiality surprise.
    const json = await get(asHrAdmin, '?kinds=pip');
    expect(lines.length - 1).toBe(json.body.rows.length);
  });
});
