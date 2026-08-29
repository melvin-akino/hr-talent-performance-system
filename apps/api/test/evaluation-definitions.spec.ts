import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * C1 — the evaluation definition (requirements §2).
 *
 * The client names five evaluation types. They are five rows here, not five
 * features, and most of this suite exists to keep that true: the constraints
 * that stop a definition being self-contradictory, and the snapshot that stops
 * an edit to one moving a score already given under it.
 *
 * What is NOT here is scheduling. Firing an evaluation on somebody's third
 * month is C2 and waits on Q7. This proves the answer can be *stored*.
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
    throw new Error(
      `Must run as non-superuser hr_app, got '${who.rows[0]?.user}'. A superuser `
      + 'bypasses RLS and the permission assertions below would be vacuous.');
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
     VALUES ($1,'HCM','Human Capital Management','2020-01-01') RETURNING id`,
    [org])).rows[0].id;
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
  ids.associate = await emp('assoc');

  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [org]);
  await admin.query('SELECT app.seed_phase3_grants($1)', [org]);
  await admin.query('SELECT app.seed_evaluation_definitions($1)', [org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, e, r]);

  const rEmp = await role('employee');
  for (const e of [ids.hrAdmin, ids.associate]) await assign(e, rEmp);
  await assign(ids.hrAdmin, await role('hr_admin'));
}

/** Inserts a definition as HR, returning the row or throwing. */
const define = (fields: Record<string, unknown>) => as<{ id: string }>(ids.hrAdmin,
  `INSERT INTO evaluation_definition (
     org_id, code, name, eval_type, period_basis, anchor, offset_months,
     expected_instances, averaging, participants)
   VALUES ($1,$2,$3,$4::evaluation_type,$5::evaluation_period_basis,
           $6::evaluation_anchor,$7::smallint[],$8,$9::evaluation_averaging,
           $10::evaluation_participant[])
   RETURNING id`,
  [ids.org, fields.code, fields.name, fields.evalType,
   fields.periodBasis ?? 'calendar', fields.anchor ?? null,
   fields.offsetMonths ?? null, fields.expectedInstances ?? 1,
   fields.averaging ?? 'single', fields.participants ?? ['self', 'supervisor']]);

describe('the client’s five types, seeded', () => {
  it('are five rows, not five features', async () => {
    const rows = await as<{ code: string; eval_type: string }>(ids.hrAdmin,
      `SELECT code, eval_type::text FROM evaluation_definition ORDER BY code`);
    expect(rows.map((r) => r.code)).toEqual(
      ['ANNUAL', 'KPI', 'PROB', 'PROJECT', 'SEMI']);
    expect(new Set(rows.map((r) => r.eval_type)).size).toBe(5);
  });

  it('carries the probationary pair as data, ready for Q7', async () => {
    // The offsets are stated on their page 1 and are not in question. The
    // ANCHOR is Q7, seeded to our assumption -- the point being that answering
    // Q7 is an UPDATE to this row, not a schema change.
    const prob = await one<{
      period_basis: string; anchor: string; offset_months: number[];
      expected_instances: number; averaging: string;
    }>(ids.hrAdmin,
      `SELECT period_basis::text, anchor::text, offset_months,
              expected_instances, averaging::text
         FROM evaluation_definition WHERE code = 'PROB'`);

    expect(prob!.period_basis).toBe('employee_relative');
    expect(prob!.anchor).toBe('hired_on');
    expect(prob!.offset_months).toEqual([3, 4]);
    expect(prob!.expected_instances).toBe(2);
    expect(prob!.averaging).toBe('mean');
  });

  it('answers Q7 with an UPDATE when it lands', async () => {
    // Proving the claim rather than asserting it in a comment: switching the
    // anchor to regularisation is one statement and breaks nothing.
    await as(ids.hrAdmin,
      `UPDATE evaluation_definition SET anchor = 'regularized_on'
        WHERE code = 'PROB'`);
    const after = await one<{ anchor: string }>(ids.hrAdmin,
      `SELECT anchor::text FROM evaluation_definition WHERE code = 'PROB'`);
    expect(after!.anchor).toBe('regularized_on');

    await as(ids.hrAdmin,
      `UPDATE evaluation_definition SET anchor = 'hired_on' WHERE code = 'PROB'`);
  });

  it('seeds semi-annual as two instances averaged', async () => {
    const semi = await one<{ expected_instances: number; averaging: string }>(
      ids.hrAdmin,
      `SELECT expected_instances, averaging::text
         FROM evaluation_definition WHERE code = 'SEMI'`);
    expect(semi!.expected_instances).toBe(2);
    expect(semi!.averaging).toBe('mean');
  });

  it('is idempotent, so re-seeding an existing org adds nothing', async () => {
    await admin.query('SELECT app.seed_evaluation_definitions($1)', [ids.org]);
    const n = await one<{ c: string }>(ids.hrAdmin,
      `SELECT count(*)::int AS c FROM evaluation_definition`);
    expect(Number(n!.c)).toBe(5);
  });
});

describe('a definition cannot contradict itself', () => {
  it('refuses averaging over a single instance', async () => {
    await expect(define({
      code: 'BAD1', name: 'Mean of one', evalType: 'annual',
      expectedInstances: 1, averaging: 'mean',
    })).rejects.toThrow(/averaging_agrees/);
  });

  it('refuses two instances with no averaging rule', async () => {
    // The failure this catches shows up as a person's score being half what
    // their evaluators recorded, with nothing on screen to explain it.
    await expect(define({
      code: 'BAD2', name: 'Two, unaveraged', evalType: 'semi_annual',
      expectedInstances: 2, averaging: 'single',
    })).rejects.toThrow(/averaging_agrees/);
  });

  it('refuses an employee-relative definition with no anchor', async () => {
    await expect(define({
      code: 'BAD3', name: 'Relative to nothing', evalType: 'probationary',
      periodBasis: 'employee_relative', offsetMonths: [3],
    })).rejects.toThrow(/relative_complete/);
  });

  it('refuses an employee-relative definition with no offsets', async () => {
    await expect(define({
      code: 'BAD4', name: 'No months', evalType: 'probationary',
      periodBasis: 'employee_relative', anchor: 'hired_on',
    })).rejects.toThrow(/relative_complete/);
  });

  it('refuses a calendar definition carrying a stray anchor', async () => {
    // Not pedantry: an unused anchor sits unnoticed until somebody flips the
    // basis and silently inherits offsets nobody chose.
    await expect(define({
      code: 'BAD5', name: 'Calendar with anchor', evalType: 'annual',
      anchor: 'hired_on',
    })).rejects.toThrow(/relative_complete/);
  });

  it('refuses a month offset of zero', async () => {
    await expect(define({
      code: 'BAD6', name: 'Month zero', evalType: 'probationary',
      periodBasis: 'employee_relative', anchor: 'hired_on', offsetMonths: [0, 4],
      expectedInstances: 2, averaging: 'mean',
    })).rejects.toThrow(/offsets_positive/);
  });

  it('refuses a NULL hiding inside the offsets', async () => {
    // `0 < ALL (ARRAY[3, NULL])` is NULL, and a CHECK that evaluates to NULL
    // PASSES -- so without the explicit NULL guard this array would slip
    // through the very constraint written to catch it.
    await expect(define({
      code: 'BAD7', name: 'Null month', evalType: 'probationary',
      periodBasis: 'employee_relative', anchor: 'hired_on',
      offsetMonths: [3, null], expectedInstances: 2, averaging: 'mean',
    })).rejects.toThrow(/offsets_positive/);
  });

  it('refuses a definition nobody takes part in', async () => {
    await expect(define({
      code: 'BAD8', name: 'Nobody', evalType: 'annual', participants: [],
    })).rejects.toThrow(/participants_present/);
  });
});

describe('a cycle pins the rules it was issued under', () => {
  it('snapshots them on insert, without the caller doing anything', async () => {
    // A trigger rather than application code: cycles are created from the API,
    // the CLI and seed-demo, and a snapshot that relies on each caller
    // remembering to take it is one that will be missed.
    const semi = await one<{ id: string }>(ids.hrAdmin,
      `SELECT id FROM evaluation_definition WHERE code = 'SEMI'`);

    const cycle = await one<{ id: string }>(ids.hrAdmin,
      `INSERT INTO review_cycle (org_id, name, opens_on, closes_on,
                                 evaluation_definition_id)
            VALUES ($1,'FY2026 Semi-annual','2026-01-01','2026-12-31',$2)
       RETURNING id`, [ids.org, semi!.id]);

    const snap = await one<{ expected_instances: number; averaging: string }>(
      ids.hrAdmin,
      `SELECT expected_instances, averaging::text FROM review_cycle WHERE id = $1`,
      [cycle!.id]);
    expect(snap!.expected_instances).toBe(2);
    expect(snap!.averaging).toBe('mean');
    ids.cycle = cycle!.id;
  });

  it('does not move when the definition is edited afterwards', async () => {
    // The versioning principle, applied where it bites: HR changes semi-annual
    // to a single instance next year, and last year's cycle must still mean
    // what it meant.
    await as(ids.hrAdmin,
      `UPDATE evaluation_definition
          SET expected_instances = 1, averaging = 'single' WHERE code = 'SEMI'`);

    const snap = await one<{ expected_instances: number; averaging: string }>(
      ids.hrAdmin,
      `SELECT expected_instances, averaging::text FROM review_cycle WHERE id = $1`,
      [ids.cycle]);
    expect(snap!.expected_instances).toBe(2);
    expect(snap!.averaging).toBe('mean');

    await as(ids.hrAdmin,
      `UPDATE evaluation_definition
          SET expected_instances = 2, averaging = 'mean' WHERE code = 'SEMI'`);
  });

  it('leaves a cycle with no definition alone', async () => {
    // Cycles predating C1 have none, and inventing one would be a claim about
    // what they were rather than a record of it.
    const cycle = await one<{ expected_instances: number | null; averaging: string | null }>(
      ids.hrAdmin,
      `INSERT INTO review_cycle (org_id, name, opens_on, closes_on)
            VALUES ($1,'Legacy cycle','2025-01-01','2025-12-31')
       RETURNING expected_instances, averaging::text AS averaging`, [ids.org]);
    expect(cycle!.expected_instances).toBeNull();
    expect(cycle!.averaging).toBeNull();
  });

  it('will not let a definition in use be deleted', async () => {
    // Retiring is is_active = FALSE. Deleting would erase what the cycle was.
    await expect(as(ids.hrAdmin,
      `DELETE FROM evaluation_definition WHERE code = 'SEMI'`))
      .rejects.toThrow(/foreign key|violates/i);
  });
});

describe('who may define an evaluation type', () => {
  it('lets everyone read them', async () => {
    // A person is entitled to know what kind of evaluation they are being put
    // through and how its instances combine.
    const seen = await as(ids.associate,
      `SELECT id FROM evaluation_definition`);
    expect(seen.length).toBe(5);
  });

  it('stops an ordinary employee defining one', async () => {
    await expect(as(ids.associate,
      `INSERT INTO evaluation_definition (org_id, code, name, eval_type)
            VALUES ($1,'MINE','My own type','annual')`, [ids.org]))
      .rejects.toThrow(/row-level security/i);
  });

  it('stops an ordinary employee editing one', async () => {
    // A forbidden UPDATE does not raise under RLS -- it matches no rows. What
    // matters is that the definition is unchanged.
    const changed = await as(ids.associate,
      `UPDATE evaluation_definition SET expected_instances = 9
        WHERE code = 'ANNUAL' RETURNING id`);
    expect(changed).toHaveLength(0);

    const still = await one<{ expected_instances: number }>(ids.associate,
      `SELECT expected_instances FROM evaluation_definition WHERE code = 'ANNUAL'`);
    expect(still!.expected_instances).toBe(1);
  });
});
