/**
 * The notification outbox and its delivery worker.
 *
 * This subsystem exists because the office SMTP relay will be down sometimes
 * and there is no provider dashboard to check ([D-005](docs/decisions.md)).
 * Everything worth testing here is therefore a failure path: what happens when
 * the relay refuses connections, when a worker dies mid-send, when two workers
 * run at once, and when a template is missing.
 *
 * Delivery is exercised against a real SMTP server on a real socket, stopped
 * and restarted to simulate an outage. A mocked transport would prove only that
 * the mock was called.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SMTPServer } from 'smtp-server';
import type { AddressInfo } from 'node:net';

const MIGRATIONS = join(__dirname, '../../../db/migrations');

let container: StartedPostgreSqlContainer;
let admin: Pool;
let app: Pool;
let orgId: string;
let alice: string;
let bob: string;

/** Mails accepted by the test relay, newest last. */
let inbox: string[] = [];
let smtp: SMTPServer | undefined;
let smtpPort: number;

async function startSmtp(): Promise<void> {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, _session, callback) {
      let raw = '';
      stream.on('data', (c) => { raw += c.toString(); });
      stream.on('end', () => { inbox.push(raw); callback(); });
    },
  });
  await new Promise<void>((resolve) => smtp!.listen(smtpPort, '127.0.0.1', resolve));
}

async function stopSmtp(): Promise<void> {
  if (!smtp) return;
  await new Promise<void>((resolve) => smtp!.close(() => resolve()));
  smtp = undefined;
}

// The worker is constructed after the environment is set, because config.ts
// freezes process.env at module load.
type Worker = { tick(limit?: number): Promise<{ sent: number; failed: number }>;
                buildDigests(): Promise<number>;
                onModuleDestroy(): void };
let worker: Worker;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('hr').withUsername('postgres').withPassword('postgres')
    .start();
  admin = new Pool({ connectionString: container.getConnectionUri() });
  await admin.query(`
    CREATE ROLE hr_migrator LOGIN BYPASSRLS PASSWORD 'm';
    CREATE ROLE hr_app LOGIN NOBYPASSRLS PASSWORD 'a';
  `);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  const appUri = container.getConnectionUri().replace('postgres:postgres', 'hr_app:a');
  app = new Pool({ connectionString: appUri });

  // --- a tenant with two people ------------------------------------------
  await admin.query(`SELECT set_config('app.request_id', $1, false)`, [randomUUID()]);
  orgId = (await admin.query<{ id: string }>(
    `INSERT INTO organization (code, name, timezone)
          VALUES ('NOTIF','Notif Co','Asia/Manila') RETURNING id`)).rows[0].id;
  await admin.query('SELECT app.seed_baseline_roles($1)', [orgId]);
  await admin.query('SELECT app.seed_notification_templates($1)', [orgId]);

  const person = async (no: string, email: string | null): Promise<string> =>
    (await admin.query<{ id: string }>(
      `INSERT INTO employee (org_id, employee_no, first_name, last_name,
                             work_email, hired_on)
            VALUES ($1,$2,$2,'X',$3,'2020-01-01') RETURNING id`,
      [orgId, no, email])).rows[0].id;

  alice = await person('A1', 'alice@notif.test');
  bob = await person('B1', 'bob@notif.test');

  // --- SMTP + worker ------------------------------------------------------
  const probe = new SMTPServer({});
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  smtpPort = (probe.server.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  await startSmtp();

  process.env.DATABASE_URL = appUri;
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtpPort);
  process.env.SMTP_IGNORE_TLS = 'true';
  process.env.MAIL_FROM = 'HR <no-reply@notif.test>';
  process.env.LOG_LEVEL = 'silent';

  const { DbService } = await import('../src/db/db.service');
  const { NotificationWorkerService } = await import(
    '../src/notifications/notification-worker.service');
  const db = new DbService();
  db.onModuleInit();
  worker = new NotificationWorkerService(db) as unknown as Worker;
}, 300_000);

afterAll(async () => {
  worker?.onModuleDestroy();
  await stopSmtp();
  await app?.end();
  await admin?.end();
  await container?.stop();
});

beforeEach(async () => {
  inbox = [];
  await admin.query('DELETE FROM notification_outbox');
  await admin.query('DELETE FROM notification_preference');
});

const enqueue = async (
  recipient: string, code = 'goal_approved',
  payload: Record<string, unknown> = {}, dedupe: string | null = null,
): Promise<string | null> => (await admin.query<{ id: string | null }>(
  `SELECT app.enqueue_notification($1,$2,$3::jsonb,$4) AS id`,
  [recipient, code, JSON.stringify(payload), dedupe])).rows[0].id;

