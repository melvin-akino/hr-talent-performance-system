import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 7: analytics.
 *
 * Two properties matter more than the numbers themselves:
 *
 *   1. Aggregates are scoped by RLS. A manager's "distribution" must cover their
 *      subtree and nobody else's, from the same SQL HR runs. If that fails, an
 *      aggregate becomes a way to read rows you cannot read directly.
 *   2. Nobody is silently dropped. An employee with no rating or no potential is
 *      reported as unplaced, because a shrinking population is how a nine-box
 *      quietly lies.
 */

const MIGRATIONS = join(__dirname, '../../../db/migrations');

let container: StartedPostgreSqlContainer;
let admin: Pool;
let app: Pool;
const ids: Record<string, string> = {};

async function as<T extends Record<string, unknown>>(
  employeeId: string | null, sql: string, params: unknown[] = [],
): Promise<T[]> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_employee_id', $1, true)`,
      [employeeId ?? '']);
    const res = await client.query<T>(sql, params);
    await client.query('COMMIT');
    return res.rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('hr').withUsername('postgres').withPassword('postgres').start();
  admin = new Pool({ connectionString: container.getConnectionUri() });
  await admin.query(`
    CREATE ROLE hr_migrator LOGIN BYPASSRLS PASSWORD 'm';
    CREATE ROLE hr_app LOGIN NOBYPASSRLS PASSWORD 'a';
  `);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  app = new Pool({
    connectionString: container.getConnectionUri().replace('postgres:postgres', 'hr_app:a'),
  });

  const who = await app.query<{ user: string; bypass: boolean }>(
    `SELECT current_user AS user, usesuper AS bypass
       FROM pg_user WHERE usename = current_user`);
  if (who.rows[0]?.user !== 'hr_app' || who.rows[0]?.bypass) {
    throw new Error(`Must run as non-superuser hr_app, got '${who.rows[0]?.user}'`);
  }

  await seed();
}, 240_000);

afterAll(async () => {
  await app?.end();
  await admin?.end();
  await container?.stop();
});

