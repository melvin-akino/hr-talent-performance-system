/**
 * A person can always see their own records — including the ones written ABOUT
 * them by someone they cannot see.
 *
 * This is the failure mode that migration 0022 was written for and that keeps
 * coming back, because the bug looks like correct code:
 *
 *     JOIN employee e ON e.id = <record>.some_actor_id
 *
 * RLS on `employee` is deliberately tight — visibility runs downward, so a
 * report cannot read their own manager's row. An inner join to the actor
 * therefore drops the whole record. Nothing errors. The row is simply gone, and
 * the person is told they have no PIP, no assessment, no check-in.
 *
 * Three real instances were found by probing, all fixed by projecting the name
 * through `app.display_name()` instead of joining:
 *
 *   pip_plan.supervisor_id       — an employee could not see their own PIP
 *   competency_assessment.assessed_by — nor their own assessment history
 *   goal_checkin.checked_in_by   — nor a check-in their manager logged for them
 *
 * Every future record with an actor column needs a case here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
let asSubject: Record<string, string>;
let asManager: Record<string, string>;
let goalId: string;

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  asSubject = { Authorization: `Bearer ${await h.token(org.report.subject)}` };
  asManager = { Authorization: `Bearer ${await h.token(org.manager.subject)}` };

  await h.admin.query(`SELECT set_config('app.request_id', $1, false)`, [randomUUID()]);

  // Confirm the premise: the subject genuinely cannot read the manager's row.
  // If that ever changes these tests still pass but stop proving anything, so
  // the premise is asserted rather than assumed.
  const upward = await request(h.url).get(`/employees/${org.manager.id}`).set(asSubject);
  expect([401, 403, 404]).toContain(upward.status);

  // --- a PIP opened by the manager ----------------------------------------
  await h.admin.query(
    `INSERT INTO pip_plan (org_id, employee_id, initiated_by, supervisor_id,
                           reason, starts_on, ends_on, state, created_by)
          VALUES ($1,$2,$3,$3,'Missed delivery targets',
                  CURRENT_DATE, CURRENT_DATE + 60, 'active', $3)`,
    [org.orgId, org.report.id, org.manager.id]);

  // --- a competency assessment made by the manager ------------------------
  const fw = (await h.admin.query<{ id: string }>(
    `INSERT INTO competency_framework (org_id, code, version, name)
          VALUES ($1,'CORE',1,'Core') RETURNING id`, [org.orgId])).rows[0]!.id;
  const comp = (await h.admin.query<{ id: string }>(
    `INSERT INTO competency (framework_id, code, name, category, sequence)
          VALUES ($1,'JUDG','Judgement','core',1) RETURNING id`, [fw])).rows[0]!.id;
  await h.admin.query(
    `INSERT INTO competency_level (competency_id, level_no, label, behavioral_indicator)
          VALUES ($1,3,'Level 3','Weighs trade-offs across a system')`, [comp]);
  await h.admin.query(
    `UPDATE competency_framework SET is_active = TRUE, published_at = now()
      WHERE id = $1`, [fw]);
  await h.admin.query(
    `INSERT INTO competency_assessment
       (org_id, subject_employee_id, competency_id, assessed_level, assessed_by,
        notes, assessed_on, created_by)
     VALUES ($1,$2,$3,3,$4,'Assessed during the cycle',CURRENT_DATE,$4)`,
    [org.orgId, org.report.id, comp, org.manager.id]);

  // --- a check-in the manager logged on the subject's goal -----------------
  goalId = (await h.admin.query<{ id: string }>(
    `INSERT INTO goal (org_id, goal_period_id, employee_id, title, weight, state,
                       approved_by, approved_at)
          VALUES ($1,$2,$3,'Ship the integration',100,'active',$4,now())
       RETURNING id`,
    [org.orgId, org.goalPeriodId, org.report.id, org.manager.id])).rows[0]!.id;
  await h.admin.query(
    `INSERT INTO goal_checkin (goal_id, checked_in_by, status_flag, period_ending,
                               comment, created_by)
          VALUES ($1,$2,'at_risk',CURRENT_DATE,'Discussed in our one-to-one',$2)`,
    [goalId, org.manager.id]);
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe('a person can see their own PIP', () => {
  it('returns the plan to its subject', async () => {
    // The whole point of a PIP is that the employee knows what is expected of
    // them. One they cannot read is worse than none — it is an expectation
    // nobody told them about.
    const res = await request(h.url).get('/pips').set(asSubject);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reason).toBe('Missed delivery targets');
  });

  it('names the supervisor without disclosing their record', async () => {
    const res = await request(h.url).get('/pips').set(asSubject);
    expect(res.body[0].supervisorName).toBe('Mary Manager');

    // The name is all that leaks. The employee row itself stays unreadable.
    const direct = await request(h.url).get(`/employees/${org.manager.id}`).set(asSubject);
    expect([401, 403, 404]).toContain(direct.status);
  });

  it('shows the manager the same plan', async () => {
    const res = await request(h.url).get('/pips').set(asManager);
    expect(res.body).toHaveLength(1);
  });
});

describe('a person can see their own competency assessments', () => {
  it('returns an assessment made by their manager', async () => {
    const res = await request(h.url)
      .get(`/employees/${org.report.id}/competency-assessments`).set(asSubject);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].assessedLevel).toBe(3);
  });

  it('names the assessor', async () => {
    const res = await request(h.url)
      .get(`/employees/${org.report.id}/competency-assessments`).set(asSubject);
    // An anonymous assessment would be worse than none: you cannot discuss a
    // level with nobody.
    expect(res.body[0].assessedBy).toBe('Mary Manager');
  });
});

describe('a person can see check-ins on their own goal', () => {
  it('returns one their manager logged', async () => {
    const res = await request(h.url).get(`/goals/${goalId}/checkins`).set(asSubject);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].comment).toBe('Discussed in our one-to-one');
  });

  it('names who logged it', async () => {
    const res = await request(h.url).get(`/goals/${goalId}/checkins`).set(asSubject);
    expect(res.body[0].checkedInBy).toBe('Mary Manager');
  });
});

describe('display_name does not become a directory', () => {
  it('returns nothing for an employee in another tenant', async () => {
    const other = await seedOrg(h.admin, 'OTHERCO');
    const res = await h.admin.query<{ name: string | null }>(
      `SELECT app.display_name($1) AS name`, [other.manager.id]);
    // Called with no tenant context set, so it must resolve nothing rather than
    // leak a name across the boundary on an unguessable id.
    expect(res.rows[0]!.name).toBeNull();
  });
});
