import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * F5b — the reminders half of §7.8.
 *
 * IDEMPOTENCE IS THE WHOLE TEST.
 *
 * A scan that runs hourly must not send hourly, and getting that wrong does not
 * look like a bug: it looks like the system working and people ignoring it,
 * which is worse because the fix is invisible too. So most of this suite runs
 * the scan repeatedly and asserts that the second run is silent, then advances
 * the clock and asserts that a genuinely new milestone is not.
 */

const MIGRATIONS = join(__dirname, '../../../db/migrations');

let container: StartedPostgreSqlContainer;
let admin: Pool;
const ids: Record<string, string> = {};

/** Runs the scan as the system does, returning what it enqueued by template. */
async function scan(asOf: string, daysAhead = 7): Promise<Record<string, number>> {
  const res = await admin.query<{ template_code: string; enqueued: string }>(
    'SELECT * FROM app.enqueue_due_reminders($1::date, $2)', [asOf, daysAhead]);
  return Object.fromEntries(res.rows.map((r) => [r.template_code, Number(r.enqueued)]));
}

const queuedFor = async (code: string) => Number((await admin.query<{ n: string }>(
  'SELECT count(*)::int AS n FROM notification_outbox WHERE template_code = $1',
  [code])).rows[0]!.n);

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
  await seed();
}, 240_000);

afterAll(async () => {
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
  ids.dept = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'OPS','Operations','2020-01-01') RETURNING id`, [org])).rows[0].id;

  const emp = async (no: string) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on,work_email)
       VALUES ($1,$2,$2,'X','2020-01-01',$3) RETURNING id`,
      [org, no, `${no.toLowerCase()}@ggc.example`])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [org, id, ids.dept, ids.etype]);
    return id;
  };

  ids.subject = await emp('SUBJ');
  ids.reviewer = await emp('REV');
  ids.hr = await emp('HR');

  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);
  await admin.query('SELECT app.seed_notification_templates($1)', [org]);
  await admin.query('SELECT app.seed_reminder_templates($1)', [org]);

  // A cycle closing on 2026-06-30, with one unsubmitted review.
  ids.cycle = (await admin.query(
    `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
     VALUES ($1,'FY2026','2026-01-01','2026-06-30','open') RETURNING id`,
    [org])).rows[0].id;
  const scale = (await admin.query(
    `INSERT INTO rating_scale (org_id,code,version,name,published_at)
     VALUES ($1,'STD',1,'Standard',now()) RETURNING id`, [org])).rows[0].id;
  const template = (await admin.query(
    `INSERT INTO form_template (org_id,code,name) VALUES ($1,'STD','Standard')
     RETURNING id`, [org])).rows[0].id;
  ids.version = (await admin.query(
    `INSERT INTO form_version (form_template_id,version,schema_json,rating_scale_id,
                               published_at,is_active)
     VALUES ($1,1,'{"sections":[]}'::jsonb,$2,now(),TRUE) RETURNING id`,
    [template, scale])).rows[0].id;
  ids.instance = (await admin.query(
    `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                  reviewer_employee_id, reviewer_role,
                                  form_version_id, state)
     VALUES ($1,$2,$3,'supervisor',$4,'in_progress') RETURNING id`,
    [ids.cycle, ids.subject, ids.reviewer, ids.version])).rows[0].id;

  // A weekly-cadence goal whose last check-in was 2026-03-01.
  ids.period = (await admin.query(
    `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state,
                              checkin_cadence)
     VALUES ($1,'FY2026','annual','2026-01-01','2026-12-31','open','weekly')
     RETURNING id`, [org])).rows[0].id;
  ids.goal = (await admin.query(
    `INSERT INTO goal (org_id, employee_id, goal_period_id, title, weight, state,
                       approved_by, approved_at)
     VALUES ($1,$2,$3,'Ship the thing',100,'active',$4,now()) RETURNING id`,
    [org, ids.subject, ids.period, ids.hr])).rows[0].id;
  await admin.query(
    `INSERT INTO goal_checkin (goal_id, checked_in_by, progress_pct, status_flag,
                               period_ending, created_at)
     VALUES ($1,$2,50,'on_track','2026-03-01','2026-03-01')`,
    [ids.goal, ids.subject]);
}

