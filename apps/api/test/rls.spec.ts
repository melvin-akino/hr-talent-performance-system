import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RLS policies are tested against a REAL PostgreSQL instance. Mocks cannot
 * verify a security policy -- a mocked repository would happily return rows the
 * database would have refused, and the test would pass while production leaks.
 *
 * Scenario built below (as of 2026-01-01):
 *
 *   ceo
 *    +-- eng_director
 *    |     +-- eng_manager
 *    |           +-- eng_ic
 *    +-- sales_director
 *          +-- sales_ic
 *
 *   hr_partner  -- scoped to the Engineering department only
 *   hr_admin    -- org-wide
 */

const MIGRATIONS = join(__dirname, '../../../db/migrations');
const AS_OF = '2026-01-01';

let container: StartedPostgreSqlContainer;
let admin: Pool;   // BYPASSRLS -- setup only
let app: Pool;     // RLS enforced -- the role under test
const ids: Record<string, string> = {};

/** Runs a query as `employeeId`, exactly as DbService.withContext does. */
async function as<T extends Record<string, unknown>>(
  employeeId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_employee_id', $1, true)`, [
      employeeId ?? '',
    ]);
    const res = await client.query<T>(sql, params);
    await client.query('COMMIT');
    return res.rows;
  } catch (err) {
    // Mirrors DbService.withContext. Without the rollback, a deliberately
    // denied statement leaves the connection in an aborted transaction, and
    // every later test on that pooled connection fails with a misleading
    // "current transaction is aborted" instead of its real assertion.
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('hr')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  admin = new Pool({ connectionString: container.getConnectionUri() });

  await admin.query(`
    CREATE ROLE hr_migrator LOGIN BYPASSRLS PASSWORD 'm';
    CREATE ROLE hr_app LOGIN NOBYPASSRLS PASSWORD 'a';
  `);

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }

  app = new Pool({
    connectionString: container.getConnectionUri().replace('postgres:postgres', 'hr_app:a'),
  });

  // A superuser bypasses RLS unconditionally, which would make every
  // deny-assertion below pass while testing nothing. Fail loudly instead.
  const who = await app.query<{ user: string; bypass: boolean }>(
    `SELECT current_user AS user, usesuper AS bypass
       FROM pg_user WHERE usename = current_user`);
  if (who.rows[0]?.user !== 'hr_app' || who.rows[0]?.bypass) {
    throw new Error(
      `RLS test pool must connect as the non-superuser hr_app, got ` +
      `'${who.rows[0]?.user}' (superuser=${who.rows[0]?.bypass}). ` +
      `Deny-assertions would be vacuous.`);
  }

  await seed();
}, 180_000);

afterAll(async () => {
  await app?.end();
  await admin?.end();
  await container?.stop();
});