const outbox = async (): Promise<{ state: string; attempts: number; template_code: string }[]> =>
  (await admin.query(`SELECT state, attempts, template_code, available_at, last_error
                        FROM notification_outbox ORDER BY created_at`)).rows;

// ---------------------------------------------------------------------------

describe('what gets queued at all', () => {
  it('queues a notification for an active employee', async () => {
    expect(await enqueue(alice)).not.toBeNull();
    expect((await outbox())[0].state).toBe('pending');
  });

  it('does not queue for a separated employee', async () => {
    await admin.query(
      `UPDATE employee SET status='separated', separated_on=CURRENT_DATE WHERE id=$1`, [bob]);
    expect(await enqueue(bob)).toBeNull();
    expect(await outbox()).toHaveLength(0);
    await admin.query(
      `UPDATE employee SET status='active', separated_on=NULL WHERE id=$1`, [bob]);
  });

  it('does not queue for a soft-deleted employee', async () => {
    await admin.query(`UPDATE employee SET deleted_at=now() WHERE id=$1`, [bob]);
    expect(await enqueue(bob)).toBeNull();
    await admin.query(`UPDATE employee SET deleted_at=NULL WHERE id=$1`, [bob]);
  });

  it('does not queue for someone with no work email', async () => {
    const noEmail = (await admin.query<{ id: string }>(
      `INSERT INTO employee (org_id, employee_no, first_name, last_name, hired_on)
            VALUES ($1,'NOEMAIL','No','Email','2020-01-01') RETURNING id`,
      [orgId])).rows[0].id;
    // Not an error — there is simply nowhere to send it.
    expect(await enqueue(noEmail)).toBeNull();
  });

  it('respects an "off" preference', async () => {
    await admin.query(
      `INSERT INTO notification_preference (org_id, employee_id, template_code, mode)
            VALUES ($1,$2,NULL,'off')`, [orgId, alice]);
    expect(await enqueue(alice)).toBeNull();
  });

  it('holds for digest when that is the preference', async () => {
    await admin.query(
      `INSERT INTO notification_preference (org_id, employee_id, template_code, mode)
            VALUES ($1,$2,NULL,'digest')`, [orgId, alice]);
    await enqueue(alice);
    expect((await outbox())[0].state).toBe('held_for_digest');
  });

  it('lets a per-template preference override the employee default', async () => {
    await admin.query(
      `INSERT INTO notification_preference (org_id, employee_id, template_code, mode)
            VALUES ($1,$2,NULL,'off'), ($1,$2,'goal_approved','immediate')`,
      [orgId, alice]);
    expect(await enqueue(alice, 'goal_approved')).not.toBeNull();
    expect(await enqueue(alice, 'review_released')).toBeNull();
  });
});

describe('deduplication', () => {
  it('collapses a duplicate while one is still live', async () => {
    expect(await enqueue(alice, 'goal_approved', {}, 'goal-42')).not.toBeNull();
    expect(await enqueue(alice, 'goal_approved', {}, 'goal-42')).toBeNull();
    expect(await outbox()).toHaveLength(1);
  });

  it('allows the same key again once the first was sent', async () => {
    // Otherwise a recurring event could only ever notify once, forever.
    await enqueue(alice, 'goal_approved', {}, 'goal-42');
    await admin.query(`UPDATE notification_outbox SET state='sent'`);
    expect(await enqueue(alice, 'goal_approved', {}, 'goal-42')).not.toBeNull();
  });

  it('does not deduplicate across recipients', async () => {
    await enqueue(alice, 'goal_approved', {}, 'same-key');
    await enqueue(bob, 'goal_approved', {}, 'same-key');
    expect(await outbox()).toHaveLength(2);
  });

  it('does not deduplicate when no key is given', async () => {
    await enqueue(alice);
    await enqueue(alice);
    expect(await outbox()).toHaveLength(2);
  });
});

