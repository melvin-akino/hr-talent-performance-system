/**
 * F0c — the four operations of D-016, over HTTP.
 *
 * THE TEMPORAL PROPERTIES ARE THE TEST.
 *
 * A change that overwrites instead of appending does not fail. It succeeds, and
 * every goal and review pointing at the old department silently re-parents
 * itself, so "which section was this person in when they were rated" quietly
 * changes for every past cycle. Nobody finds that until an appraisal is
 * disputed a year later.
 *
 * So most of this suite reads the employment history back and asserts three
 * things that a naive implementation gets wrong: no gap, no overlap, and the
 * period that was true before the change still says what it said.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedOrg, startHarness, type Harness, type SeededOrg } from './support/http-harness';

let h: Harness;
let org: SeededOrg;
let asHrAdmin: Record<string, string>;
let asEmployee: Record<string, string>;
let deptId: string;
let dept2Id: string;
let typeId: string;

/** The full history, oldest first — what every assertion here reads. */
async function history(employeeId: string) {
  const res = await h.admin.query<{
    effective_from: string; effective_to: string | null;
    event_type: string; department_id: string; status: string;
    change_reason: string | null;
  }>(`SELECT effective_from::text, effective_to::text, event_type,
             department_id, status, change_reason
        FROM employment WHERE employee_id = $1 ORDER BY effective_from`,
     [employeeId]);
  return res.rows;
}

