import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Admin CRUD for reference data.
 *
 * The interesting tests are the refusals. CRUD on reference data is where an
 * admin can quietly break historical queries — closing a department people are
 * still in, deactivating an employment type in use, or creating a second live
 * row with the same code so imports resolve nondeterministically.
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
  ids.deptOps = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'OPS','Operations','2020-01-01') RETURNING id`, [ids.org])).rows[0].id;
  ids.deptEmpty = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'TEMP','Temporary Unit','2020-01-01') RETURNING id`, [ids.org])).rows[0].id;

  ids.typeReg = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','Regular')
     RETURNING id`, [ids.org])).rows[0].id;
  ids.typeUnused = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'SEAS','Seasonal')
     RETURNING id`, [ids.org])).rows[0].id;

  const emp = async (no: string) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [ids.org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`,
      [ids.org, id, ids.deptOps, ids.typeReg]);
    return id;
  };

  ids.hrAdmin = await emp('admin');
  ids.ic = await emp('ic');

  await admin.query('SELECT app.seed_baseline_roles($1)', [ids.org]);
  await admin.query('SELECT app.seed_reference_admin_grants($1)', [ids.org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [ids.org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [ids.org, e, r]);
  await assign(ids.hrAdmin, await role('hr_admin'));
  await assign(ids.ic, await role('employee'));
}

// ---------------------------------------------------------------------------

describe('department CRUD', () => {
  it('an HR admin can create a department', async () => {
    const rows = await as<{ id: string }>(ids.hrAdmin,
      `INSERT INTO department (org_id,code,name,effective_from)
       VALUES ($1,'FIN','Finance',CURRENT_DATE) RETURNING id`, [ids.org]);
    expect(rows).toHaveLength(1);
    ids.deptFin = rows[0]!.id;
  });

  it('an HR admin can correct a code the importer derived', async () => {
    // The whole point of the CRUD: import guesses OPS, HR may prefer OPRS.
    const rows = await as<{ code: string }>(ids.hrAdmin,
      `UPDATE department SET code='OPRS' WHERE id=$1 RETURNING code`, [ids.deptOps]);
    expect(rows[0]!.code).toBe('OPRS');
    await admin.query(`UPDATE department SET code='OPS' WHERE id=$1`, [ids.deptOps]);
  });

  it('a plain employee cannot create or rename a department', async () => {
    await expect(
      as(ids.ic, `INSERT INTO department (org_id,code,name,effective_from)
                  VALUES ($1,'X','Sneaky',CURRENT_DATE)`, [ids.org]),
    ).rejects.toThrow(/row-level security/i);

    const updated = await as(ids.ic,
      `UPDATE department SET name='Renamed' WHERE id=$1 RETURNING id`, [ids.deptOps]);
    expect(updated).toEqual([]);
  });

  it('refuses a second ACTIVE department with the same code', async () => {
    await expect(
      admin.query(`INSERT INTO department (org_id,code,name,effective_from)
                   VALUES ($1,'OPS','Operations Duplicate','2021-01-01')`, [ids.org]),
    ).rejects.toThrow(/department_current_code_uq/);
  });

  it('permits reusing a code once the old department is closed', async () => {
    const old = (await admin.query(
      `INSERT INTO department (org_id,code,name,effective_from,effective_to)
       VALUES ($1,'OLD','Old Unit','2018-01-01','2019-01-01') RETURNING id`,
      [ids.org])).rows[0].id;
    expect(old).toBeTruthy();
    // A new live department may take the retired code.
    const fresh = await admin.query(
      `INSERT INTO department (org_id,code,name,effective_from)
       VALUES ($1,'OLD','Old Unit Revived','2020-01-01') RETURNING id`, [ids.org]);
    expect(fresh.rowCount).toBe(1);
  });
});

/**
 * Org unit levels (migration 0027).
 *
 * The rule is narrow on purpose: it rejects INVERSION — a division inside a
 * branch — and permits everything else. Two shapes that look wrong but are not:
 * a department inside a department, which is how the client's HCM sections were
 * loaded before the level existed, and a branch directly under a division with
 * no area between, which is normal when a division runs branches itself.
 *
 * A stricter "each level must be exactly one below its parent" rule would fail
 * on real data the day it shipped.
 */
describe('org unit levels', () => {
  it('defaults to department, so rows predating the level keep their meaning', async () => {
    const rows = await as<{ unit_type: string }>(ids.hrAdmin,
      `INSERT INTO department (org_id,code,name,effective_from)
       VALUES ($1,'DEFLT','Defaulted',CURRENT_DATE) RETURNING unit_type`, [ids.org]);
    expect(rows[0]!.unit_type).toBe('department');
  });

  it('accepts a branch inside a division, skipping the levels between', async () => {
    const div = (await admin.query(
      `INSERT INTO department (org_id,code,name,unit_type,effective_from)
       VALUES ($1,'MCDIV','Motorcycle Division','division',CURRENT_DATE) RETURNING id`,
      [ids.org])).rows[0].id;
    const branch = await admin.query(
      `INSERT INTO department (org_id,code,name,unit_type,parent_department_id,effective_from)
       VALUES ($1,'BR01','Dagupan Branch','branch',$2,CURRENT_DATE) RETURNING id`,
      [ids.org, div]);
    expect(branch.rowCount).toBe(1);
    ids.divMc = div;
  });

  it('accepts a department nested in a department', async () => {
    // The client's HCM sections arrived this way, and they are not wrong.
    const parent = (await admin.query(
      `INSERT INTO department (org_id,code,name,unit_type,effective_from)
       VALUES ($1,'HCMX','Human Capital','department',CURRENT_DATE) RETURNING id`,
      [ids.org])).rows[0].id;
    const child = await admin.query(
      `INSERT INTO department (org_id,code,name,unit_type,parent_department_id,effective_from)
       VALUES ($1,'HSX','Hiring & Selection','department',$2,CURRENT_DATE) RETURNING id`,
      [ids.org, parent]);
    expect(child.rowCount).toBe(1);
  });

  it('rejects a division inside a branch, and says which is which', async () => {
    const branch = (await admin.query(
      `INSERT INTO department (org_id,code,name,unit_type,effective_from)
       VALUES ($1,'BR02','Urdaneta Branch','branch',CURRENT_DATE) RETURNING id`,
      [ids.org])).rows[0].id;

    await expect(
      admin.query(
        `INSERT INTO department (org_id,code,name,unit_type,parent_department_id,effective_from)
         VALUES ($1,'BADDIV','Inverted','division',$2,CURRENT_DATE)`, [ids.org, branch]),
    ).rejects.toThrow(/cannot sit inside branch/);
  });

  it('rejects inversion introduced by an UPDATE, not only on insert', async () => {
    // Moving a node under a deeper parent is the same mistake arriving later.
    const area = (await admin.query(
      `INSERT INTO department (org_id,code,name,unit_type,effective_from)
       VALUES ($1,'AR01','Area R1-C','area',CURRENT_DATE) RETURNING id`,
      [ids.org])).rows[0].id;
    const group = (await admin.query(
      `INSERT INTO department (org_id,code,name,unit_type,effective_from)
       VALUES ($1,'GRP1','Automotive Group','group',CURRENT_DATE) RETURNING id`,
      [ids.org])).rows[0].id;

    await expect(
      admin.query(`UPDATE department SET parent_department_id=$2 WHERE id=$1`,
        [group, area]),
    ).rejects.toThrow(/cannot sit inside area/);
  });

  it('treats area and section as the same depth', async () => {
    // Siblings in depth, different in kind: back office versus branch network.
    const depth = await admin.query<{ a: number; s: number }>(
      `SELECT app.org_unit_depth('area') AS a, app.org_unit_depth('section') AS s`);
    expect(depth.rows[0]!.a).toBe(depth.rows[0]!.s);
  });
});

/**
 * The rank ladder (migration 0028).
 *
 * The direction is the whole risk here: the client numbers ranks so that a
 * LOWER number is MORE senior. Every rule they wrote is phrased as "1 rank
 * higher", "up to 2 ranks above", so the tests are phrased that way too — if
 * app.ranks_above() ever inverts, these fail rather than silently inviting the
 * wrong people to evaluate someone.
 */
describe('rank ladder', () => {
  it('orders the ladder with the lower number more senior', async () => {
    for (const [code, name, no] of [
      ['R6', 'Department Manager', 6], ['R7', 'Assistant Department Manager', 7],
      ['R10', 'Junior Supervisor', 10], ['R11', 'Team Leader / Associate', 11],
    ] as const) {
      await admin.query(
        `INSERT INTO job_rank (org_id, code, name, rank_no) VALUES ($1,$2,$3,$4)`,
        [ids.org, code, name, no]);
    }
    const rows = await admin.query<{ code: string }>(
      `SELECT code FROM job_rank WHERE org_id=$1 ORDER BY rank_no`, [ids.org]);
    expect(rows.rows.map((r) => r.code)).toEqual(['R6', 'R7', 'R10', 'R11']);
  });

  it('answers "how many ranks above" in the direction the rules are written', async () => {
    const q = async (subject: number, other: number) =>
      Number((await admin.query<{ n: number }>(
        `SELECT app.ranks_above($1::smallint,$2::smallint) AS n`, [subject, other]))
        .rows[0]!.n);

    // An Associate (11) and a Junior Supervisor (10): the supervisor is 1 above.
    expect(await q(11, 10)).toBe(1);
    // Two ranks above an Associate is rank 9.
    expect(await q(11, 9)).toBe(2);
    // Same rank is zero, in both directions.
    expect(await q(11, 11)).toBe(0);
    // A Department Manager looking at an Associate: the Associate is below.
    expect(await q(6, 11)).toBe(-5);
  });

  it('refuses two rungs on the same number', async () => {
    // "One rank above" has no answer if two ranks share a number.
    await expect(
      admin.query(
        `INSERT INTO job_rank (org_id, code, name, rank_no) VALUES ($1,'R11B','Duplicate',11)`,
        [ids.org]),
    ).rejects.toThrow(/job_rank_org_id_rank_no_key/);
  });

  it('lets a position be unranked', async () => {
    // Normal for a tenant with no ladder, and for positions outside it.
    const rows = await admin.query<{ rank_id: string | null }>(
      `INSERT INTO position (org_id, title) VALUES ($1,'Unranked Role') RETURNING rank_id`,
      [ids.org]);
    expect(rows.rows[0]!.rank_id).toBeNull();
  });

  it('a plain employee can read the ladder but not change it', async () => {
    // Reading is necessary: an employee should see what rank their role is.
    const visible = await as(ids.ic, `SELECT id FROM job_rank`);
    expect(visible.length).toBeGreaterThan(0);

    await expect(
      as(ids.ic, `INSERT INTO job_rank (org_id, code, name, rank_no)
                  VALUES ($1,'R99','Invented',99)`, [ids.org]),
    ).rejects.toThrow(/row-level security/i);
  });
});

/**
 * Employment milestones (migration 0029).
 *
 * The dates are read from history rather than stored beside it, so these build
 * a real career — and a real career has to respect `employment_no_overlap`:
 * nobody holds two employments at once, so each row is closed as the next
 * begins. Writing the test the lazy way (several open-ended rows) is rejected by
 * the database, which is the constraint doing its job.
 *
 * The two orderings that could plausibly be written backwards are asserted
 * explicitly: regularisation takes the EARLIEST such event, because extended
 * probation produces more than one, and promotion takes the LATEST, because
 * "date promoted" means the most recent.
 */
describe('employment milestones', () => {
  let person: string;

  const milestones = async (id: string) => (await admin.query<{
    hired_on: string | null; regularized_on: string | null; last_promoted_on: string | null;
  }>(`SELECT (m.hired_on)::text, (m.regularized_on)::text, (m.last_promoted_on)::text
        FROM app.employment_milestones($1) m`, [id])).rows[0]!;

  /** Closes the open row and opens a new one — how a career actually moves. */
  const move = async (employee: string, on: string, event: string) => {
    await admin.query(
      `UPDATE employment SET effective_to = $2
        WHERE employee_id = $1 AND effective_to IS NULL`, [employee, on]);
    await admin.query(
      `INSERT INTO employment (org_id, employee_id, department_id, employment_type_id,
                               status, effective_from, event_type)
       VALUES ($1,$2,$3,$4,'regular',$5,$6::employment_event)`,
      [ids.org, employee, ids.deptOps, ids.typeReg, on, event]);
  };

  it('reports only a hire date for someone freshly imported', async () => {
    person = (await admin.query<{ id: string }>(
      `INSERT INTO employee (org_id, employee_no, first_name, last_name, work_email, hired_on)
       VALUES ($1,'MS-001','Milestone','Subject','ms1@example.test','2020-03-02')
       RETURNING id`, [ids.org])).rows[0]!.id;
    await admin.query(
      `INSERT INTO employment (org_id, employee_id, department_id,
                               employment_type_id, status, effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-03-02')`,
      [ids.org, person, ids.deptOps, ids.typeReg]);

    const m = await milestones(person);
    expect(m.hired_on).toBe('2020-03-02');
    expect(m.regularized_on).toBeNull();
    expect(m.last_promoted_on).toBeNull();
  });

  it('takes the EARLIEST regularisation, so extended probation does not move it', async () => {
    // Two regularisation events is not a data error: probation was extended and
    // then closed. The date they became regular is the first one.
    await move(person, '2020-09-02', 'regularization');
    await move(person, '2020-12-02', 'regularization');

    expect((await milestones(person)).regularized_on).toBe('2020-09-02');
  });

  it('takes the LATEST promotion, because that is what the date means', async () => {
    await move(person, '2022-01-15', 'promotion');
    await move(person, '2024-06-01', 'promotion');

    const m = await milestones(person);
    expect(m.last_promoted_on).toBe('2024-06-01');
    // Both promotions remain in the history; only the summary picks one.
    const all = await admin.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM employment
        WHERE employee_id=$1 AND event_type='promotion'`, [person]);
    expect(all.rows[0]!.c).toBe(2);

    // And the earlier dates are untouched by the later moves.
    expect(m.hired_on).toBe('2020-03-02');
    expect(m.regularized_on).toBe('2020-09-02');
  });

  it('refuses two employments at once, which is what keeps the history readable', async () => {
    // Asserting the premise the rest of this block relies on: if overlapping
    // rows were allowed, "the earliest regularisation" would stop being
    // well-defined and these tests would pass while meaning nothing.
    await expect(
      admin.query(
        `INSERT INTO employment (org_id, employee_id, department_id, employment_type_id,
                                 status, effective_from, event_type)
         VALUES ($1,$2,$3,$4,'regular','2025-01-01','promotion')`,
        [ids.org, person, ids.deptOps, ids.typeReg]),
    ).rejects.toThrow(/employment_no_overlap/);
  });

  it('defaults existing rows to hire, which is what they are', async () => {
    const rows = await admin.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM employment WHERE event_type = 'hire'`);
    expect(rows.rows[0]!.c).toBeGreaterThan(0);
  });
});

