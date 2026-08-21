/**
 * Pre-flight readiness check for a deployment.
 *
 * Answers one question: if a pilot department logged in tomorrow, what would
 * break? Every check reports a concrete remedy, because a checklist that says
 * "FAIL" without saying what to do is just anxiety.
 *
 * Four severities:
 *   FAIL  the pilot cannot run
 *   WARN  it will run, but something will surprise someone
 *   SKIP  could not be checked from here, and says what to set so it can be
 *   PASS  verified
 *
 * The security checks matter most. They verify the posture of THIS database,
 * not the one the test suite builds — a deployment where RLS was never enabled
 * passes every unit test and leaks everything. The identity checks do the same
 * for the realm: accounts whose password is committed to this repository are
 * not a database fact, so they have to be read from Keycloak itself.
 */
import { Client } from 'pg';

type Severity = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

interface Check {
  name: string;
  severity: Severity;
  detail: string;
  remedy?: string;
}

let results: Check[] = [];

const add = (name: string, severity: Severity, detail: string, remedy?: string) =>
  results.push(remedy ? { name, severity, detail, remedy } : { name, severity, detail });

export async function preflight(orgCode: string): Promise<number> {
  // Each run reports on the state of the system now, not on the union of every
  // run in this process — otherwise a resolved failure stays "failed" forever.
  results = [];

  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) {
    console.error('ADMIN_DATABASE_URL must be set');
    return 1;
  }

  const c = new Client({ connectionString: url });
  await c.connect();

  try {
    const org = await c.query<{ id: string; name: string }>(
      'SELECT id, name FROM organization WHERE code = $1', [orgCode]);
    if (!org.rows[0]) {
      console.error(`Organization '${orgCode}' does not exist.`);
      return 1;
    }
    const orgId = org.rows[0].id;

    await securityChecks(c);
    await schemaChecks(c);
    await peopleChecks(c, orgId);
    await configChecks(c, orgId);
    await notificationChecks(c, orgId);
    for (const check of await identityChecks(keycloakConfigFromEnv())) results.push(check);

    return report(org.rows[0].name, orgCode);
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------------------

async function securityChecks(c: Client): Promise<void> {
  // RLS is the security boundary (D-003). A table with it disabled is readable
  // by every authenticated user regardless of any policy written for it.
  const rls = await c.query<{ table_name: string; enabled: boolean; forced: boolean }>(
    `SELECT c.relname AS table_name, c.relrowsecurity AS enabled,
            c.relforcerowsecurity AS forced
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname NOT IN ('schema_migration')`);

  const missing = rls.rows.filter((r) => !r.enabled);
  const unforced = rls.rows.filter((r) => r.enabled && !r.forced);

  if (missing.length > 0) {
    add('Row-level security enabled', 'FAIL',
      `${missing.length} table(s) without RLS: ${missing.map((r) => r.table_name).join(', ')}`,
      'These tables are readable by any authenticated user. Do not go live.');
  } else {
    add('Row-level security enabled', 'PASS', `${rls.rows.length} tables protected`);
  }

  if (unforced.length > 0) {
    // Without FORCE, the table OWNER bypasses RLS — and the owner is the
    // migration role.
    add('RLS forced for table owner', 'FAIL',
      `${unforced.length} table(s) not FORCEd: ${unforced.map((r) => r.table_name).join(', ')}`,
      'ALTER TABLE ... FORCE ROW LEVEL SECURITY. The schema owner bypasses RLS otherwise.');
  } else {
    add('RLS forced for table owner', 'PASS', 'every table FORCEs RLS');
  }

  const appRole = await c.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
    `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'hr_app'`);
  if (!appRole.rows[0]) {
    add('Application role', 'FAIL', 'role hr_app does not exist',
      'The API must connect as a non-superuser role that owns nothing.');
  } else if (appRole.rows[0].rolbypassrls || appRole.rows[0].rolsuper) {
    add('Application role', 'FAIL',
      'hr_app can bypass RLS (superuser or BYPASSRLS)',
      'ALTER ROLE hr_app NOSUPERUSER NOBYPASSRLS. Every access rule is void otherwise.');
  } else {
    add('Application role', 'PASS', 'hr_app is a non-superuser without BYPASSRLS');
  }

  // Every mutable table should carry the audit trigger.
  const audited = await c.query<{ table_name: string }>(
    `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname NOT IN ('schema_migration', 'audit_log')
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger t
           WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
             AND t.tgname LIKE '%_audit')`);
  if (audited.rows.length > 0) {
    add('Audit coverage', 'WARN',
      `${audited.rows.length} table(s) without an audit trigger: ` +
      `${audited.rows.map((r) => r.table_name).join(', ')}`,
      'Changes to these tables leave no trail. Acceptable for pure child tables; ' +
      'check the list is what you expect.');
  } else {
    add('Audit coverage', 'PASS', 'all mutable tables audited');
  }
}

