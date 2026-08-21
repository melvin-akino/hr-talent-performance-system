/**
 * Who may call what, asserted over HTTP.
 *
 * The RLS suites prove the database denies the wrong people. This proves the
 * API surface does too — a distinction that matters because a route can leak
 * without RLS ever being violated: by returning a 500 that names a record, by
 * accepting an id belonging to someone else and reporting "not found" only
 * after acting on it, or by exposing an admin route with no role check at all.
 *
 * Deny-assertions are the point. A test that only checks the happy path proves
 * the feature works, not that it is protected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  for (const [name, person] of Object.entries({
    report: org.report, manager: org.manager,
    hrAdmin: org.hrAdmin, outsider: org.outsider,
  })) {
    tokens[name] = await h.token(person.subject);
  }
}, 300_000);

afterAll(async () => { await h?.stop(); });

const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

/**
 * 401/403/404 are all legitimate denials; 2xx is not.
 *
 * 400 is deliberately excluded. A validation failure means the request was
 * rejected *before* authorization ran, so it proves nothing about who may do
 * what — and a deny-test that passes because its payload was malformed is worse
 * than no test, because it reads as coverage. Every request below therefore
 * sends a payload the schema accepts.
 */
const denied = (status: number) => status === 401 || status === 403 || status === 404;

/** A payload that passes validation, so the denial under test is the real one. */
const validCycle = (name: string) => ({
  name,
  opensOn: '2026-11-01',
  closesOn: '2026-12-15',
  phases: [
    { phaseType: 'self', opensOn: '2026-11-01', closesOn: '2026-12-15' },
    { phaseType: 'supervisor', opensOn: '2026-11-01', closesOn: '2026-12-15' },
  ],
});

describe('everyone can reach their own record', () => {
  it.each(['report', 'manager', 'hrAdmin', 'outsider'])('%s', async (who) => {
    const res = await request(h.url).get('/employees/me').set(as(who));
    expect(res.status).toBe(200);
  });
});

describe('the caller is told which roles they hold', () => {
  // The interface uses this to decide which navigation groups to render. It is
  // not an authorization boundary — editing it in the browser gains nothing,
  // because every query still runs under the caller's own RLS policies.
  it('reports a plain employee as employee only', async () => {
    const res = await request(h.url).get('/employees/me').set(as('report'));
    expect(res.body.roles).toEqual(['employee']);
  });

  it('reports a manager as both employee and manager', async () => {
    const res = await request(h.url).get('/employees/me').set(as('manager'));
    expect(res.body.roles).toEqual(expect.arrayContaining(['employee', 'manager']));
  });

  it('reports an HR admin as hr_admin', async () => {
    const res = await request(h.url).get('/employees/me').set(as('hrAdmin'));
    expect(res.body.roles).toContain('hr_admin');
  });

  it('does not disclose anyone else‘s roles when listing people', async () => {
    // Knowing who the administrators are is not something a directory listing
    // should hand out. roles is populated by me() alone.
    const res = await request(h.url).get('/employees').set(as('hrAdmin'));
    expect(res.status).toBe(200);
    for (const employee of res.body) {
      expect(employee.roles).toBeUndefined();
    }
  });

  it('does not disclose another person‘s roles when fetching them by id', async () => {
    const res = await request(h.url).get(`/employees/${org.report.id}`).set(as('manager'));
    expect(res.status).toBe(200);
    expect(res.body.roles).toBeUndefined();
  });
});

