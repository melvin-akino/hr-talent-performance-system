/**
 * F6 — the December 2025 Performance Improvement Plan form, over HTTP.
 *
 * `pip-form.spec.ts` proves the database rules. This proves they are WIRED, and
 * it exists for one reason above the rest: the original acknowledge call could
 * never succeed for the one person entitled to make it, and nothing noticed
 * because nothing called it. So the first test here is that call, made as the
 * employee, with no body — exactly as the screen made it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
let asManager: Record<string, string>;     // supervises Ricky
let asEmployee: Record<string, string>;    // Ricky, the subject
let asCeo: Record<string, string>;         // skip-level
let asOutsider: Record<string, string>;
let asHr: Record<string, string>;
let asDeptHead: Record<string, string>;

const post = (auth: Record<string, string>, path: string, body?: unknown) =>
  request(h.url).post(path).set(auth).send(body ?? {});
const get = (auth: Record<string, string>, path: string) =>
  request(h.url).get(path).set(auth);

const milestone = { description: 'Close five tickets a week', dueOn: '2026-04-15' };

/** A complete form, every section the December 2025 PIP carries. */
const fullForm = (over: Record<string, unknown> = {}) => ({
  employeeId: org.report.id,
  reason: 'Missed ticket-turnaround targets in three consecutive weeks',
  expectedOutcome: 'Turnaround back inside target by the plan end date',
  startsOn: '2026-03-01',
  endsOn: '2026-06-01',
  milestones: [milestone],
  seriesNo: `PIP-${randomUUID().slice(0, 8)}`,
  evaluatedOn: '2026-02-27',
  latestEvaluationOn: '2026-01-31',
  evaluationPart1Score: 38.5,
  evaluationPart2Score: 17,
  evaluationOverallScore: 55.5,
  pefReference: 'PEF-2026-014',
  recordOfInfractions: 'Two late arrivals logged in January',
  targetScore: 70,
  initialReviewOn: '2026-04-01',
  finalReviewOn: '2026-05-29',
  skillsToImprove: 'Turnaround time on support tickets',
  officerResponsibility: 'Weekly coaching and a shadowing assignment',
  additionalRemarks: 'Employee agreed to the targets in the session',
  ...over,
});

