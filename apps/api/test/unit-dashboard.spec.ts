/**
 * F3 — the unit dashboard (§7.3), over HTTP.
 *
 * THE CLAIM UNDER TEST IS THE DESIGN CLAIM.
 *
 * There is one endpoint and one service method for Department Head, Area Head,
 * Regional Head and GM. No role appears in the route and no branch on role
 * appears in the service: the difference between what a DH sees and what an
 * Area Head sees is entirely RLS. So these tests give the same request to
 * people with different grants and assert the answers differ correctly — which
 * is the only way to show the scoping is real rather than incidental.
 *
 * The failure this guards against is the tempting one: a `role === 'dept_head'`
 * branch that happens to produce the right answer today, drifts the moment
 * somebody edits a grant, and cannot be caught by reading the SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
let asHrAdmin: Record<string, string>;
let asDeptHead: Record<string, string>;
let asEmployee: Record<string, string>;
let periodId: string;
let deptA: string;
let dhId: string;
let dhSubject: string;

const get = (auth: Record<string, string>) =>
  request(h.url).get(`/dashboards/unit/${periodId}`).set(auth);

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  asHrAdmin = { Authorization: `Bearer ${await h.token(org.hrAdmin.subject)}` };
  asEmployee = { Authorization: `Bearer ${await h.token(org.report.subject)}` };
  periodId = org.goalPeriodId;

  deptA = (await h.admin.query<{ id: string }>(
    `SELECT em.department_id AS id FROM employment em
      WHERE em.employee_id = $1 AND em.effective_to IS NULL`,
    [org.manager.id])).rows[0]!.id;

  // The role exists with grants and no holders — 0038 seeded it that way, so
  // the DH step was built, tested and impossible to demonstrate. Scope matters:
  // can_access's 'department' branch begins `scope_department_id IS NOT NULL`,
  // so an unscoped assignment grants nothing at all.
  await h.admin.query('SELECT app.seed_line_role_grants($1)', [org.orgId]);
  await h.admin.query('SELECT app.seed_dept_head_review_grants($1)', [org.orgId]);
  // A DEDICATED holder, not the CEO.
  //
  // The first version of this fixture made org.ceo the Department Head, and the
  // scoping assertion failed at 2 units versus 2 — because the CEO already
  // holds `manager` at subtree scope from the top of the chart, which swallows
  // any department scope added to them. Testing a narrow grant on somebody who
  // also holds a wide one proves nothing about the narrow one.
  dhSubject = randomUUID();
  dhId = (await h.admin.query<{ id: string }>(
    `INSERT INTO employee (org_id, employee_no, first_name, last_name,
                           hired_on, work_email, idp_subject)
          VALUES ($1,'F3-DH','Dahlia','Head','2020-01-01',
                  'dahlia.head@test.local',$2)
     RETURNING id`, [org.orgId, dhSubject])).rows[0]!.id;
  await h.admin.query(
    `INSERT INTO employment (org_id, employee_id, department_id,
                             employment_type_id, status, effective_from)
     SELECT $1, $2, $3, em.employment_type_id, 'regular', '2020-01-01'
       FROM employment em
      WHERE em.employee_id = $4 AND em.effective_to IS NULL`,
    [org.orgId, dhId, deptA, org.manager.id]);
  await h.admin.query(
    `INSERT INTO role_assignment (org_id, employee_id, role_id,
                                  scope_department_id, effective_from)
     SELECT $1, $2, r.id, $3, '2020-01-01'
       FROM app_role r WHERE r.org_id = $1 AND r.code = 'dept_head'`,
    [org.orgId, dhId, deptA]);

  // A second populated unit. Without it the DH and the admin both see one
  // department and "strictly less than the org" compares 1 with 1, which
  // passes for the wrong reason or fails for the right one.
  const deptB = (await h.admin.query<{ id: string }>(
    `INSERT INTO department (org_id, code, name, unit_type, effective_from)
          VALUES ($1,'F3B','Second Section','section','2020-01-01')
     RETURNING id`, [org.orgId])).rows[0]!.id;
  await h.admin.query(
    `UPDATE employment SET department_id = $2
      WHERE employee_id = $1 AND effective_to IS NULL`,
    [org.outsider.id, deptB]);

  asDeptHead = { Authorization: `Bearer ${await h.token(dhSubject)}` };

}, 300_000);

afterAll(async () => { await h?.stop(); });

describe('the unit view', () => {
  it('answers for an HR administrator', async () => {
    const res = await get(asHrAdmin);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.units)).toBe(true);
    expect(res.body).toHaveProperty('reviewProgress');
    expect(res.body).toHaveProperty('waitingOnYou');
    expect(res.body).toHaveProperty('blockingSignOff');
  });

  it('shows a unit where nobody has set a target, with a zero', async () => {
    // A section that disappears when it is failing is the opposite of a
    // dashboard. Headcount comes from current employment, not from goal rows.
    const res = await get(asHrAdmin);
    for (const u of res.body.units) {
      expect(u.headcount).toBeGreaterThan(0);
      expect(u.withGoals).toBeLessThanOrEqual(u.headcount);
    }
    expect(res.body.units.some((u: { withGoals: number }) => u.withGoals === 0))
      .toBe(true);
  });

  it('gives a department-scoped holder strictly less than the org', async () => {
    // The design claim. Same route, same service, no role branch — only RLS.
    const admin = await get(asHrAdmin);
    const dh = await get(asDeptHead);

    expect(dh.status).toBe(200);
    expect(dh.body.units.length).toBeGreaterThan(0);
    expect(dh.body.units.length).toBeLessThan(admin.body.units.length);

    // And what it shows is their own scope, not an arbitrary subset.
    const dhCodes = dh.body.units.map((u: { id: string }) => u.id);
    expect(dhCodes).toContain(deptA);
  });

  it('declines to answer for somebody with no unit', async () => {
    // Found by testing, not by reasoning: an employee holding employee:read at
    // 'self' only came back with ONE unit — their own department, headcount 1.
    // Nothing leaked, they saw only themselves. But "one person, none with
    // goals" is a false statement about a section, and numbers silently scoped
    // to the reader are worse than no answer. So the view now requires a scope
    // wider than self.
    const res = await get(asEmployee);
    expect(res.status).toBe(200);
    expect(res.body.units).toEqual([]);
    expect(res.body.reviewProgress).toEqual([]);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await request(h.url).get(`/dashboards/unit/${periodId}`);
    expect(res.status).toBe(401);
  });
});

describe('what is waiting for you', () => {
  it('lists the caller’s own unfinished reviews, whatever their role', async () => {
    const scale = (await h.admin.query<{ id: string }>(
      `INSERT INTO rating_scale (org_id,code,version,name,published_at)
            VALUES ($1,'F3S',1,'S',now()) RETURNING id`, [org.orgId])).rows[0]!.id;
    const tpl = (await h.admin.query<{ id: string }>(
      `INSERT INTO form_template (org_id,code,name) VALUES ($1,'F3F','F')
       RETURNING id`, [org.orgId])).rows[0]!.id;
    const ver = (await h.admin.query<{ id: string }>(
      `INSERT INTO form_version (form_template_id,version,schema_json,
                                 rating_scale_id,published_at,is_active)
            VALUES ($1,1,'{"sections":[]}'::jsonb,$2,now(),TRUE) RETURNING id`,
      [tpl, scale])).rows[0]!.id;
    const cycle = (await h.admin.query<{ id: string }>(
      `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
            VALUES ($1,'F3CYC','2026-01-01','2026-12-31','open') RETURNING id`,
      [org.orgId])).rows[0]!.id;

    // A dept_head instance: the approval step from 0038. It reaches the
    // dashboard because it is assigned to them, not because of their title.
    await h.admin.query(
      `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                    reviewer_employee_id, reviewer_role,
                                    form_version_id, state)
            VALUES ($1,$2,$3,'dept_head',$4,'in_progress')`,
      [cycle, org.report.id, dhId, ver]);

    const res = await get(asDeptHead);
    expect(res.status).toBe(200);
    const mine = res.body.waitingOnYou;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].asRole).toBe('dept_head');
    expect(mine[0].cycle).toBe('F3CYC');
    expect(mine[0].closesOn).toBe('2026-12-31');
  });

  it('explains why a cycle will not close', async () => {
    // signOff refuses while any instance is unsubmitted (0038). Without this
    // list the answer to "why is this cycle stuck" is opening records one at a
    // time until you find the one nobody has done.
    const res = await get(asHrAdmin);
    const blocked = res.body.blockingSignOff;
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]).toHaveProperty('subjectName');
    expect(blocked[0]).toHaveProperty('outstanding');
    expect(blocked[0].roles).toContain('dept_head');
  });

  it('does not list the caller as blocking their own sign-off', async () => {
    // Their own review is their business and appears under waitingOnYou; the
    // blocking list is about other people's cycles they can help close.
    const res = await get(asHrAdmin);
    const names: string[] = res.body.blockingSignOff.map(
      (b: { subjectName: string }) => b.subjectName);
    expect(names).not.toContain('Hilda Ar');
  });
});

describe('the role can actually be assigned', () => {
  it('grants dept_head with a department scope, and it resolves', async () => {
    // 0038 seeded dept_head with review:approve at department scope and left it
    // unassigned. This asserts the assignment made in beforeAll actually
    // confers the grant — an unscoped one would resolve to nothing and look
    // identical from the outside.
    // Asked in the DH's own context: can_access reads
    // app.current_employee_id(), so running it on the admin pool without an
    // identity would answer about nobody.
    const c = await h.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.current_employee_id',$1,true)`,
        [dhId]);
      const granted = await c.query<{ ok: boolean }>(
        `SELECT app.can_access('review','approve',$1) AS ok`, [org.report.id]);
      expect(granted.rows[0]?.ok).toBe(true);

      // And the scope is what makes it work. Clearing it must revoke the
      // grant — otherwise this test would pass for an unscoped assignment too
      // and prove nothing about the scope at all.
      await c.query(
        `UPDATE role_assignment ra SET scope_department_id = NULL
           FROM app_role r
          WHERE r.id = ra.role_id AND r.code = 'dept_head'
            AND ra.employee_id = $1`, [dhId]);
      const unscoped = await c.query<{ ok: boolean }>(
        `SELECT app.can_access('review','approve',$1) AS ok`, [org.report.id]);
      expect(unscoped.rows[0]?.ok).toBe(false);

      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