/** Adds somebody and returns their id. */
async function addPerson(no: string, hiredOn = '2024-01-01') {
  const res = await request(h.url).post('/employees').set(asHrAdmin).send({
    employeeNo: no,
    firstName: 'Test',
    lastName: no,
    workEmail: `${no.toLowerCase()}@test.local`,
    hiredOn,
    departmentId: deptId,
    employmentTypeId: typeId,
    status: 'probationary',
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeAll(async () => {
  h = await startHarness();
  org = await seedOrg(h.admin);
  asHrAdmin = { Authorization: `Bearer ${await h.token(org.hrAdmin.subject)}` };
  asEmployee = { Authorization: `Bearer ${await h.token(org.report.subject)}` };

  deptId = (await h.admin.query<{ id: string }>(
    `SELECT id FROM department WHERE org_id = $1 ORDER BY code LIMIT 1`,
    [org.orgId])).rows[0]!.id;
  dept2Id = (await h.admin.query<{ id: string }>(
    `INSERT INTO department (org_id, code, name, unit_type, effective_from)
          VALUES ($1,'ZZ2','Second Unit','department','2020-01-01')
     RETURNING id`, [org.orgId])).rows[0]!.id;
  typeId = (await h.admin.query<{ id: string }>(
    `SELECT id FROM employment_type WHERE org_id = $1 LIMIT 1`,
    [org.orgId])).rows[0]!.id;
}, 300_000);

afterAll(async () => { await h?.stop(); });

describe('adding somebody', () => {
  it('creates the person, their employment and their reporting line at once', async () => {
    const res = await request(h.url).post('/employees').set(asHrAdmin).send({
      employeeNo: 'NEW-001',
      firstName: 'Amihan',
      lastName: 'Reyes',
      workEmail: 'amihan.reyes@test.local',
      hiredOn: '2025-03-01',
      departmentId: deptId,
      employmentTypeId: typeId,
      status: 'probationary',
      supervisorEmployeeId: org.manager.id,
    });
    expect(res.status).toBe(201);

    // All three rows, or none. A person with an employee row and no employment
    // is invisible to every screen that joins through it.
    const rows = await history(res.body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('hire');
    expect(rows[0]!.effective_from).toBe('2025-03-01');
    expect(rows[0]!.effective_to).toBeNull();

    const line = await h.admin.query(
      `SELECT supervisor_employee_id FROM reporting_line
        WHERE employee_id = $1 AND line_type = 'primary'`, [res.body.id]);
    expect(line.rows[0]?.supervisor_employee_id).toBe(org.manager.id);
  });

  it('refuses a duplicate employee number, and says so', async () => {
    const res = await request(h.url).post('/employees').set(asHrAdmin).send({
      employeeNo: 'NEW-001',
      firstName: 'Someone', lastName: 'Else',
      workEmail: 'someone.else@test.local',
      hiredOn: '2025-04-01',
      departmentId: deptId, employmentTypeId: typeId,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already uses that number/i);
  });

  it('refuses an ordinary employee', async () => {
    const res = await request(h.url).post('/employees').set(asEmployee).send({
      employeeNo: 'NOPE-1',
      firstName: 'No', lastName: 'Way',
      workEmail: 'no.way@test.local',
      hiredOn: '2025-01-01',
      departmentId: deptId, employmentTypeId: typeId,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('recording a change', () => {
  it('closes the old period and opens a new one, with no gap and no overlap', async () => {
    // The property the whole design rests on.
    const id = await addPerson('CHG-001', '2024-01-01');

    const res = await request(h.url)
      .post(`/employees/${id}/employment-events`).set(asHrAdmin)
      .send({
        event: 'regularization',
        effectiveFrom: '2024-07-01',
        reason: 'Passed probation',
        status: 'regular',
      });
    expect(res.status).toBe(201);

    const rows = await history(id);
    expect(rows).toHaveLength(2);

    // The old period still says what it said. It was true until July.
    expect(rows[0]!.event_type).toBe('hire');
    expect(rows[0]!.status).toBe('probationary');
    expect(rows[0]!.effective_from).toBe('2024-01-01');
    // No gap and no overlap: one period's end is the next one's start, and
    // effective_to is exclusive.
    expect(rows[0]!.effective_to).toBe('2024-07-01');
    expect(rows[1]!.effective_from).toBe('2024-07-01');
    expect(rows[1]!.effective_to).toBeNull();
    expect(rows[1]!.status).toBe('regular');
    expect(rows[1]!.change_reason).toBe('Passed probation');
  });

  it('carries forward whatever the caller did not restate', async () => {
    // A promotion that changes only the position must not require the caller
    // to repeat the department, or a half-filled form silently moves somebody.
    const id = await addPerson('CHG-002', '2024-01-01');
    const before = (await history(id))[0]!;

    await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'promotion', effectiveFrom: '2025-01-01',
              reason: 'Promoted to Senior' });

    const rows = await history(id);
    expect(rows[1]!.department_id).toBe(before.department_id);
    expect(rows[1]!.status).toBe(before.status);
  });

  it('moves the department when asked, and only then', async () => {
    const id = await addPerson('CHG-003', '2024-01-01');
    await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'lateral_transfer', effectiveFrom: '2024-06-01',
              reason: 'Moved to Second Unit', departmentId: dept2Id });

    const rows = await history(id);
    expect(rows[0]!.department_id).toBe(deptId);   // history unchanged
    expect(rows[1]!.department_id).toBe(dept2Id);
  });

  it('accepts a backdated change, splitting the period it lands in', async () => {
    // HCM routinely learns about a transfer after it happened. This is ordinary
    // effective-dating, not an edge case.
    const id = await addPerson('CHG-004', '2024-01-01');
    await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'promotion', effectiveFrom: '2025-06-01',
              reason: 'Promotion' });

    // Now record something that happened BEFORE the promotion already recorded.
    const res = await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'regularization', effectiveFrom: '2024-07-01',
              reason: 'Regularised, recorded late', status: 'regular' });
    expect(res.status).toBe(201);

    const rows = await history(id);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.effective_from, r.effective_to])).toEqual([
      ['2024-01-01', '2024-07-01'],
      ['2024-07-01', '2025-06-01'],   // the split keeps the far edge
      ['2025-06-01', null],
    ]);
  });

  it('refuses two changes on the same day, and says which', async () => {
    const id = await addPerson('CHG-005', '2024-01-01');
    await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'promotion', effectiveFrom: '2024-06-01', reason: 'One' });

    const res = await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'demotion', effectiveFrom: '2024-06-01', reason: 'Two' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already takes effect on 2024-06-01/);
  });

  it('refuses a date before the person existed', async () => {
    const id = await addPerson('CHG-006', '2024-01-01');
    const res = await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'promotion', effectiveFrom: '2023-01-01', reason: 'Early' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/No employment period covers/);
  });

  it('refuses a change with no reason', async () => {
    const id = await addPerson('CHG-007', '2024-01-01');
    const res = await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'promotion', effectiveFrom: '2024-06-01', reason: '   ' });
    expect(res.status).toBe(400);
  });

  it('will not record a correction as an event', async () => {
    // The distinction D-016 exists to protect. A correction amends a row; it
    // does not append a period that never existed.
    const id = await addPerson('CHG-008', '2024-01-01');
    const res = await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'correction', effectiveFrom: '2024-06-01', reason: 'Typo' });
    expect(res.status).toBe(400);   // rejected by the schema before the DB
  });

  it('moves the reporting line in the same change', async () => {
    // sync-roles derives the supervisor role from reporting lines, so a
    // transfer whose line lands later leaves the old supervisor holding access.
    const id = await addPerson('CHG-009', '2024-01-01');
    await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'lateral_transfer', effectiveFrom: '2024-09-01',
              reason: 'Transfer', departmentId: dept2Id,
              supervisorEmployeeId: org.ceo.id });

    const lines = await h.admin.query<{ supervisor_employee_id: string;
                                        effective_from: string; effective_to: string | null }>(
      `SELECT supervisor_employee_id, effective_from::text, effective_to::text
         FROM reporting_line WHERE employee_id = $1 AND line_type = 'primary'
        ORDER BY effective_from`, [id]);
    expect(lines.rows.at(-1)?.supervisor_employee_id).toBe(org.ceo.id);
    expect(lines.rows.at(-1)?.effective_from).toBe('2024-09-01');
  });
});

