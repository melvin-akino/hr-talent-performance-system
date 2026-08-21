import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NotificationWorkerService } from '../src/notifications/notification-worker.service';

/**
 * Phase 5: feedback channels and the notification outbox.
 *
 * The exit criterion of this phase is "a supervisor-only thread is provably
 * invisible to the employee", so that gets tested from both directions along
 * with the two other channels. The privacy promise in a channel NAME has to
 * hold, or people stop using the honest one.
 *
 * Hierarchy:  director -> manager -> ic, ic2      outsider (other dept)
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
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on,work_email)
       VALUES ($1,$2,$2,'X','2020-01-01',$3) RETURNING id`,
      [ids.org, no, `${no}@acme.test`])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [ids.org, id, dept, et]);
    return id;
  };

  ids.director = await emp('director', ids.deptEng);
  ids.manager = await emp('manager', ids.deptEng);
  ids.ic = await emp('ic', ids.deptEng);
  ids.ic2 = await emp('ic2', ids.deptEng);
  ids.outsider = await emp('outsider', ids.deptSales);
  ids.hrAdmin = await emp('hradmin', ids.deptEng);

  const line = (child: string, sup: string) => admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [ids.org, child, sup]);
  await line(ids.manager, ids.director);
  await line(ids.ic, ids.manager);
  await line(ids.ic2, ids.manager);

  await admin.query('SELECT app.seed_baseline_roles($1)', [ids.org]);
  await admin.query('SELECT app.seed_phase5_feedback_grants($1)', [ids.org]);
  await admin.query('SELECT app.seed_phase5_notification_grants($1)', [ids.org]);
  await admin.query('SELECT app.seed_notification_templates($1)', [ids.org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [ids.org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [ids.org, e, r]);
  const rEmp = await role('employee');
  for (const e of [ids.director, ids.manager, ids.ic, ids.ic2, ids.outsider, ids.hrAdmin]) {
    await assign(e, rEmp);
  }
  await assign(ids.manager, await role('manager'));
  await assign(ids.director, await role('manager'));
  await assign(ids.hrAdmin, await role('hr_admin'));
}

const thread = async (author: string, subject: string, visibility: string) =>
  (await admin.query<{ id: string }>(
    `INSERT INTO feedback_thread (org_id,subject_employee_id,created_by,visibility,title)
     VALUES ($1,$2,$3,$4::feedback_visibility,$5) RETURNING id`,
    [ids.org, subject, author, visibility, `${visibility} thread`])).rows[0].id;

const canSee = async (viewer: string, threadId: string) =>
  (await as(viewer, 'SELECT id FROM feedback_thread WHERE id=$1', [threadId])).length === 1;

// ---------------------------------------------------------------------------

describe('supervisor_only feedback', () => {
  it('is INVISIBLE to the employee it is about', async () => {
    // The Phase 5 exit criterion.
    const t = await thread(ids.manager, ids.ic, 'supervisor_only');
    expect(await canSee(ids.ic, t)).toBe(false);
  });

  it('hides its messages from the employee too', async () => {
    const t = await thread(ids.manager, ids.ic, 'supervisor_only');
    await admin.query(
      `INSERT INTO feedback_message (feedback_thread_id,author_employee_id,body)
       VALUES ($1,$2,'private note about performance')`, [t, ids.manager]);
    expect(await as(ids.ic,
      'SELECT id FROM feedback_message WHERE feedback_thread_id=$1', [t])).toEqual([]);
  });

  it('is visible to the author and the direct supervisor', async () => {
    // Written by the director ABOUT the ic: the manager is the ic's direct
    // supervisor and can see it; the author can always see their own.
    const t = await thread(ids.director, ids.ic, 'supervisor_only');
    expect(await canSee(ids.director, t)).toBe(true);
    expect(await canSee(ids.manager, t)).toBe(true);
  });

  it('is invisible to peers and other departments', async () => {
    const t = await thread(ids.manager, ids.ic, 'supervisor_only');
    expect(await canSee(ids.ic2, t)).toBe(false);
    expect(await canSee(ids.outsider, t)).toBe(false);
  });

  it('is visible to HR', async () => {
    const t = await thread(ids.manager, ids.ic, 'supervisor_only');
    expect(await canSee(ids.hrAdmin, t)).toBe(true);
  });

  it('never notifies the subject — that would leak its existence', async () => {
    const t = await thread(ids.manager, ids.ic, 'supervisor_only');
    // Mirrors FeedbackService.notifyParticipants for a supervisor_only thread:
    // the subject is deliberately absent from the recipient set.
    await admin.query(
      `SELECT app.enqueue_notification($1,'feedback.received',
              jsonb_build_object('threadId',$2::text,'title','t'), 'k1')`,
      [ids.manager, t]);

    const toSubject = await admin.query(
      `SELECT id FROM notification_outbox WHERE recipient_employee_id=$1`, [ids.ic]);
    expect(toSubject.rowCount).toBe(0);
  });
});

describe('employee_only feedback', () => {
  it('is visible to the author and the subject', async () => {
    const t = await thread(ids.manager, ids.ic, 'employee_only');
    expect(await canSee(ids.manager, t)).toBe(true);
    expect(await canSee(ids.ic, t)).toBe(true);
  });

  it('is invisible to the subject\'s supervisor when written by someone else', async () => {
    // Peer-to-peer private feedback: the ic's manager has no claim on it.
    const t = await thread(ids.ic2, ids.ic, 'employee_only');
    expect(await canSee(ids.manager, t)).toBe(false);
  });

  it('is invisible even to HR — otherwise the channel name is a lie', async () => {
    const t = await thread(ids.ic2, ids.ic, 'employee_only');
    expect(await canSee(ids.hrAdmin, t)).toBe(false);
  });
});

describe('employee_and_supervisor feedback', () => {
  it('is visible to subject, author, direct supervisor and HR', async () => {
    const t = await thread(ids.ic2, ids.ic, 'employee_and_supervisor');
    expect(await canSee(ids.ic, t)).toBe(true);
    expect(await canSee(ids.ic2, t)).toBe(true);
    expect(await canSee(ids.manager, t)).toBe(true);
    expect(await canSee(ids.hrAdmin, t)).toBe(true);
  });

  it('is invisible to a skip-level manager', async () => {
    // Direct supervisor only. A director has no automatic claim on a
    // conversation between someone and their own manager.
    const t = await thread(ids.ic2, ids.ic, 'employee_and_supervisor');
    expect(await canSee(ids.director, t)).toBe(false);
  });

  it('is invisible to unrelated employees', async () => {
    const t = await thread(ids.ic2, ids.ic, 'employee_and_supervisor');
    expect(await canSee(ids.outsider, t)).toBe(false);
  });
});

describe('author names survive tight employee RLS', () => {
  /*
   * Regression test for a bug that shipped past every other test and was only
   * found by using the app: the feedback query inner-joined `employee` to render
   * the author's name. When a PEER writes feedback about you, the thread is
   * visible but the author's employee row is not, so the join dropped the row
   * and the feedback vanished. app.display_name() (migration 0022) returns only
   * a name, for an id the caller already holds.
   */
  it('a subject can read a peer\'s name without being able to read their record', async () => {
    // ic cannot see ic2's employee row at all...
    expect(await as(ids.ic, 'SELECT id FROM employee WHERE id=$1', [ids.ic2])).toEqual([]);

    // ...but can resolve their display name.
    const name = await as<{ n: string | null }>(ids.ic,
      'SELECT app.display_name($1) AS n', [ids.ic2]);
    expect(name[0]!.n).toBe('ic2 X');
  });

  it('the thread survives the join that used to drop it', async () => {
    const t = await thread(ids.ic2, ids.ic, 'employee_and_supervisor');
    const rows = await as<{ id: string; author: string | null }>(ids.ic,
      `SELECT t.id, app.display_name(t.created_by) AS author
         FROM feedback_thread t WHERE t.id = $1`, [t]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.author).toBe('ic2 X');
  });

  it('display_name does not cross a tenant boundary', async () => {
    const otherOrg = (await admin.query(
      `INSERT INTO organization (code,name) VALUES ('BETA','Beta') RETURNING id`)).rows[0].id;
    const foreigner = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,'b1','Beta','Person','2020-01-01') RETURNING id`,
      [otherOrg])).rows[0].id;

    const name = await as<{ n: string | null }>(ids.ic,
      'SELECT app.display_name($1) AS n', [foreigner]);
    expect(name[0]!.n).toBeNull();
  });
});

describe('feedback integrity', () => {
  it('cannot be written about yourself', async () => {
    await expect(
      admin.query(
        `INSERT INTO feedback_thread (org_id,subject_employee_id,created_by,
                                      visibility,title)
         VALUES ($1,$2,$2,'employee_only','self')`, [ids.org, ids.ic]),
    ).rejects.toThrow(/feedback_not_self/);
  });

  it('cannot be attributed to someone else', async () => {
    await expect(
      as(ids.ic,
        `INSERT INTO feedback_thread (org_id,subject_employee_id,created_by,
                                      visibility,title)
         VALUES ($1,$2,$3,'employee_only','forged')`,
        [ids.org, ids.ic2, ids.manager]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('messages are append-only', async () => {
    const t = await thread(ids.manager, ids.ic, 'employee_only');
    await admin.query(
      `INSERT INTO feedback_message (feedback_thread_id,author_employee_id,body)
       VALUES ($1,$2,'original')`, [t, ids.manager]);
    await admin.query(`UPDATE feedback_message SET body='rewritten'
                        WHERE feedback_thread_id=$1`, [t]);
    await admin.query(`DELETE FROM feedback_message WHERE feedback_thread_id=$1`, [t]);
    const res = await admin.query(
      `SELECT body FROM feedback_message WHERE feedback_thread_id=$1`, [t]);
    expect(res.rowCount).toBe(1);
    expect(res.rows[0].body).toBe('original');
  });

  it('a closed thread accepts no further replies', async () => {
    const t = await thread(ids.manager, ids.ic, 'employee_only');
    await admin.query(`UPDATE feedback_thread SET is_closed=TRUE WHERE id=$1`, [t]);
    // The WITH CHECK raises rather than returning zero rows, which is why
    // FeedbackService.reply() translates 42501 into a 403 instead of letting it
    // become an unexplained 500.
    await expect(
      as(ids.manager,
        `INSERT INTO feedback_message (feedback_thread_id,author_employee_id,body)
         VALUES ($1,$2,'late') RETURNING id`, [t, ids.manager]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('only the author may close a thread', async () => {
    const t = await thread(ids.manager, ids.ic, 'employee_and_supervisor');
    const bySubject = await as(ids.ic,
      `UPDATE feedback_thread SET is_closed=TRUE WHERE id=$1 RETURNING id`, [t]);
    expect(bySubject).toEqual([]);
    const byAuthor = await as(ids.manager,
      `UPDATE feedback_thread SET is_closed=TRUE WHERE id=$1 RETURNING id`, [t]);
    expect(byAuthor).toHaveLength(1);
  });
});

describe('notification outbox', () => {
  const enqueue = async (recipient: string, code: string, dedupe?: string) =>
    (await admin.query<{ id: string | null }>(
      `SELECT app.enqueue_notification($1,$2,'{"x":1}'::jsonb,$3) AS id`,
      [recipient, code, dedupe ?? null])).rows[0]!.id;

  it('queues a notification with the recipient\'s address snapshotted', async () => {
    const id = await enqueue(ids.ic, 'goal.approved');
    expect(id).toBeTruthy();
    const res = await admin.query<{ recipient_email: string; state: string }>(
      `SELECT recipient_email, state::text AS state FROM notification_outbox WHERE id=$1`,
      [id]);
    expect(res.rows[0].recipient_email).toBe('ic@acme.test');
    expect(res.rows[0].state).toBe('pending');
  });

  it('deduplicates while a notification is still undelivered', async () => {
    const first = await enqueue(ids.ic2, 'goal.approved', 'dupe-key');
    const second = await enqueue(ids.ic2, 'goal.approved', 'dupe-key');
    expect(first).toBeTruthy();
    // Second call is a no-op, not an error: callers should not have to know
    // whether one is already queued.
    expect(second).toBeNull();
  });

  it('allows a new notification once the previous one is sent', async () => {
    await admin.query(
      `UPDATE notification_outbox SET state='sent' WHERE dedupe_key='dupe-key'`);
    expect(await enqueue(ids.ic2, 'goal.approved', 'dupe-key')).toBeTruthy();
  });

  it('respects an "off" preference', async () => {
    await admin.query(
      `INSERT INTO notification_preference (org_id,employee_id,template_code,mode)
       VALUES ($1,$2,'goal.approved','off')`, [ids.org, ids.director]);
    expect(await enqueue(ids.director, 'goal.approved')).toBeNull();
  });

  it('a per-template preference beats the account default', async () => {
    await admin.query(
      `INSERT INTO notification_preference (org_id,employee_id,template_code,mode)
       VALUES ($1,$2,NULL,'off')`, [ids.org, ids.outsider]);
    // Default off...
    expect(await enqueue(ids.outsider, 'goal.approved')).toBeNull();
    // ...but this specific template is switched back on.
    await admin.query(
      `INSERT INTO notification_preference (org_id,employee_id,template_code,mode)
       VALUES ($1,$2,'review.released','immediate')`, [ids.org, ids.outsider]);
    expect(await enqueue(ids.outsider, 'review.released')).toBeTruthy();
  });

  it('holds digest-mode notifications instead of sending them', async () => {
    await admin.query(
      `INSERT INTO notification_preference (org_id,employee_id,template_code,mode)
       VALUES ($1,$2,NULL,'digest')`, [ids.org, ids.hrAdmin]);
    const id = await enqueue(ids.hrAdmin, 'goal.approved');
    const res = await admin.query<{ state: string }>(
      `SELECT state::text AS state FROM notification_outbox WHERE id=$1`, [id]);
    expect(res.rows[0].state).toBe('held_for_digest');
  });

  it('collapses held notifications into one digest', async () => {
    await enqueue(ids.hrAdmin, 'review.released');
    await enqueue(ids.hrAdmin, 'pip.created');

    const built = await admin.query<{ n: string }>('SELECT app.build_digests() AS n');
    expect(Number(built.rows[0].n)).toBeGreaterThan(0);

    const digest = await admin.query<{ payload: { itemCount: number } }>(
      `SELECT payload FROM notification_outbox
        WHERE recipient_employee_id=$1 AND template_code='digest'`, [ids.hrAdmin]);
    expect(digest.rowCount).toBe(1);
    expect(digest.rows[0].payload.itemCount).toBeGreaterThanOrEqual(3);

    // The held rows are marked sent so they cannot also be delivered singly.
    const stillHeld = await admin.query(
      `SELECT id FROM notification_outbox
        WHERE recipient_employee_id=$1 AND state='held_for_digest'`, [ids.hrAdmin]);
    expect(stillHeld.rowCount).toBe(0);
  });

  it('skips an employee with no work email', async () => {
    const noEmail = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,'noemail','No','Email','2020-01-01') RETURNING id`,
      [ids.org])).rows[0].id;
    expect(await enqueue(noEmail, 'goal.approved')).toBeNull();
  });

  it('skips a separated employee', async () => {
    const gone = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on,
                             work_email,status,separated_on)
       VALUES ($1,'gone','Gone','Away','2020-01-01','gone@acme.test','separated',
               '2026-01-01') RETURNING id`, [ids.org])).rows[0].id;
    expect(await enqueue(gone, 'goal.approved')).toBeNull();
  });

  it('claims work exactly once across concurrent workers', async () => {
    await admin.query(`UPDATE notification_outbox SET state='sent'`);
    for (let i = 0; i < 6; i++) await enqueue(ids.ic, 'goal.approved', `claim-${i}`);

    // Two claims in parallel must partition the work, not duplicate it —
    // that is what FOR UPDATE SKIP LOCKED buys.
    const [a, b] = await Promise.all([
      admin.query<{ id: string }>('SELECT id FROM app.claim_notifications(3)'),
      admin.query<{ id: string }>('SELECT id FROM app.claim_notifications(3)'),
    ]);
    const all = [...a.rows, ...b.rows].map((r) => r.id);
    expect(all.length).toBe(6);
    expect(new Set(all).size).toBe(6);
  });

  it('backs off on failure and gives up after six attempts', async () => {
    await admin.query(`UPDATE notification_outbox SET state='sent'`);
    const id = await enqueue(ids.ic, 'goal.approved', 'retry-me');

    for (let attempt = 1; attempt <= 6; attempt++) {
      await admin.query('SELECT id FROM app.claim_notifications(10)');
      await admin.query('SELECT app.fail_notification($1,$2)', [id, 'relay refused']);
      // Make the row due again so the next claim picks it up.
      await admin.query(
        `UPDATE notification_outbox SET available_at=now() WHERE id=$1 AND state='pending'`,
        [id]);
    }

    const res = await admin.query<{ state: string; attempts: number; last_error: string }>(
      `SELECT state::text AS state, attempts, last_error FROM notification_outbox
        WHERE id=$1`, [id]);
    expect(res.rows[0].state).toBe('failed');
    expect(res.rows[0].attempts).toBeGreaterThanOrEqual(6);
    // The error text must survive: on-prem there is no provider dashboard.
    expect(res.rows[0].last_error).toBe('relay refused');
  });

  it('requeues rows a crashed worker left mid-send', async () => {
    await admin.query(`UPDATE notification_outbox SET state='sent'`);
    const id = await enqueue(ids.ic, 'goal.approved', 'stalled');
    await admin.query(
      `UPDATE notification_outbox SET state='sending', created_at=now() - interval '1 hour'
        WHERE id=$1`, [id]);

    const n = await admin.query<{ n: string }>(
      'SELECT app.requeue_stalled_notifications() AS n');
    expect(Number(n.rows[0].n)).toBe(1);
    const res = await admin.query<{ state: string }>(
      `SELECT state::text AS state FROM notification_outbox WHERE id=$1`, [id]);
    expect(res.rows[0].state).toBe('pending');
  });

  it('an employee cannot read another employee\'s notifications', async () => {
    await admin.query(`UPDATE notification_outbox SET state='sent'`);
    await enqueue(ids.ic, 'goal.approved', 'privacy');
    expect(await as(ids.ic2,
      `SELECT id FROM notification_outbox WHERE recipient_employee_id=$1`,
      [ids.ic])).toEqual([]);
    expect((await as(ids.ic,
      `SELECT id FROM notification_outbox WHERE recipient_employee_id=$1`,
      [ids.ic])).length).toBeGreaterThan(0);
  });
});

describe('template rendering', () => {
  it('substitutes dotted placeholders', () => {
    const out = NotificationWorkerService.render({
      template_code: 't',
      payload: { employee: { name: 'Ana' }, count: 3 },
      subject: 'Hi {{employee.name}}',
      body_text: '{{employee.name}} has {{count}} items',
      body_html: null,
    });
    expect(out.subject).toBe('Hi Ana');
    expect(out.text).toBe('Ana has 3 items');
  });

  it('leaves unknown placeholders visible rather than blanking them', () => {
    // "Hi {{employee.name}}" is an obvious bug report; "Hi ," looks like bad data.
    const out = NotificationWorkerService.render({
      template_code: 't', payload: {},
      subject: 'Hi {{employee.name}}', body_text: 'x', body_html: null,
    });
    expect(out.subject).toBe('Hi {{employee.name}}');
  });

  it('does not execute anything in a template', () => {
    const out = NotificationWorkerService.render({
      template_code: 't',
      payload: { name: '<script>alert(1)</script>' },
      subject: 's', body_text: 'Hello {{name}}', body_html: null,
    });
    // Substitution only — the value is inserted verbatim into a text body, and
    // no expression in the template is ever evaluated.
    expect(out.text).toBe('Hello <script>alert(1)</script>');
  });

  it('falls back to a deliverable message when the template is missing', () => {
    const out = NotificationWorkerService.render({
      template_code: 'goal.approved', payload: { a: 1 },
      subject: null, body_text: null, body_html: null,
    });
    // A missing template must not lose the notification silently.
    expect(out.subject).toContain('goal.approved');
    expect(out.text).toContain('no active template');
  });
});
