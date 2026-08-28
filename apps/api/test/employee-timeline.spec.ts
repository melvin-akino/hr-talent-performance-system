import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * F1 — one employee's history in one place (requirements §7.1).
 *
 * The property that matters is not the ordering. It is that a consolidated view
 * is the obvious place for confidential assessment to leak: five sources, each
 * with its own visibility rule, joined into one list. `app.employee_timeline`
 * re-implements none of those rules — it runs as the caller and each source
 * filters itself — and the tests below are what holds that to account.
 *
 * These MUST run as the unprivileged role. A superuser bypasses RLS entirely,
 * and every deny-assertion here would pass vacuously against one.
 */

const MIGRATIONS = join(__dirname, '../../../db/migrations');

let container: StartedPostgreSqlContainer;
let admin: Pool;
let app: Pool;
const ids: Record<string, string> = {};

interface Event {
  occurred_on: string; kind: string; title: string;
  detail: string | null; result: string | null;
}

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

/** The timeline for `subject`, as `viewer` sees it. */
const timelineOf = (viewer: string, subject: string) => as<Event>(viewer,
  `SELECT occurred_on::text, kind::text AS kind, title, detail, result
     FROM app.employee_timeline($1)`, [subject]);

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
    throw new Error(
      `Timeline tests must run as non-superuser hr_app, got '${who.rows[0]?.user}'. `
      + 'A superuser bypasses RLS and every deny-assertion below would be vacuous.');
  }

  await seed();
}, 240_000);

afterAll(async () => {
  await app?.end();
  await admin?.end();
  await container?.stop();
});

