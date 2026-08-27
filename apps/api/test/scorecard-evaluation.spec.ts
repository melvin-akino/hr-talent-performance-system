import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Evaluating against a loaded scorecard — the client's "load KPI and evaluate".
 *
 * Two properties carry the weight here, and both are about time:
 *
 *   1. an evaluation's lines are a SNAPSHOT, so editing the scorecard afterwards
 *      cannot move a score somebody has already been given;
 *   2. an employee must not read a draft evaluation of themselves, and MUST be
 *      able to read it once submitted.
 *
 * The rest — ceilings, unassessed lines, freezing on submit — exists to stop a
 * number appearing that nobody can account for.
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

const one = async <T extends Record<string, unknown>>(
  viewer: string, sql: string, params: unknown[] = [],
): Promise<T | undefined> => (await as<T>(viewer, sql, params))[0];

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
    throw new Error(`Evaluation tests must run as hr_app, got '${who.rows[0]?.user}'`);
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

  const emp = async (no: string) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [org, id, ids.dept, ids.etype]);
    return id;
  };

  ids.hrAdmin = await emp('hradmin');
  ids.supervisor = await emp('supervisor');
  ids.associate = await emp('assoc');
  ids.bystander = await emp('bystander');

  await admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, ids.associate, ids.supervisor]);

  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [org]);
  await admin.query('SELECT app.seed_line_role_grants($1)', [org]);
  await admin.query('SELECT app.seed_scorecard_grants($1)', [org]);
  await admin.query('SELECT app.seed_evaluation_grants($1)', [org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, e, r]);

  const rEmp = await role('employee');
  for (const e of [ids.hrAdmin, ids.supervisor, ids.associate, ids.bystander]) {
    await assign(e, rEmp);
  }
  await assign(ids.hrAdmin, await role('hr_admin'));
  await assign(ids.supervisor, await role('manager'));

  // A small scorecard shaped like the client's: two repeated Claims Processing
  // lines that differ only by criterion, plus a technical line worth 2.
  ids.scorecard = (await admin.query(
    `INSERT INTO scorecard (org_id,name,department_id)
     VALUES ($1,'Social Insurances',$2) RETURNING id`, [org, ids.dept])).rows[0].id;

  const indicator = async (name: string, nature: string) => (await admin.query(
    `INSERT INTO task_indicator (org_id,name,nature)
     VALUES ($1,$2,$3::task_nature) RETURNING id`, [org, name, nature])).rows[0].id;

  ids.claims = await indicator('Claims Processing', 'administrative');
  ids.referral = await indicator('Incident Referral', 'technical');

  const line = (ind: string, points: number, criteria: string, seq: number) =>
    admin.query(
      `INSERT INTO scorecard_item (org_id,scorecard_id,task_indicator_id,points,
                                   criteria,sequence)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [org, ids.scorecard, ind, points, criteria, seq]);

  await line(ids.claims, 1, '1 pt per type of claim - accident', 1);
  await line(ids.claims, 1, '1 pt per type of claim - maternity', 2);
  await line(ids.referral, 2, 'referred within the day', 3);
  // Target: 4.

  await admin.query(
    `INSERT INTO scorecard_assignment (org_id,scorecard_id,employee_id,effective_from)
     VALUES ($1,$2,$3,'2026-01-01')`, [org, ids.scorecard, ids.associate]);
}

/** Opens a fresh evaluation over a period nothing else uses. */
async function open(viewer: string, start: string, end: string): Promise<string> {
  const row = await one<{ id: string }>(viewer,
    `SELECT app.open_scorecard_evaluation($1, $2::date, $3::date, $4) AS id`,
    [ids.associate, start, end, viewer]);
  return row!.id;
}

const scoreAll = async (viewer: string, evaluation: string, points: number[]) => {
  const lines = await as<{ id: string }>(viewer,
    `SELECT id FROM scorecard_evaluation_line WHERE evaluation_id = $1 ORDER BY sequence`,
    [evaluation]);
  for (const [i, line] of lines.entries()) {
    await as(viewer,
      `UPDATE scorecard_evaluation_line SET points_awarded = $2 WHERE id = $1`,
      [line.id, points[i]]);
  }
};

describe('opening an evaluation', () => {
  it('snapshots the scorecard as it stands', async () => {
    const ev = await open(ids.supervisor, '2026-01-01', '2026-03-31');

    const lines = await as<{ indicator_name: string; criteria: string; pts: string }>(
      ids.supervisor,
      `SELECT indicator_name, criteria, points_available AS pts
         FROM scorecard_evaluation_line WHERE evaluation_id = $1 ORDER BY sequence`,
      [ev]);

    expect(lines).toHaveLength(3);
    // Both Claims Processing lines survive, distinguished by their criteria --
    // the repeat is the whole point of 0032's design.
    expect(lines.map((l) => l.indicator_name)).toEqual([
      'Claims Processing', 'Claims Processing', 'Incident Referral',
    ]);
    expect(lines[0]!.criteria).toContain('accident');
    expect(lines[1]!.criteria).toContain('maternity');

    const head = await one<{ target: string }>(ids.supervisor,
      `SELECT target_points AS target FROM scorecard_evaluation WHERE id = $1`, [ev]);
    expect(Number(head!.target)).toBe(4);
  });

  it('refuses when the person is on no scorecard for that period', async () => {
    // The assignment starts 2026-01-01, so a 2025 period has nothing to score.
    await expect(open(ids.supervisor, '2025-01-01', '2025-03-31'))
      .rejects.toThrow(/No scorecard assigned/);
  });

  it('refuses a period the wrong way round', async () => {
    await expect(open(ids.supervisor, '2026-06-30', '2026-04-01'))
      .rejects.toThrow(/starts after it ends/);
  });

  it('refuses a second evaluation for the same period', async () => {
    await open(ids.supervisor, '2026-04-01', '2026-06-30');
    await expect(open(ids.supervisor, '2026-04-01', '2026-06-30')).rejects.toThrow();
  });

  it('is not open to somebody with no line to the person', async () => {
    await expect(open(ids.bystander, '2026-07-01', '2026-09-30'))
      .rejects.toThrow(/row-level security/i);
  });
});

describe('scoring', () => {
  it('will not award more points than a line is worth', async () => {
    const ev = await open(ids.supervisor, '2027-01-01', '2027-03-31');
    const line = await one<{ id: string }>(ids.supervisor,
      `SELECT id FROM scorecard_evaluation_line
        WHERE evaluation_id = $1 ORDER BY sequence LIMIT 1`, [ev]);
    await expect(
      as(ids.supervisor,
        `UPDATE scorecard_evaluation_line SET points_awarded = 5 WHERE id = $1`,
        [line!.id]),
    ).rejects.toThrow(/within_available/);
  });

  it('keeps "not yet assessed" apart from "earned nothing"', async () => {
    const ev = await open(ids.supervisor, '2027-04-01', '2027-06-30');
    const lines = await as<{ id: string }>(ids.supervisor,
      `SELECT id FROM scorecard_evaluation_line WHERE evaluation_id = $1 ORDER BY sequence`,
      [ev]);
    await as(ids.supervisor,
      `UPDATE scorecard_evaluation_line SET points_awarded = 0 WHERE id = $1`,
      [lines[0]!.id]);

    const counts = await one<{ zero: string; unassessed: string }>(ids.supervisor,
      `SELECT count(*) FILTER (WHERE points_awarded = 0) AS zero,
              count(*) FILTER (WHERE points_awarded IS NULL) AS unassessed
         FROM scorecard_evaluation_line WHERE evaluation_id = $1`, [ev]);
    expect(Number(counts!.zero)).toBe(1);
    expect(Number(counts!.unassessed)).toBe(2);
  });

  it('refuses to submit while any line is unassessed', async () => {
    const ev = await open(ids.supervisor, '2027-07-01', '2027-09-30');
    await expect(
      as(ids.supervisor, `SELECT app.submit_scorecard_evaluation($1)`, [ev]),
    ).rejects.toThrow(/unassessed/);
  });

  it('totals the lines on submit', async () => {
    const ev = await open(ids.supervisor, '2028-01-01', '2028-03-31');
    await scoreAll(ids.supervisor, ev, [1, 0, 1.5]);

    const total = await one<{ t: string }>(ids.supervisor,
      `SELECT app.submit_scorecard_evaluation($1) AS t`, [ev]);
    expect(Number(total!.t)).toBe(2.5);

    const head = await one<{ state: string; awarded: string; target: string }>(
      ids.supervisor,
      `SELECT state::text AS state, awarded_points AS awarded, target_points AS target
         FROM scorecard_evaluation WHERE id = $1`, [ev]);
    expect(head!.state).toBe('submitted');
    expect(Number(head!.awarded)).toBe(2.5);
    expect(Number(head!.target)).toBe(4);
  });

  it('freezes the lines once submitted', async () => {
    const ev = await open(ids.supervisor, '2028-04-01', '2028-06-30');
    await scoreAll(ids.supervisor, ev, [1, 1, 2]);
    await as(ids.supervisor, `SELECT app.submit_scorecard_evaluation($1)`, [ev]);

    const line = await one<{ id: string }>(ids.supervisor,
      `SELECT id FROM scorecard_evaluation_line
        WHERE evaluation_id = $1 ORDER BY sequence LIMIT 1`, [ev]);
    // The UPDATE policy carries state = 'draft', so this matches nothing rather
    // than raising -- and the score is unchanged, which is what matters.
    const changed = await as(ids.supervisor,
      `UPDATE scorecard_evaluation_line SET points_awarded = 0
        WHERE id = $1 RETURNING id`, [line!.id]);
    expect(changed).toHaveLength(0);

    const still = await one<{ awarded: string }>(ids.supervisor,
      `SELECT awarded_points AS awarded FROM scorecard_evaluation WHERE id = $1`, [ev]);
    expect(Number(still!.awarded)).toBe(4);
  });

  it('will not submit the same evaluation twice', async () => {
    const ev = await open(ids.supervisor, '2028-07-01', '2028-09-30');
    await scoreAll(ids.supervisor, ev, [1, 1, 2]);
    await as(ids.supervisor, `SELECT app.submit_scorecard_evaluation($1)`, [ev]);
    await expect(
      as(ids.supervisor, `SELECT app.submit_scorecard_evaluation($1)`, [ev]),
    ).rejects.toThrow(/already submitted/);
  });
});

describe('a score already given does not move', () => {
  it('survives the scorecard being rewritten underneath it', async () => {
    // This is the test the whole snapshot design exists for. R10 and R11 alone
    // will change several of the client's scorecards after people have been
    // scored on them.
    const ev = await open(ids.supervisor, '2029-01-01', '2029-03-31');
    await scoreAll(ids.supervisor, ev, [1, 1, 2]);
    await as(ids.supervisor, `SELECT app.submit_scorecard_evaluation($1)`, [ev]);

    // HR now edits the scorecard: repoints a line, rewrites a criterion, and
    // adds a task. Every one of these would move a live total.
    await as(ids.hrAdmin,
      `UPDATE scorecard_item SET points = 9 WHERE scorecard_id = $1 AND sequence = 3`,
      [ids.scorecard]);
    await as(ids.hrAdmin,
      `UPDATE scorecard_item SET criteria = 'rewritten entirely'
        WHERE scorecard_id = $1 AND sequence = 1`, [ids.scorecard]);
    await as(ids.hrAdmin,
      `INSERT INTO scorecard_item (org_id,scorecard_id,task_indicator_id,points,
                                   criteria,sequence)
       VALUES ($1,$2,$3,3,'added after the fact',4)`,
      [ids.org, ids.scorecard, ids.referral]);

    const head = await one<{ awarded: string; target: string }>(ids.supervisor,
      `SELECT awarded_points AS awarded, target_points AS target
         FROM scorecard_evaluation WHERE id = $1`, [ev]);
    expect(Number(head!.awarded)).toBe(4);
    expect(Number(head!.target)).toBe(4);

    const lines = await as<{ criteria: string; pts: string }>(ids.supervisor,
      `SELECT criteria, points_available AS pts
         FROM scorecard_evaluation_line WHERE evaluation_id = $1 ORDER BY sequence`,
      [ev]);
    expect(lines).toHaveLength(3);
    expect(lines[0]!.criteria).toContain('accident');
    expect(Number(lines[2]!.pts)).toBe(2);

    // Meanwhile the scorecard itself has genuinely moved on, so the next
    // evaluation opened will pick the new shape up.
    const target = await one<{ t: string }>(ids.hrAdmin,
      'SELECT app.scorecard_target($1) AS t', [ids.scorecard]);
    expect(Number(target!.t)).toBe(14);
  });

  it('keeps the record when the scorecard line it came from is deleted', async () => {
    const before = await one<{ c: string }>(ids.hrAdmin,
      `SELECT count(*)::int AS c FROM scorecard_evaluation_line
        WHERE indicator_name = 'Incident Referral'`);
    await as(ids.hrAdmin,
      `DELETE FROM scorecard_item WHERE scorecard_id = $1 AND sequence = 4`,
      [ids.scorecard]);
    const after = await one<{ c: string }>(ids.hrAdmin,
      `SELECT count(*)::int AS c FROM scorecard_evaluation_line
        WHERE indicator_name = 'Incident Referral'`);
    expect(after!.c).toBe(before!.c);
  });
});

describe('who can see an evaluation', () => {
  it('hides a draft from the person being evaluated', async () => {
    const ev = await open(ids.supervisor, '2030-01-01', '2030-03-31');

    // The supervisor is mid-assessment. Reading it now would change how
    // supervisors write, permanently and for the worse.
    expect(await as(ids.associate,
      `SELECT id FROM scorecard_evaluation WHERE id = $1`, [ev])).toHaveLength(0);
    expect(await as(ids.associate,
      `SELECT id FROM scorecard_evaluation_line WHERE evaluation_id = $1`, [ev]))
      .toHaveLength(0);

    // And the evaluator can see their own work.
    expect(await as(ids.supervisor,
      `SELECT id FROM scorecard_evaluation WHERE id = $1`, [ev])).toHaveLength(1);
  });

  it('shows it to them once submitted, lines and all', async () => {
    const ev = await open(ids.supervisor, '2030-04-01', '2030-06-30');
    await scoreAll(ids.supervisor, ev, [1, 0, 2]);
    await as(ids.supervisor, `SELECT app.submit_scorecard_evaluation($1)`, [ev]);

    const seen = await one<{ awarded: string }>(ids.associate,
      `SELECT awarded_points AS awarded FROM scorecard_evaluation WHERE id = $1`, [ev]);
    expect(Number(seen!.awarded)).toBe(3);
    expect(await as(ids.associate,
      `SELECT id FROM scorecard_evaluation_line WHERE evaluation_id = $1`, [ev]))
      .toHaveLength(3);
  });

  it('lets the subject acknowledge, and nobody else pretend to', async () => {
    const ev = await open(ids.supervisor, '2030-07-01', '2030-09-30');
    await scoreAll(ids.supervisor, ev, [1, 1, 2]);
    await as(ids.supervisor, `SELECT app.submit_scorecard_evaluation($1)`, [ev]);

    const acked = await as(ids.associate,
      `UPDATE scorecard_evaluation SET state = 'acknowledged', acknowledged_at = now()
        WHERE id = $1 AND employee_id = $2 RETURNING id`, [ev, ids.associate]);
    expect(acked).toHaveLength(1);

    const state = await one<{ state: string }>(ids.supervisor,
      `SELECT state::text AS state FROM scorecard_evaluation WHERE id = $1`, [ev]);
    expect(state!.state).toBe('acknowledged');
  });

  it('keeps it away from an unrelated colleague entirely', async () => {
    const ev = await open(ids.supervisor, '2031-01-01', '2031-03-31');
    await scoreAll(ids.supervisor, ev, [1, 1, 2]);
    await as(ids.supervisor, `SELECT app.submit_scorecard_evaluation($1)`, [ev]);

    // Submitted, so not hidden by the draft rule -- it is the scope that keeps
    // a peer out, which is the case worth proving.
    expect(await as(ids.bystander,
      `SELECT id FROM scorecard_evaluation WHERE id = $1`, [ev])).toHaveLength(0);
  });

  it('is readable org-wide by HR', async () => {
    const seen = await one<{ c: string }>(ids.hrAdmin,
      `SELECT count(*)::int AS c FROM scorecard_evaluation`);
    expect(Number(seen!.c)).toBeGreaterThan(0);
  });
});
