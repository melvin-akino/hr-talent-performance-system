import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tenant isolation (decisions.md D-008).
 *
 * Every other suite seeds a single organization, which is exactly why the
 * cross-tenant leak survived 107 passing tests. This one provisions TWO
 * organizations and asserts mutual invisibility in both directions — an
 * asymmetric test would pass against a policy that only scoped one way.
 *
 * Both tenants get an org-wide HR admin, because 'org' scope is the widest
 * grant in the system and therefore the most dangerous if it means "all orgs".
 */

const MIGRATIONS = join(__dirname, '../../../db/migrations');

let container: StartedPostgreSqlContainer;
let admin: Pool;
let app: Pool;

interface Tenant {
  org: string;
  dept: string;
  etype: string;
  admin: string;
  manager: string;
  ic: string;
  period: string;
  kpi: string;
  framework: string;
  competency: string;
  resource: string;
}
const A = {} as Tenant;
const B = {} as Tenant;

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

const count = async (viewer: string, sql: string, params: unknown[] = []) =>
  Number((await as<{ c: string }>(viewer, sql, params))[0]!.c);

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
    throw new Error(`Tenancy tests must run as non-superuser hr_app, got '${who.rows[0]?.user}'`);
  }

  await seedTenant('ACME', A);
  await seedTenant('BETA', B);
}, 240_000);

afterAll(async () => {
  await app?.end();
  await admin?.end();
  await container?.stop();
});