async function seed(): Promise<void> {
  const org = (await admin.query(
    `INSERT INTO organization (code,name) VALUES ('GGC','Guanzon') RETURNING id`)).rows[0].id;
  ids.org = org;
  ids.dept = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'CB','Compensation & Benefits','2020-01-01') RETURNING id`, [org])).rows[0].id;
  ids.etype = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','Regular') RETURNING id`,
    [org])).rows[0].id;
  ids.position = (await admin.query(
    `INSERT INTO position (org_id,title,department_id)
     VALUES ($1,'Associate',$2) RETURNING id`, [org, ids.dept])).rows[0].id;

  const emp = async (no: string) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,position_id,department_id,
                               employment_type_id,status,effective_from,event_type)
       VALUES ($1,$2,$3,$4,$5,'regular','2020-01-01','hire')`,
      [org, id, ids.position, ids.dept, ids.etype]);
    return id;
  };

  ids.hrAdmin = await emp('hradmin');
  ids.supervisor = await emp('supervisor');
  ids.subject = await emp('subject');
  ids.peer = await emp('peer');

  await admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, ids.subject, ids.supervisor]);

  for (const fn of ['seed_baseline_roles', 'seed_phase1_grants', 'seed_phase2_grants',
                    'seed_phase3_grants', 'seed_phase4_grants', 'seed_line_role_grants',
                    'seed_scorecard_grants', 'seed_evaluation_grants']) {
    await admin.query(`SELECT app.${fn}($1)`, [org]);
  }

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, e, r]);

  const rEmp = await role('employee');
  for (const e of [ids.hrAdmin, ids.supervisor, ids.subject, ids.peer]) await assign(e, rEmp);
  await assign(ids.hrAdmin, await role('hr_admin'));
  await assign(ids.supervisor, await role('manager'));

  // --- a promotion, so the timeline has an "action taken" to show -----------
  await admin.query(
    `UPDATE employment SET effective_to = '2026-07-01'
      WHERE employee_id = $1 AND effective_to IS NULL`, [ids.subject]);
  ids.seniorPosition = (await admin.query(
    `INSERT INTO position (org_id,title,department_id)
     VALUES ($1,'Senior Associate',$2) RETURNING id`, [org, ids.dept])).rows[0].id;
  await admin.query(
    `INSERT INTO employment (org_id,employee_id,position_id,department_id,
                             employment_type_id,status,effective_from,event_type,
                             change_reason)
     VALUES ($1,$2,$3,$4,$5,'regular','2026-07-01','promotion','Strong FY2025')`,
    [org, ids.subject, ids.seniorPosition, ids.dept, ids.etype]);

  // --- a task evaluation, left as a DRAFT -----------------------------------
  ids.scorecard = (await admin.query(
    `INSERT INTO scorecard (org_id,name,department_id)
     VALUES ($1,'Social Insurances',$2) RETURNING id`, [org, ids.dept])).rows[0].id;
  const indicator = (await admin.query(
    `INSERT INTO task_indicator (org_id,name,nature)
     VALUES ($1,'Claims Processing','administrative') RETURNING id`, [org])).rows[0].id;
  await admin.query(
    `INSERT INTO scorecard_item (org_id,scorecard_id,task_indicator_id,points,sequence)
     VALUES ($1,$2,$3,4,1)`, [org, ids.scorecard, indicator]);
  await admin.query(
    `INSERT INTO scorecard_assignment (org_id,scorecard_id,employee_id,effective_from)
     VALUES ($1,$2,$3,'2026-01-01')`, [org, ids.scorecard, ids.subject]);

  ids.draftEval = (await as<{ id: string }>(ids.supervisor,
    `SELECT app.open_scorecard_evaluation($1,'2026-01-01','2026-03-31',$2) AS id`,
    [ids.subject, ids.supervisor]))[0]!.id;

  // --- a second evaluation, submitted ---------------------------------------
  ids.doneEval = (await as<{ id: string }>(ids.supervisor,
    `SELECT app.open_scorecard_evaluation($1,'2026-04-01','2026-06-30',$2) AS id`,
    [ids.subject, ids.supervisor]))[0]!.id;
  await as(ids.supervisor,
    `UPDATE scorecard_evaluation_line SET points_awarded = 3 WHERE evaluation_id = $1`,
    [ids.doneEval]);
  await as(ids.supervisor,
    `SELECT app.submit_scorecard_evaluation($1)`, [ids.doneEval]);
}

describe('what the timeline gathers', () => {
  it('draws the whole record from every source, newest first', async () => {
    const events = await timelineOf(ids.hrAdmin, ids.subject);
    const kinds = events.map((e) => e.kind);

    expect(kinds).toContain('employment_event');
    expect(kinds).toContain('task_evaluation');

    const dates = events.map((e) => e.occurred_on);
    expect([...dates]).toEqual([...dates].sort().reverse());
  });

  it('puts an evaluation at the period it describes, not the day it was signed',
    async () => {
      // The Q2 evaluation was submitted today; it belongs at 30 June, because
      // the reader is asking what this person's Q2 was.
      const events = await timelineOf(ids.hrAdmin, ids.subject);
      const q2 = events.find((e) => e.kind === 'task_evaluation'
        && e.occurred_on === '2026-06-30');
      expect(q2).toBeDefined();
      expect(q2!.result).toBe('3 / 4');
    });

  it('shows the promotion, with the reason it was given', async () => {
    // "Actions taken", the other half of the client's sentence -- and what lets
    // a reader see that a promotion followed a strong year.
    const events = await timelineOf(ids.hrAdmin, ids.subject);
    const promotion = events.find((e) => e.title === 'Promotion');
    expect(promotion).toBeDefined();
    expect(promotion!.occurred_on).toBe('2026-07-01');
    expect(promotion!.detail).toContain('Senior Associate');
    expect(promotion!.result).toBe('Strong FY2025');
  });

  it('renders a whole-number score without a trailing dot', async () => {
    // to_char with FM strips trailing zeros and leaves the point behind, so
    // 4.00 came out as "4." — which reads on screen as a truncation bug.
    const events = await timelineOf(ids.hrAdmin, ids.subject);
    const scored = events.filter((e) => e.result !== null);
    expect(scored.length).toBeGreaterThan(0);
    for (const e of scored) expect(e.result).not.toMatch(/\.$/);
  });

  it('narrows to a window when asked', async () => {
    const window = await as<Event>(ids.hrAdmin,
      `SELECT occurred_on::text, kind::text AS kind, title, detail, result
         FROM app.employee_timeline($1, '2026-04-01', '2026-06-30')`, [ids.subject]);
    expect(window.length).toBeGreaterThan(0);
    for (const e of window) {
      expect(e.occurred_on >= '2026-04-01').toBe(true);
      expect(e.occurred_on <= '2026-06-30').toBe(true);
    }
  });
});

describe('the timeline shows nothing the screens would not', () => {
  it('hides a draft evaluation from its subject', async () => {
    // The rule from 0033, inherited rather than restated. If this ever fails,
    // the consolidated view has become the leak.
    const own = await timelineOf(ids.subject, ids.subject);
    const drafts = own.filter((e) => e.detail === 'Draft');
    expect(drafts).toEqual([]);

    // And the supervisor, who is writing it, does see it.
    const theirs = await timelineOf(ids.supervisor, ids.subject);
    expect(theirs.some((e) => e.detail === 'Draft')).toBe(true);
  });

  it('shows the subject their own submitted evaluation', async () => {
    // The other half of the same rule: a score you cannot see is indefensible.
    const own = await timelineOf(ids.subject, ids.subject);
    const submitted = own.find((e) => e.kind === 'task_evaluation'
      && e.detail === 'Submitted');
    expect(submitted?.result).toBe('3 / 4');
  });

  it('keeps a colleague out of the assessment entirely', async () => {
    const peerView = await timelineOf(ids.peer, ids.subject);
    expect(peerView.filter((e) => e.kind === 'task_evaluation')).toEqual([]);
  });

  it('returns nothing at all without an identity', async () => {
    // Fails closed. The function is SECURITY INVOKER, so no identity means no
    // org, and every source's tenant predicate is false.
    const anonymous = await as<Event>(null,
      `SELECT occurred_on::text, kind::text AS kind, title, detail, result
         FROM app.employee_timeline($1)`, [ids.subject]);
    expect(anonymous).toEqual([]);
  });

  it('does not become a way to read a colleague you cannot otherwise see',
    async () => {
      // A peer can see employment history — that is public inside the tenant —
      // but the assessment rows are what the confidentiality rules protect, and
      // those are the ones that must be absent.
      const peerView = await timelineOf(ids.peer, ids.subject);
      const confidential = peerView.filter(
        (e) => e.kind === 'task_evaluation' || e.kind === 'review');
      expect(confidential).toEqual([]);
    });
});