async function seed(): Promise<void> {
  ids.org = (await admin.query(
    `INSERT INTO organization (code,name) VALUES ('ACME','Acme') RETURNING id`)).rows[0].id;
  ids.deptEng = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'ENG','Engineering','2020-01-01') RETURNING id`, [ids.org])).rows[0].id;
  ids.deptSales = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'SALES','Sales','2020-01-01') RETURNING id`, [ids.org])).rows[0].id;
  const et = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','R') RETURNING id`,
    [ids.org])).rows[0].id;

  const emp = async (no: string, dept: string) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [ids.org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [ids.org, id, dept, et]);
    return id;
  };

  ids.manager = await emp('manager', ids.deptEng);
  ids.ic1 = await emp('ic1', ids.deptEng);
  ids.ic2 = await emp('ic2', ids.deptEng);
  ids.salesMgr = await emp('salesmgr', ids.deptSales);
  ids.salesIc = await emp('salesic', ids.deptSales);
  ids.hrAdmin = await emp('hradmin', ids.deptEng);

  const line = (child: string, sup: string) => admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [ids.org, child, sup]);
  await line(ids.ic1, ids.manager);
  await line(ids.ic2, ids.manager);
  await line(ids.salesIc, ids.salesMgr);

  await admin.query('SELECT app.seed_baseline_roles($1)', [ids.org]);
  await admin.query('SELECT app.seed_phase3_grants($1)', [ids.org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [ids.org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [ids.org, e, r]);
  const rEmp = await role('employee');
  for (const e of [ids.manager, ids.ic1, ids.ic2, ids.salesMgr, ids.salesIc, ids.hrAdmin]) {
    await assign(e, rEmp);
  }
  await assign(ids.manager, await role('manager'));
  await assign(ids.salesMgr, await role('manager'));
  await assign(ids.hrAdmin, await role('hr_admin'));

  // A 1-5 scale, so bands are 1-2.33 / 2.33-3.67 / 3.67-5.
  ids.scale = (await admin.query(
    `INSERT INTO rating_scale (org_id,code,version,name,published_at)
     VALUES ($1,'STD',1,'Standard',now()) RETURNING id`, [ids.org])).rows[0].id;
  for (let n = 1; n <= 5; n++) {
    await admin.query(
      `INSERT INTO rating_scale_point (rating_scale_id,sequence,value,label)
       VALUES ($1,$2,$3,$4)`, [ids.scale, n, n, `L${n}`]);
  }
  const tpl = (await admin.query(
    `INSERT INTO form_template (org_id,code,name) VALUES ($1,'STD','Std') RETURNING id`,
    [ids.org])).rows[0].id;
  ids.formVersion = (await admin.query(
    `INSERT INTO form_version (form_template_id,version,schema_json,rating_scale_id,
                               published_at,is_active)
     VALUES ($1,1,'{"sections":[]}'::jsonb,$2,now(),TRUE) RETURNING id`,
    [tpl, ids.scale])).rows[0].id;

  ids.cycle = (await admin.query(
    `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
     VALUES ($1,'FY2026','2026-01-01','2026-03-31','open') RETURNING id`,
    [ids.org])).rows[0].id;

  /** Summary + a submitted supervisor instance carrying the reviewer's rating. */
  const record = async (
    subject: string, reviewer: string,
    overall: number | null, calibrated: number | null, potential: number | null,
  ) => {
    const s = (await admin.query<{ id: string }>(
      `INSERT INTO review_summary (review_cycle_id,subject_employee_id,
                                   overall_rating,calibrated_rating,potential_rating)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [ids.cycle, subject, overall, calibrated, potential])).rows[0].id;
    await admin.query(
      `INSERT INTO review_instance (review_cycle_id,subject_employee_id,
                                    reviewer_employee_id,reviewer_role,form_version_id,
                                    state,overall_rating,submitted_at)
       VALUES ($1,$2,$3,'supervisor',$4,'submitted',$5,now())`,
      [ids.cycle, subject, reviewer, ids.formVersion, overall]);
    return s;
  };

  // Engineering: a generous rater. Sales: a harsh one.
  ids.sumIc1 = await record(ids.ic1, ids.manager, 5, null, 3);
  ids.sumIc2 = await record(ids.ic2, ids.manager, 4, 3, 2);      // calibrated down
  ids.sumSalesIc = await record(ids.salesIc, ids.salesMgr, 2, null, 1);
  // No rating at all — must be reported as unplaced, not dropped.
  ids.sumMgr = (await admin.query<{ id: string }>(
    `INSERT INTO review_summary (review_cycle_id,subject_employee_id)
     VALUES ($1,$2) RETURNING id`, [ids.cycle, ids.manager])).rows[0].id;
}

// ---------------------------------------------------------------------------

describe('rating distribution', () => {
  it('reports the spread per department with percentages', async () => {
    const rows = await admin.query<{
      department: string; rating: string; employee_count: string; pct_of_group: string;
    }>(`SELECT * FROM app.rating_distribution($1)`, [ids.cycle]);

    const eng = rows.rows.filter((r) => r.department === 'Engineering');
    // ic1 = 5, ic2 calibrated to 3. The manager has no rating and is excluded.
    expect(eng.map((r) => Number(r.rating)).sort()).toEqual([3, 5]);
    expect(eng.every((r) => Number(r.pct_of_group) === 50)).toBe(true);
  });

  it('uses the calibrated rating where one exists', async () => {
    const rows = await admin.query<{ rating: string }>(
      `SELECT * FROM app.rating_distribution($1) WHERE department='Engineering'`,
      [ids.cycle]);
    // ic2's original 4 was calibrated to 3, so 4 must not appear.
    expect(rows.rows.map((r) => Number(r.rating))).not.toContain(4);
  });

  it('derives bands from the cycle\'s own scale, not a hardcoded 1-5', async () => {
    const range = await admin.query<{ min_value: string; max_value: string }>(
      `SELECT * FROM app.cycle_rating_range($1)`, [ids.cycle]);
    expect(Number(range.rows[0].min_value)).toBe(1);
    expect(Number(range.rows[0].max_value)).toBe(5);
  });
});

describe('calibration movement', () => {
  it('reports only ratings calibration actually changed', async () => {
    // Run as HR. app.display_name() is tenant-scoped and returns NULL without
    // an identity — correct behaviour, and a reminder that analytics must be
    // exercised the way the application actually calls them.
    const rows = await as<{ employee_name: string; movement: string }>(
      ids.hrAdmin, `SELECT * FROM app.calibration_movement($1)`, [ids.cycle]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.employee_name).toBe('ic2 X');
    expect(Number(rows[0]!.movement)).toBe(-1);
  });

  it('is empty when calibration moved nobody', async () => {
    const cycle = (await admin.query<{ id: string }>(
      `INSERT INTO review_cycle (org_id,name,opens_on,closes_on)
       VALUES ($1,'Quiet','2026-04-01','2026-06-30') RETURNING id`,
      [ids.org])).rows[0].id;
    await admin.query(
      `INSERT INTO review_summary (review_cycle_id,subject_employee_id,
                                   overall_rating,calibrated_rating)
       VALUES ($1,$2,4,4)`, [cycle, ids.ic1]);
    const rows = await admin.query(`SELECT * FROM app.calibration_movement($1)`, [cycle]);
    expect(rows.rowCount).toBe(0);
  });
});

describe('rater comparison', () => {
  it('surfaces how far each reviewer sits from the group average', async () => {
    const rows = await as<{
      reviewer_name: string; average_rating: string; group_average: string;
      deviation: string; reviews_submitted: string;
    }>(ids.hrAdmin, `SELECT * FROM app.rater_comparison($1)`, [ids.cycle]);

    // manager rated 5 and 4 (avg 4.5); salesMgr rated 2. Group avg = 3.67.
    const mgr = rows.find((r) => r.reviewer_name === 'manager X')!;
    const sales = rows.find((r) => r.reviewer_name === 'salesmgr X')!;
    expect(Number(mgr.average_rating)).toBe(4.5);
    expect(Number(sales.average_rating)).toBe(2);
    expect(Number(mgr.deviation)).toBeGreaterThan(0);
    expect(Number(sales.deviation)).toBeLessThan(0);
  });

  it('reports the review count, because an average over one person is not evidence', async () => {
    const rows = await as<{ reviewer_name: string; reviews_submitted: string }>(
      ids.hrAdmin, `SELECT * FROM app.rater_comparison($1)`, [ids.cycle]);
    expect(Number(rows.find((r) => r.reviewer_name === 'manager X')!.reviews_submitted))
      .toBe(2);
  });
});

describe('nine-box', () => {
  it('bands performance against the scale range', async () => {
    const rows = await as<{
      employee_name: string; rating: string | null;
      performance_band: number | null; potential_band: number | null;
    }>(ids.hrAdmin, `SELECT * FROM app.nine_box($1)`, [ids.cycle]);

    const byName = (n: string) => rows.find((r) => r.employee_name === n)!;
    // 1-5 scale: thirds at 2.33 and 3.67.
    expect(byName('ic1 X').performance_band).toBe(3);      // 5
    expect(byName('ic2 X').performance_band).toBe(2);      // calibrated 3
    expect(byName('salesic X').performance_band).toBe(1);  // 2
  });

  it('reports employees with no rating rather than dropping them', async () => {
    const rows = await as<{
      employee_name: string; performance_band: number | null;
    }>(ids.hrAdmin, `SELECT * FROM app.nine_box($1)`, [ids.cycle]);
    const mgr = rows.find((r) => r.employee_name === 'manager X');
    // A shrinking population is how a nine-box quietly lies.
    expect(mgr).toBeDefined();
    expect(mgr!.performance_band).toBeNull();
  });

  it('never infers potential from performance', async () => {
    const rows = await as<{
      employee_name: string; performance_band: number; potential_band: number | null;
    }>(ids.hrAdmin, `SELECT * FROM app.nine_box($1)`, [ids.cycle]);
    const ic2 = rows.find((r) => r.employee_name === 'ic2 X')!;
    // Middling performance, explicitly recorded potential of 2 — the two axes
    // are independent, which is the only reason the grid tells you anything.
    expect(ic2.performance_band).toBe(2);
    expect(ic2.potential_band).toBe(2);

    const ic1 = rows.find((r) => r.employee_name === 'ic1 X')!;
    expect(ic1.performance_band).toBe(3);
    expect(ic1.potential_band).toBe(3);
  });

  it('rejects a potential rating outside 1-3', async () => {
    await expect(
      admin.query(`UPDATE review_summary SET potential_rating=7 WHERE id=$1`,
        [ids.sumIc1]),
    ).rejects.toThrow();
  });

  it('freezes potential at sign-off, like the ratings beside it', async () => {
    await admin.query(
      `UPDATE review_summary SET signed_off_by=$2, signed_off_at=now() WHERE id=$1`,
      [ids.sumSalesIc, ids.salesMgr]);
    await expect(
      admin.query(`UPDATE review_summary SET potential_rating=3 WHERE id=$1`,
        [ids.sumSalesIc]),
    ).rejects.toThrow(/signed off and its ratings are final/);
  });
});

describe('analytics are scoped by RLS', () => {
  it('a manager sees only their own subtree in the distribution', async () => {
    const rows = await as<{ department: string }>(ids.manager,
      `SELECT * FROM app.rating_distribution($1)`, [ids.cycle]);
    // Engineering only — Sales is invisible to them, so it cannot appear in an
    // aggregate either.
    expect(rows.every((r) => r.department === 'Engineering')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('a manager cannot see another manager\'s rater statistics', async () => {
    const rows = await as<{ reviewer_name: string }>(ids.manager,
      `SELECT * FROM app.rater_comparison($1)`, [ids.cycle]);
    expect(rows.some((r) => r.reviewer_name === 'salesmgr X')).toBe(false);
  });

  it('an IC sees nothing in the cross-employee analytics', async () => {
    expect(await as(ids.ic1, `SELECT * FROM app.rating_distribution($1)`, [ids.cycle]))
      .toEqual([]);
    expect(await as(ids.ic1, `SELECT * FROM app.nine_box($1)`, [ids.cycle]))
      .toEqual([]);
  });

  it('HR sees every department', async () => {
    const rows = await as<{ department: string }>(ids.hrAdmin,
      `SELECT * FROM app.rating_distribution($1)`, [ids.cycle]);
    const departments = new Set(rows.map((r) => r.department));
    expect(departments.has('Engineering')).toBe(true);
    expect(departments.has('Sales')).toBe(true);
  });

  it('an unreleased rating stays invisible to its subject', async () => {
    // The release rule from Phase 3 must survive being aggregated over.
    const rows = await as(ids.ic1, `SELECT * FROM app.performance_trend($1)`, [ids.ic1]);
    expect(rows).toEqual([]);
  });

  it('a released rating appears in the subject\'s own trend', async () => {
    await admin.query(
      `UPDATE review_summary SET released_at=now() WHERE id=$1`, [ids.sumIc1]);
    const rows = await as<{ rating: string }>(ids.ic1,
      `SELECT * FROM app.performance_trend($1)`, [ids.ic1]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.rating)).toBe(5);
  });
});

describe('cycle progress', () => {
  it('reports the completion funnel', async () => {
    const rows = await admin.query<{
      subjects: string; instances: string; submitted: string; signed_off: string;
    }>(`SELECT * FROM app.cycle_progress($1)`, [ids.cycle]);
    const p = rows.rows[0];
    expect(Number(p.subjects)).toBe(4);
    expect(Number(p.instances)).toBe(3);
    expect(Number(p.submitted)).toBe(3);
    expect(Number(p.signed_off)).toBe(1);
  });
});
