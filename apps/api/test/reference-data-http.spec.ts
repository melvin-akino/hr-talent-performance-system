/**
 * Phase 2: the reference data that could previously only arrive by CSV.
 *
 * The rank ladder had a list endpoint and no create endpoint, which is how
 * GGCHCM ended up with no ranks at all: the only way in was a rank_no column in
 * an import file, and the seed file did not have one. A structure you can only
 * create by re-importing every employee is one that stays empty.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
let asHrAdmin: Record<string, string>;
let asEmployee: Record<string, string>;

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  asHrAdmin = { Authorization: `Bearer ${await h.token(org.hrAdmin.subject)}` };
  asEmployee = { Authorization: `Bearer ${await h.token(org.report.subject)}` };
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe('reference data that could previously only arrive by CSV', () => {
  it('adds a rung to the ladder', async () => {
    const res = await request(h.url).post('/ranks').set(asHrAdmin)
      .send({ code: 'R7', name: 'Section Head', rankNo: 7 });
    expect(res.status).toBe(201);

    const list = await request(h.url).get('/ranks').set(asHrAdmin);
    const codes = list.body.map((r: { code: string }) => r.code);
    expect(codes).toContain('R7');
  });

  it('keeps the ladder ordered most senior first', async () => {
    // Ascending, because 6 outranks 11. Sorting "descending because bigger is
    // better" would invert every picker in the product.
    const list = await request(h.url).get('/ranks').set(asHrAdmin);
    const nos = list.body.map((r: { rankNo: number }) => r.rankNo);
    expect(nos).toEqual([...nos].sort((a: number, b: number) => a - b));
  });

  it('refuses two rungs with the same number', async () => {
    const res = await request(h.url).post('/ranks').set(asHrAdmin)
      .send({ code: 'R7B', name: 'Duplicate', rankNo: 7 });
    expect(res.status).toBe(400);
  });

  it('creates a position', async () => {
    const res = await request(h.url).post('/positions').set(asHrAdmin)
      .send({ title: 'Records Officer', jobFamily: 'Shared Services' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it('refuses an ordinary employee', async () => {
    const res = await request(h.url).post('/ranks').set(asEmployee)
      .send({ code: 'R9', name: 'Nope', rankNo: 9 });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