async function schemaChecks(c: Client): Promise<void> {
  const applied = await c.query<{ n: string }>(
    'SELECT count(*)::int AS n FROM schema_migration');
  add('Migrations applied', 'PASS', `${applied.rows[0]!.n} migrations recorded`);

  // A tenant boundary that has never been exercised in this database.
  const orgs = await c.query<{ n: string }>('SELECT count(*)::int AS n FROM organization');
  if (Number(orgs.rows[0]!.n) > 1) {
    add('Tenants', 'WARN', `${orgs.rows[0]!.n} organizations in this database`,
      'On-prem is expected to hold one. Confirm the extra rows are intentional.');
  } else {
    add('Tenants', 'PASS', 'single organization, as expected on-prem');
  }
}

async function peopleChecks(c: Client, orgId: string): Promise<void> {
  const active = await c.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM employee
      WHERE org_id = $1 AND deleted_at IS NULL AND status = 'active'`, [orgId]);
  const headcount = Number(active.rows[0]!.n);

  if (headcount === 0) {
    add('Employees loaded', 'FAIL', 'no active employees',
      'Import the 201 file: hr import-201 --org <CODE> --file <file> --dry-run');
    return;
  }
  add('Employees loaded', 'PASS', `${headcount} active employees`);

  const noEmail = await c.query<{ employee_no: string }>(
    `SELECT employee_no FROM employee
      WHERE org_id = $1 AND deleted_at IS NULL AND status = 'active'
        AND (work_email IS NULL OR work_email = '')`, [orgId]);
  if (noEmail.rows.length > 0) {
    add('Work emails', 'FAIL',
      `${noEmail.rows.length} employee(s) have no work email: ` +
      `${noEmail.rows.slice(0, 10).map((r) => r.employee_no).join(', ')}`,
      'They cannot sign in at all. Add Work_Email and re-run the import.');
  } else {
    add('Work emails', 'PASS', 'every active employee has one');
  }

  // Exactly one person should sit at the top of the chart.
  const noSupervisor = await c.query<{ employee_no: string }>(
    `SELECT e.employee_no FROM employee e
      WHERE e.org_id = $1 AND e.deleted_at IS NULL AND e.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM reporting_line rl
           WHERE rl.employee_id = e.id AND rl.line_type = 'primary'
             AND rl.effective_from <= CURRENT_DATE
             AND (rl.effective_to IS NULL OR CURRENT_DATE < rl.effective_to))`,
    [orgId]);

  if (noSupervisor.rows.length === 0) {
    add('Reporting lines', 'FAIL', 'nobody is at the top of the org chart',
      'Every employee has a supervisor, which implies a cycle. Check the CSV.');
  } else if (noSupervisor.rows.length === 1) {
    add('Reporting lines', 'PASS',
      `one root (${noSupervisor.rows[0]!.employee_no}), everyone else reports upward`);
  } else {
    add('Reporting lines', 'FAIL',
      `${noSupervisor.rows.length} employees have no supervisor: ` +
      `${noSupervisor.rows.slice(0, 10).map((r) => r.employee_no).join(', ')}`,
      'Their managers will see nothing and their goals cannot be approved. ' +
      'Exactly one person (the top) should have a blank Supervisor_ID.');
  }

  const noPosition = await c.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM employee e
       JOIN employment em ON em.employee_id = e.id AND em.effective_to IS NULL
      WHERE e.org_id = $1 AND e.status = 'active' AND em.position_id IS NULL`, [orgId]);
  if (Number(noPosition.rows[0]!.n) > 0) {
    add('Positions', 'WARN', `${noPosition.rows[0]!.n} employee(s) hold no position`,
      'They are excluded from competency gap reports and career paths.');
  } else {
    add('Positions', 'PASS', 'every employee holds a position');
  }

  const admins = await c.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM role_assignment ra
       JOIN app_role r ON r.id = ra.role_id
      WHERE ra.org_id = $1 AND r.code = 'hr_admin'
        AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_DATE)`, [orgId]);
  if (Number(admins.rows[0]!.n) === 0) {
    add('HR administrator', 'FAIL', 'nobody holds the hr_admin role',
      'Nobody can administer the system. Run: hr grant-admin --org <CODE> ' +
      '--employee-no <NO>');
  } else {
    add('HR administrator', 'PASS', `${admins.rows[0]!.n} assigned`);
  }

  const idpLinked = await c.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM employee
      WHERE org_id = $1 AND idp_subject IS NOT NULL`, [orgId]);
  add('Identity links', Number(idpLinked.rows[0]!.n) > 0 ? 'PASS' : 'WARN',
    `${idpLinked.rows[0]!.n} employee(s) have signed in at least once`,
    Number(idpLinked.rows[0]!.n) === 0
      ? 'Expected before launch. Each link is created on that person\'s first login, ' +
        'matched by work email — so the emails must match the directory exactly.'
      : undefined);
}