async function seedTenant(code: string, t: Tenant): Promise<void> {
  t.org = (await admin.query(
    `INSERT INTO organization (code,name) VALUES ($1,$1) RETURNING id`, [code])).rows[0].id;
  t.dept = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'D','Dept','2020-01-01') RETURNING id`, [t.org])).rows[0].id;
  t.etype = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','Regular') RETURNING id`,
    [t.org])).rows[0].id;

  const emp = async (no: string) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [t.org, `${code}-${no}`])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [t.org, id, t.dept, t.etype]);
    return id;
  };

  t.admin = await emp('admin');
  t.manager = await emp('mgr');
  t.ic = await emp('ic');

  await admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [t.org, t.ic, t.manager]);

  await admin.query('SELECT app.seed_baseline_roles($1)', [t.org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [t.org]);
  await admin.query('SELECT app.seed_phase2_grants($1)', [t.org]);
  await admin.query('SELECT app.seed_phase3_grants($1)', [t.org]);
  await admin.query('SELECT app.seed_phase4_grants($1)', [t.org]);
  await admin.query('SELECT app.seed_phase6_grants($1)', [t.org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [t.org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [t.org, e, r]);

  const rEmp = await role('employee');
  for (const e of [t.admin, t.manager, t.ic]) await assign(e, rEmp);
  await assign(t.manager, await role('manager'));
  await assign(t.admin, await role('hr_admin'));

  t.period = (await admin.query(
    `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state)
     VALUES ($1,$2,'annual','2026-01-01','2026-12-31','open') RETURNING id`,
    [t.org, `${code}-FY26`])).rows[0].id;

  t.kpi = (await admin.query(
    `INSERT INTO kpi_definition (org_id,code,version,name,measure_type,published_at)
     VALUES ($1,$2,1,'Revenue','currency',now()) RETURNING id`,
    [t.org, `${code}-REV`])).rows[0].id;

  await admin.query(
    `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,state,
                       approved_by,approved_at)
     VALUES ($1,$2,$3,$4,100,'active',$5,now())`,
    [t.org, t.period, t.ic, `${code} secret goal`, t.manager]);

  await admin.query(
    `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
                           starts_on,ends_on)
     VALUES ($1,$2,$3,$3,'Confidential performance concern','2026-03-01','2026-06-01')`,
    [t.org, t.ic, t.manager]);

  // Phase 4. Any new table with an org_id needs a case here, or a leak can
  // reappear exactly as it did before migration 0015.
  // Draft first: a published framework is frozen, so competencies and levels
  // must be added before publishing.
  t.framework = (await admin.query(
    `INSERT INTO competency_framework (org_id,code,version,name)
     VALUES ($1,$2,1,'Framework') RETURNING id`,
    [t.org, `${code}-CORE`])).rows[0].id;
  t.competency = (await admin.query(
    `INSERT INTO competency (framework_id,code,name) VALUES ($1,'C1','Competency')
     RETURNING id`, [t.framework])).rows[0].id;
  for (let n = 1; n <= 3; n++) {
    await admin.query(
      `INSERT INTO competency_level (competency_id,level_no,label)
       VALUES ($1,$2,$3)`, [t.competency, n, `L${n}`]);
  }
  await admin.query(
    `UPDATE competency_framework SET is_active=TRUE, published_at=now() WHERE id=$1`,
    [t.framework]);
  await admin.query(
    `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                        assessed_level,assessed_by)
     VALUES ($1,$2,$3,2,$4)`, [t.org, t.ic, t.competency, t.manager]);

  // Phase 6. Standing requirement from D-008: any new table with an org_id
  // needs a case here, or a cross-tenant leak can reappear unnoticed.
  t.resource = (await admin.query(
    `INSERT INTO learning_resource (org_id,title,resource_type,competency_id)
     VALUES ($1,$2,'course',$3) RETURNING id`,
    [t.org, `${code} course`, t.competency])).rows[0].id;

  const plan = (await admin.query(
    `INSERT INTO development_plan (org_id,employee_id,title)
     VALUES ($1,$2,$3) RETURNING id`,
    [t.org, t.ic, `${code} development plan`])).rows[0].id;
  await admin.query(
    `INSERT INTO dev_action (development_plan_id,sequence,description)
     VALUES ($1,1,'Confidential development action')`, [plan]);
  await admin.query(
    `INSERT INTO learning_assignment (org_id,employee_id,learning_resource_id,assigned_by)
     VALUES ($1,$2,$3,$4)`, [t.org, t.ic, t.resource, t.manager]);

  // B5. HR-authored help. Company policy is not secret, but one customer's
  // internal timetable is not another's business.
  await admin.query(
    `INSERT INTO help_article (org_id, slug, title, summary, section, body, published_at)
     VALUES ($1, 'review-timetable', $2, 'When our cycle runs.', 'reviews',
             'Self-reviews are due by 30 November.', now())`,
    [t.org, `${code} review timetable`]);
}

// ---------------------------------------------------------------------------

describe('an org-wide HR admin is confined to their own tenant', () => {
  it('sees only their own employees', async () => {
    expect(await count(A.admin, 'SELECT count(*)::int AS c FROM employee')).toBe(3);
    expect(await count(B.admin, 'SELECT count(*)::int AS c FROM employee')).toBe(3);
  });

  it('cannot see the other tenant\'s employees — both directions', async () => {
    expect(await count(A.admin,
      'SELECT count(*)::int AS c FROM employee WHERE org_id = $1', [B.org])).toBe(0);
    expect(await count(B.admin,
      'SELECT count(*)::int AS c FROM employee WHERE org_id = $1', [A.org])).toBe(0);
  });

  it('cannot read a specific foreign employee by id', async () => {
    expect(await as(A.admin, 'SELECT id FROM employee WHERE id = $1', [B.ic])).toEqual([]);
    expect(await as(B.admin, 'SELECT id FROM employee WHERE id = $1', [A.ic])).toEqual([]);
  });

  it('can_access() denies across the boundary at every scope', async () => {
    const probe = async (viewer: string, target: string) =>
      (await as<{ r: boolean }>(viewer,
        `SELECT app.can_access('employee','read',$1) AS r`, [target]))[0]!.r;
    expect(await probe(A.admin, B.ic)).toBe(false);
    expect(await probe(B.admin, A.ic)).toBe(false);
    // Sanity: it still permits access within the tenant, so the test is not
    // passing merely because everything is denied.
    expect(await probe(A.admin, A.ic)).toBe(true);
  });
});

describe('reference data is tenant-scoped', () => {
  const cases: [string, string][] = [
    ['organization', 'SELECT count(*)::int AS c FROM organization'],
    ['department', 'SELECT count(*)::int AS c FROM department'],
    ['employment_type', 'SELECT count(*)::int AS c FROM employment_type'],
    ['app_role', 'SELECT count(*)::int AS c FROM app_role'],
    ['goal_period', 'SELECT count(*)::int AS c FROM goal_period'],
    ['kpi_definition', 'SELECT count(*)::int AS c FROM kpi_definition'],
    ['competency_framework', 'SELECT count(*)::int AS c FROM competency_framework'],
    ['competency', 'SELECT count(*)::int AS c FROM competency'],
    ['competency_level', 'SELECT count(*)::int AS c FROM competency_level'],
    ['learning_resource', 'SELECT count(*)::int AS c FROM learning_resource'],
    ['help_article', 'SELECT count(*)::int AS c FROM help_article'],
  ];

  for (const [label, sql] of cases) {
    it(`${label}: each tenant sees only its own rows`, async () => {
      const a = await count(A.admin, sql);
      const b = await count(B.admin, sql);
      // Both tenants seeded identically, so each must see exactly half the
      // total. Seeing everything would double these numbers.
      expect(a).toBeGreaterThan(0);
      expect(a).toBe(b);
      const total = Number((await admin.query<{ c: string }>(
        sql.replace('::int AS c', '::int AS c'))).rows[0]!.c);
      expect(a).toBe(total / 2);
    });
  }

  it('the permission matrix itself does not leak', async () => {
    const a = await count(A.admin, 'SELECT count(*)::int AS c FROM access_grant');
    const total = Number((await admin.query<{ c: string }>(
      'SELECT count(*)::int AS c FROM access_grant')).rows[0]!.c);
    expect(a).toBeGreaterThan(0);
    expect(a).toBe(total / 2);
  });
});

describe('performance data is tenant-scoped', () => {
  it('goals do not cross the boundary', async () => {
    expect(await count(A.admin, 'SELECT count(*)::int AS c FROM goal')).toBe(1);
    expect(await count(A.admin,
      `SELECT count(*)::int AS c FROM goal WHERE title LIKE 'BETA%'`)).toBe(0);
    expect(await count(B.admin,
      `SELECT count(*)::int AS c FROM goal WHERE title LIKE 'ACME%'`)).toBe(0);
  });

  it('PIPs do not cross the boundary', async () => {
    expect(await count(A.admin, 'SELECT count(*)::int AS c FROM pip_plan')).toBe(1);
    expect(await count(B.admin, 'SELECT count(*)::int AS c FROM pip_plan')).toBe(1);
  });

  it('competency assessments do not cross the boundary', async () => {
    expect(await count(A.admin, 'SELECT count(*)::int AS c FROM competency_assessment'))
      .toBe(1);
    expect(await count(B.admin, 'SELECT count(*)::int AS c FROM competency_assessment'))
      .toBe(1);
    expect(await count(A.admin,
      'SELECT count(*)::int AS c FROM competency_assessment WHERE org_id = $1', [B.org]))
      .toBe(0);
  });

  it('development plans and assigned learning do not cross the boundary', async () => {
    expect(await count(A.admin, 'SELECT count(*)::int AS c FROM development_plan')).toBe(1);
    expect(await count(A.admin,
      `SELECT count(*)::int AS c FROM development_plan WHERE title LIKE 'BETA%'`)).toBe(0);
    expect(await count(B.admin,
      `SELECT count(*)::int AS c FROM development_plan WHERE title LIKE 'ACME%'`)).toBe(0);

    // Actions inherit the plan, so they must disappear with it.
    expect(await count(A.admin, 'SELECT count(*)::int AS c FROM dev_action')).toBe(1);
    expect(await count(A.admin,
      'SELECT count(*)::int AS c FROM learning_assignment WHERE org_id = $1',
      [B.org])).toBe(0);
  });

  it('audit history does not cross the boundary', async () => {
    const a = await count(A.admin,
      'SELECT count(*)::int AS c FROM audit_log WHERE org_id = $1', [B.org]);
    expect(a).toBe(0);
  });
});

describe('writes cannot cross the boundary', () => {
  it('an admin cannot create a goal for a foreign employee', async () => {
    await expect(
      as(A.admin,
        `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight)
         VALUES ($1,$2,$3,'cross-tenant',10)`, [A.org, A.period, B.ic]),
    ).rejects.toThrow();
  });

  it('a composite foreign key blocks cross-org rows even with RLS bypassed', async () => {
    // Written as the migrator (BYPASSRLS) to prove the constraint holds
    // independently of row-level security — defence in depth, not duplication.
    await expect(
      admin.query(
        `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight)
         VALUES ($1,$2,$3,'cross-tenant',10)`, [A.org, A.period, B.ic]),
    ).rejects.toThrow(/goal_employee_same_org/);
  });

  it('a cross-org reporting line is rejected', async () => {
    // A.manager deliberately, not A.ic: the IC already holds an open primary
    // line, so the no-overlap exclusion constraint would fire first and the
    // test would pass without ever exercising the cross-org key.
    await expect(
      admin.query(
        `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,
                                     effective_from)
         VALUES ($1,$2,$3,'2026-01-01')`, [A.org, A.manager, B.manager]),
    ).rejects.toThrow(/same_org/);
  });

  it('a cross-org role assignment is rejected', async () => {
    const roleA = (await admin.query(
      `SELECT id FROM app_role WHERE org_id=$1 AND code='hr_admin'`, [A.org])).rows[0].id;
    await expect(
      admin.query(
        `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
         VALUES ($1,$2,$3,'2026-01-01')`, [A.org, B.ic, roleA]),
    ).rejects.toThrow(/same_org/);
  });
});

describe('tenant identity', () => {
  it('resolves from the authenticated employee, not from client input', async () => {
    const a = (await as<{ o: string }>(A.ic, 'SELECT app.current_org_id() AS o'))[0]!.o;
    const b = (await as<{ o: string }>(B.ic, 'SELECT app.current_org_id() AS o'))[0]!.o;
    expect(a).toBe(A.org);
    expect(b).toBe(B.org);
    expect(a).not.toBe(b);
  });

  it('is NULL with no identity, so every org predicate fails closed', async () => {
    const rows = await as<{ o: string | null }>(null, 'SELECT app.current_org_id() AS o');
    expect(rows[0]!.o).toBeNull();
    expect(await count(null as unknown as string,
      'SELECT count(*)::int AS c FROM employee')).toBe(0);
  });

  it('an IdP subject cannot be claimed by two tenants', async () => {
    await admin.query(`UPDATE employee SET idp_subject = 'shared-subject' WHERE id = $1`,
      [A.ic]);
    await expect(
      admin.query(`UPDATE employee SET idp_subject = 'shared-subject' WHERE id = $1`,
        [B.ic]),
    ).rejects.toThrow();
    await admin.query(`UPDATE employee SET idp_subject = NULL WHERE id = $1`, [A.ic]);
  });
});