describe('claiming is safe with more than one worker', () => {
  it('two concurrent claimers get disjoint sets', async () => {
    for (let i = 0; i < 10; i++) await enqueue(alice);

    // Two real transactions held open at once — the condition SKIP LOCKED
    // exists for. Without it the second claimer would block, or worse, both
    // would claim the same rows and every notification would be sent twice.
    const a = await app.connect();
    const b = await app.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      const first = await a.query<{ id: string }>('SELECT * FROM app.claim_notifications(5)');
      const second = await b.query<{ id: string }>('SELECT * FROM app.claim_notifications(5)');
      await a.query('COMMIT');
      await b.query('COMMIT');

      const ids = new Set([...first.rows, ...second.rows].map((r) => r.id));
      expect(first.rows).toHaveLength(5);
      expect(second.rows).toHaveLength(5);
      expect(ids.size).toBe(10);            // no overlap
    } finally {
      a.release();
      b.release();
    }
  });

  it('marks claimed rows as sending and counts the attempt', async () => {
    await enqueue(alice);
    await app.query('SELECT * FROM app.claim_notifications(10)');
    const [row] = await outbox();
    expect(row.state).toBe('sending');
    expect(row.attempts).toBe(1);
  });

  it('does not claim a notification before it is due', async () => {
    await enqueue(alice);
    await admin.query(`UPDATE notification_outbox SET available_at = now() + INTERVAL '1 hour'`);
    const claimed = await app.query('SELECT * FROM app.claim_notifications(10)');
    expect(claimed.rows).toHaveLength(0);
  });

  it('does not claim rows held for digest', async () => {
    await admin.query(
      `INSERT INTO notification_preference (org_id, employee_id, template_code, mode)
            VALUES ($1,$2,NULL,'digest')`, [orgId, alice]);
    await enqueue(alice);
    const claimed = await app.query('SELECT * FROM app.claim_notifications(10)');
    expect(claimed.rows).toHaveLength(0);
  });
});

describe('failure, backoff and giving up', () => {
  const failOnce = async (): Promise<void> => {
    const claimed = await app.query<{ id: string }>('SELECT * FROM app.claim_notifications(1)');
    await app.query('SELECT app.fail_notification($1,$2)',
      [claimed.rows[0].id, 'relay refused']);
  };

  it('returns the row to pending and defers it', async () => {
    await enqueue(alice);
    await failOnce();

    const row = (await admin.query<{ state: string; due_in_future: boolean; last_error: string }>(
      `SELECT state, available_at > now() AS due_in_future, last_error
         FROM notification_outbox`)).rows[0];
    expect(row.state).toBe('pending');
    expect(row.due_in_future).toBe(true);
    expect(row.last_error).toBe('relay refused');
  });

  it('backs off further with each attempt', async () => {
    await enqueue(alice);
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      await admin.query(`UPDATE notification_outbox SET available_at = now()`);
      await failOnce();
      const { rows } = await admin.query<{ secs: string }>(
        `SELECT EXTRACT(EPOCH FROM available_at - now()) AS secs FROM notification_outbox`);
      delays.push(Number(rows[0].secs));
    }
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
  });

  it('parks the row as failed after six attempts, keeping the error', async () => {
    await enqueue(alice);
    for (let i = 0; i < 6; i++) {
      await admin.query(`UPDATE notification_outbox SET available_at = now(), state='pending'`);
      await failOnce();
    }
    const row = (await admin.query<{ state: string; attempts: number; last_error: string }>(
      `SELECT state, attempts, last_error FROM notification_outbox`)).rows[0];

    // 'failed' rather than deleted: on-prem there is no provider dashboard, so
    // a dead letter has to remain queryable.
    expect(row.state).toBe('failed');
    expect(row.attempts).toBe(6);
    expect(row.last_error).toBe('relay refused');
  });

  it('truncates an enormous error rather than refusing to record it', async () => {
    await enqueue(alice);
    const claimed = await app.query<{ id: string }>('SELECT * FROM app.claim_notifications(1)');
    await app.query('SELECT app.fail_notification($1,$2)',
      [claimed.rows[0].id, 'x'.repeat(10_000)]);
    const row = (await admin.query<{ last_error: string }>(
      'SELECT last_error FROM notification_outbox')).rows[0];
    expect(row.last_error).toHaveLength(2000);
  });
});

describe('a worker that dies mid-send', () => {
  it('leaves rows reclaimable rather than lost', async () => {
    await enqueue(alice);
    await app.query('SELECT * FROM app.claim_notifications(1)');   // then "crash"
    await admin.query(`UPDATE notification_outbox SET created_at = now() - INTERVAL '1 hour'`);

    const requeued = await app.query<{ n: number }>(
      `SELECT app.requeue_stalled_notifications() AS n`);
    expect(requeued.rows[0].n).toBe(1);
    expect((await outbox())[0].state).toBe('pending');
  });

  it('does not reclaim a send that is merely in progress', async () => {
    await enqueue(alice);
    await app.query('SELECT * FROM app.claim_notifications(1)');
    const requeued = await app.query<{ n: number }>(
      `SELECT app.requeue_stalled_notifications() AS n`);
    expect(requeued.rows[0].n).toBe(0);
    expect((await outbox())[0].state).toBe('sending');
  });
});

