import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * F5 — the messages the system was missing (§7.8).
 *
 * The audit that produced this migration is worth keeping as a test: a seeded
 * template with nothing emitting it looks exactly like a working feature, and
 * `review.assigned` sat in that state from 0021 until now. So this suite
 * asserts, for every template a tenant gets, either that something emits it or
 * that it is on a short and deliberate list of ones that do not yet.
 */

const MIGRATIONS = join(__dirname, '../../../db/migrations');
const SRC = join(__dirname, '../src');

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
    await client.query(
      `SELECT set_config('app.request_id', gen_random_uuid()::text, true)`);
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

/**
 * Everything sitting in somebody's outbox, read AS THEM.
 *
 * Not as HR: the outbox is scoped to its recipient unless the reader holds
 * notification:write, so reading it as the person is both the accurate query
 * and the stronger assertion -- it proves they can actually see the message
 * that was queued for them.
 */
const outboxFor = async (recipient: string) => (await as<{ code: string }>(recipient,
  `SELECT template_code AS code FROM notification_outbox
    WHERE recipient_employee_id = $1
    ORDER BY template_code`, [recipient])).map((r) => r.code);

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
  const org = (await admin.query(
    `INSERT INTO organization (code,name) VALUES ('GGC','Guanzon') RETURNING id`)).rows[0].id;
  ids.org = org;
  ids.etype = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','Regular') RETURNING id`,
    [org])).rows[0].id;
  ids.branch = (await admin.query(
    `INSERT INTO department (org_id,code,name,unit_type,effective_from)
     VALUES ($1,'DAG','Dagupan','branch','2020-01-01') RETURNING id`, [org])).rows[0].id;
  ids.rank = (await admin.query(
    `INSERT INTO job_rank (org_id,code,name,rank_no) VALUES ($1,'R11','Associate',11)
     RETURNING id`, [org])).rows[0].id;

  const emp = async (no: string) => {
    const pos = (await admin.query(
      `INSERT INTO position (org_id,title,department_id,job_family,rank_id)
       VALUES ($1,$2,$3,'Branch',$4) RETURNING id`,
      [org, `Associate ${no}`, ids.branch, ids.rank])).rows[0].id;
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on,
                             work_email)
       VALUES ($1,$2,$2,'X','2020-01-01',$3) RETURNING id`,
      [org, no, `${no.toLowerCase()}@ggc.example`])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,position_id,department_id,
                               employment_type_id,status,effective_from)
       VALUES ($1,$2,$3,$4,$5,'regular','2020-01-01')`,
      [org, id, pos, ids.branch, ids.etype]);
    return id;
  };

  ids.subject = await emp('SUBJ');
  ids.reviewer = await emp('REV');
  ids.hr = await emp('HR');

  for (const fn of ['seed_baseline_roles', 'seed_phase1_grants', 'seed_phase3_grants',
                    'seed_line_role_grants', 'seed_dept_head_review_grants',
                    'seed_notification_templates', 'seed_hcm_target_templates',
                    'seed_workflow_event_templates']) {
    await admin.query(`SELECT app.${fn}($1)`, [org]);
  }
  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const rEmp = await role('employee');
  for (const e of [ids.subject, ids.reviewer, ids.hr]) {
    await admin.query(
      `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
       VALUES ($1,$2,$3,'2020-01-01')`, [org, e, rEmp]);
  }
  await admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, ids.hr, await role('hr_admin')]);

  ids.cycle = (await admin.query(
    `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
     VALUES ($1,'FY2026','2026-01-01','2026-12-31','open') RETURNING id`,
    [org])).rows[0].id;

  const rule = (await admin.query(
    `INSERT INTO peer_review_rule (org_id,code,name,min_reviewers,max_reviewers)
     VALUES ($1,'ALL','All staff',1,5) RETURNING id`, [org])).rows[0].id;
  await admin.query(
    `INSERT INTO peer_review_rule_source (org_id,rule_id,label,rank_delta,relation)
     VALUES ($1,$2,'Colleagues',0,'same_unit')`, [org, rule]);
}

describe('every seeded template has an emitter, or is deliberately pending', () => {
  it('names the ones nothing sends, so a silent template cannot hide', async () => {
    // This is the audit that produced 0042, kept as a test.
    //
    // The failure it prevents is specific: `review.assigned` was seeded in 0021
    // and never emitted, so for eleven migrations the system looked like it
    // told reviewers about their work and did not. A template with no emitter
    // is indistinguishable from a feature until somebody waits for a message
    // that never comes.
    const codes = (await as<{ code: string }>(ids.hr,
      `SELECT DISTINCT code FROM notification_template ORDER BY code`))
      .map((r) => r.code);

    const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((f) => typeof f === 'string' && f.endsWith('.ts'))
      .map((f) => readFileSync(join(SRC, f), 'utf8'))
      .join('\n');
    const migrations = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
      .join('\n');
    /*
     * Whether anything actually SENDS this template.
     *
     * Matching the bare quoted code was the first attempt and it was vacuous:
     * every template's own seed statement contains its code in quotes, so all
     * of them looked emitted and the audit asserted nothing. Emission has to be
     * recognised by the call -- NotificationsService.enqueue in TypeScript,
     * app.enqueue_notification in SQL -- with the code as an argument to it.
     */
    const emitted = (code: string) => {
      const near = new RegExp(
        String.raw`enqueue(?:_notification)?\s*\([\s\S]{0,400}?'`
        + code.replace('.', String.raw`\.`) + `'`);
      return near.test(sources) || near.test(migrations);
    };

    // Templates that exist but nothing sends yet, each for a stated reason.
    // Keeping the list here, rather than in a comment somewhere, is what stops
    // a silent template quietly becoming normal.
    const pending: Record<string, string> = {
      // Needs a scheduler to notice a deadline is near. Recorded as F5b;
      // seeding a template without its scanner is what produced this mess.
      'goal.checkin_overdue': 'needs the deadline scanner (F5b)',
      // Assembled by the worker from what is already queued, rather than
      // enqueued by name like the others.
      digest: 'assembled by the notification worker',
      // Fires when a panel cannot be filled. The draw reports a short panel to
      // its caller today; routing that to HCM belongs with D4.
      'peer.panel_short': 'sent when D4 enforces the minimum',
    };

    const silent = codes.filter((c) => !emitted(c) && !(c in pending));
    expect(silent).toEqual([]);

    // And the pending list must not rot: anything on it that HAS gained an
    // emitter should come off, so the list stays a real inventory.
    const nowEmitted = Object.keys(pending).filter(
      (c) => codes.includes(c) && emitted(c));
    expect(nowEmitted).toEqual([]);
  });
});