describe('correcting', () => {
  it('amends the value and touches no period', async () => {
    const id = await addPerson('COR-001', '2024-01-01');
    await request(h.url).post(`/employees/${id}/employment-events`)
      .set(asHrAdmin)
      .send({ event: 'promotion', effectiveFrom: '2024-06-01', reason: 'P' });

    const before = await history(id);
    const res = await request(h.url).patch(`/employees/${id}`).set(asHrAdmin)
      .send({ lastName: 'Corrected', workEmail: 'corrected@test.local' });
    expect(res.status).toBe(200);

    // The periods are untouched. A correction is not a change.
    expect(await history(id)).toEqual(before);

    const row = await h.admin.query(
      'SELECT last_name, work_email::text FROM employee WHERE id = $1', [id]);
    expect(row.rows[0]?.last_name).toBe('Corrected');
  });

  it('keeps the milestones right after a correction and a second regularisation', async () => {
    // app.employment_milestones() takes the EARLIEST regularisation and the
    // LATEST promotion. Probation extended twice still became regular once.
    const id = await addPerson('COR-002', '2024-01-01');
    for (const [event, from, reason] of [
      ['regularization', '2024-07-01', 'Regularised'],
      ['regularization', '2025-01-01', 'Probation had been extended'],
      ['promotion', '2025-06-01', 'First promotion'],
      ['promotion', '2026-01-01', 'Second promotion'],
    ] as const) {
      const r = await request(h.url).post(`/employees/${id}/employment-events`)
        .set(asHrAdmin).send({ event, effectiveFrom: from, reason });
      expect(r.status).toBe(201);
    }

    await request(h.url).patch(`/employees/${id}`).set(asHrAdmin)
      .send({ hiredOn: '2024-01-15' });

    const m = await h.admin.query<{ hired_on: string; regularized_on: string;
                                    last_promoted_on: string }>(
      `SELECT hired_on::text, regularized_on::text, last_promoted_on::text
         FROM app.employment_milestones($1)`, [id]);
    expect(m.rows[0]).toEqual({
      hired_on: '2024-01-15',          // the correction took
      regularized_on: '2024-07-01',    // the earliest, not the extension
      last_promoted_on: '2026-01-01',  // the latest
    });
  });

  it('refuses an empty correction', async () => {
    const id = await addPerson('COR-003', '2024-01-01');
    const res = await request(h.url).patch(`/employees/${id}`).set(asHrAdmin).send({});
    expect(res.status).toBe(400);
  });
});