describe('reviews closing soon', () => {
  it('says nothing while the deadline is far off', async () => {
    // Well outside the window. A reminder here would train people to ignore
    // them, which costs more than the one that arrives too late.
    expect(await scan('2026-05-01')).toMatchObject({ 'review.due_soon': 0 });
  });

  it('reminds the reviewer inside the window', async () => {
    expect(await scan('2026-06-25')).toMatchObject({ 'review.due_soon': 1 });
    expect(await queuedFor('review.due_soon')).toBe(1);
  });

  it('does not remind again on the next scan, or the next hundred', async () => {
    // The property the whole design rests on. Deduping on the milestone rather
    // than the day means the scan interval is a free choice.
    for (const day of ['2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28']) {
      expect(await scan(day)).toMatchObject({ 'review.due_soon': 0 });
    }
    expect(await queuedFor('review.due_soon')).toBe(1);
  });

  it('reminds again once the cycle has actually closed', async () => {
    // A different milestone, and a different message: overdue reads differently
    // from due-soon, and says whose result it is holding up.
    expect(await scan('2026-07-01')).toMatchObject({ 'review.overdue': 1 });
    expect(await scan('2026-07-02')).toMatchObject({ 'review.overdue': 0 });
  });

  it('stops entirely once the review is submitted', async () => {
    await admin.query(
      `UPDATE review_instance SET state = 'submitted' WHERE id = $1`, [ids.instance]);
    const before = await queuedFor('review.overdue');
    // A fresh instance, so the dedupe key cannot be what is doing the work here.
    const other = (await admin.query<{ id: string }>(
      `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                    reviewer_employee_id, reviewer_role,
                                    form_version_id, state)
       VALUES ($1,$2,$3,'self',$4,'submitted') RETURNING id`,
      [ids.cycle, ids.reviewer, ids.reviewer, ids.version])).rows[0]!.id;
    expect(other).toBeTruthy();

    expect(await scan('2026-07-10')).toMatchObject({ 'review.overdue': 0 });
    expect(await queuedFor('review.overdue')).toBe(before);
  });
});

describe('check-ins whose cadence has lapsed', () => {
  it('emits the template that has existed since 0021 and never fired', async () => {
    // The gap F5's audit found. A weekly goal last checked in on 1 March is
    // overdue by the end of that month.
    expect(await scan('2026-03-20')).toMatchObject({ 'goal.checkin_overdue': 1 });
  });

  it('sends one nudge per missed period, not one per scan', async () => {
    // Bucketed by whole cadence periods, so a person who never checks in is
    // reminded weekly rather than hourly -- and a person who is one day late is
    // not reminded at all.
    const first = await queuedFor('goal.checkin_overdue');

    // Same week: silent.
    expect(await scan('2026-03-21')).toMatchObject({ 'goal.checkin_overdue': 0 });
    expect(await queuedFor('goal.checkin_overdue')).toBe(first);

    // A further week missed: one more.
    expect(await scan('2026-03-27')).toMatchObject({ 'goal.checkin_overdue': 1 });
    expect(await queuedFor('goal.checkin_overdue')).toBe(first + 1);
  });

  it('stops when they check in', async () => {
    await admin.query(
      `INSERT INTO goal_checkin (goal_id, checked_in_by, progress_pct, status_flag,
                                 period_ending, created_at)
       VALUES ($1,$2,80,'on_track','2026-03-28','2026-03-28')`,
      [ids.goal, ids.subject]);
    // Two days later the cadence has not lapsed again.
    expect(await scan('2026-03-30')).toMatchObject({ 'goal.checkin_overdue': 0 });
  });

  it('ignores a period with no cadence set', async () => {
    // 'none' means the client does not want check-ins on that period, and a
    // reminder would be the system arguing with their configuration.
    await admin.query(
      `UPDATE goal_period SET checkin_cadence = 'none' WHERE id = $1`, [ids.period]);
    expect(await scan('2026-06-01')).toMatchObject({ 'goal.checkin_overdue': 0 });
    await admin.query(
      `UPDATE goal_period SET checkin_cadence = 'weekly' WHERE id = $1`, [ids.period]);
  });
});