/** Raises and activates a plan, returning its id. */
async function activePlan(over: Record<string, unknown> = {}): Promise<string> {
  const created = await post(asManager, '/pips', fullForm(over));
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  const activated = await post(asManager, `/pips/${created.body.id}/activate`);
  expect(activated.status, JSON.stringify(activated.body)).toBeLessThan(300);
  return created.body.id as string;
}

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);

  // The grants that make the department and HCM lines real, and the line roles
  // they are granted to. Idempotent.
  await h.admin.query('SELECT app.seed_line_role_grants($1)', [org.orgId]);
  await h.admin.query('SELECT app.seed_pip_signature_grants($1)', [org.orgId]);

  // A DEDICATED department head. Not the CEO: the CEO already holds a wide
  // grant from the top of the chart, which swallows any department scope added
  // to them, and a narrow grant tested on somebody who also holds a wide one
  // proves nothing about the narrow one.
  const subject = randomUUID();
  const dh = (await h.admin.query<{ id: string }>(
    `INSERT INTO employee (org_id, employee_no, first_name, last_name, hired_on,
                           work_email, idp_subject)
          VALUES ($1,'PIP-DH','Dahlia','Head','2020-01-01','dahlia@test.local',$2)
       RETURNING id`, [org.orgId, subject])).rows[0]!.id;
  const dept = (await h.admin.query<{ id: string }>(
    `SELECT department_id AS id FROM employment
      WHERE employee_id = $1 AND effective_to IS NULL`, [org.manager.id])).rows[0]!.id;
  await h.admin.query(
    `INSERT INTO employment (org_id, employee_id, department_id, employment_type_id,
                             status, effective_from)
     SELECT $1,$2,$3,em.employment_type_id,'regular','2020-01-01'
       FROM employment em WHERE em.employee_id = $4 AND em.effective_to IS NULL`,
    [org.orgId, dh, dept, org.manager.id]);
  await h.admin.query(
    `INSERT INTO role_assignment (org_id, employee_id, role_id, scope_department_id,
                                  effective_from)
     SELECT $1,$2,r.id,$3,'2020-01-01' FROM app_role r
      WHERE r.org_id = $1 AND r.code = 'dept_head'`, [org.orgId, dh, dept]);

  const tok = async (s: string) => ({ Authorization: `Bearer ${await h.token(s)}` });
  asManager = await tok(org.manager.subject);
  asEmployee = await tok(org.report.subject);
  asCeo = await tok(org.ceo.subject);
  asOutsider = await tok(org.outsider.subject);
  asHr = await tok(org.hrAdmin.subject);
  asDeptHead = await tok(subject);

  // Not a superuser: every refusal below would otherwise pass for nothing.
  const su = await h.admin.query<{ usesuper: boolean }>(
    `SELECT usesuper FROM pg_user WHERE usename = 'hr_app'`);
  expect(su.rows[0]?.usesuper).toBe(false);
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe('raising a plan on the standard form', () => {
  it('records every section the form carries', async () => {
    const res = await post(asManager, '/pips', fullForm({ seriesNo: 'PIP-FULL-1' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      seriesNo: 'PIP-FULL-1',
      evaluatedOn: '2026-02-27',
      latestEvaluationOn: '2026-01-31',
      evaluationPart1Score: 38.5,
      evaluationPart2Score: 17,
      evaluationOverallScore: 55.5,
      pefReference: 'PEF-2026-014',
      recordOfInfractions: 'Two late arrivals logged in January',
      targetScore: 70,
      initialReviewOn: '2026-04-01',
      finalReviewOn: '2026-05-29',
      skillsToImprove: 'Turnaround time on support tickets',
      officerResponsibility: 'Weekly coaching and a shadowing assignment',
      additionalRemarks: 'Employee agreed to the targets in the session',
      state: 'draft',
    });
    // Nothing is signed on a draft, and nobody is offered a signature on one.
    expect(res.body.acknowledgements).toEqual([]);
    expect(res.body.signableParties).toEqual([]);
  });

  it('still accepts a plan with none of the new sections', async () => {
    // Every new field is optional. Making them mandatory would change what it
    // takes to raise a plan for every organisation at once, and the form itself
    // marks none of them required.
    const res = await post(asManager, '/pips', {
      employeeId: org.report.id,
      reason: 'Missed ticket-turnaround targets in three consecutive weeks',
      startsOn: '2026-03-01', endsOn: '2026-06-01', milestones: [milestone],
    });
    expect(res.status).toBe(201);
    expect(res.body.seriesNo).toBeNull();
    expect(res.body.targetScore).toBeNull();
  });

  it('refuses a score outside 0-100, and says so', async () => {
    const res = await post(asManager, '/pips', fullForm({ evaluationPart1Score: 101 }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/out of 100/);
  });

  it('refuses an initial review dated after the final one', async () => {
    const res = await post(asManager, '/pips', fullForm({
      initialReviewOn: '2026-05-30', finalReviewOn: '2026-04-01',
    }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/initial review cannot fall after/);
  });

  it('refuses a reused series number with a sentence, not a constraint name', async () => {
    await post(asManager, '/pips', fullForm({ seriesNo: 'PIP-DUP-1' }));
    const res = await post(asManager, '/pips', fullForm({ seriesNo: 'pip-dup-1 ' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/series number is already in use/);
  });
});

describe('signing', () => {
  it('lets the employee acknowledge their own plan, with no body — the call that never worked', async () => {
    const plan = await activePlan();

    // Exactly what the screen sends: a POST, no body, as the subject.
    const res = await request(h.url).post(`/pips/${plan}/acknowledge`).set(asEmployee);

    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(res.body.acknowledgedAt).toBeTruthy();
    expect(res.body.acknowledgements).toHaveLength(1);
    expect(res.body.acknowledgements[0]).toMatchObject({ party: 'employee' });
  });

  it('offers each person only the line they can sign, and drops it once signed', async () => {
    const plan = await activePlan();
    const offered = async (who: Record<string, string>) =>
      (await get(who, `/pips/${plan}`)).body.signableParties;

    expect(await offered(asEmployee)).toEqual(['employee']);
    expect(await offered(asManager)).toEqual(['reporting_officer']);
    expect(await offered(asDeptHead)).toEqual(['department_head']);
    expect(await offered(asHr)).toEqual(['hcm_representative']);

    await post(asEmployee, `/pips/${plan}/acknowledge`);
    expect(await offered(asEmployee)).toEqual([]);
  });

  it('refuses a second signature on the same line, plainly', async () => {
    const plan = await activePlan();
    await post(asEmployee, `/pips/${plan}/acknowledge`);
    const again = await post(asEmployee, `/pips/${plan}/acknowledge`);
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already been signed as the employee/);
  });

  it('refuses a line the caller does not hold, and names it', async () => {
    const plan = await activePlan();
    // The supervisor cannot sign as the employee — an acknowledgement entered by
    // the manager would be worthless as a record.
    const res = await post(asManager, `/pips/${plan}/acknowledge`, { party: 'employee' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/cannot sign this plan as the employee/);
  });

  it('collects all four signatures, each from the person who holds that line', async () => {
    const plan = await activePlan();

    for (const [who, party] of [
      [asEmployee, 'employee'],
      [asManager, 'reporting_officer'],
      [asDeptHead, 'department_head'],
      [asHr, 'hcm_representative'],
    ] as const) {
      const res = await post(who, `/pips/${plan}/acknowledge`, { party });
      expect(res.status, `${party}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
    }

    const final = await get(asHr, `/pips/${plan}`);
    expect(final.body.acknowledgements.map((a: { party: string }) => a.party).sort())
      .toEqual(['department_head', 'employee', 'hcm_representative', 'reporting_officer']);
    // Each entry names who signed, so "signed by whom" is answerable from the screen.
    for (const a of final.body.acknowledgements) {
      expect(a.by).toBeTruthy();
      expect(a.at).toBeTruthy();
    }
    expect(final.body.signableParties).toEqual([]);
  });

  it('refuses a signature before the plan is active', async () => {
    const draft = (await post(asManager, '/pips', fullForm())).body.id;
    const res = await post(asEmployee, `/pips/${draft}/acknowledge`);
    expect(res.status).toBe(403);
  });

  it('shows a skip-level manager, a stranger and a peer nothing — not even that it exists', async () => {
    // 0011's rule, still true. Adding signatories must not have widened it.
    const plan = await activePlan();
    for (const who of [asCeo, asOutsider]) {
      expect((await get(who, `/pips/${plan}`)).status).toBe(404);
      expect((await post(who, `/pips/${plan}/acknowledge`, { party: 'employee' })).status)
        .toBe(404);
    }
  });

  it('rejects a party that is not one of the four', async () => {
    const plan = await activePlan();
    const res = await post(asEmployee, `/pips/${plan}/acknowledge`, { party: 'ceo' });
    expect(res.status).toBe(400);
  });
});

describe('the reviews the schedule names', () => {
  const review = (plan: string, over: Record<string, unknown>) =>
    post(asManager, `/pips/${plan}/reviews`, {
      reviewDate: '2026-04-01', progressSummary: 'Walked through the progress to date',
      statusFlag: 'on_track', ...over,
    });

  it('records an initial review with its score, and lists the kind and score back', async () => {
    const plan = await activePlan();
    const res = await review(plan, { kind: 'initial', score: 62.5 });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    const list = await get(asManager, `/pips/${plan}/reviews`);
    expect(list.body[0]).toMatchObject({ kind: 'initial', score: 62.5 });
  });

  it('treats an unmarked review as interim, with no score', async () => {
    const plan = await activePlan();
    await review(plan, {});
    const list = await get(asManager, `/pips/${plan}/reviews`);
    expect(list.body[0]).toMatchObject({ kind: 'interim', score: null });
  });

  it('requires a score for an initial or a final review', async () => {
    const plan = await activePlan();
    const res = await review(plan, { kind: 'final' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/records a score/);
  });

  it('refuses a second initial review, explaining why', async () => {
    const plan = await activePlan();
    await review(plan, { kind: 'initial', score: 50 });
    const res = await review(plan, { kind: 'initial', score: 51 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already has that review/);
  });
});