async function configChecks(c: Client, orgId: string): Promise<void> {
  // The single most common launch failure: an employee with no form, silently
  // skipped when the cycle generates.
  const noForm = await c.query<{ employee_no: string }>(
    `SELECT e.employee_no
       FROM employee e
       JOIN employment em ON em.employee_id = e.id AND em.effective_to IS NULL
       JOIN employment_type et ON et.id = em.employment_type_id
                              AND et.is_eligible_for_review
      WHERE e.org_id = $1 AND e.deleted_at IS NULL AND e.status = 'active'
        AND app.resolve_form_version(e.id) IS NULL`, [orgId]);

  const defaultAssignment = await c.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM form_template_assignment
      WHERE org_id = $1 AND employment_type_id IS NULL AND app_role_id IS NULL`,
    [orgId]);

  if (Number(defaultAssignment.rows[0]!.n) === 0) {
    add('Review form assignment', 'FAIL', 'no organisation-wide default form',
      'Anyone not matched by a specific rule is skipped when a cycle generates. ' +
      'Setup → Review forms → Who gets which form.');
  } else if (noForm.rows.length > 0) {
    add('Review form assignment', 'FAIL',
      `${noForm.rows.length} review-eligible employee(s) resolve to no form`,
      'They will be silently skipped at cycle generation.');
  } else {
    add('Review form assignment', 'PASS',
      'every review-eligible employee resolves to a form');
  }

  const scale = await c.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM rating_scale WHERE org_id = $1 AND is_active`,
    [orgId]);
  if (Number(scale.rows[0]!.n) === 0) {
    add('Rating scale', 'WARN', 'no active rating scale',
      'Rating questions will render with no options.');
  } else {
    add('Rating scale', 'PASS', `${scale.rows[0]!.n} active`);
  }

  const period = await c.query<{ name: string; state: string }>(
    `SELECT name, state::text AS state FROM goal_period
      WHERE org_id = $1 AND state = 'open' ORDER BY starts_on DESC LIMIT 1`, [orgId]);
  if (!period.rows[0]) {
    add('Goal period', 'WARN', 'no open goal period',
      'Nobody can create goals. Open one in the HR console.');
  } else {
    add('Goal period', 'PASS', `${period.rows[0].name} is open`);
  }

  const eligible = await c.query<{ code: string; name: string }>(
    `SELECT code, name FROM employment_type
      WHERE org_id = $1 AND is_active AND is_eligible_for_review`, [orgId]);
  add('Review-eligible employment types', 'PASS',
    eligible.rows.map((r) => r.code).join(', ') || 'none',
    eligible.rows.length === 0
      ? 'No employment type is review-eligible, so a cycle would generate nothing.'
      : 'Confirm this list is right — it decides who a review cycle picks up.');
}

async function notificationChecks(c: Client, orgId: string): Promise<void> {
  const templates = await c.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM notification_template
      WHERE org_id = $1 AND is_active`, [orgId]);
  if (Number(templates.rows[0]!.n) === 0) {
    add('Email templates', 'WARN', 'none active',
      'Notifications will still queue, and send a plain fallback message.');
  } else {
    add('Email templates', 'PASS', `${templates.rows[0]!.n} active`);
  }

  const stuck = await c.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM notification_outbox WHERE state = 'failed'`);
  if (Number(stuck.rows[0]!.n) > 0) {
    add('Notification queue', 'WARN', `${stuck.rows[0]!.n} failed notification(s)`,
      'Check the relay settings; see Notifications → Delivery queue.');
  } else {
    add('Notification queue', 'PASS', 'nothing failed');
  }

  if (!process.env.SMTP_HOST) {
    add('SMTP relay', 'WARN', 'SMTP_HOST is not set in this environment',
      'Notifications queue durably but never send. Set SMTP_HOST/SMTP_PORT on the ' +
      'API service.');
  } else {
    add('SMTP relay', 'PASS', `configured: ${process.env.SMTP_HOST}`);
  }
}

// --- identity (Keycloak) ---------------------------------------------------

/**
 * The demo fixtures in ops/keycloak/realm-hr.json. Their password is committed
 * to this repository, so on a live system each one is a published credential.
 */
