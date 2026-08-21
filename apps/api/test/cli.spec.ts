/**
 * The operator CLI and the migration runner.
 *
 * These run once, on a customer's server, usually with nobody present who can
 * debug them — and several of them are the difference between a working
 * installation and one that looks healthy while holding nothing. They had no
 * tests at all until now, and two of the bugs they contain were found by
 * running the installer by hand rather than by any suite.
 *
 * Everything here runs against a real PostgreSQL. The commands themselves are
 * driven exactly as the CLI drives them: through ADMIN_DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, Pool } from 'pg';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate, MigrationChecksumError } from '../src/db/migrate';
import { provisionOrg } from '../src/cli/provision-org';
import { syncRoles } from '../src/cli/sync-roles';
import { openGoalPeriod } from '../src/cli/goal-period';
import { preflight, identityChecks, keycloakConfigFromEnv } from '../src/cli/preflight';
import { assertSafeTarget, UnsafeSeedTargetError } from '../src/cli/seed-demo';
import { assertConfirmedTarget } from '../src/cli/seed-activity';

const MIGRATIONS = join(__dirname, '../../../db/migrations');

let container: StartedPostgreSqlContainer;
let admin: Pool;
let adminUrl: string;

/** Captures what the commands print, so assertions can read their output. */
function captureOutput(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.log = realLog; } };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('hr').withUsername('postgres').withPassword('postgres')
    .start();
  adminUrl = container.getConnectionUri();
  admin = new Pool({ connectionString: adminUrl });
  await admin.query(`
    CREATE ROLE hr_migrator LOGIN BYPASSRLS PASSWORD 'm';
    CREATE ROLE hr_app LOGIN NOBYPASSRLS PASSWORD 'a';
  `);
  process.env.ADMIN_DATABASE_URL = adminUrl;

  // The identity checks read these. A developer's shell may carry them from a
  // running stack, which would make preflight's results depend on whose machine
  // the suite runs on; the tests that need them set them explicitly.
  for (const v of ['KEYCLOAK_URL', 'KEYCLOAK_REALM', 'OIDC_AUDIENCE', 'KEYCLOAK_ADMIN',
                   'KEYCLOAK_ADMIN_PASSWORD', 'KC_ENABLE_PASSWORD_GRANT']) {
    delete process.env[v];
  }
}, 300_000);

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

// ---------------------------------------------------------------------------

describe('migration runner', () => {
  it('applies every migration to an empty database', async () => {
    const result = await migrate({ url: adminUrl });
    const onDisk = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));

    expect(result.applied).toHaveLength(onDisk.length);
    expect(result.alreadyApplied).toBe(0);

    const recorded = await admin.query('SELECT count(*)::int AS n FROM schema_migration');
    expect(recorded.rows[0].n).toBe(onDisk.length);
  }, 120_000);

  it('is a no-op on the second run', async () => {
    const result = await migrate({ url: adminUrl });
    expect(result.applied).toHaveLength(0);
    expect(result.alreadyApplied).toBeGreaterThan(0);
  });

  it('applies migrations in filename order', async () => {
    const order = (await admin.query<{ filename: string }>(
      'SELECT filename FROM schema_migration ORDER BY applied_at, filename')).rows
      .map((r) => r.filename);
    expect(order).toEqual([...order].sort());
  });

  it('finds its migrations without being told where they are', () => {
    // The default resolution walks up from __dirname. A fixed relative path is
    // correct for exactly one of the two layouts this code runs in, and getting
    // it wrong produced an empty schema on a healthy-looking production cluster.
    expect(() => readdirSync(MIGRATIONS)).not.toThrow();
    expect(readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).length)
      .toBeGreaterThan(0);
  });
});