describe('digests', () => {
  it('collapses everything held for a recipient into one mail', async () => {
    await admin.query(
      `INSERT INTO notification_preference (org_id, employee_id, template_code, mode)
            VALUES ($1,$2,NULL,'digest')`, [orgId, alice]);
    await enqueue(alice, 'goal_approved');
    await enqueue(alice, 'review_released');
    await enqueue(alice, 'checkin_due');

    const built = await worker.buildDigests();
    expect(built).toBe(1);

    const rows = await outbox();
    const digest = rows.find((r) => r.template_code === 'digest');
    expect(digest?.state).toBe('pending');

    // The held rows must not also be delivered individually.
    const held = rows.filter((r) => r.template_code !== 'digest');
    expect(held.every((r) => r.state === 'sent')).toBe(true);
  });

  it('builds nothing when there is nothing held', async () => {
    expect(await worker.buildDigests()).toBe(0);
  });
});

describe('delivery, and surviving a relay outage', () => {
  it('sends a queued notification and marks it sent', async () => {
    await enqueue(alice, 'goal_approved', { goal: { title: 'Ship it' } });

    const result = await worker.tick();
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toContain('alice@notif.test');
    expect((await outbox())[0].state).toBe('sent');
  });

  it('keeps the notification when the relay is down, and delivers it after', async () => {
    // The whole reason the outbox exists. An office relay goes down; nothing
    // may be lost, and nothing may be sent twice on the way back up.
    await stopSmtp();
    await enqueue(alice, 'goal_approved', { goal: { title: 'Survives an outage' } });

    const during = await worker.tick();
    expect(during.sent).toBe(0);
    expect(during.failed).toBe(1);
    expect(inbox).toHaveLength(0);
    expect((await outbox())[0].state).toBe('pending');

    await startSmtp();
    // Backoff deferred it; the operator's clock, not ours, would normally wait.
    await admin.query(`UPDATE notification_outbox SET available_at = now()`);

    const after = await worker.tick();
    expect(after).toEqual({ sent: 1, failed: 0 });
    expect(inbox).toHaveLength(1);
    expect((await outbox())[0].state).toBe('sent');
  });

  it('delivers each notification exactly once across repeated passes', async () => {
    await enqueue(alice);
    await enqueue(bob);

    await worker.tick();
    await worker.tick();
    await worker.tick();

    expect(inbox).toHaveLength(2);
    expect((await outbox()).every((r) => r.state === 'sent')).toBe(true);
  });
});

describe('template rendering', () => {
  let render: (n: {
    template_code: string; payload: Record<string, unknown>;
    subject: string | null; body_text: string | null; body_html: string | null;
  }) => { subject: string; text: string; html?: string };

  beforeAll(async () => {
    ({ NotificationWorkerService: { render } } = await import(
      '../src/notifications/notification-worker.service') as never);
  });

  const base = { template_code: 't', body_html: null };

  it('substitutes dotted paths', () => {
    const out = render({
      ...base, payload: { employee: { name: 'Ana' }, goal: { title: 'Ship' } },
      subject: 'Hi {{employee.name}}', body_text: 'Goal: {{goal.title}}',
    });
    expect(out.subject).toBe('Hi Ana');
    expect(out.text).toBe('Goal: Ship');
  });

  it('leaves an unknown placeholder visible', () => {
    // "Hi {{employee.name}}" is an obvious bug report; "Hi ," looks like a data
    // problem and gets ignored for months.
    const out = render({
      ...base, payload: {}, subject: 'Hi {{employee.name}}', body_text: 'x',
    });
    expect(out.subject).toBe('Hi {{employee.name}}');
  });

  it('does not execute anything embedded in a template', () => {
    // Templates are authored by HR and stored in the database. Substitution
    // only — anything evaluable here would be a code-injection path.
    const out = render({
      ...base, payload: { x: '1' },
      subject: '{{constructor.constructor}}',
      body_text: '${process.exit(1)} {{__proto__}}',
    });
    expect(out.subject).toBe('{{constructor.constructor}}');
    expect(out.text).toBe('${process.exit(1)} {{__proto__}}');
  });

  it('renders a payload value that is itself an object', () => {
    const out = render({
      ...base, payload: { items: [1, 2] }, subject: 's', body_text: '{{items}}',
    });
    expect(out.text).toBe('[1,2]');
  });

  it('falls back to something deliverable when the template is missing', () => {
    // A missing template must not lose the notification.
    const out = render({
      template_code: 'goal_approved', payload: { goalId: 7 },
      subject: null, body_text: null, body_html: null,
    });
    expect(out.subject).toContain('goal_approved');
    expect(out.text).toContain('no active template');
    expect(out.text).toContain('goalId');
  });
});