const FIXTURE_USERNAMES = ['maria', 'jose', 'ana', 'paolo', 'grace', 'ramon'];

export interface KeycloakConfig {
  url: string;
  realm: string;
  clientId: string;
  admin: string;
  password: string;
}

/**
 * Reads the realm admin credentials from the environment.
 *
 * Returns the names of what is missing rather than throwing: preflight runs in
 * places that have a database URL and nothing else (the installer's `docker
 * compose exec` among them), and a readiness check that crashes because it
 * could not check something is worse than one that says so.
 */
export function keycloakConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): KeycloakConfig | { missing: string[] } {
  const required = {
    url: env.KEYCLOAK_URL,
    realm: env.KEYCLOAK_REALM,
    clientId: env.OIDC_AUDIENCE,
    admin: env.KEYCLOAK_ADMIN,
    password: env.KEYCLOAK_ADMIN_PASSWORD,
  };
  const names: Record<keyof typeof required, string> = {
    url: 'KEYCLOAK_URL', realm: 'KEYCLOAK_REALM', clientId: 'OIDC_AUDIENCE',
    admin: 'KEYCLOAK_ADMIN', password: 'KEYCLOAK_ADMIN_PASSWORD',
  };
  const missing = (Object.keys(required) as (keyof typeof required)[])
    .filter((k) => !required[k]).map((k) => names[k]);

  if (missing.length > 0) return { missing };
  return {
    url: required.url!.replace(/\/$/, ''),
    realm: required.realm!,
    clientId: required.clientId!,
    admin: required.admin!,
    password: required.password!,
  };
}

interface KeycloakUser {
  username: string;
  email?: string;
  federationLink?: string;
  origin?: string;
}

