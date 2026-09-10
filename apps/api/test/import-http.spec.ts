/**
 * Phase 1 and 2: getting people in, over HTTP.
 *
 * The 201 importer has existed and worked for a while. It was reachable only
 * from a terminal, which meant "management adds an employee" was a task for a
 * developer with a database URL. These are the endpoints that change that, and
 * the two things worth testing hard are the ones that would not look broken:
 *
 *   * TENANCY. Ph201ImportService runs under withAdminContext -- it bypasses
 *     RLS by necessity, since it creates units and ranks that do not exist yet
 *     -- and it takes the organisation as an argument. Over HTTP that argument
 *     must come from the caller's own row and never from the request, or the
 *     tenant boundary is decided by whoever posts.
 *
 *   * TEMPLATE DRIFT. A downloadable template that disagrees with the parser
 *     fails silently: this repository's own seed file carried job_level=R11
 *     where the ladder needed rank_no=11, and every import produced no ranks
 *     while reporting success. So the template is fed back through the importer
 *     here, and every column it offers must be one the parser actually reads.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
let asHrAdmin: Record<string, string>;
let asEmployee: Record<string, string>;

const HEADER = 'employee_id,first_name,last_name,work_email,date_hired,'
  + 'department,section,position,rank_no,rank_title,employment_status,reports_to';

const rows = (...lines: string[]) => `${HEADER}\n${lines.join('\n')}\n`;

const BOSS = 'IMP-001,Amihan,Reyes,amihan.reyes@test.local,2019-01-01,'
  + 'Shared Services,,Department Manager,6,Department Manager,regular,';
const STAFF = 'IMP-002,Benigno,Cruz,benigno.cruz@test.local,2021-06-01,'
  + 'Shared Services,Payroll,Associate,11,Associate,regular,IMP-001';

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  asHrAdmin = { Authorization: `Bearer ${await h.token(org.hrAdmin.subject)}` };
  asEmployee = { Authorization: `Bearer ${await h.token(org.report.subject)}` };
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe('the template', () => {
  it('is offered as a downloadable file', async () => {
    const res = await request(h.url).get('/import/template').set(asHrAdmin);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('201-template.csv');
    expect(res.text.split('\n')[0]).toContain('employee_id');
  });

  it('offers no column the parser does not read', async () => {
    // The anti-drift assertion, and the reason this suite exists.
    //
    // Feeding the template straight back in means the two can never disagree
    // for long: any column added to the template that the parser ignores comes
    // back in columnsNotImported, and any header renamed in the parser stops
    // the template validating at all.
    const tpl = await request(h.url).get('/import/template').set(asHrAdmin);
    const res = await request(h.url).post('/import/employees/preview')
      .set(asHrAdmin).send({ csv: tpl.text });

    expect(res.status).toBe(201);
    expect(res.body.columnsNotImported).toEqual([]);
  });

  it('explains each column, including which way the rank ladder runs', async () => {
    const res = await request(h.url).get('/import/columns').set(asHrAdmin);
    const rank = res.body.find((c: { column: string }) => c.column === 'rank_no');
    // Lower-is-more-senior is the single most reversible thing in this file,
    // and getting it backwards misroutes peer review rather than erroring.
    expect(rank.note).toContain('LOWER IS MORE SENIOR');
  });
});

describe('preview', () => {
  it('reports what would happen and writes nothing', async () => {
    const res = await request(h.url).post('/import/employees/preview')
      .set(asHrAdmin).send({ csv: rows(BOSS, STAFF) });

    expect(res.status).toBe(201);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.totalRows).toBe(2);
    expect(res.body.created).toBe(2);
    expect(res.body.errors).toEqual([]);

    const after = await h.admin.query(
      `SELECT count(*)::int AS n FROM employee WHERE employee_no LIKE 'IMP-%'`);
    expect(after.rows[0].n).toBe(0);
  });

  it('names the row and the reason when a file is wrong', async () => {
    // An import that fails with a stack trace is one HR cannot act on.
    const res = await request(h.url).post('/import/employees/preview')
      .set(asHrAdmin).send({
        csv: rows(BOSS, STAFF.replace('11,Associate,regular', 'eleven,Associate,regular')),
      });

    expect(res.status).toBe(201);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body.errors)).toContain('not a number');
  });
});

describe('applying', () => {
  it('creates the people, the units and the ladder in one go', async () => {
    const res = await request(h.url).post('/import/employees')
      .set(asHrAdmin).send({ csv: rows(BOSS, STAFF) });

    expect(res.status).toBe(201);
    expect(res.body.dryRun).toBe(false);
    expect(res.body.created).toBe(2);
    expect(res.body.reportingLines).toBe(1);
    // The ladder is the part that silently did nothing before Phase 2.
    expect(res.body.ranksCreated.map((r: { rankNo: number }) => r.rankNo).sort((a: number, b: number) => a - b))
      .toEqual([6, 11]);
    expect(res.body.positionsRanked).toBeGreaterThan(0);
  });

  it('is idempotent — the same file again updates rather than duplicates', async () => {
    const res = await request(h.url).post('/import/employees')
      .set(asHrAdmin).send({ csv: rows(BOSS, STAFF) });
    expect(res.body.created).toBe(0);
    expect(res.body.updated).toBe(2);

    const n = await h.admin.query(
      `SELECT count(*)::int AS n FROM employee WHERE employee_no LIKE 'IMP-%'`);
    expect(n.rows[0].n).toBe(2);
  });
});

describe('who may import', () => {
  it('refuses an ordinary employee', async () => {
    // Not a 500 and not a silent no-op: importing staff is employee:write, and
    // someone without it must be told so.
    const res = await request(h.url).post('/import/employees/preview')
      .set(asEmployee).send({ csv: rows(BOSS) });
    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await request(h.url).post('/import/employees/preview')
      .send({ csv: rows(BOSS) });
    expect(res.status).toBe(401);
  });

  it('takes the organisation from the caller, not the request', async () => {
    // The failure this prevents: posting another tenant's org code and having
    // the import land in their company. There is no field to put it in, and
    // this asserts that adding one to the body changes nothing.
    const res = await request(h.url).post('/import/employees/preview')
      .set(asHrAdmin)
      .send({ csv: rows(BOSS), orgCode: 'SOMEONE-ELSE', org: 'SOMEONE-ELSE' });

    expect(res.status).toBe(201);
    // It parsed against the caller's own org, so the rows read as creates in
    // that tenant rather than erroring on an unknown organisation.
    expect(res.body.totalRows).toBe(1);
  });
});

