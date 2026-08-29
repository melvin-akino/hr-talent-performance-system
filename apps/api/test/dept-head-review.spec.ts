import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * C3 — the Department Head revises, approves or disapproves (§4.5b).
 *
 * The step sits between a supervisor filling in an evaluation and it becoming
 * final. Two properties carry the weight:
 *
 *   1. sign-off waits for the DH — and does so as a CONSEQUENCE of the existing
 *      rule that every instance must be submitted, not because a new check was
 *      added that somebody could forget;
 *   2. sending an evaluation back is a second person's judgement. Before this,
 *      the assigned reviewer could return their own submitted evaluation and
 *      rewrite it.
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

  ids.deptHead = await emp('depthead');
  ids.supervisor = await emp('supervisor');
  ids.subject = await emp('subject');

  await admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, ids.subject, ids.supervisor]);

  for (const fn of ['seed_baseline_roles', 'seed_phase1_grants', 'seed_phase3_grants',
                    'seed_line_role_grants', 'seed_dept_head_review_grants']) {
    await admin.query(`SELECT app.${fn}($1)`, [org]);
  }

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;

  const rEmp = await role('employee');
  for (const e of [ids.deptHead, ids.supervisor, ids.subject]) {
    await admin.query(
      `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
       VALUES ($1,$2,$3,'2020-01-01')`, [org, e, rEmp]);
  }
  await admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, ids.supervisor, await role('manager')]);
  // Scoped to the department: 'department' scope reads scope_department_id off
  // the assignment, so an unscoped dept_head is deliberately powerless.
  await admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,scope_department_id,
                                  effective_from)
     VALUES ($1,$2,$3,$4,'2020-01-01')`,
    [org, ids.deptHead, await role('dept_head'), ids.dept]);

  // A cycle with the new phase in the chain.
  ids.cycle = (await admin.query(
    `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
     VALUES ($1,'FY2026','2026-01-01','2026-12-31','open') RETURNING id`,
    [org])).rows[0].id;
  for (const [i, phase] of ['self', 'supervisor', 'dept_head', 'signoff'].entries()) {
    await admin.query(
      `INSERT INTO review_cycle_phase (review_cycle_id, phase_type, sequence,
                                       opens_on, closes_on)
       VALUES ($1,$2::review_phase_type,$3,'2026-01-01','2026-12-31')`,
      [ids.cycle, phase, i + 1]);
  }

  const scale = (await admin.query(
    `INSERT INTO rating_scale (org_id,code,version,name,published_at)
     VALUES ($1,'STD',1,'Standard',now()) RETURNING id`, [org])).rows[0].id;
  const template = (await admin.query(
    `INSERT INTO form_template (org_id,code,name) VALUES ($1,'STD','Standard')
     RETURNING id`, [org])).rows[0].id;
  ids.formVersion = (await admin.query(
    `INSERT INTO form_version (form_template_id,version,schema_json,rating_scale_id,
                               published_at,is_active)
     VALUES ($1,1,$2::jsonb,$3,now(),TRUE) RETURNING id`,
    [template, JSON.stringify({ sections: [] }), scale])).rows[0].id;

  const instance = async (reviewer: string, role: string) => (await admin.query(
    `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                  reviewer_employee_id, reviewer_role,
                                  form_version_id, state)
     VALUES ($1,$2,$3,$4::reviewer_role,$5,'not_started') RETURNING id`,
    [ids.cycle, ids.subject, reviewer, role, ids.formVersion])).rows[0].id;

  ids.selfInstance = await instance(ids.subject, 'self');
  ids.supInstance = await instance(ids.supervisor, 'supervisor');
  ids.dhInstance = await instance(ids.deptHead, 'dept_head');

  await admin.query(
    `INSERT INTO review_summary (review_cycle_id, subject_employee_id)
     VALUES ($1,$2)`, [ids.cycle, ids.subject]);
}

describe('the Department Head is part of the chain', () => {
  it('can hold a review instance of their own', async () => {
    // reviewer_role had no dept_head, so a DH could not be assigned at all.
    const mine = await as<{ id: string; role: string }>(ids.deptHead,
      `SELECT id, reviewer_role::text AS role FROM review_instance
        WHERE reviewer_employee_id = $1`, [ids.deptHead]);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.role).toBe('dept_head');
  });

  it('has a phase to work in', async () => {
    const phases = await as<{ phase_type: string }>(ids.deptHead,
      `SELECT phase_type::text FROM review_cycle_phase
        WHERE review_cycle_id = $1 ORDER BY sequence`, [ids.cycle]);
    expect(phases.map((p) => p.phase_type))
      .toEqual(['self', 'supervisor', 'dept_head', 'signoff']);
  });

  it('sees the reviews of people in their department', async () => {
    const seen = await one<{ ok: boolean }>(ids.deptHead,
      `SELECT app.can_access('review','read',$1) AS ok`, [ids.subject]);
    expect(seen!.ok).toBe(true);
  });
});

describe('sign-off waits for the Department Head', () => {
  it('is blocked while the DH instance is unsubmitted', async () => {
    // Not a new check: signOff already refuses while any instance for the
    // subject is unsubmitted, and the DH now has one. The gate falls out of the
    // existing rule rather than being a second rule to keep in step.
    await as(ids.subject,
      `UPDATE review_instance SET state = 'submitted' WHERE id = $1`,
      [ids.selfInstance]);
    await as(ids.supervisor,
      `UPDATE review_instance SET state = 'submitted' WHERE id = $1`,
      [ids.supInstance]);

    const pending = await one<{ c: string }>(ids.deptHead,
      `SELECT count(*)::int AS c FROM review_instance
        WHERE review_cycle_id = $1 AND subject_employee_id = $2
          AND state <> 'submitted'`, [ids.cycle, ids.subject]);
    expect(Number(pending!.c)).toBe(1);
  });

  it('is clear once the DH submits', async () => {
    await as(ids.deptHead,
      `UPDATE review_instance SET state = 'submitted' WHERE id = $1`,
      [ids.dhInstance]);

    const pending = await one<{ c: string }>(ids.deptHead,
      `SELECT count(*)::int AS c FROM review_instance
        WHERE review_cycle_id = $1 AND subject_employee_id = $2
          AND state <> 'submitted'`, [ids.cycle, ids.subject]);
    expect(Number(pending!.c)).toBe(0);
  });
});

describe('sending an evaluation back is a second person’s judgement', () => {
  it('lets the Department Head return the supervisor’s evaluation', async () => {
    const allowed = await one<{ ok: boolean }>(ids.deptHead,
      `SELECT app.can_return_review($1) AS ok`, [ids.supInstance]);
    expect(allowed!.ok).toBe(true);
  });

  it('does not let the supervisor return their own', async () => {
    // The defect this closes. The row policy lets the assigned reviewer edit
    // their own instance, which is right for filling one in and wrong for
    // sending it back -- so a supervisor could return and rewrite their own
    // submitted evaluation. Audited, but with no second person involved, which
    // is the entire content of step 5b.
    const allowed = await one<{ ok: boolean }>(ids.supervisor,
      `SELECT app.can_return_review($1) AS ok`, [ids.supInstance]);
    expect(allowed!.ok).toBe(false);
  });

  it('does not let the subject return anything about themselves', async () => {
    const allowed = await one<{ ok: boolean }>(ids.subject,
      `SELECT app.can_return_review($1) AS ok`, [ids.supInstance]);
    expect(allowed!.ok).toBe(false);
  });

  it('still records a reason when one is returned', async () => {
    // The state machine's rule (0013), unchanged and still holding.
    await expect(as(ids.deptHead,
      `UPDATE review_instance SET state = 'returned' WHERE id = $1`,
      [ids.supInstance])).rejects.toThrow(/must record a reason/);

    await as(ids.deptHead,
      `UPDATE review_instance SET state = 'returned', returned_reason = $2
        WHERE id = $1`, [ids.supInstance, 'Rating is not supported by the evidence.']);

    const row = await one<{ state: string; reason: string; submitted_at: string | null }>(
      ids.deptHead,
      `SELECT state::text AS state, returned_reason AS reason, submitted_at::text
         FROM review_instance WHERE id = $1`, [ids.supInstance]);
    expect(row!.state).toBe('returned');
    expect(row!.reason).toMatch(/not supported/);
    // Returning clears the submission, so the cycle genuinely reopens.
    expect(row!.submitted_at).toBeNull();
  });
});

describe('a Department Head is scoped to their department', () => {
  it('cannot touch reviews outside it', async () => {
    // 'department' scope resolves the subtree of the assignment's department.
    // Somebody in another one is not theirs, and the grant must not reach them.
    const other = (await admin.query<{ id: string }>(
      `INSERT INTO department (org_id,code,name,effective_from)
       VALUES ($1,'OPS','Operations','2020-01-01') RETURNING id`,
      [ids.org])).rows[0]!.id;
    const outsider = (await admin.query<{ id: string }>(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,'outsider','O','X','2020-01-01') RETURNING id`,
      [ids.org])).rows[0]!.id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`,
      [ids.org, outsider, other, ids.etype]);

    const allowed = await one<{ ok: boolean }>(ids.deptHead,
      `SELECT app.can_access('review','approve',$1) AS ok`, [outsider]);
    expect(allowed!.ok).toBe(false);
  });
});