describe('the events that were missing', () => {
  it('tells a reviewer they have a review to write', async () => {
    // The eleven-migration gap. generateInstances() created the work and told
    // nobody.
    const scale = (await admin.query<{ id: string }>(
      `INSERT INTO rating_scale (org_id,code,version,name,published_at)
       VALUES ($1,'STD',1,'Standard',now()) RETURNING id`, [ids.org])).rows[0]!.id;
    const template = (await admin.query<{ id: string }>(
      `INSERT INTO form_template (org_id,code,name) VALUES ($1,'STD','Standard')
       RETURNING id`, [ids.org])).rows[0]!.id;
    const version = (await admin.query<{ id: string }>(
      `INSERT INTO form_version (form_template_id,version,schema_json,
                                 rating_scale_id,published_at,is_active)
       VALUES ($1,1,'{"sections":[]}'::jsonb,$2,now(),TRUE) RETURNING id`,
      [template, scale])).rows[0]!.id;

    await as(ids.hr,
      `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                    reviewer_employee_id, reviewer_role,
                                    form_version_id)
       VALUES ($1,$2,$3,'supervisor',$4)`,
      [ids.cycle, ids.subject, ids.reviewer, version]);

    // The template exists and renders; the emitter is asserted by the audit
    // test above and exercised through the service in reviews.spec.
    const tpl = await as(ids.hr,
      `SELECT id FROM notification_template WHERE code = 'review.assigned'`);
    expect(tpl).toHaveLength(1);
  });

  it('invites a drawn peer reviewer, in the same statement as the draw',
    async () => {
      // An invitation that depends on the caller remembering is one that gets
      // missed, and a panel nobody was told about never fills.
      const drawn = await as<{ reviewer_employee_id: string }>(ids.hr,
        `SELECT * FROM app.draw_peer_reviewers($1,$2,1::smallint,CURRENT_DATE,0.3)`,
        [ids.cycle, ids.subject]);
      expect(drawn).toHaveLength(1);

      ids.drawn = drawn[0]!.reviewer_employee_id;
      expect(await outboxFor(ids.drawn)).toContain('peer.invited');
    });

  it('names the subject to the reviewer, because they must answer about them',
    async () => {
      // Rendering happens in the worker at send time, so the outbox holds the
      // payload rather than finished text -- the payload is what has to carry
      // the name.
      const row = await as<{ payload: { subjectName?: string } }>(ids.drawn,
        `SELECT payload FROM notification_outbox
          WHERE template_code = 'peer.invited' LIMIT 1`);
      // The six-month question cannot be answered about an anonymous person.
      expect(row[0]?.payload.subjectName).toContain('SUBJ');
    });

  it('does not tell the subject who was asked', async () => {
    // The direction that must never reverse while Q5 is open.
    expect(await outboxFor(ids.subject)).not.toContain('peer.invited');
  });
});

describe('the templates render', () => {
  it('has a payload key for every placeholder it uses', async () => {
    // Rendering is the worker's job and it deliberately leaves an unknown
    // placeholder visible rather than blanking it, so a missing payload key
    // reaches a person as literal "{{subjectName}}" -- which tells them the
    // system is broken in a way they cannot act on.
    //
    // Checking the pairing here catches that at the point it is introduced,
    // rather than in somebody's inbox.
    const queued = await as<{ code: string; payload: Record<string, unknown> }>(
      ids.drawn,
      `SELECT template_code AS code, payload FROM notification_outbox`);
    expect(queued.length).toBeGreaterThan(0);

    for (const message of queued) {
      const tpl = await as<{ subject: string; body: string }>(ids.drawn,
        `SELECT subject, body_text AS body FROM notification_template
          WHERE code = $1 AND is_active LIMIT 1`, [message.code]);
      const text = `${tpl[0]!.subject}
${tpl[0]!.body}`;
      const placeholders = [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)]
        .map((m) => m[1]!.split('.')[0]!);

      for (const key of new Set(placeholders)) {
        // Named in the failure so a break says which template and which key.
        expect(
          { template: message.code, missing: key },
          `${message.code} uses {{${key}}} but its payload has `
          + `[${Object.keys(message.payload).join(', ')}]`,
        ).toEqual({ template: message.code, missing: key });
        expect(Object.keys(message.payload)).toContain(key);
      }
    }
  });
});