describe('ending employment', () => {
  it('reports what would be orphaned before anything is done', async () => {
    const id = await addPerson('SEP-001', '2024-01-01');

    // An unsubmitted review in an open cycle, with them as the subject.
    const cycle = (await h.admin.query<{ id: string }>(
      `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
            VALUES ($1,'SEPCYC','2026-01-01','2026-12-31','open') RETURNING id`,
      [org.orgId])).rows[0]!.id;
    const scale = (await h.admin.query<{ id: string }>(
      `INSERT INTO rating_scale (org_id,code,version,name,published_at)
            VALUES ($1,'SEPS',1,'S',now()) RETURNING id`, [org.orgId])).rows[0]!.id;
    const tpl = (await h.admin.query<{ id: string }>(
      `INSERT INTO form_template (org_id,code,name) VALUES ($1,'SEPF','F')
       RETURNING id`, [org.orgId])).rows[0]!.id;
    const ver = (await h.admin.query<{ id: string }>(
      `INSERT INTO form_version (form_template_id,version,schema_json,
                                 rating_scale_id,published_at,is_active)
            VALUES ($1,1,'{"sections":[]}'::jsonb,$2,now(),TRUE) RETURNING id`,
      [tpl, scale])).rows[0]!.id;
    await h.admin.query(
      `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                    reviewer_employee_id, reviewer_role,
                                    form_version_id, state)
            VALUES ($1,$2,$3,'supervisor',$4,'in_progress')`,
      [cycle, id, org.manager.id, ver]);

    const blockers = await request(h.url)
      .get(`/employees/${id}/separation-blockers`).set(asHrAdmin);
    expect(blockers.status).toBe(200);
    expect(blockers.body.map((b: { kind: string }) => b.kind)).toContain('open_review');

    // And the separation is refused until it is acknowledged.
    const refused = await request(h.url).post(`/employees/${id}/separation`)
      .set(asHrAdmin)
      .send({ separatedOn: '2026-06-30', reason: 'Resigned' });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/would leave work unfinished/);

    // Acknowledged, it goes through — HR sometimes must separate mid-cycle.
    const ok = await request(h.url).post(`/employees/${id}/separation`)
      .set(asHrAdmin)
      .send({ separatedOn: '2026-06-30', reason: 'Resigned',
              acknowledgeBlockers: true });
    expect(ok.status).toBe(201);
  });

  it('closes the period and keeps the person queryable', async () => {
    const id = await addPerson('SEP-002', '2024-01-01');
    const res = await request(h.url).post(`/employees/${id}/separation`)
      .set(asHrAdmin)
      .send({ separatedOn: '2025-12-31', reason: 'End of contract' });
    expect(res.status).toBe(201);

    const rows = await history(id);
    // effective_to is exclusive, so a last day of the 31st closes on the 1st.
    expect(rows.at(-1)?.effective_to).toBe('2026-01-01');

    // Nothing is deleted: past results still reference them, and "why was this
    // decision made" outlives the employment.
    const emp = await h.admin.query<{ status: string; separated_on: string }>(
      'SELECT status, separated_on::text FROM employee WHERE id = $1', [id]);
    expect(emp.rows[0]).toEqual({ status: 'separated', separated_on: '2025-12-31' });
  });

  it('refuses to separate somebody twice', async () => {
    const id = await addPerson('SEP-003', '2024-01-01');
    await request(h.url).post(`/employees/${id}/separation`).set(asHrAdmin)
      .send({ separatedOn: '2025-06-30', reason: 'Left' });

    const again = await request(h.url).post(`/employees/${id}/separation`)
      .set(asHrAdmin).send({ separatedOn: '2025-07-31', reason: 'Left again' });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/no open employment period/i);
  });

  it('refuses an ordinary employee', async () => {
    const id = await addPerson('SEP-004', '2024-01-01');
    const res = await request(h.url).post(`/employees/${id}/separation`)
      .set(asEmployee).send({ separatedOn: '2025-01-01', reason: 'Nope' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