describe('migrations are immutable once applied', () => {
  let scratch: string;
  let scratchDb: string;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'mig-'));
    await admin.query('CREATE DATABASE immutable_test');
    scratchDb = adminUrl.replace(/\/hr(\?|$)/, '/immutable_test$1');
  });

  afterAll(() => { rmSync(scratch, { recursive: true, force: true }); });

  it('refuses to continue when an applied migration has changed', async () => {
    writeFileSync(join(scratch, '0001_a.sql'), 'CREATE TABLE a (id int);');
    await migrate({ url: scratchDb, dir: scratch });

    // Edit it after the fact — the exact mistake the checksum exists to catch.
    writeFileSync(join(scratch, '0001_a.sql'), 'CREATE TABLE a (id bigint);');

    await expect(migrate({ url: scratchDb, dir: scratch }))
      .rejects.toBeInstanceOf(MigrationChecksumError);
  });

  it('names the offending file and tells the operator what to do', async () => {
    await expect(migrate({ url: scratchDb, dir: scratch }))
      .rejects.toThrow(/0001_a\.sql was modified after being applied/);
    await expect(migrate({ url: scratchDb, dir: scratch }))
      .rejects.toThrow(/Write a new migration/);
  });

  it('does not apply later migrations once a divergence is found', async () => {
    // Stopping matters: applying 0002 against a schema that no longer matches
    // its own history is how a restore fails months later.
    writeFileSync(join(scratch, '0002_b.sql'), 'CREATE TABLE b (id int);');
    await expect(migrate({ url: scratchDb, dir: scratch })).rejects.toThrow();

    const scratchPool = new Pool({ connectionString: scratchDb });
    const b = await scratchPool.query(
      `SELECT to_regclass('public.b') AS present`);
    await scratchPool.end();
    expect(b.rows[0].present).toBeNull();
  });
});

