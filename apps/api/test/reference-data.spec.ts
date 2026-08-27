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
