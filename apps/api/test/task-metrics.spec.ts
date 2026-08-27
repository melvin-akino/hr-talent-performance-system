import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task metrics — loading what people are measured on, without evaluating them.
 *
 * The shape here is taken directly from the client's HCM workbook, because the
 * workbook is what broke the first attempt: their scorecards list the SAME
 * indicator several times with different acceptance criteria — "Claims
 * Processing" once for accident, once for maternity, once for sickness — and a
 * uniqueness rule on (scorecard, indicator) silently collapsed a 33-point
 * scorecard to 19. The line is the unit of measurement, not the indicator, and
 * the first test pins that down.
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
    throw new Error(`Metrics test pool must be non-superuser hr_app, got '${who.rows[0]?.user}'`);
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
  ids.otherDept = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'HS','Hiring & Selection','2020-01-01') RETURNING id`, [org])).rows[0].id;
  ids.etype = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','Regular') RETURNING id`,
    [org])).rows[0].id;

  const emp = async (no: string, dept = ids.dept) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [org, id, dept, ids.etype]);
    return id;
  };

  ids.hrAdmin = await emp('hradmin');
  ids.deptHead = await emp('depthead');
  ids.associate = await emp('assoc');
  ids.outsider = await emp('outsider', ids.otherDept);

  await admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, ids.associate, ids.deptHead]);

  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [org]);
  await admin.query('SELECT app.seed_line_role_grants($1)', [org]);
  await admin.query('SELECT app.seed_scorecard_grants($1)', [org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, e, r]);

  const rEmp = await role('employee');
  for (const e of [ids.hrAdmin, ids.deptHead, ids.associate, ids.outsider]) {
    await assign(e, rEmp);
  }
  await assign(ids.hrAdmin, await role('hr_admin'));

  // A department head is assigned WITH a department. 'department' scope reads
  // scope_department_id off the assignment, so an unscoped dept_head is
  // deliberately powerless -- and would make this suite pass for the wrong
  // reason if it were assigned the way the other roles are.
  await admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,scope_department_id,
                                  effective_from)
     VALUES ($1,$2,$3,$4,'2020-01-01')`,
    [org, ids.deptHead, await role('dept_head'), ids.dept]);
}

/** Mirrors how the loader builds a scorecard out of the workbook's rows. */
async function buildCard(
  name: string, lines: Array<[string, string, number, string | null]>,
): Promise<string> {
  const sc = (await as<{ id: string }>(ids.hrAdmin,
    `INSERT INTO scorecard (org_id, name, department_id) VALUES ($1,$2,$3) RETURNING id`,
    [ids.org, name, ids.dept]))[0]!.id;
  let seq = 0;
  for (const [indicator, nature, points, criteria] of lines) {
    seq += 1;
    await as(ids.hrAdmin,
      `INSERT INTO task_indicator (org_id, name, nature)
            VALUES ($1,$2,$3::task_nature)
       ON CONFLICT (org_id, name) DO NOTHING`, [ids.org, indicator, nature]);
    await as(ids.hrAdmin,
      `INSERT INTO scorecard_item (org_id, scorecard_id, task_indicator_id, points,
                                   criteria, sequence)
            SELECT $1, $2, t.id, $3, $4, $5 FROM task_indicator t
             WHERE t.org_id = $1 AND t.name = $6`,
      [ids.org, sc, points, criteria, seq, indicator]);
  }
  return sc;
}

const targetOf = async (viewer: string, sc: string) => Number(
  (await as<{ t: string }>(viewer, 'SELECT app.scorecard_target($1) AS t', [sc]))[0]!.t);

describe('the catalogue', () => {
  it('gives each nature its default weight', async () => {
    // Straight from the workbook's own legend: administrative 1, field 1.5,
    // technical 2. If these drift, every target in every scorecard moves.
    const rows = await as<{ n: string; m: string }>(ids.associate,
      `SELECT n::text AS n, app.task_nature_multiplier(n) AS m
         FROM unnest(ARRAY['administrative','field','technical']::task_nature[]) AS n`);
    expect(rows.map((r) => [r.n, Number(r.m)])).toEqual([
      ['administrative', 1], ['field', 1.5], ['technical', 2],
    ]);
  });

  it('refuses two entries with the same name', async () => {
    await as(ids.hrAdmin,
      `INSERT INTO task_indicator (org_id,name,nature) VALUES ($1,'Filing','administrative')`,
      [ids.org]);
    await expect(
      as(ids.hrAdmin,
        `INSERT INTO task_indicator (org_id,name,nature) VALUES ($1,'Filing','field')`,
        [ids.org]),
    ).rejects.toThrow();
  });

  it('is not writable by an ordinary employee', async () => {
    await expect(
      as(ids.associate,
        `INSERT INTO task_indicator (org_id,name,nature)
         VALUES ($1,'Self Serving','technical')`, [ids.org]),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('scorecards', () => {
  it('carries the same indicator on several lines, each with its own criterion',
    async () => {
      // The Social Insurances case that broke the first schema.
      const sc = await buildCard('Social Insurances', [
        ['Claims Processing', 'administrative', 1, '1 pt per type of claim - accident'],
        ['Claims Processing', 'administrative', 1, '1 pt per type of claim - maternity'],
        ['Claims Processing', 'administrative', 1, '1 pt per type of claim - sickness'],
        ['Payments processing', 'administrative', 1, '1 pt per company - G'],
        ['Payments processing', 'administrative', 1, '1 pt per company - H'],
      ]);

      const lines = await as<{ criteria: string }>(ids.associate,
        `SELECT criteria FROM scorecard_item WHERE scorecard_id = $1 ORDER BY sequence`,
        [sc]);
      expect(lines).toHaveLength(5);
      expect(new Set(lines.map((l) => l.criteria)).size).toBe(5);
      expect(await targetOf(ids.associate, sc)).toBe(5);
    });

  it('totals mixed natures the way the workbook does', async () => {
    const sc = await buildCard('OSH Health', [
      ['Health Monitoring', 'field', 1.5, 'per branch visited'],
      ['Incident Reporting', 'administrative', 1, 'per report filed'],
      ['Program Design', 'technical', 2, 'per programme'],
    ]);
    expect(await targetOf(ids.associate, sc)).toBe(4.5);
  });

  it('reports zero for a scorecard with no lines yet', async () => {
    // HCM creates the card first and fills it in over days. A NULL here would
    // render as an empty target on screen and read as a bug.
    const sc = (await as<{ id: string }>(ids.hrAdmin,
      `INSERT INTO scorecard (org_id,name) VALUES ($1,'Empty') RETURNING id`,
      [ids.org]))[0]!.id;
    expect(await targetOf(ids.hrAdmin, sc)).toBe(0);
  });

  it('rejects a line worth nothing', async () => {
    const sc = (await as<{ id: string }>(ids.hrAdmin,
      `INSERT INTO scorecard (org_id,name) VALUES ($1,'Zero Points') RETURNING id`,
      [ids.org]))[0]!.id;
    const ind = (await as<{ id: string }>(ids.hrAdmin,
      `INSERT INTO task_indicator (org_id,name,nature)
       VALUES ($1,'Unweighted','administrative') RETURNING id`, [ids.org]))[0]!.id;
    await expect(
      as(ids.hrAdmin,
        `INSERT INTO scorecard_item (org_id,scorecard_id,task_indicator_id,points,sequence)
         VALUES ($1,$2,$3,0,1)`, [ids.org, sc, ind]),
    ).rejects.toThrow(/points_positive/);
  });
});

describe('who may define metrics', () => {
  it('lets a department head write, and everyone read', async () => {
    const sc = (await as<{ id: string }>(ids.deptHead,
      `INSERT INTO scorecard (org_id,name,department_id)
       VALUES ($1,'Wages & Benefits',$2) RETURNING id`, [ids.org, ids.dept]))[0]!.id;
    expect(sc).toBeTruthy();

    // Reading is deliberately open inside the tenant: a person must be able to
    // see the scorecard they are measured on, and their colleagues' too, the
    // same way the printed workbook circulates.
    const seen = await as<{ id: string }>(ids.associate,
      `SELECT id FROM scorecard WHERE id = $1`, [sc]);
    expect(seen).toHaveLength(1);
  });

  it('stops an ordinary employee editing their own scorecard', async () => {
    const sc = await buildCard('Comms DS', [
      ['Info Dissem', 'administrative', 1, 'per posting'],
    ]);
    // An UPDATE the policy forbids does not raise -- USING simply matches no
    // rows, so the statement succeeds having changed nothing. Asserting on the
    // error would have tested the wrong thing; what matters is the points.
    const changed = await as(ids.associate,
      `UPDATE scorecard_item SET points = 99 WHERE scorecard_id = $1 RETURNING id`, [sc]);
    expect(changed).toHaveLength(0);

    expect(await targetOf(ids.associate, sc)).toBe(1);
  });
});

describe('assignment', () => {
  it('finds what a person is measured on as of a date', async () => {
    const sc = await buildCard('Screening', [
      ['Applicant Matching', 'technical', 14, '2 pts per division'],
    ]);
    await as(ids.hrAdmin,
      `INSERT INTO scorecard_assignment (org_id,scorecard_id,employee_id,effective_from)
       VALUES ($1,$2,$3,'2026-01-01')`, [ids.org, sc, ids.associate]);

    const now = await as<{ id: string | null }>(ids.hrAdmin,
      `SELECT app.scorecard_for($1, DATE '2026-06-01') AS id`, [ids.associate]);
    expect(now[0]!.id).toBe(sc);

    // Before it started they were on nothing — a fact about the past, not a
    // fallback to today's card.
    const past = await as<{ id: string | null }>(ids.hrAdmin,
      `SELECT app.scorecard_for($1, DATE '2025-06-01') AS id`, [ids.associate]);
    expect(past[0]!.id).toBeNull();
  });

  it('refuses to put someone on two scorecards at once', async () => {
    const a = await buildCard('Onboarding 1', [
      ['Orientation', 'administrative', 1, 'per batch'],
    ]);
    await buildCard('Onboarding 2', [
      ['Records Filing', 'administrative', 1, 'per file'],
    ]);
    await as(ids.hrAdmin,
      `INSERT INTO scorecard_assignment (org_id,scorecard_id,employee_id,effective_from)
       VALUES ($1,$2,$3,'2026-01-01')`, [ids.org, a, ids.outsider]);
    const b = (await as<{ id: string }>(ids.hrAdmin,
      `SELECT id FROM scorecard WHERE org_id = $1 AND name = 'Onboarding 2'`,
      [ids.org]))[0]!.id;
    await expect(
      as(ids.hrAdmin,
        `INSERT INTO scorecard_assignment (org_id,scorecard_id,employee_id,effective_from)
         VALUES ($1,$2,$3,'2026-03-01')`, [ids.org, b, ids.outsider]),
    ).rejects.toThrow();
  });

  it('allows a move once the previous card is closed', async () => {
    // Somebody transferring mid-year is normal, and the record of what they
    // were measured on before the move has to survive it.
    const open = await as<{ id: string }>(ids.hrAdmin,
      `SELECT id FROM scorecard_assignment
        WHERE employee_id = $1 AND effective_to IS NULL`, [ids.outsider]);
    expect(open).toHaveLength(1);

    await as(ids.hrAdmin,
      `UPDATE scorecard_assignment SET effective_to = '2026-03-01' WHERE id = $1`,
      [open[0]!.id]);
    const b = (await as<{ id: string }>(ids.hrAdmin,
      `SELECT id FROM scorecard WHERE org_id = $1 AND name = 'Onboarding 2'`,
      [ids.org]))[0]!.id;
    await as(ids.hrAdmin,
      `INSERT INTO scorecard_assignment (org_id,scorecard_id,employee_id,effective_from)
       VALUES ($1,$2,$3,'2026-03-01')`, [ids.org, b, ids.outsider]);

    const nameOn = async (asOf: string) => (await as<{ name: string }>(ids.hrAdmin,
      `SELECT s.name FROM scorecard s WHERE s.id = app.scorecard_for($1, $2::date)`,
      [ids.outsider, asOf]))[0]?.name;
    expect(await nameOn('2026-02-01')).toBe('Onboarding 1');
    expect(await nameOn('2026-04-01')).toBe('Onboarding 2');
  });

  it('does not evaluate anybody', async () => {
    // Option 1 is loading only. Nothing in this subsystem may write a score,
    // and this is the assertion that keeps it that way while option 2 is built.
    const scored = await as<{ c: string }>(ids.hrAdmin,
      `SELECT count(*)::int AS c FROM review_instance WHERE computed_score IS NOT NULL`);
    expect(Number(scored[0]!.c)).toBe(0);
  });
});