async function seed(): Promise<void> {
  const org = (await admin.query(
    `INSERT INTO organization (code, name) VALUES ('ACME','Acme') RETURNING id`,
  )).rows[0].id;
  ids.org = org;

  const dept = async (code: string, name: string, parent: string | null) =>
    (await admin.query(
      `INSERT INTO department (org_id, code, name, parent_department_id, effective_from)
       VALUES ($1,$2,$3,$4,'2020-01-01') RETURNING id`,
      [org, code, name, parent],
    )).rows[0].id;

  ids.deptRoot = await dept('ALL', 'Acme', null);
  ids.deptEng = await dept('ENG', 'Engineering', ids.deptRoot);
  ids.deptSales = await dept('SALES', 'Sales', ids.deptRoot);

  const etype = (await admin.query(
    `INSERT INTO employment_type (org_id, code, name) VALUES ($1,'REG','Regular') RETURNING id`,
    [org],
  )).rows[0].id;

  const emp = async (no: string, last: string, deptId: string) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id, employee_no, first_name, last_name, work_email, hired_on)
       VALUES ($1,$2,$3,$4,$5,'2020-01-01') RETURNING id`,
      [org, no, no, last, `${no}@acme.test`],
    )).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id, employee_id, department_id, employment_type_id,
                               status, effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`,
      [org, id, deptId, etype],
    );
    return id;
  };

  ids.ceo = await emp('ceo', 'Chief', ids.deptRoot);
  ids.engDirector = await emp('engdir', 'Director', ids.deptEng);
  ids.engManager = await emp('engmgr', 'Manager', ids.deptEng);
  ids.engIc = await emp('engic', 'Engineer', ids.deptEng);
  ids.salesDirector = await emp('salesdir', 'Sales', ids.deptSales);
  ids.salesIc = await emp('salesic', 'Seller', ids.deptSales);
  ids.hrPartner = await emp('hrbp', 'Partner', ids.deptRoot);
  ids.hrAdmin = await emp('hradmin', 'Admin', ids.deptRoot);

  const line = (child: string, parent: string, from = '2020-01-01') =>
    admin.query(
      `INSERT INTO reporting_line (org_id, employee_id, supervisor_employee_id, effective_from)
       VALUES ($1,$2,$3,$4)`,
      [org, child, parent, from],
    );

  await line(ids.engDirector, ids.ceo);
  await line(ids.engManager, ids.engDirector);
  await line(ids.engIc, ids.engManager);
  await line(ids.salesDirector, ids.ceo);
  await line(ids.salesIc, ids.salesDirector);

  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);

  const role = async (code: string) =>
    (await admin.query(`SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, code]))
      .rows[0].id;

  const assign = (employeeId: string, roleId: string, scopeDept: string | null = null) =>
    admin.query(
      `INSERT INTO role_assignment (org_id, employee_id, role_id, scope_department_id,
                                    effective_from)
       VALUES ($1,$2,$3,$4,'2020-01-01')`,
      [org, employeeId, roleId, scopeDept],
    );

  const [rEmployee, rManager, rPartner, rAdmin] = await Promise.all(
    ['employee', 'manager', 'hr_partner', 'hr_admin'].map(role),
  );

  for (const id of [ids.ceo, ids.engDirector, ids.engManager, ids.engIc,
                    ids.salesDirector, ids.salesIc, ids.hrPartner, ids.hrAdmin]) {
    await assign(id, rEmployee);
  }
  for (const id of [ids.ceo, ids.engDirector, ids.engManager, ids.salesDirector]) {
    await assign(id, rManager);
  }
  await assign(ids.hrPartner, rPartner, ids.deptEng);
  await assign(ids.hrAdmin, rAdmin);
}

const visibleIds = async (viewer: string) =>
  (await as<{ id: string }>(viewer, 'SELECT id FROM employee ORDER BY id'))
    .map((r) => r.id);

describe('employee visibility', () => {
  it('an IC sees only themselves', async () => {
    expect(await visibleIds(ids.engIc)).toEqual([ids.engIc]);
  });

  it('a manager sees themselves and their direct reports', async () => {
    const seen = await visibleIds(ids.engManager);
    expect(seen).toContain(ids.engManager);
    expect(seen).toContain(ids.engIc);
    expect(seen).toHaveLength(2);
  });

  it('a director sees the full subtree, including skip-level reports', async () => {
    const seen = await visibleIds(ids.engDirector);
    expect(seen).toEqual(
      expect.arrayContaining([ids.engDirector, ids.engManager, ids.engIc]),
    );
  });

  it('managers cannot see peers or other branches of the org', async () => {
    const seen = await visibleIds(ids.engDirector);
    expect(seen).not.toContain(ids.salesDirector);
    expect(seen).not.toContain(ids.salesIc);
    expect(seen).not.toContain(ids.ceo);
  });

  it('a department-scoped HR partner cannot read another department', async () => {
    const seen = await visibleIds(ids.hrPartner);
    expect(seen).toContain(ids.engIc);
    expect(seen).toContain(ids.engManager);
    expect(seen).not.toContain(ids.salesIc);
    expect(seen).not.toContain(ids.salesDirector);
  });

  it('an org-scoped HR admin reads everyone', async () => {
    expect(await visibleIds(ids.hrAdmin)).toHaveLength(8);
  });

  it('fails closed when no identity is set', async () => {
    expect(await visibleIds(null as unknown as string)).toEqual([]);
  });

  it('soft-deleted employees disappear even from an org-wide admin', async () => {
    await admin.query(`UPDATE employee SET deleted_at = now() WHERE id = $1`, [ids.salesIc]);
    expect(await visibleIds(ids.hrAdmin)).not.toContain(ids.salesIc);
    await admin.query(`UPDATE employee SET deleted_at = NULL WHERE id = $1`, [ids.salesIc]);
  });
});

describe('temporal hierarchy', () => {
  it('resolves the supervisor in effect on a past date, not today', async () => {
    // engIc transfers from engManager to salesDirector on 2026-06-01.
    await admin.query(
      `UPDATE reporting_line SET effective_to = '2026-06-01'
        WHERE employee_id = $1 AND line_type = 'primary'`,
      [ids.engIc],
    );
    await admin.query(
      `INSERT INTO reporting_line (org_id, employee_id, supervisor_employee_id, effective_from)
       VALUES ($1,$2,$3,'2026-06-01')`,
      [ids.org, ids.engIc, ids.salesDirector],
    );

    const before = await admin.query<{ r: boolean }>(
      `SELECT app.reports_to($1,$2,'2026-03-01'::date) AS r`, [ids.engIc, ids.engManager]);
    const after = await admin.query<{ r: boolean }>(
      `SELECT app.reports_to($1,$2,'2026-09-01'::date) AS r`, [ids.engIc, ids.engManager]);

    expect(before.rows[0].r).toBe(true);
    expect(after.rows[0].r).toBe(false);
  });

  it('does not hang on a reporting cycle', async () => {
    // Cycles are rejected at import, but a manual DB edit could still create
    // one. The depth cap must contain it rather than spin.
    const res = await admin.query<{ r: boolean }>(
      `SELECT app.reports_to($1,$2) AS r`, [ids.ceo, ids.engIc]);
    expect(res.rows[0].r).toBe(false);
  });
});

describe('privilege escalation guards', () => {
  it('an HR admin cannot grant a role to themselves', async () => {
    const roleId = (await admin.query(
      `SELECT id FROM app_role WHERE org_id=$1 AND code='hr_admin'`, [ids.org])).rows[0].id;
    await expect(
      as(ids.hrAdmin,
        `INSERT INTO role_assignment (org_id, employee_id, role_id, effective_from)
         VALUES ($1,$2,$3,CURRENT_DATE)`,
        [ids.org, ids.hrAdmin, roleId]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('an IC cannot read anyone else\'s role assignments', async () => {
    const rows = await as(ids.engIc,
      'SELECT id FROM role_assignment WHERE employee_id <> $1', [ids.engIc]);
    expect(rows).toEqual([]);
  });

  it('an IC cannot escalate by writing to access_grant', async () => {
    const roleId = (await admin.query(
      `SELECT id FROM app_role WHERE org_id=$1 AND code='employee'`, [ids.org])).rows[0].id;
    await expect(
      as(ids.engIc,
        `INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
         VALUES ($1,$2,'employee','read','org')`,
        [ids.org, roleId]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('an IC cannot modify another employee record', async () => {
    const res = await as(ids.engIc,
      `UPDATE employee SET last_name = 'Hacked' WHERE id = $1 RETURNING id`,
      [ids.engManager]);
    expect(res).toEqual([]);
  });
});

describe('audit log', () => {
  it('records mutations with the acting employee', async () => {
    await as(ids.hrAdmin,
      `UPDATE employee SET preferred_name = 'Ace' WHERE id = $1`, [ids.engIc]);

    const rows = await admin.query<{ actor_employee_id: string; changed_columns: string[] }>(
      `SELECT actor_employee_id, changed_columns FROM audit_log
        WHERE table_name = 'employee' AND record_id = $1 AND operation = 'UPDATE'
        ORDER BY occurred_at DESC LIMIT 1`, [ids.engIc]);

    expect(rows.rows[0].actor_employee_id).toBe(ids.hrAdmin);
    expect(rows.rows[0].changed_columns).toContain('preferred_name');
    // Bookkeeping columns must not pollute the diff.
    expect(rows.rows[0].changed_columns).not.toContain('updated_at');
  });

  it('is append-only -- updates and deletes are silently discarded', async () => {
    const before = (await admin.query('SELECT count(*)::int AS c FROM audit_log')).rows[0].c;
    await admin.query(`UPDATE audit_log SET operation = 'DELETE'`);
    await admin.query('DELETE FROM audit_log');
    const after = (await admin.query('SELECT count(*)::int AS c FROM audit_log')).rows[0].c;
    expect(after).toBe(before);
  });
});