/** Admin-API session against the realm. Same login the provisioner uses. */
async function keycloakAdmin(cfg: KeycloakConfig) {
  const res = await fetch(`${cfg.url}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'admin-cli',
      username: cfg.admin, password: cfg.password,
    }),
  });
  if (!res.ok) {
    throw new Error(`admin login failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const token = ((await res.json()) as { access_token: string }).access_token;

  return async <T>(path: string): Promise<T> => {
    const r = await fetch(`${cfg.url}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      throw new Error(`GET ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    return (await r.json()) as T;
  };
}

/**
 * Two things the database cannot see: accounts that came with the source tree,
 * and whether the password grant was left switched on.
 *
 * Both are FAIL rather than WARN. An account whose password is published in a
 * public repository is not a caveat on a system holding personnel records, and
 * the password grant turns every such account into a token endpoint that skips
 * the browser flow entirely.
 */
export async function identityChecks(
  cfg: KeycloakConfig | { missing: string[] },
  env: NodeJS.ProcessEnv = process.env,
): Promise<Check[]> {
  const out: Check[] = [];
  const push = (name: string, severity: Severity, detail: string, remedy?: string) =>
    out.push(remedy ? { name, severity, detail, remedy } : { name, severity, detail });

  // Independent of Keycloak: the flag decides what the NEXT provisioning run
  // configures, so leaving it set re-enables the grant even after it is turned
  // off in the admin console.
  if (env.KC_ENABLE_PASSWORD_GRANT === 'true') {
    push('Password grant flag', 'FAIL',
      'KC_ENABLE_PASSWORD_GRANT=true in this environment',
      'It exists to smoke-test a pilot. Remove it from .env and re-run ' +
      'ops/keycloak/provision-realm.mjs, or the next provisioning run turns the ' +
      'direct-access grant back on.');
  } else {
    push('Password grant flag', 'PASS', 'KC_ENABLE_PASSWORD_GRANT is not set');
  }

  if ('missing' in cfg) {
    const remedy = `Set ${cfg.missing.join(', ')} for this command and re-run. ` +
      'Until then nothing has verified that the demo fixtures are gone from the ' +
      'realm, or that the SPA client refuses the password grant.';
    push('Demo accounts', 'SKIP', 'Keycloak not reachable from this command', remedy);
    push('Password grant disabled', 'SKIP', 'Keycloak not reachable from this command', remedy);
    return out;
  }

  let get: <T>(path: string) => Promise<T>;
  try {
    get = await keycloakAdmin(cfg);
  } catch (err) {
    const detail = `could not query Keycloak at ${cfg.url}: ` +
      `${err instanceof Error ? err.message : String(err)}`;
    push('Demo accounts', 'WARN', detail,
      'Neither identity check ran. Verify the realm by hand before go-live.');
    push('Password grant disabled', 'WARN', detail,
      'Check the client\'s Direct access grants setting in the admin console.');
    return out;
  }

  // --- demo accounts -------------------------------------------------------
  try {
    const realm = encodeURIComponent(cfg.realm);
    const users = await get<KeycloakUser[]>(
      `/admin/realms/${realm}/users?briefRepresentation=true&max=2000`);

    // A directory-backed account carries a federationLink. Everything else was
    // created locally with a password set outside Active Directory — which is
    // what both seeding scripts do, and what nothing on a real install should.
    const local = users.filter((u) => !u.federationLink);
    const fixtures = local.filter((u) => FIXTURE_USERNAMES.includes(u.username));

    if (local.length > 0) {
      const shown = local.slice(0, 15).map((u) => u.username).join(', ');
      push('Demo accounts', 'FAIL',
        `${local.length} account(s) in realm '${cfg.realm}' are not federated from ` +
        `the directory: ${shown}${local.length > 15 ? ', …' : ''}` +
        (fixtures.length > 0
          ? ` — ${fixtures.length} of them are the committed dev fixtures`
          : ''),
        'Delete them. The dev fixtures share the password test1234, which is in ' +
        'ops/keycloak/realm-hr.json in this repository; the accounts made by ' +
        'ops/keycloak/seed-users.mjs share it too. Real staff sign in through ' +
        'Active Directory, so a correct realm has no locally-created users at all. ' +
        'If one of these is a deliberate break-glass account, give it a password ' +
        'that was never committed and expect this check to keep flagging it.');
    } else {
      push('Demo accounts', 'PASS',
        `no locally-created accounts in realm '${cfg.realm}' ` +
        `(${users.length} federated)`);
    }
  } catch (err) {
    push('Demo accounts', 'WARN',
      `could not list realm users: ${err instanceof Error ? err.message : String(err)}`,
      'Verify by hand that no demo fixtures remain in the realm.');
  }

  // --- password grant on the SPA client ------------------------------------
  try {
    const realm = encodeURIComponent(cfg.realm);
    const clients = await get<{ clientId: string; directAccessGrantsEnabled?: boolean }[]>(
      `/admin/realms/${realm}/clients?clientId=${encodeURIComponent(cfg.clientId)}`);
    const client = clients[0];

    if (!client) {
      push('Password grant disabled', 'FAIL',
        `client '${cfg.clientId}' does not exist in realm '${cfg.realm}'`,
        'Nobody can sign in at all. Run ops/keycloak/provision-realm.mjs.');
    } else if (client.directAccessGrantsEnabled) {
      push('Password grant disabled', 'FAIL',
        `client '${cfg.clientId}' has direct access grants enabled`,
        'Any holder of a username and password can mint tokens directly, ' +
        'bypassing the browser flow, MFA and the identity provider. Unset ' +
        'KC_ENABLE_PASSWORD_GRANT and re-run ops/keycloak/provision-realm.mjs.');
    } else {
      push('Password grant disabled', 'PASS',
        `client '${cfg.clientId}' refuses the resource-owner password grant`);
    }
  } catch (err) {
    push('Password grant disabled', 'WARN',
      `could not read the client: ${err instanceof Error ? err.message : String(err)}`,
      'Check the client\'s Direct access grants setting in the admin console.');
  }

  return out;
}

// ---------------------------------------------------------------------------

function report(orgName: string, orgCode: string): number {
  const icon = { PASS: '  ok  ', WARN: ' warn ', FAIL: ' FAIL ', SKIP: ' skip ' };
  const fails = results.filter((r) => r.severity === 'FAIL');
  const warns = results.filter((r) => r.severity === 'WARN');
  const skips = results.filter((r) => r.severity === 'SKIP');

  console.log(`\nPre-flight check — ${orgName} (${orgCode})\n`);
  for (const r of results) {
    console.log(`[${icon[r.severity]}] ${r.name}`);
    console.log(`          ${r.detail}`);
    if (r.remedy && r.severity !== 'PASS') console.log(`          → ${r.remedy}`);
  }

  console.log(`\n${results.length} checks · ${fails.length} failed · ${warns.length} warnings` +
              `${skips.length > 0 ? ` · ${skips.length} not checked` : ''}\n`);

  if (fails.length > 0) {
    console.log('NOT READY. Resolve the failures above before the pilot.\n');
    return 1;
  }
  if (skips.length > 0) {
    console.log('Ready, but not everything could be checked from here. A skipped ' +
                'check is not a passed one — read them above.\n');
    return 0;
  }
  if (warns.length > 0) {
    console.log('Ready, with caveats. Read the warnings — none blocks a pilot.\n');
    return 0;
  }
  console.log('Ready.\n');
  return 0;
}