describe('what the scan reports', () => {
  it('names every template, including the ones with nothing to send', async () => {
    // A scan that found nothing and a scan that never looked at a category are
    // indistinguishable unless the zeroes are printed too.
    const result = await scan('2026-05-01');
    expect(Object.keys(result).sort()).toEqual([
      'evaluation.overdue',
      'goal.checkin_overdue',
      'peer.invitation_pending',
      'review.due_soon',
      'review.overdue',
    ]);
  });

  it('reaches across tenants, because a system job has no identity', async () => {
    // SECURITY DEFINER by necessity. The safety rests on it only ever calling
    // enqueue_notification, which addresses the person whose own work is late --
    // so it can disclose nothing to anybody who was not already the recipient.
    const other = (await admin.query<{ id: string }>(
      `INSERT INTO organization (code,name) VALUES ('BETA','Beta') RETURNING id`))
      .rows[0]!.id;
    await admin.query('SELECT app.seed_baseline_roles($1)', [other]);
    await admin.query('SELECT app.seed_reminder_templates($1)', [other]);

    const dept = (await admin.query<{ id: string }>(
      `INSERT INTO department (org_id,code,name,effective_from)
       VALUES ($1,'X','X','2020-01-01') RETURNING id`, [other])).rows[0]!.id;
    const etype = (await admin.query<{ id: string }>(
      `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','Regular')
       RETURNING id`, [other])).rows[0]!.id;
    const person = (await admin.query<{ id: string }>(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on,
                             work_email)
       VALUES ($1,'B-1','B','X','2020-01-01','b1@beta.example') RETURNING id`,
      [other])).rows[0]!.id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [other, person, dept, etype]);

    const cycle = (await admin.query<{ id: string }>(
      `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
       VALUES ($1,'BETA FY','2026-01-01','2026-08-31','open') RETURNING id`,
      [other])).rows[0]!.id;
    const scale = (await admin.query<{ id: string }>(
      `INSERT INTO rating_scale (org_id,code,version,name,published_at)
       VALUES ($1,'STD',1,'S',now()) RETURNING id`, [other])).rows[0]!.id;
    const tpl = (await admin.query<{ id: string }>(
      `INSERT INTO form_template (org_id,code,name) VALUES ($1,'STD','S')
       RETURNING id`, [other])).rows[0]!.id;
    const ver = (await admin.query<{ id: string }>(
      `INSERT INTO form_version (form_template_id,version,schema_json,
                                 rating_scale_id,published_at,is_active)
       VALUES ($1,1,'{"sections":[]}'::jsonb,$2,now(),TRUE) RETURNING id`,
      [tpl, scale])).rows[0]!.id;
    await admin.query(
      `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                    reviewer_employee_id, reviewer_role,
                                    form_version_id, state)
       VALUES ($1,$2,$2,'self',$3,'in_progress')`, [cycle, person, ver]);

    expect(await scan('2026-08-28')).toMatchObject({ 'review.due_soon': 1 });

    // And it landed in the right tenant.
    const where = await admin.query<{ org_id: string }>(
      `SELECT org_id FROM notification_outbox
        WHERE template_code = 'review.due_soon' ORDER BY created_at DESC LIMIT 1`);
    expect(where.rows[0]!.org_id).toBe(other);
  });
});
