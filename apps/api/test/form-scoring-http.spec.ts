/**
 * Scored forms, through the real HTTP path.
 *
 * `form-scoring.spec.ts` proves the arithmetic; this proves it is actually
 * WIRED. The two failures are different: a rule that is right but never called
 * looks identical to one that works, and the form templates in this system are
 * written through the API, not by hand in SQL.
 *
 * So these go in over HTTP, as an HR administrator, and assert the refusal
 * reaches the caller as a 400 with a message they can act on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
let asHrAdmin: Record<string, string>;

const section = (fields: unknown[]) => ({
  key: 'part1', title: 'Performance', fields,
});

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  asHrAdmin = { Authorization: `Bearer ${await h.token(org.hrAdmin.subject)}` };
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe('publishing a scored form', () => {
  it('accepts a template whose columns both total the stated maximum', async () => {
    const res = await request(h.url).post('/form-templates').set(asHrAdmin).send({
      code: 'SCORED',
      name: 'Scored Review',
      schema: {
        scoring: { maxPoints: 100, classifications: ['technical', 'admin'] },
        sections: [section([
          { key: 'mastery', label: 'Mastery', type: 'rating',
            points: { technical: 70, admin: 60 } },
          { key: 'attendance', label: 'Attendance', type: 'rating',
            points: { technical: 30, admin: 40 } },
        ])],
      },
    });

    expect(res.status).toBe(201);
  });

  it('refuses one that does not add up, and says which column is wrong', async () => {
    const res = await request(h.url).post('/form-templates').set(asHrAdmin).send({
      code: 'BROKEN',
      name: 'Does Not Add Up',
      schema: {
        scoring: { maxPoints: 100, classifications: ['technical', 'admin'] },
        sections: [section([
          { key: 'mastery', label: 'Mastery', type: 'rating',
            points: { technical: 70, admin: 60 } },
          { key: 'attendance', label: 'Attendance', type: 'rating',
            points: { technical: 30, admin: 35 } },
        ])],
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/admin totals 95/);
  });

  it('leaves nothing behind when it refuses', async () => {
    // The validation runs inside the transaction, so a rejected template must
    // not exist. A half-created template with no usable version is worse than a
    // clean refusal, because the code is then taken.
    const rows = await h.admin.query(
      `SELECT id FROM form_template WHERE code = 'BROKEN'`);
    expect(rows.rows).toEqual([]);
  });

  it('still accepts an unscored form, which is every form built before this', async () => {
    const res = await request(h.url).post('/form-templates').set(asHrAdmin).send({
      code: 'PLAIN',
      name: 'Commentary Only',
      schema: {
        sections: [section([
          { key: 'comments', label: 'Comments', type: 'textarea', required: true },
        ])],
      },
    });

    expect(res.status).toBe(201);
  });

  it('refuses points on a field whose answer is stored elsewhere', async () => {
    // goal_review writes nothing to form_response, so points on it could never
    // be scored — and would fail silently rather than loudly.
    const res = await request(h.url).post('/form-templates').set(asHrAdmin).send({
      code: 'UNSCOREABLE',
      name: 'Points On Goals',
      schema: {
        scoring: { maxPoints: 100 },
        sections: [section([
          { key: 'goals', label: 'Goals', type: 'goal_review', points: 100 },
        ])],
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot carry points/);
  });
});
