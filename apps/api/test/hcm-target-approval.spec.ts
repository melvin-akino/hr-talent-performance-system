import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * C5 — HCM approves targets before they count (requirements §4.3).
 *
 * Their step 3 is "HCM sets timeline, approves targets, revises". The timeline
 * half already existed; this is the approval.
 *
 * The property worth defending is that the second gate is REAL — that a target
 * parked for HCM cannot become active by any route that does not go through
 * HCM. A gate people believe in but the system does not keep is worse than no
 * gate, because nobody checks it afterwards.
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

  ids.hcm = await emp('hcm');
  ids.supervisor = await emp('supervisor');
  ids.employee = await emp('employee');

  await admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, ids.employee, ids.supervisor]);

  for (const fn of ['seed_baseline_roles', 'seed_phase1_grants',
                    'seed_hcm_target_grants', 'seed_hcm_target_templates']) {
    await admin.query(`SELECT app.${fn}($1)`, [org]);
  }

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, e, r]);

  const rEmp = await role('employee');
  for (const e of [ids.hcm, ids.supervisor, ids.employee]) await assign(e, rEmp);
  await assign(ids.hcm, await role('hr_admin'));
  await assign(ids.supervisor, await role('manager'));

  // Two periods: one with the gate on, one without, so the default path is
  // proven unchanged alongside the new one.
  ids.gated = (await admin.query(
    `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state,
                              requires_hcm_approval)
     VALUES ($1,'FY2026 (gated)','annual','2026-01-01','2026-12-31','open',TRUE)
     RETURNING id`, [org])).rows[0].id;
  ids.plain = (await admin.query(
    `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state)
     VALUES ($1,'FY2027','annual','2027-01-01','2027-12-31','open')
     RETURNING id`, [org])).rows[0].id;
}

/** A goal submitted for approval in the given period. */
async function submittedGoal(periodId: string, title: string): Promise<string> {
  const id = (await as<{ id: string }>(ids.employee,
    `INSERT INTO goal (org_id, employee_id, goal_period_id, title, weight, state)
          VALUES ($1,$2,$3,$4,100,'draft') RETURNING id`,
    [ids.org, ids.employee, periodId, title]))[0]!.id;
  await as(ids.employee,
    `UPDATE goal SET state = 'pending_approval' WHERE id = $1`, [id]);
  return id;
}

/** What a supervisor's approval does, exactly as the service does it. */
const supervisorApproves = (goalId: string) => as<{ state: string }>(ids.supervisor,
  `UPDATE goal
      SET state = app.goal_state_after_supervisor_approval($1),
          approved_by = $2, approved_at = now()
    WHERE id = $1
RETURNING state::text AS state`, [goalId, ids.supervisor]);

describe('the gate is off by default', () => {
  it('leaves the existing single-approval flow untouched', async () => {
    // A second mandatory gate on every tenant is not ours to impose, so the
    // default path has to be proven unchanged, not assumed.
    const goal = await submittedGoal(ids.plain, 'Ungated target');
    const after = await supervisorApproves(goal);
    expect(after[0]!.state).toBe('active');

    const row = await one<{ hcm_approved_by: string | null }>(ids.hcm,
      `SELECT hcm_approved_by FROM goal WHERE id = $1`, [goal]);
    expect(row!.hcm_approved_by).toBeNull();
  });
});

describe('with the gate on', () => {
  it('parks a supervisor-approved target for HCM', async () => {
    const goal = await submittedGoal(ids.gated, 'Gated target');
    const after = await supervisorApproves(goal);
    expect(after[0]!.state).toBe('pending_hcm');
    ids.parked = goal;
  });

  it('will not let it reach active without an HCM approver', async () => {
    // The gate made real. Without this the state column could be moved by
    // anything and the approval would be a step people believed in rather than
    // one the system kept.
    await expect(as(ids.hcm,
      `UPDATE goal SET state = 'active' WHERE id = $1`, [ids.parked]))
      .rejects.toThrow(/without an HCM approver/);
  });

  it('releases when HCM approves', async () => {
    await as(ids.hcm,
      `UPDATE goal SET state = 'active', hcm_approved_by = $2,
                       hcm_approved_at = now(), hcm_revision_note = NULL
        WHERE id = $1`, [ids.parked, ids.hcm]);

    const row = await one<{ state: string; hcm_approved_by: string }>(ids.hcm,
      `SELECT state::text AS state, hcm_approved_by FROM goal WHERE id = $1`,
      [ids.parked]);
    expect(row!.state).toBe('active');
    expect(row!.hcm_approved_by).toBe(ids.hcm);
  });

  it('refuses an HCM approver who is the subject', async () => {
    // The point of a gate is that somebody else passed it.
    //
    // Set up through the migrator rather than through the supervisor: the HCM
    // administrator does not report to them, so a supervisor's approval would
    // match no rows under RLS and the goal would never reach pending_hcm --
    // which is correct behaviour, and would make this test pass for the wrong
    // reason.
    const own = (await admin.query<{ id: string }>(
      `INSERT INTO goal (org_id, employee_id, goal_period_id, title, weight,
                         state, approved_by, approved_at)
            VALUES ($1,$2,$3,'My own target',100,'pending_hcm',$4,now())
       RETURNING id`,
      [ids.org, ids.hcm, ids.gated, ids.supervisor])).rows[0]!.id;

    await expect(as(ids.hcm,
      `UPDATE goal SET state='active', hcm_approved_by=$2, hcm_approved_at=now()
        WHERE id=$1`, [own, ids.hcm]))
      .rejects.toThrow(/hcm_approver_not_subject/);
  });
});

