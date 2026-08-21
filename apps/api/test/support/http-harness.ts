/**
 * Boots the real API over HTTP, against a real PostgreSQL, behind a real OIDC
 * signature check.
 *
 * Nothing here is mocked. The AuthGuard is the system's outermost security
 * boundary, and a mocked guard would assert only that the mock was called. So
 * this harness generates an RSA key pair, serves a genuine JWKS from a local
 * HTTP server, and signs genuine RS256 tokens — which means every rejection
 * path (bad signature, wrong issuer, wrong audience, expired) is exercised by
 * the same jose verification the production server runs.
 *
 * Ordering matters: config.ts validates and freezes process.env at module load,
 * so every environment variable must be set before AppModule is imported. That
 * is why the imports below are dynamic.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import type { INestApplication } from '@nestjs/common';

const MIGRATIONS = join(__dirname, '../../../../db/migrations');

export const AUDIENCE = 'hr-system-test';

export interface Harness {
  app: INestApplication;
  /** BYPASSRLS pool, for seeding and assertions the API must not be able to make. */
  admin: Pool;
  /** Base URL of the running API, including the /api prefix. */
  url: string;
  /** Mints a valid token for an employee's IdP subject. */
  token(subject: string, overrides?: TokenOverrides): Promise<string>;
  /** The issuer this harness signs for. */
  issuer: string;
  stop(): Promise<void>;
}

export interface TokenOverrides {
  issuer?: string;
  audience?: string;
  expiresIn?: string | number;
  notBefore?: string | number;
  /** Sign with a different key — used to prove signatures are actually checked. */
  wrongKey?: boolean;
  /** Omit the subject entirely (the Keycloak `basic` scope failure mode). */
  noSubject?: boolean;
}

