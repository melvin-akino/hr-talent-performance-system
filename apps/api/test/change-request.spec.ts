/**
 * F4 — the request-and-approval flow (§7.9), over HTTP.
 *
 * THE THINGS THAT MUST NOT BE POSSIBLE.
 *
 * A request entity is only worth having if the answer it records is one
 * somebody else gave. So the tests that matter here are the refusals: you
 * cannot ask about yourself, you cannot decide your own request, you cannot
 * decide one you have no grant over, and you cannot decline without saying
 * why. Each of those is enforced in the database — a CHECK constraint, a
 * transition trigger or an RLS policy — and each is asked here over HTTP,
 * because a rule enforced only in a service is a rule that holds until the
 * CLI writes the same row.
 *
 * And the one that is a confidentiality claim rather than a workflow one: the
 * SUBJECT of a request cannot see it. A request to adjust somebody's score is
 * assessment in motion, the same category as a draft evaluation (0033).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
let asHrAdmin: Record<string, string>;
let asManager: Record<string, string>;
let asReport: Record<string, string>;
let asOutsider: Record<string, string>;

const post = (auth: Record<string, string>, body: unknown) =>
  request(h.url).post('/requests').set(auth).send(body);
const list = (auth: Record<string, string>) =>
  request(h.url).get('/requests').set(auth);

/** A well-formed scoring adjustment about the manager's own report. */
const adjustment = () => ({
  requestType: 'scoring_adjustment',
  subjectEmployeeId: org.report.id,
  currentScore: 3.2,
  proposedScore: 3.8,
  rationale: 'Took on the branch rollout mid-cycle; the scorecard predates it.',
});

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  asHrAdmin = { Authorization: `Bearer ${await h.token(org.hrAdmin.subject)}` };
  asManager = { Authorization: `Bearer ${await h.token(org.manager.subject)}` };
  asReport = { Authorization: `Bearer ${await h.token(org.report.subject)}` };
  asOutsider = { Authorization: `Bearer ${await h.token(org.outsider.subject)}` };

  // Not a superuser. A suite that silently connects with BYPASSRLS proves the
  // opposite of everything below.
  const su = await h.admin.query<{ usesuper: boolean }>(
    `SELECT usesuper FROM pg_user WHERE usename = 'hr_app'`);
  expect(su.rows[0]?.usesuper).toBe(false);

  await h.admin.query('SELECT app.seed_change_request_grants($1)', [org.orgId]);
  await h.admin.query('SELECT app.seed_change_request_templates($1)', [org.orgId]);
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe('raising a request', () => {
  it('records who asked, about whom, and why', async () => {
    const res = await post(asManager, adjustment());
    expect(res.status).toBe(201);
    expect(res.body.state).toBe('submitted');
    expect(res.body.requestedBy).toContain('Manager');
    expect(res.body.subjectName).toContain('Report');
    expect(res.body.proposedScore).toBe(3.8);
    // The department is filled in from the subject's employment rather than
    // asked for: "which section raised this" is the first question anybody
    // reviewing a year of requests asks, and a field people can leave blank is
    // a field that is blank.
    expect(res.body.department).toBeTruthy();
  });

  it('refuses a request about yourself', async () => {
    // Self-dealing, and a CHECK constraint rather than a service rule.
    const res = await post(asManager, {
      ...adjustment(), subjectEmployeeId: org.manager.id,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses a scoring adjustment with no score in it', async () => {
    const res = await post(asManager, {
      requestType: 'scoring_adjustment',
      subjectEmployeeId: org.report.id,
      rationale: 'Please have another look.',
    });
    expect(res.status).toBe(400);
  });

  it('refuses a request with no reason', async () => {
    const res = await post(asManager, { ...adjustment(), rationale: '   ' });
    expect(res.status).toBe(400);
  });

  it('refuses somebody with no grant over the subject', async () => {
    // Otto has no line to Ricky and no change_request:write scope that reaches
    // him. RLS refuses the INSERT; nothing in the service was asked.
    const res = await post(asOutsider, adjustment());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(h.url).post('/requests').send(adjustment())).status).toBe(401);
  });
});

describe('who can see a request', () => {
  let id: string;

  beforeAll(async () => {
    id = (await post(asManager, adjustment())).body.id;
  });

  it('shows it to the person who raised it', async () => {
    const res = await list(asManager);
    expect(res.body.some((r: { id: string }) => r.id === id)).toBe(true);
  });

  it('shows it to an approver', async () => {
    const res = await list(asHrAdmin);
    expect(res.body.some((r: { id: string }) => r.id === id)).toBe(true);
  });

  it('hides it from its own subject', async () => {
    // The confidentiality claim. A request to adjust Ricky's score is a
    // judgement still being formed; showing it to him produces an argument
    // about a decision nobody has made. What he is entitled to is the result,
    // once somebody applies it.
    const res = await list(asReport);
    expect(res.body.some((r: { id: string }) => r.id === id)).toBe(false);

    // And not by id either — a list filter that leaks on the detail route is
    // the usual way this goes wrong.
    const byId = await request(h.url).get(`/requests/${id}`).set(asReport);
    expect(byId.status).toBe(404);
  });

  it('hides it from an unrelated colleague', async () => {
    const res = await list(asOutsider);
    expect(res.body.some((r: { id: string }) => r.id === id)).toBe(false);
  });
});