describe('sending a target back', () => {
  it('returns it to draft with the reason attached', async () => {
    const goal = await submittedGoal(ids.gated, 'Target to revise');
    await supervisorApproves(goal);

    await as(ids.hcm,
      `UPDATE goal SET state = 'draft', hcm_revision_note = $2 WHERE id = $1`,
      [goal, 'Target is not measurable — give it a number.']);

    const row = await one<{ state: string; note: string }>(ids.hcm,
      `SELECT state::text AS state, hcm_revision_note AS note
         FROM goal WHERE id = $1`, [goal]);
    expect(row!.state).toBe('draft');
    expect(row!.note).toMatch(/not measurable/);
    ids.revised = goal;
  });

  it('clears the approvals it had', async () => {
    // A revised goal must not still carry the signature of somebody who
    // approved a different version of it.
    const row = await one<{ approved_by: string | null; hcm_approved_by: string | null }>(
      ids.hcm,
      `SELECT approved_by, hcm_approved_by FROM goal WHERE id = $1`, [ids.revised]);
    expect(row!.approved_by).toBeNull();
    expect(row!.hcm_approved_by).toBeNull();
  });

  it('can go round the loop again', async () => {
    await as(ids.employee,
      `UPDATE goal SET state = 'pending_approval' WHERE id = $1`, [ids.revised]);
    const after = await supervisorApproves(ids.revised);
    expect(after[0]!.state).toBe('pending_hcm');
  });
});

describe('who holds the second gate', () => {
  it('is not the supervisor who approved it', async () => {
    // A supervisor holds goal:approve over their own reports. If HCM's release
    // reused that action, every supervisor would hold the second gate too --
    // and two gates one role can pass alone is one gate.
    const allowed = await one<{ ok: boolean }>(ids.supervisor,
      `SELECT app.can_access('goal_target', 'approve', $1) AS ok`, [ids.employee]);
    expect(allowed!.ok).toBe(false);

    const supervisorHasFirst = await one<{ ok: boolean }>(ids.supervisor,
      `SELECT app.can_access('goal', 'approve', $1) AS ok`, [ids.employee]);
    expect(supervisorHasFirst!.ok).toBe(true);
  });

  it('is HCM', async () => {
    const allowed = await one<{ ok: boolean }>(ids.hcm,
      `SELECT app.can_access('goal_target', 'approve', $1) AS ok`, [ids.employee]);
    expect(allowed!.ok).toBe(true);
  });

  it('is not the employee', async () => {
    const allowed = await one<{ ok: boolean }>(ids.employee,
      `SELECT app.can_access('goal_target', 'approve', $1) AS ok`, [ids.employee]);
    expect(allowed!.ok).toBe(false);
  });
});

describe('the messages the gate needs', () => {
  it('has one for a target waiting on HCM, and one for a revision', async () => {
    // Without the first, a supervisor's approval is met with silence, which
    // reads as the supervisor having done nothing. Without the second, a target
    // reappears in somebody's drafts with no explanation.
    const codes = await as<{ code: string }>(ids.hcm,
      `SELECT code FROM notification_template
        WHERE code IN ('goal.awaiting_hcm','goal.revision_requested')
        ORDER BY code`);
    expect(codes.map((c) => c.code))
      .toEqual(['goal.awaiting_hcm', 'goal.revision_requested']);
  });
});