export async function startHarness(): Promise<Harness> {
  // --- database -----------------------------------------------------------
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('hr')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const admin = new Pool({ connectionString: container.getConnectionUri() });
  await admin.query(`
    CREATE ROLE hr_migrator LOGIN BYPASSRLS PASSWORD 'm';
    CREATE ROLE hr_app LOGIN NOBYPASSRLS PASSWORD 'a';
  `);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }

  const appUri = container.getConnectionUri().replace('postgres:postgres', 'hr_app:a');

  // The same guard every RLS suite carries. If the credential swap above ever
  // fails to match, the API would run as a superuser and every authorization
  // assertion in these tests would pass while testing nothing.
  const probe = new Pool({ connectionString: appUri });
  const who = await probe.query<{ user: string; bypass: boolean }>(
    `SELECT current_user AS user, usesuper AS bypass
       FROM pg_user WHERE usename = current_user`);
  await probe.end();
  if (who.rows[0]?.user !== 'hr_app' || who.rows[0]?.bypass) {
    throw new Error(
      `API test pool must connect as the non-superuser hr_app, got ` +
      `'${who.rows[0]?.user}' (superuser=${who.rows[0]?.bypass}).`);
  }

  // --- signing keys and a JWKS endpoint -----------------------------------
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const { privateKey: otherPrivate } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  const jwks: Server = createServer((req, res) => {
    if (req.url?.endsWith('/certs')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
  const jwksPort = (jwks.address() as AddressInfo).port;
  const jwksUrl = `http://127.0.0.1:${jwksPort}/certs`;

  // The issuer is deliberately NOT the JWKS host: on-prem they genuinely differ,
  // and that split is what OIDC_JWKS_URL exists for. Asserting it here means the
  // production configuration is the tested one.
  const issuer = 'https://hr.test/auth/realms/hr';

  // --- environment, before any app module is loaded -----------------------
  process.env.DATABASE_URL = appUri;
  process.env.OIDC_ISSUER_URL = issuer;
  process.env.OIDC_JWKS_URL = jwksUrl;
  process.env.OIDC_AUDIENCE = AUDIENCE;
  // Silent by default — a passing suite should print nothing. HARNESS_DEBUG=1
  // turns the API's own logs back on, which is the only way to see the cause of
  // a 500 raised inside a request.
  process.env.LOG_LEVEL = process.env.HARNESS_DEBUG ? 'debug' : 'silent';
  process.env.NODE_ENV = 'test';
  delete process.env.SMTP_HOST;

  const { Test } = await import('@nestjs/testing');
  const { AppModule } = await import('../../src/app.module');
  const { configureApp } = await import('../../src/main');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  await app.listen(0, '127.0.0.1');

  const url = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');

  async function token(subject: string, o: TokenOverrides = {}): Promise<string> {
    let t = new SignJWT({ ...(o.noSubject ? {} : { sub: subject }) })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setIssuer(o.issuer ?? issuer)
      .setAudience(o.audience ?? AUDIENCE)
      .setExpirationTime(o.expiresIn ?? '5m');
    if (o.notBefore !== undefined) t = t.setNotBefore(o.notBefore);
    return t.sign(o.wrongKey ? otherPrivate : privateKey);
  }

  return {
    app, admin, url, token, issuer,
    async stop() {
      await app?.close();
      await new Promise<void>((resolve) => jwks.close(() => resolve()));
      await admin?.end();
      await container?.stop();
    },
  };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export interface SeededPerson {
  id: string;
  employeeNo: string;
  subject: string;
}

export interface SeededOrg {
  orgId: string;
  ceo: SeededPerson;
  manager: SeededPerson;
  report: SeededPerson;
  hrAdmin: SeededPerson;
  outsider: SeededPerson;
  goalPeriodId: string;
}

/**
 * A minimal but realistic organisation: a CEO, a manager with one report, an HR
 * admin, and an unrelated employee in a different branch. That last one is the
 * important row — most authorization bugs are invisible until someone who
 * should see nothing asks for something.
 */
export async function seedOrg(admin: Pool, code = 'TESTCO'): Promise<SeededOrg> {
  const q = async <T extends Record<string, unknown>>(
    sql: string, params: unknown[] = [],
  ): Promise<T[]> => (await admin.query<T>(sql, params)).rows;

  await admin.query(`SELECT set_config('app.request_id', $1, false)`, [randomUUID()]);

  const orgId = (await q<{ id: string }>(
    `INSERT INTO organization (code, name, timezone)
          VALUES ($1, 'Test Co', 'Asia/Manila') RETURNING id`, [code]))[0]!.id;

  for (const fn of ['app.seed_baseline_roles', 'app.seed_phase1_grants',
    'app.seed_phase2_grants', 'app.seed_phase3_grants', 'app.seed_phase4_grants',
    'app.seed_reference_admin_grants', 'app.seed_phase5_feedback_grants',
    'app.seed_phase5_notification_grants', 'app.seed_phase6_grants', 'app.seed_help_grants',
    'app.seed_notification_templates']) {
    await admin.query(`SELECT ${fn}($1)`, [orgId]);
  }

  const deptId = (await q<{ id: string }>(
    `INSERT INTO department (org_id, code, name, effective_from)
          VALUES ($1,'ENG','Engineering','2020-01-01') RETURNING id`, [orgId]))[0]!.id;

  const typeId = (await q<{ id: string }>(
    `INSERT INTO employment_type (org_id, code, name, is_eligible_for_review)
          VALUES ($1,'REG','Regular',TRUE) RETURNING id`, [orgId]))[0]!.id;

  const positionId = (await q<{ id: string }>(
    `INSERT INTO position (org_id, title, department_id)
          VALUES ($1,'Engineer',$2) RETURNING id`, [orgId, deptId]))[0]!.id;

  async function person(no: string, first: string, last: string): Promise<SeededPerson> {
    const subject = randomUUID();
    const id = (await q<{ id: string }>(
      `INSERT INTO employee (org_id, employee_no, first_name, last_name,
                             work_email, idp_subject, hired_on)
            VALUES ($1,$2,$3,$4,$5,$6,'2020-01-01') RETURNING id`,
      [orgId, no, first, last, `${no}@test.local`, subject]))[0]!.id;
    await admin.query(
      `INSERT INTO employment (org_id, employee_id, employment_type_id, position_id,
                               department_id, status, effective_from)
            VALUES ($1,$2,$3,$4,$5,'regular','2020-01-01')`,
      [orgId, id, typeId, positionId, deptId]);
    return { id, employeeNo: no, subject };
  }

  const ceo = await person('E001', 'Cee', 'Oh');
  const manager = await person('E002', 'Mary', 'Manager');
  const report = await person('E003', 'Ricky', 'Report');
  const hrAdmin = await person('E004', 'Hilda', 'Ar');
  const outsider = await person('E005', 'Otto', 'Sider');

  const reportsTo = async (child: SeededPerson, parent: SeededPerson) =>
    admin.query(
      `INSERT INTO reporting_line (org_id, employee_id, supervisor_employee_id,
                                   effective_from)
            VALUES ($1,$2,$3,'2020-01-01')`, [orgId, child.id, parent.id]);

  await reportsTo(manager, ceo);
  await reportsTo(report, manager);
  await reportsTo(hrAdmin, ceo);
  await reportsTo(outsider, ceo);

  const grant = async (p: SeededPerson, roleCode: string) =>
    admin.query(
      `INSERT INTO role_assignment (org_id, employee_id, role_id, effective_from)
            SELECT $1,$2,r.id,'2020-01-01' FROM app_role r
             WHERE r.org_id=$1 AND r.code=$3`, [orgId, p.id, roleCode]);

  for (const p of [ceo, manager, report, hrAdmin, outsider]) await grant(p, 'employee');
  await grant(ceo, 'manager');
  await grant(manager, 'manager');
  await grant(hrAdmin, 'hr_admin');

  const goalPeriodId = (await q<{ id: string }>(
    `INSERT INTO goal_period (org_id, name, period_type, starts_on, ends_on,
                              state, checkin_cadence)
          VALUES ($1,'FY2026','annual','2026-01-01','2026-12-31','open','monthly')
       RETURNING id`, [orgId]))[0]!.id;

  return { orgId, ceo, manager, report, hrAdmin, outsider, goalPeriodId };
}