describe('a failed migration is not recorded as applied', () => {
  it('leaves the file pending so the next run retries it', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'mig-fail-'));
    await admin.query('CREATE DATABASE fail_test');
    const url = adminUrl.replace(/\/hr(\?|$)/, '/fail_test$1');

    writeFileSync(join(scratch, '0001_ok.sql'), 'CREATE TABLE ok (id int);');
    writeFileSync(join(scratch, '0002_broken.sql'), 'CREATE TABLE ;;; syntax error');

    await expect(migrate({ url, dir: scratch })).rejects.toThrow();

    const pool = new Pool({ connectionString: url });
    const recorded = await pool.query<{ filename: string }>(
      'SELECT filename FROM schema_migration ORDER BY filename');
    await pool.end();

    // The good one is recorded; the broken one is not.
    expect(recorded.rows.map((r) => r.filename)).toEqual(['0001_ok.sql']);

    rmSync(scratch, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------

describe('provision-org', () => {
  const out = { restore: () => undefined } as { restore: () => void };

  afterEach(() => out.restore());

  it('creates an organisation with everything a tenant needs', async () => {
    const c = captureOutput();
    await provisionOrg('ACME', 'Acme Corporation', 'Asia/Manila');
    c.restore();

    const org = await admin.query<{ id: string; name: string }>(
      `SELECT id, name FROM organization WHERE code = 'ACME'`);
    expect(org.rows[0].name).toBe('Acme Corporation');
    const orgId = org.rows[0].id;

    // Every phase's grants, not just the ones seed-demo happened to call. An
    // org provisioned after the migrations ran gets nothing unless this command
    // applies them — the defect that made this command necessary.
    const roles = await admin.query<{ code: string }>(
      `SELECT code FROM app_role WHERE org_id = $1 ORDER BY code`, [orgId]);
    expect(roles.rows.map((r) => r.code))
      .toEqual(expect.arrayContaining(['employee', 'manager', 'hr_admin', 'hr_partner']));

    const grants = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM access_grant WHERE org_id = $1`, [orgId]);
    expect(grants.rows[0].n).toBeGreaterThan(0);

    const templates = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notification_template WHERE org_id = $1`, [orgId]);
    expect(templates.rows[0].n).toBeGreaterThan(0);
  });

  it('creates a published rating scale and a default review form', async () => {
    const orgId = (await admin.query<{ id: string }>(
      `SELECT id FROM organization WHERE code='ACME'`)).rows[0].id;

    const scale = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rating_scale_point p
         JOIN rating_scale s ON s.id = p.rating_scale_id
        WHERE s.org_id = $1`, [orgId]);
    expect(scale.rows[0].n).toBe(5);

    // The org-wide default assignment: without it resolve_form_version returns
    // NULL and every review is silently skipped at generation.
    const assignment = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM form_template_assignment
        WHERE org_id = $1 AND employment_type_id IS NULL AND app_role_id IS NULL`,
      [orgId]);
    expect(assignment.rows[0].n).toBe(1);
  });

  it('is idempotent — re-running changes nothing', async () => {
    const before = await admin.query(
      `SELECT (SELECT count(*) FROM app_role) AS roles,
              (SELECT count(*) FROM rating_scale_point) AS points,
              (SELECT count(*) FROM form_template_assignment) AS assignments`);

    const c = captureOutput();
    await provisionOrg('ACME', 'Acme Corporation', 'Asia/Manila');
    c.restore();

    const after = await admin.query(
      `SELECT (SELECT count(*) FROM app_role) AS roles,
              (SELECT count(*) FROM rating_scale_point) AS points,
              (SELECT count(*) FROM form_template_assignment) AS assignments`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('refuses to run without ADMIN_DATABASE_URL', async () => {
    const saved = process.env.ADMIN_DATABASE_URL;
    delete process.env.ADMIN_DATABASE_URL;
    await expect(provisionOrg('X', 'X', 'Asia/Manila')).rejects.toThrow(/ADMIN_DATABASE_URL/);
    process.env.ADMIN_DATABASE_URL = saved;
  });
});

// ---------------------------------------------------------------------------

describe('sync-roles', () => {
  let orgId: string;

  beforeAll(async () => {
    orgId = (await admin.query<{ id: string }>(
      `SELECT id FROM organization WHERE code='ACME'`)).rows[0].id;

    const dept = (await admin.query<{ id: string }>(
      `INSERT INTO department (org_id, code, name, effective_from)
            VALUES ($1,'ENG','Engineering','2020-01-01') RETURNING id`, [orgId])).rows[0].id;
    const type = (await admin.query<{ id: string }>(
      `SELECT id FROM employment_type WHERE org_id=$1 AND code='REG'`, [orgId])).rows[0].id;

    // boss <- lead <- ic ; plus `lonely`, who manages nobody.
    for (const [no, first] of [['B1', 'Boss'], ['L1', 'Lead'], ['I1', 'Ic'], ['N1', 'Lonely']]) {
      const id = (await admin.query<{ id: string }>(
        `INSERT INTO employee (org_id, employee_no, first_name, last_name,
                               work_email, hired_on)
              VALUES ($1,$2,$3,'X',$4,'2020-01-01') RETURNING id`,
        [orgId, no, first, `${no}@t.local`])).rows[0].id;
      await admin.query(
        `INSERT INTO employment (org_id, employee_id, employment_type_id,
                                 department_id, status, effective_from)
              VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [orgId, id, type, dept]);
    }

    const idOf = async (no: string) => (await admin.query<{ id: string }>(
      `SELECT id FROM employee WHERE org_id=$1 AND employee_no=$2`, [orgId, no])).rows[0].id;

    // B1 is the single root; everyone else reports upward. Preflight later
    // asserts exactly one root, so a second unparented employee would be a
    // genuine finding rather than test noise.
    await admin.query(
      `INSERT INTO reporting_line (org_id, employee_id, supervisor_employee_id,
                                   effective_from)
            VALUES ($1,$2,$3,'2020-01-01'), ($1,$4,$5,'2020-01-01'),
                   ($1,$6,$3,'2020-01-01')`,
      [orgId, await idOf('L1'), await idOf('B1'), await idOf('I1'), await idOf('L1'),
       await idOf('N1')]);
  });

  const rolesOf = async (no: string): Promise<string[]> => (await admin.query<{ code: string }>(
    `SELECT r.code FROM role_assignment ra
       JOIN app_role r ON r.id = ra.role_id
       JOIN employee e ON e.id = ra.employee_id
      WHERE e.employee_no = $1 AND e.org_id = $2
        AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_DATE)
      ORDER BY r.code`, [no, orgId])).rows.map((r) => r.code);

  it('writes nothing on a dry run', async () => {
    const c = captureOutput();
    await syncRoles('ACME', true);
    c.restore();

    expect(await rolesOf('I1')).toEqual([]);
    expect(c.lines.join('\n')).toMatch(/DRY RUN/);
  });

  it('grants employee to everyone and manager to those with reports', async () => {
    const c = captureOutput();
    await syncRoles('ACME', false);
    c.restore();

    expect(await rolesOf('B1')).toEqual(['employee', 'manager']);
    expect(await rolesOf('L1')).toEqual(['employee', 'manager']);
    expect(await rolesOf('I1')).toEqual(['employee']);
    // Having a job title is not being a manager; having a report is.
    expect(await rolesOf('N1')).toEqual(['employee']);
  });

  it('is idempotent', async () => {
    const c = captureOutput();
    await syncRoles('ACME', false);
    c.restore();

    expect(c.lines.join('\n')).toMatch(/employee\s+\+0 granted/);
    expect(await rolesOf('L1')).toEqual(['employee', 'manager']);
  });

  it('closes the manager grant when the last report goes away', async () => {
    await admin.query(
      `UPDATE reporting_line SET effective_to = CURRENT_DATE
         WHERE employee_id = (SELECT id FROM employee
                               WHERE org_id=$1 AND employee_no='I1')`, [orgId]);

    const c = captureOutput();
    await syncRoles('ACME', false);
    c.restore();

    // Revocation is immediate — a demoted manager must not keep access to a
    // former report's records for the remainder of the day.
    expect(await rolesOf('L1')).toEqual(['employee']);

    // The grant was made today by an earlier test, so it is removed rather than
    // closed. The audit trail carries the deletion.
    const audited = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE table_name = 'role_assignment' AND operation = 'DELETE'`);
    expect(audited.rows[0].n).toBeGreaterThan(0);
  });

  it('fails clearly on an unknown organisation', async () => {
    await expect(syncRoles('NOPE', false)).rejects.toThrow(/does not exist/);
  });
});

// ---------------------------------------------------------------------------

describe('open-goal-period', () => {
  const period = {
    orgCode: 'ACME', name: 'FY2026',
    startsOn: '2026-01-01', endsOn: '2026-12-31',
    periodType: 'annual', cadence: 'monthly',
  };

  it('opens a period', async () => {
    const c = captureOutput();
    await openGoalPeriod(period);
    c.restore();

    const row = await admin.query<{ state: string; checkin_cadence: string }>(
      `SELECT state, checkin_cadence FROM goal_period WHERE name='FY2026'`);
    expect(row.rows[0].state).toBe('open');
    expect(row.rows[0].checkin_cadence).toBe('monthly');
  });

  it('reopens a closed period without complaint', async () => {
    await admin.query(`UPDATE goal_period SET state='closed' WHERE name='FY2026'`);

    const c = captureOutput();
    await openGoalPeriod(period);
    c.restore();

    const row = await admin.query<{ state: string }>(
      `SELECT state FROM goal_period WHERE name='FY2026'`);
    expect(row.rows[0].state).toBe('open');
    expect(c.lines.join('\n')).toMatch(/was closed; it is now open/);
  });

  it('refuses to move the dates of an existing period', async () => {
    // Shifting the boundaries would change what goals already filed against it
    // were measured over.
    await expect(openGoalPeriod({ ...period, endsOn: '2027-06-30' }))
      .rejects.toThrow(/Refusing to move the boundaries/);
  });

  it('rejects an end date before the start', async () => {
    await expect(openGoalPeriod({ ...period, name: 'Bad', startsOn: '2026-12-31', endsOn: '2026-01-01' }))
      .rejects.toThrow(/must be after/);
  });

  it('rejects an unknown period type or cadence', async () => {
    await expect(openGoalPeriod({ ...period, name: 'B1', periodType: 'fortnightly' }))
      .rejects.toThrow(/--type must be one of/);
    await expect(openGoalPeriod({ ...period, name: 'B2', cadence: 'hourly' }))
      .rejects.toThrow(/--cadence must be one of/);
  });

  it('warns when a new period overlaps an open one', async () => {
    const c = captureOutput();
    await openGoalPeriod({ ...period, name: 'FY2026-H1', endsOn: '2026-06-30' });
    c.restore();
    expect(c.lines.join('\n')).toMatch(/overlaps 1 other open period/);
  });
});

// ---------------------------------------------------------------------------

describe('preflight', () => {
  beforeAll(async () => {
    // An earlier test closes I1's reporting line to prove manager revocation,
    // which leaves the org with two roots. Restore it: preflight asserting
    // "exactly one root" is a real check, and it should fail here only if
    // preflight is wrong, not because a previous test moved the furniture.
    await admin.query(
      `UPDATE reporting_line SET effective_to = NULL
        WHERE employee_id = (SELECT id FROM employee WHERE employee_no = 'I1')`);

    // Preflight legitimately fails without an administrator — nobody could
    // operate the system. Grant one so the "ready" assertion below is testing
    // preflight rather than an incomplete fixture.
    await admin.query(
      `INSERT INTO role_assignment (org_id, employee_id, role_id, effective_from)
            SELECT o.id, e.id, r.id, '2020-01-01'
              FROM organization o
              JOIN employee e ON e.org_id = o.id AND e.employee_no = 'B1'
              JOIN app_role r ON r.org_id = o.id AND r.code = 'hr_admin'
             WHERE o.code = 'ACME'`);
  });

  it('reports a provisioned organisation as ready', async () => {
    const c = captureOutput();
    const code = await preflight('ACME');
    c.restore();

    const output = c.lines.join('\n');
    expect(output).toMatch(/0 failed/);
    // Exit code 0 means "safe to proceed"; the installer propagates it.
    expect(code).toBe(0);
  });

  it('confirms the security invariants rather than assuming them', async () => {
    const c = captureOutput();
    await preflight('ACME');
    c.restore();
    const output = c.lines.join('\n');

    expect(output).toMatch(/Row-level security enabled/);
    expect(output).toMatch(/RLS forced for table owner/);
    expect(output).toMatch(/hr_app is a non-superuser without BYPASSRLS/);
  });

  it('fails when the application role can bypass RLS', async () => {
    // The single most dangerous misconfiguration possible: every policy in the
    // system becomes advisory. Preflight must catch it, not merely mention it.
    await admin.query('ALTER ROLE hr_app BYPASSRLS');
    try {
      const c = captureOutput();
      const code = await preflight('ACME');
      c.restore();

      expect(c.lines.join('\n')).toMatch(/BYPASSRLS/);
      expect(code).not.toBe(0);
    } finally {
      await admin.query('ALTER ROLE hr_app NOBYPASSRLS');
    }
  });

  it('fails on an unknown organisation', async () => {
    const c = captureOutput();
    const code = await preflight('NOSUCHORG').catch(() => 1);
    c.restore();
    expect(code).not.toBe(0);
  });

  it('reports the state of this run, not of every run before it', async () => {
    // The failure above must not still be counted here. A checklist that
    // remembers resolved failures is one an operator learns to ignore.
    const c = captureOutput();
    const code = await preflight('ACME');
    c.restore();

    expect(c.lines.join('\n')).toMatch(/0 failed/);
    expect(code).toBe(0);
    // One line per check, not two runs' worth.
    expect(c.lines.filter((l) => l.includes('Application role'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

/**
 * The two things the database cannot see: accounts that shipped with the source
 * tree, and whether the password grant was left on. Both are checked against a
 * stand-in for Keycloak's admin API — the shape of those two responses is the
 * whole contract, and a container per assertion would buy nothing.
 */
describe('preflight identity checks', () => {
  let kc: Server;
  let base: string;
  let realmUsers: unknown[] = [];
  let directAccessGrants = false;
  let clientExists = true;
  let failLogin = false;

  const config = () => ({
    url: base, realm: 'hr', clientId: 'hr-system',
    admin: 'kcadmin', password: 'secret',
  });
  const named = (checks: { name: string }[], name: string) =>
    checks.find((c) => c.name === name)!;

  beforeAll(async () => {
    kc = createServer((req, res) => {
      const url = req.url ?? '';
      res.setHeader('content-type', 'application/json');

      if (url.startsWith('/realms/master/protocol/openid-connect/token')) {
        if (failLogin) { res.statusCode = 401; res.end('{"error":"invalid_grant"}'); return; }
        res.end(JSON.stringify({ access_token: 't' }));
        return;
      }
      if (req.headers.authorization !== 'Bearer t') {
        res.statusCode = 401; res.end('{}'); return;
      }
      if (url.startsWith('/admin/realms/hr/users')) {
        res.end(JSON.stringify(realmUsers));
        return;
      }
      if (url.startsWith('/admin/realms/hr/clients')) {
        res.end(JSON.stringify(clientExists
          ? [{ clientId: 'hr-system', directAccessGrantsEnabled: directAccessGrants }]
          : []));
        return;
      }
      res.statusCode = 404; res.end('{}');
    });
    await new Promise<void>((r) => kc.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(kc.address() as AddressInfo).port}`;
  });

  afterAll(async () => { await new Promise((r) => kc.close(r)); });

  afterEach(() => {
    realmUsers = [];
    directAccessGrants = false;
    clientExists = true;
    failLogin = false;
    delete process.env.KC_ENABLE_PASSWORD_GRANT;
  });

  it('passes a realm whose users all come from the directory', async () => {
    realmUsers = [
      { username: 'r.villanueva', federationLink: 'ad-provider-id' },
      { username: 'g.ilagan', federationLink: 'ad-provider-id' },
    ];
    const checks = await identityChecks(config(), {});

    expect(named(checks, 'Demo accounts').severity).toBe('PASS');
    expect(named(checks, 'Password grant disabled').severity).toBe('PASS');
  });

  it('FAILS on the committed dev fixtures, and names them', async () => {
    // These six share the password test1234, which is in realm-hr.json in the
    // repository. On a live HR system that is a published credential, not a
    // warning about tidiness.
    realmUsers = ['maria', 'jose', 'ana', 'paolo', 'grace', 'ramon']
      .map((username) => ({ username }));

    const check = named(await identityChecks(config(), {}), 'Demo accounts');
    expect(check.severity).toBe('FAIL');
    expect(check.detail).toMatch(/maria/);
    expect(check.detail).toMatch(/committed dev fixtures/);
    expect(check.remedy).toMatch(/test1234/);
  });

  it('FAILS on seeded accounts that are not the named fixtures', async () => {
    // The 27 accounts ops/keycloak/seed-users.mjs creates carry the same
    // password but arbitrary usernames, so a hardcoded list would miss them.
    // Not being federated is what gives them away.
    realmUsers = Array.from({ length: 27 },
      (_, i) => ({ username: `person.${i}`, email: `person.${i}@devcore.ph` }));

    const check = named(await identityChecks(config(), {}), 'Demo accounts');
    expect(check.severity).toBe('FAIL');
    expect(check.detail).toMatch(/27 account\(s\)/);
  });

  it('counts only the local accounts when the realm holds both', async () => {
    realmUsers = [
      { username: 'real.person', federationLink: 'ad-provider-id' },
      { username: 'maria' },
    ];
    const check = named(await identityChecks(config(), {}), 'Demo accounts');
    expect(check.severity).toBe('FAIL');
    expect(check.detail).toMatch(/1 account\(s\)/);
  });

  it('FAILS when the SPA client accepts the password grant', async () => {
    directAccessGrants = true;
    const check = named(await identityChecks(config(), {}), 'Password grant disabled');
    expect(check.severity).toBe('FAIL');
    expect(check.remedy).toMatch(/KC_ENABLE_PASSWORD_GRANT/);
  });

  it('FAILS on the flag even when the client currently refuses the grant', async () => {
    // Turning it off in the admin console is undone by the next provisioning
    // run, so the environment is checked as well as the realm.
    const checks = await identityChecks(config(), { KC_ENABLE_PASSWORD_GRANT: 'true' });
    expect(named(checks, 'Password grant flag').severity).toBe('FAIL');
    expect(named(checks, 'Password grant disabled').severity).toBe('PASS');
  });

  it('FAILS when the SPA client is missing entirely', async () => {
    clientExists = false;
    const check = named(await identityChecks(config(), {}), 'Password grant disabled');
    expect(check.severity).toBe('FAIL');
    expect(check.detail).toMatch(/does not exist/);
  });

  it('does not report a pass it could not verify when Keycloak refuses it', async () => {
    failLogin = true;
    const checks = await identityChecks(config(), {});
    expect(named(checks, 'Demo accounts').severity).toBe('WARN');
    expect(named(checks, 'Password grant disabled').severity).toBe('WARN');
  });

  it('SKIPs rather than crashing when the credentials are absent', async () => {
    const cfg = keycloakConfigFromEnv({ KEYCLOAK_URL: 'http://kc:8080' });
    expect(cfg).toEqual({
      missing: ['KEYCLOAK_REALM', 'OIDC_AUDIENCE', 'KEYCLOAK_ADMIN',
                'KEYCLOAK_ADMIN_PASSWORD'],
    });

    const checks = await identityChecks(cfg, {});
    expect(named(checks, 'Demo accounts').severity).toBe('SKIP');
    expect(named(checks, 'Demo accounts').remedy).toMatch(/KEYCLOAK_ADMIN_PASSWORD/);
  });

  it('a skipped check does not fail the run, and is not reported as a pass', async () => {
    // install.sh runs preflight through `docker compose exec`, which carries no
    // Keycloak credentials unless they are passed for that call.
    const c = captureOutput();
    const code = await preflight('ACME');
    c.restore();
    const output = c.lines.join('\n');

    expect(code).toBe(0);
    expect(output).toMatch(/skip.*Demo accounts|Demo accounts/s);
    expect(output).toMatch(/not checked/);
    expect(output).not.toMatch(/no locally-created accounts/);
  });

  it('fails the whole run when preflight finds demo accounts', async () => {
    realmUsers = [{ username: 'maria' }];
    Object.assign(process.env, {
      KEYCLOAK_URL: base, KEYCLOAK_REALM: 'hr', OIDC_AUDIENCE: 'hr-system',
      KEYCLOAK_ADMIN: 'kcadmin', KEYCLOAK_ADMIN_PASSWORD: 'secret',
    });
    try {
      const c = captureOutput();
      const code = await preflight('ACME');
      c.restore();

      expect(code).toBe(1);
      expect(c.lines.join('\n')).toMatch(/FAIL.*\n.*maria/);
    } finally {
      for (const v of ['KEYCLOAK_URL', 'KEYCLOAK_REALM', 'OIDC_AUDIENCE',
                       'KEYCLOAK_ADMIN', 'KEYCLOAK_ADMIN_PASSWORD']) {
        delete process.env[v];
      }
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * seed-demo writes accounts whose password is public. The guard is the only
 * thing standing between a stale ADMIN_DATABASE_URL and a customer database.
 */
describe('seed-demo refuses an unsafe target', () => {
  let c: Client;

  beforeAll(async () => {
    c = new Client({ connectionString: adminUrl });
    await c.connect();
    await c.query(
      `INSERT INTO organization (code, name, timezone)
            VALUES ('FRESH', 'Freshly provisioned', 'Asia/Manila')
       ON CONFLICT (code) DO NOTHING`);
  });

  afterAll(async () => { await c.end(); });
  afterEach(() => { delete process.env.NODE_ENV; });

  it('allows an organisation with no employees', async () => {
    await expect(assertSafeTarget(c, 'FRESH', {}, {})).resolves.toBeUndefined();
  });

  it('allows an organisation that does not exist yet', async () => {
    await expect(assertSafeTarget(c, 'BRAND-NEW', {}, {})).resolves.toBeUndefined();
  });

  it('refuses an organisation holding people it did not create', async () => {
    // ACME here holds B1/L1/I1/N1 from the sync-roles fixture — employee
    // numbers seed-demo never writes. That is the signature of somebody else's
    // data, which is exactly the case the guard exists for.
    await expect(assertSafeTarget(c, 'ACME', {}, {}))
      .rejects.toBeInstanceOf(UnsafeSeedTargetError);
    await expect(assertSafeTarget(c, 'ACME', {}, {}))
      .rejects.toThrow(/ADMIN_DATABASE_URL points where you think it does/);
  });

  it('proceeds on that organisation only when told to explicitly', async () => {
    const realWarn = console.warn;
    const warned: string[] = [];
    console.warn = (...a: unknown[]) => { warned.push(a.join(' ')); };
    try {
      await expect(assertSafeTarget(c, 'ACME', { confirmed: true }, {}))
        .resolves.toBeUndefined();
    } finally {
      console.warn = realWarn;
    }
    expect(warned.join('\n')).toMatch(/--yes-i-mean-it/);
  });

  it('refuses outright under NODE_ENV=production, flag or no flag', async () => {
    // The compose file sets NODE_ENV=production on the api service, so this
    // holds on every deployed install even against an empty organisation.
    await expect(assertSafeTarget(c, 'FRESH', {}, { NODE_ENV: 'production' }))
      .rejects.toThrow(/NODE_ENV=production/);
    await expect(assertSafeTarget(c, 'FRESH', { confirmed: true }, { NODE_ENV: 'production' }))
      .rejects.toThrow(/There is no override/);
  });

  it('checks before it writes anything', async () => {
    const before = await c.query('SELECT count(*)::int AS n FROM employee');
    await assertSafeTarget(c, 'FRESH', {}, {}).catch(() => undefined);
    await assertSafeTarget(c, 'ACME', {}, {}).catch(() => undefined);
    const after = await c.query('SELECT count(*)::int AS n FROM employee');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

/**
 * `seed-activity` needs a different guard, and the difference is the point.
 *
 * seed-demo can recognise its own fixtures, so it only asks when it finds
 * somebody else's people. seed-activity is *for* orgs whose staff came from a
 * real 201 import, so that signal is absent — it must ask every time, because
 * what it writes (ratings, feedback, a PIP) is attached to named individuals.
 */
describe('seed-activity target guard', () => {
  let c: Client;

  beforeAll(async () => {
    c = new Client({ connectionString: adminUrl });
    await c.connect();
  });
  afterAll(async () => { await c.end(); });
  afterEach(() => { delete process.env.NODE_ENV; });

  it('refuses without explicit confirmation even for a known demo org', async () => {
    await expect(assertConfirmedTarget(c, 'ACME', {}, {}))
      .rejects.toBeInstanceOf(UnsafeSeedTargetError);
    await expect(assertConfirmedTarget(c, 'ACME', {}, {}))
      .rejects.toThrow(/--yes-i-mean-it/);
  });

  it('names the headcount, so a wrong target is visible in the refusal', async () => {
    // The number is the tell. "0 employee(s)" against an org you expected to be
    // full — or hundreds against one you expected empty — says more than any
    // wording could.
    await expect(assertConfirmedTarget(c, 'ACME', {}, {}))
      .rejects.toThrow(/ACME' \(\d+ employee\(s\)\)/);
  });

  it('proceeds when confirmed', async () => {
    await expect(assertConfirmedTarget(c, 'ACME', { confirmed: true }, {}))
      .resolves.toBeUndefined();
  });

  it('refuses under NODE_ENV=production even when confirmed', async () => {
    await expect(
      assertConfirmedTarget(c, 'ACME', { confirmed: true }, { NODE_ENV: 'production' }),
    ).rejects.toThrow(/There is no override/);
  });
});