describe('the employee directory is scoped to what the caller may see', () => {
  it('HR admin sees the whole organisation', async () => {
    const res = await request(h.url).get('/employees').set(as('hrAdmin'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
  });

  it('a manager sees only their own subtree', async () => {
    const res = await request(h.url).get('/employees').set(as('manager'));
    expect(res.status).toBe(200);
    // Mary plus Ricky. Not the CEO above her, not Otto beside her.
    expect(res.body.map((e: { employeeNo: string }) => e.employeeNo).sort())
      .toEqual(['E002', 'E003']);
  });

  it('an individual contributor sees only themselves', async () => {
    const res = await request(h.url).get('/employees').set(as('report'));
    expect(res.status).toBe(200);
    expect(res.body.map((e: { employeeNo: string }) => e.employeeNo)).toEqual(['E003']);
  });

  it('a peer cannot fetch another employee by id', async () => {
    const res = await request(h.url).get(`/employees/${org.manager.id}`).set(as('outsider'));
    expect(denied(res.status)).toBe(true);
  });

  it('a manager can fetch their own report by id', async () => {
    const res = await request(h.url).get(`/employees/${org.report.id}`).set(as('manager'));
    expect(res.status).toBe(200);
  });

  it('a report cannot fetch their manager by id', async () => {
    // Visibility runs downward, not upward.
    const res = await request(h.url).get(`/employees/${org.manager.id}`).set(as('report'));
    expect(denied(res.status)).toBe(true);
  });
});

describe('goals belong to their owner', () => {
  let goalId: string;

  beforeAll(async () => {
    const res = await request(h.url).post('/goals').set(as('report')).send({
      goalPeriodId: org.goalPeriodId,
      employeeId: org.report.id,
      title: 'Ship the thing',
      weight: 100,
      targets: [{
        measureName: 'Delivery', measureType: 'numeric',
        direction: 'higher_is_better', targetValue: 100,
      }],
    });
    expect(res.status).toBeLessThan(300);
    goalId = res.body.id;
  });

  it('the owner can read their goal', async () => {
    const res = await request(h.url).get(`/goals/${goalId}`).set(as('report'));
    expect(res.status).toBe(200);
  });

  it('their manager can read it', async () => {
    const res = await request(h.url).get(`/goals/${goalId}`).set(as('manager'));
    expect(res.status).toBe(200);
  });

  it('an unrelated employee cannot read it', async () => {
    const res = await request(h.url).get(`/goals/${goalId}`).set(as('outsider'));
    expect(denied(res.status)).toBe(true);
  });

  it('an unrelated employee cannot modify it', async () => {
    const res = await request(h.url).patch(`/goals/${goalId}`).set(as('outsider'))
      .send({ title: 'Owned' });
    expect(denied(res.status)).toBe(true);

    const after = await request(h.url).get(`/goals/${goalId}`).set(as('report'));
    expect(after.body.title).toBe('Ship the thing');
  });

  it('an unrelated employee cannot check in on it', async () => {
    const res = await request(h.url).post(`/goals/${goalId}/checkins`).set(as('outsider'))
      .send({ statusFlag: 'on_track', periodEnding: '2026-03-31', comment: 'fine' });
    expect(denied(res.status)).toBe(true);
  });

  it('an employee cannot create a goal for somebody else', async () => {
    const res = await request(h.url).post('/goals').set(as('outsider')).send({
      goalPeriodId: org.goalPeriodId,
      employeeId: org.report.id,          // not the caller
      title: 'Assigned by a stranger',
      weight: 50,
      targets: [{
        measureName: 'Delivery', measureType: 'numeric',
        direction: 'higher_is_better', targetValue: 10,
      }],
    });
    expect(denied(res.status)).toBe(true);
  });
});

describe('administrative routes require the role, not merely a token', () => {
  it('a plain employee sees no review cycles', async () => {
    const res = await request(h.url).get('/review-cycles').set(as('report'));
    if (!denied(res.status)) expect(res.body).toHaveLength(0);
  });

  it('goal periods are readable — they are reference data, not a secret', async () => {
    // An employee must know which period is open to file a goal against it.
    // Asserting emptiness here would be asserting a bug.
    const res = await request(h.url).get('/goal-periods').set(as('report'));
    expect(res.status).toBe(200);
  });

  it('a plain employee cannot create a review cycle', async () => {
    const res = await request(h.url).post('/review-cycles').set(as('report'))
      .send(validCycle('Unauthorised cycle'));
    expect(denied(res.status)).toBe(true);
  });

  it('a manager cannot create a review cycle either', async () => {
    // Managers run their team; they do not open the company's review season.
    const res = await request(h.url).post('/review-cycles').set(as('manager'))
      .send(validCycle('Also unauthorised'));
    expect(denied(res.status)).toBe(true);
  });

  it('an HR admin can', async () => {
    // The positive case belongs next to the negatives: without it, the two
    // tests above would still pass if the route were broken for everybody.
    const res = await request(h.url).post('/review-cycles').set(as('hrAdmin'))
      .send(validCycle('FY2026 Annual Review'));
    expect(res.status).toBeLessThan(300);
  });
});

describe('unknown ids do not behave differently from forbidden ones', () => {
  it('a random goal id is denied the same way a forbidden one is', async () => {
    const random = await request(h.url).get(`/goals/${randomUUID()}`).set(as('outsider'));
    expect(denied(random.status)).toBe(true);
  });

  it('a malformed id is rejected without a server error', async () => {
    // A 500 here would mean an unvalidated parameter reached the database.
    const res = await request(h.url).get('/goals/not-a-uuid').set(as('report'));
    expect(res.status).toBeLessThan(500);
  });
});

describe('every route requires authentication', () => {
  it.each([
    ['get', '/employees/me'],
    ['get', '/employees'],
    ['post', '/goals'],
    ['get', '/review-cycles'],
    ['get', '/employees/me/goals'],
    ['get', '/notifications'],
  ])('%s %s without a token', async (method, path) => {
    const res = await request(h.url)[method as 'get'](path);
    expect(res.status).toBe(401);
  });
});