/**
 * Line roles (migration 0030).
 *
 * The point of this block is that an AREA HEAD needed no new authorization
 * machinery. An area is a department row with unit_type='area' (0027), and
 * `scope_type='department'` already resolves the subtree beneath whichever node
 * the role assignment names — so "Area Head over R1-C" is an existing scope
 * pointed at an area, and can_access() was not touched.
 *
 * If that claim is wrong, these fail. That is why the negative case matters as
 * much as the positive one: a scope that returns everything would pass the first
 * assertion and fail the second.
 */
describe('line roles', () => {
  let areaHead: string;
  let inArea: string;
  let outsideArea: string;

  it('an area head sees the people beneath their area', async () => {
    await admin.query('SELECT app.seed_line_role_grants($1)', [ids.org]);

    const area = (await admin.query<{ id: string }>(
      `INSERT INTO department (org_id,code,name,unit_type,effective_from)
       VALUES ($1,'R1C','Area R1-C','area','2020-01-01') RETURNING id`,
      [ids.org])).rows[0]!.id;
    const branch = (await admin.query<{ id: string }>(
      `INSERT INTO department (org_id,code,name,unit_type,parent_department_id,effective_from)
       VALUES ($1,'BRDAG','Dagupan Branch','branch',$2,'2020-01-01') RETURNING id`,
      [ids.org, area])).rows[0]!.id;

    const person = async (no: string, dept: string) => {
      const id = (await admin.query<{ id: string }>(
        `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
         VALUES ($1,$2,$2,'Person','2020-01-01') RETURNING id`,
        [ids.org, no])).rows[0]!.id;
      await admin.query(
        `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                                 status,effective_from)
         VALUES ($1,$2,$3,$4,'regular','2020-01-01')`,
        [ids.org, id, dept, ids.typeReg]);
      return id;
    };

    areaHead = await person('AH-1', area);
    inArea = await person('BR-1', branch);          // one level below the area
    outsideArea = await person('OPS-9', ids.deptOps); // a different part of the org

    const roleId = (await admin.query<{ id: string }>(
      `SELECT id FROM app_role WHERE org_id=$1 AND code='area_head'`, [ids.org])).rows[0]!.id;
    await admin.query(
      `INSERT INTO role_assignment (org_id,employee_id,role_id,scope_department_id,effective_from)
       VALUES ($1,$2,$3,$4,'2020-01-01')`, [ids.org, areaHead, roleId, area]);

    const visible = await as<{ id: string }>(areaHead,
      `SELECT id FROM employee WHERE id = $1`, [inArea]);
    expect(visible).toHaveLength(1);
  });

  it('and not the people outside it', async () => {
    // The half that proves the scope is a scope. An area head reading the whole
    // organisation would satisfy the test above just as well.
    const visible = await as<{ id: string }>(areaHead,
      `SELECT id FROM employee WHERE id = $1`, [outsideArea]);
    expect(visible).toEqual([]);
  });

  it('defines the line roles without granting them to anybody', async () => {
    // Defining a role must not confer it. These arrive with every tenant and
    // stay unassigned until the customer decides who holds them (Q6 is open on
    // exactly that).
    const rows = await admin.query<{ code: string; holders: number }>(
      `SELECT r.code, count(ra.*)::int AS holders
         FROM app_role r
         LEFT JOIN role_assignment ra ON ra.role_id = r.id
        WHERE r.org_id = $1 AND r.code IN ('dept_head','gm','scoring_admin')
        GROUP BY r.code ORDER BY r.code`, [ids.org]);
    expect(rows.rows.map((r) => r.code)).toEqual(['dept_head', 'gm', 'scoring_admin']);
    for (const r of rows.rows) expect(Number(r.holders)).toBe(0);
  });

  it('does not add a supervisor role, because that is `manager`', async () => {
    // manager is derived from the reporting lines by sync-roles. A parallel
    // hand-assigned supervisor role would drift from the org chart and leave two
    // answers to "is this person someone's boss".
    const rows = await admin.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM app_role WHERE org_id=$1 AND code='supervisor'`,
      [ids.org]);
    expect(rows.rows[0]!.c).toBe(0);
  });

  it('gives the scoring administrator no access to employee data', async () => {
    // It exists to set how scores are computed, not to read anyone's score.
    const rows = await admin.query<{ c: number }>(
      `SELECT count(*)::int AS c
         FROM access_grant ag JOIN app_role r ON r.id = ag.role_id
        WHERE r.org_id=$1 AND r.code='scoring_admin'
          AND ag.resource_type <> 'scoring_parameter'`, [ids.org]);
    expect(rows.rows[0]!.c).toBe(0);
  });
});

describe('destructive guards', () => {
  it('refuses to close a department that still has people', async () => {
    await expect(
      admin.query(`UPDATE department SET effective_to=CURRENT_DATE WHERE id=$1`,
        [ids.deptOps]),
    ).rejects.toThrow(/still assigned to it/);
  });

  it('allows closing an empty department', async () => {
    const res = await admin.query(
      `UPDATE department SET effective_to=CURRENT_DATE WHERE id=$1 RETURNING id`,
      [ids.deptEmpty]);
    expect(res.rowCount).toBe(1);
  });

  it('refuses to deactivate an employment type people still hold', async () => {
    await expect(
      admin.query(`UPDATE employment_type SET is_active=FALSE WHERE id=$1`,
        [ids.typeReg]),
    ).rejects.toThrow(/currently hold it/);
  });

  it('allows deactivating an unused employment type', async () => {
    const res = await admin.query(
      `UPDATE employment_type SET is_active=FALSE WHERE id=$1 RETURNING id`,
      [ids.typeUnused]);
    expect(res.rowCount).toBe(1);
  });

  it('rejects a department hierarchy cycle', async () => {
    const a = (await admin.query(
      `INSERT INTO department (org_id,code,name,effective_from)
       VALUES ($1,'CYA','Cycle A','2020-01-01') RETURNING id`, [ids.org])).rows[0].id;
    const b = (await admin.query(
      `INSERT INTO department (org_id,code,name,effective_from,parent_department_id)
       VALUES ($1,'CYB','Cycle B','2020-01-01',$2) RETURNING id`,
      [ids.org, a])).rows[0].id;

    await expect(
      admin.query(`UPDATE department SET parent_department_id=$2 WHERE id=$1`, [a, b]),
    ).rejects.toThrow(/cycle/i);
  });
});

describe('employment type review eligibility', () => {
  it('is editable by HR — it decides who a review cycle picks up', async () => {
    const rows = await as<{ eligible: boolean }>(ids.hrAdmin,
      `UPDATE employment_type SET is_eligible_for_review=FALSE
        WHERE id=$1 RETURNING is_eligible_for_review AS eligible`, [ids.typeReg]);
    expect(rows[0]!.eligible).toBe(false);
    await admin.query(
      `UPDATE employment_type SET is_eligible_for_review=TRUE WHERE id=$1`,
      [ids.typeReg]);
  });

  it('is not editable by a plain employee', async () => {
    const rows = await as(ids.ic,
      `UPDATE employment_type SET is_eligible_for_review=FALSE
        WHERE id=$1 RETURNING id`, [ids.typeReg]);
    expect(rows).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('an admin cannot see or edit another tenant\'s departments', async () => {
    const otherOrg = (await admin.query(
      `INSERT INTO organization (code,name) VALUES ('BETA','Beta') RETURNING id`)).rows[0].id;
    const otherDept = (await admin.query(
      `INSERT INTO department (org_id,code,name,effective_from)
       VALUES ($1,'BOPS','Beta Ops','2020-01-01') RETURNING id`,
      [otherOrg])).rows[0].id;

    expect(await as(ids.hrAdmin,
      `SELECT id FROM department WHERE id=$1`, [otherDept])).toEqual([]);
    expect(await as(ids.hrAdmin,
      `UPDATE department SET name='Hijacked' WHERE id=$1 RETURNING id`,
      [otherDept])).toEqual([]);
  });
});