describe('deciding', () => {
  const decide = (auth: Record<string, string>, id: string, body: unknown) =>
    request(h.url).patch(`/requests/${id}/decision`).set(auth).send(body);

  it('approves, recording who decided', async () => {
    const id = (await post(asManager, adjustment())).body.id;
    const res = await decide(asHrAdmin, id, { decision: 'approved', note: 'Agreed.' });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('approved');
    expect(res.body.decidedBy).toContain('Ar');
    expect(res.body.decidedAt).toBeTruthy();
  });

  it('will not let the requester decide their own', async () => {
    // HR hold change_request:write as well as approve, so this is not
    // hypothetical: without the constraint, an HR partner raising a request
    // could answer it in the next click and the second gate would be theatre.
    const id = (await post(asHrAdmin, {
      ...adjustment(), rationale: 'Raised by HR, to be decided by somebody else.',
    })).body.id;
    const res = await decide(asHrAdmin, id, { decision: 'approved' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('will not let somebody without the approve grant decide', async () => {
    const id = (await post(asManager, adjustment())).body.id;
    // The manager raised it and cannot answer it; the subject cannot even see
    // it. Both must fail, and for different reasons.
    expect((await decide(asManager, id, { decision: 'approved' })).status)
      .toBeGreaterThanOrEqual(400);
    expect((await decide(asReport, id, { decision: 'approved' })).status)
      .toBeGreaterThanOrEqual(400);
  });

  it('will not accept a decline with no reason', async () => {
    const id = (await post(asManager, adjustment())).body.id;
    expect((await decide(asHrAdmin, id, { decision: 'declined' })).status).toBe(400);

    const ok = await decide(asHrAdmin, id, {
      decision: 'declined', note: 'The scorecard already carries the rollout.',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.decisionNote).toContain('scorecard');
  });

  it('will not decide the same request twice', async () => {
    const id = (await post(asManager, adjustment())).body.id;
    expect((await decide(asHrAdmin, id, { decision: 'approved' })).status).toBe(200);
    // Terminal. Otherwise an approval could be quietly reversed by whoever
    // opened the screen last.
    expect((await decide(asHrAdmin, id, { decision: 'declined', note: 'changed my mind' }))
      .status).toBeGreaterThanOrEqual(400);
  });

  it('tells the requester the answer', async () => {
    const id = (await post(asManager, adjustment())).body.id;
    await decide(asHrAdmin, id, { decision: 'approved', note: 'Fine.' });

    const queued = await h.admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM notification_outbox
        WHERE recipient_employee_id = $1 AND template_code = 'request.decided'`,
      [org.manager.id]);
    expect(Number(queued.rows[0]!.n)).toBeGreaterThan(0);
  });

  it('told the approver in the first place', async () => {
    // The half that is easy to forget: without it the request sits in a queue
    // nobody is looking at and the requester chases it in chat, which is the
    // situation this feature exists to replace.
    const queued = await h.admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM notification_outbox
        WHERE recipient_employee_id = $1 AND template_code = 'request.submitted'`,
      [org.hrAdmin.id]);
    expect(Number(queued.rows[0]!.n)).toBeGreaterThan(0);
  });
});

describe('withdrawing', () => {
  it('lets the requester take it back, and that is not a decline', async () => {
    const id = (await post(asManager, adjustment())).body.id;
    const res = await request(h.url)
      .patch(`/requests/${id}/withdrawal`).set(asManager).send({});
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('withdrawn');
    // Distinct from 'declined' on purpose: collapsing them makes "how many of
    // my requests were refused" unanswerable, and that number is the one that
    // says whether the process is working.
    expect(res.body.decidedBy).toBeNull();
  });

  it('does not let somebody else withdraw it', async () => {
    const id = (await post(asManager, adjustment())).body.id;
    const res = await request(h.url)
      .patch(`/requests/${id}/withdrawal`).set(asHrAdmin).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('nothing is applied by approving', () => {
  it('leaves the subject’s records untouched', async () => {
    // D-017, asserted rather than trusted. An approval that quietly moved a
    // score would leave an audit trail in which the score changed by itself.
    const before = await h.admin.query(
      `SELECT count(*) AS n FROM competency_assessment WHERE subject_employee_id = $1`,
      [org.report.id]);

    const id = (await post(asManager, adjustment())).body.id;
    await request(h.url).patch(`/requests/${id}/decision`)
      .set(asHrAdmin).send({ decision: 'approved' });

    const after = await h.admin.query(
      `SELECT count(*) AS n FROM competency_assessment WHERE subject_employee_id = $1`,
      [org.report.id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
