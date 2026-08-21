import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 1 invariants, verified against a real PostgreSQL.
 *
 * The attainment cases below are the ones that matter most: `lower_is_better`
 * is where this calculation is classically got wrong, and a silently inverted
 * cost KPI would rate the worst performer highest.
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
    .withDatabase('hr')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
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

  // Guard, not ceremony. Testcontainers defaults to the username `test`, so a
  // credential swap that silently fails to match leaves this pool connected as
  // a SUPERUSER -- which bypasses RLS unconditionally. Every deny-assertion in
  // this file would then pass while testing nothing at all.
  const who = await app.query<{ user: string; bypass: boolean }>(
    `SELECT current_user AS user, usesuper AS bypass
       FROM pg_user WHERE usename = current_user`);
  if (who.rows[0]?.user !== 'hr_app' || who.rows[0]?.bypass) {
    throw new Error(
      `RLS test pool must connect as the non-superuser hr_app, got ` +
      `'${who.rows[0]?.user}' (superuser=${who.rows[0]?.bypass}). ` +
      `Deny-assertions would be vacuous.`);
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
    `INSERT INTO organization (code,name) VALUES ('ACME','Acme') RETURNING id`)).rows[0].id;
  ids.org = org;

  ids.deptEng = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'ENG','Engineering','2020-01-01') RETURNING id`, [org])).rows[0].id;
  ids.deptSales = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'SALES','Sales','2020-01-01') RETURNING id`, [org])).rows[0].id;

  const etype = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','Regular') RETURNING id`,
    [org])).rows[0].id;

  const emp = async (no: string, dept: string) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [org, id, dept, etype]);
    return id;
  };

  ids.mgr = await emp('mgr', ids.deptEng);
  ids.ic = await emp('ic', ids.deptEng);
  ids.ic2 = await emp('ic2', ids.deptEng);
  ids.outsider = await emp('outsider', ids.deptSales);
  ids.hrAdmin = await emp('hradmin', ids.deptEng);

  await admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01'), ($1,$4,$3,'2020-01-01')`,
    [org, ids.ic, ids.mgr, ids.ic2]);

  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, e, r]);

  const rEmp = await role('employee');
  const rMgr = await role('manager');
  const rAdmin = await role('hr_admin');
  for (const e of [ids.mgr, ids.ic, ids.ic2, ids.outsider, ids.hrAdmin]) await assign(e, rEmp);
  await assign(ids.mgr, rMgr);
  await assign(ids.hrAdmin, rAdmin);

  ids.period = (await admin.query(
    `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state)
     VALUES ($1,'FY2026','annual','2026-01-01','2026-12-31','open') RETURNING id`,
    [org])).rows[0].id;
}

const newGoal = async (employeeId: string, weight = 100, state = 'draft') =>
  (await admin.query(
    `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,state)
     VALUES ($1,$2,$3,'Goal',$4,$5::goal_state) RETURNING id`,
    [ids.org, ids.period, employeeId, weight, state])).rows[0].id;

// ---------------------------------------------------------------------------

describe('attainment is direction-aware', () => {
  const attainment = async (
    dir: string, baseline: number | null, target: number, actual: number,
  ) => {
    const goalId = await newGoal(ids.ic);
    const res = await admin.query<{ pct: string | null }>(
      `INSERT INTO goal_target (goal_id,measure_name,measure_type,direction,
                                baseline_value,target_value,actual_value)
       VALUES ($1,'m','numeric',$2::kpi_direction,$3,$4,$5)
       RETURNING attainment_pct::float8 AS pct`,
      [goalId, dir, baseline, target, actual]);
    return res.rows[0].pct;
  };

  it('higher_is_better: meeting the target is 100%', async () => {
    expect(await attainment('higher_is_better', null, 100, 100)).toBe(100);
  });

  it('higher_is_better: exceeding scores above 100', async () => {
    expect(await attainment('higher_is_better', null, 100, 120)).toBe(120);
  });

  it('lower_is_better: a cost cut from 100 to 80, achieved, is 100%', async () => {
    expect(await attainment('lower_is_better', 100, 80, 80)).toBe(100);
  });

  it('lower_is_better: beating a cost target scores ABOVE 100', async () => {
    // The classic bug: a naive actual/target would score this 87.5% and rank
    // the best performer as underachieving.
    expect(await attainment('lower_is_better', 100, 80, 70)).toBe(150);
  });

  it('lower_is_better: missing a cost target scores below 100', async () => {
    expect(await attainment('lower_is_better', 100, 80, 90)).toBe(50);
  });

  it('lower_is_better without a baseline inverts the ratio', async () => {
    expect(await attainment('lower_is_better', null, 5, 4)).toBe(125);
    expect(await attainment('lower_is_better', null, 5, 10)).toBe(50);
  });

  it('baseline-relative progress is measured across the intended range', async () => {
    expect(await attainment('higher_is_better', 20, 100, 60)).toBe(50);
  });

  it('degenerate denominators yield NULL rather than an error', async () => {
    expect(await attainment('higher_is_better', 50, 50, 50)).toBeNull();
    expect(await attainment('higher_is_better', null, 0, 5)).toBeNull();
  });

  it('is NULL until an actual is recorded', async () => {
    const goalId = await newGoal(ids.ic);
    const res = await admin.query<{ pct: string | null }>(
      `INSERT INTO goal_target (goal_id,measure_name,measure_type,target_value)
       VALUES ($1,'m','numeric',100) RETURNING attainment_pct AS pct`, [goalId]);
    expect(res.rows[0].pct).toBeNull();
  });
});

describe('goal state machine', () => {
  it('rejects an invalid transition', async () => {
    const goalId = await newGoal(ids.ic);
    await expect(
      admin.query(`UPDATE goal SET state='achieved' WHERE id=$1`, [goalId]),
    ).rejects.toThrow(/Invalid goal transition/);
  });

  it('refuses to activate a goal with no approver', async () => {
    const goalId = await newGoal(ids.ic);
    await expect(
      admin.query(`UPDATE goal SET state='active' WHERE id=$1`, [goalId]),
    ).rejects.toThrow(/without an approver/);
  });

  it('refuses self-approval', async () => {
    const goalId = await newGoal(ids.ic);
    await expect(
      admin.query(
        `UPDATE goal SET state='active', approved_by=$2, approved_at=now() WHERE id=$1`,
        [goalId, ids.ic]),
    ).rejects.toThrow(/cannot approve their own goal/);
  });

  it('allows a manager to approve', async () => {
    const goalId = await newGoal(ids.ic);
    await admin.query(
      `UPDATE goal SET state='active', approved_by=$2, approved_at=now() WHERE id=$1`,
      [goalId, ids.mgr]);
    const res = await admin.query(`SELECT state FROM goal WHERE id=$1`, [goalId]);
    expect(res.rows[0].state).toBe('active');
  });

  it('treats terminal states as terminal', async () => {
    const goalId = await newGoal(ids.ic);
    await admin.query(`UPDATE goal SET state='cancelled' WHERE id=$1`, [goalId]);
    await expect(
      admin.query(`UPDATE goal SET state='active' WHERE id=$1`, [goalId]),
    ).rejects.toThrow(/Invalid goal transition/);
  });
});

describe('cascade', () => {
  it('rejects a cycle', async () => {
    const a = await newGoal(ids.ic);
    const b = await newGoal(ids.ic2);
    await admin.query(`UPDATE goal SET parent_goal_id=$2 WHERE id=$1`, [b, a]);
    await expect(
      admin.query(`UPDATE goal SET parent_goal_id=$2 WHERE id=$1`, [a, b]),
    ).rejects.toThrow(/cycle/i);
  });

  it('does not orphan children when a parent is deleted', async () => {
    const parent = await newGoal(ids.mgr);
    const child = await newGoal(ids.ic);
    await admin.query(`UPDATE goal SET parent_goal_id=$2 WHERE id=$1`, [child, parent]);
    // ON DELETE RESTRICT: removing a parent with children must fail loudly
    // rather than silently detaching or cascading away someone's goals.
    await expect(
      admin.query(`DELETE FROM goal WHERE id=$1`, [parent]),
    ).rejects.toThrow();
  });
});

describe('weight validation', () => {
  it('permits partial weights while the period is open', async () => {
    const p = (await admin.query(
      `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state)
       VALUES ($1,'W1','annual','2026-01-01','2026-12-31','open') RETURNING id`,
      [ids.org])).rows[0].id;
    await admin.query(
      `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,state)
       VALUES ($1,$2,$3,'partial',40,'active')`, [ids.org, p, ids.ic]);
    const v = await admin.query(`SELECT * FROM app.goal_weight_violations($1)`, [p]);
    expect(v.rowCount).toBe(1); // flagged, but nothing is blocked yet
  });

  it('blocks period lock when weights do not sum to 100', async () => {
    const p = (await admin.query(
      `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state)
       VALUES ($1,'W2','annual','2026-01-01','2026-12-31','open') RETURNING id`,
      [ids.org])).rows[0].id;
    await admin.query(
      `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,state)
       VALUES ($1,$2,$3,'g',60,'active')`, [ids.org, p, ids.ic]);
    await expect(
      admin.query(`UPDATE goal_period SET state='locked' WHERE id=$1`, [p]),
    ).rejects.toThrow(/do not sum to 100/);
  });

  it('locks once weights are corrected, ignoring drafts', async () => {
    const p = (await admin.query(
      `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state)
       VALUES ($1,'W3','annual','2026-01-01','2026-12-31','open') RETURNING id`,
      [ids.org])).rows[0].id;
    await admin.query(
      `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,state)
       VALUES ($1,$2,$3,'a',60,'active'), ($1,$2,$3,'b',40,'active'),
              ($1,$2,$3,'draft-ignored',99,'draft')`,
      [ids.org, p, ids.ic]);
    await admin.query(`UPDATE goal_period SET state='locked' WHERE id=$1`, [p]);
    const res = await admin.query(
      `SELECT state, locked_at IS NOT NULL AS stamped FROM goal_period WHERE id=$1`, [p]);
    expect(res.rows[0].state).toBe('locked');
    expect(res.rows[0].stamped).toBe(true);
  });
});

describe('period freezing', () => {
  const periodWithGoal = async (state: string) => {
    const p = (await admin.query(
      `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state)
       VALUES ($1,$2,'annual','2026-01-01','2026-12-31','open') RETURNING id`,
      [ids.org, `F-${Math.random()}`])).rows[0].id;
    const g = (await admin.query(
      `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,state)
       VALUES ($1,$2,$3,'g',100,'active') RETURNING id`,
      [ids.org, p, ids.ic])).rows[0].id;
    const t = (await admin.query(
      `INSERT INTO goal_target (goal_id,measure_name,measure_type,target_value)
       VALUES ($1,'m','numeric',100) RETURNING id`, [g])).rows[0].id;
    await admin.query(`UPDATE goal_period SET state=$2::goal_period_state WHERE id=$1`,
      [p, state]);
    return { p, g, t };
  };

  it('locked: blocks new goals and weight changes', async () => {
    const { p, g } = await periodWithGoal('locked');
    await expect(admin.query(
      `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight)
       VALUES ($1,$2,$3,'late',10)`, [ids.org, p, ids.ic2]),
    ).rejects.toThrow(/locked/);
    await expect(admin.query(`UPDATE goal SET weight=50 WHERE id=$1`, [g]),
    ).rejects.toThrow(/locked/);
  });

  it('locked: still accepts check-ins and actuals -- the point of locking', async () => {
    const { g, t } = await periodWithGoal('locked');
    await admin.query(
      `INSERT INTO goal_checkin (goal_id,checked_in_by,status_flag,period_ending)
       VALUES ($1,$2,'on_track','2026-06-30')`, [g, ids.ic]);
    await admin.query(`UPDATE goal_target SET actual_value=80 WHERE id=$1`, [t]);
    const res = await admin.query(
      `SELECT attainment_pct::float8 AS pct FROM goal_target WHERE id=$1`, [t]);
    expect(res.rows[0].pct).toBe(80);
  });

  it('closed: freezes actuals and check-ins', async () => {
    const { g, t } = await periodWithGoal('closed');
    await expect(admin.query(`UPDATE goal_target SET actual_value=90 WHERE id=$1`, [t]),
    ).rejects.toThrow(/closed/);
    await expect(admin.query(
      `INSERT INTO goal_checkin (goal_id,checked_in_by,status_flag,period_ending)
       VALUES ($1,$2,'on_track','2026-12-31')`, [g, ids.ic]),
    ).rejects.toThrow(/closed/);
  });
});

describe('check-ins are immutable', () => {
  it('discards updates and deletes', async () => {
    const g = await newGoal(ids.ic);
    await admin.query(
      `INSERT INTO goal_checkin (goal_id,checked_in_by,status_flag,period_ending,comment)
       VALUES ($1,$2,'at_risk','2026-03-31','original')`, [g, ids.ic]);
    await admin.query(`UPDATE goal_checkin SET comment='rewritten' WHERE goal_id=$1`, [g]);
    await admin.query(`DELETE FROM goal_checkin WHERE goal_id=$1`, [g]);
    const res = await admin.query(
      `SELECT comment FROM goal_checkin WHERE goal_id=$1`, [g]);
    expect(res.rowCount).toBe(1);
    expect(res.rows[0].comment).toBe('original');
  });
});

describe('KPI definition versioning', () => {
  it('a goal keeps rendering the version it was authored against', async () => {
    const v1 = (await admin.query(
      `INSERT INTO kpi_definition (org_id,code,version,name,measure_type,direction)
       VALUES ($1,'REV',1,'Revenue v1','currency','higher_is_better') RETURNING id`,
      [ids.org])).rows[0].id;

    const g = (await admin.query(
      `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,kpi_definition_id)
       VALUES ($1,$2,$3,'rev goal',100,$4) RETURNING id, kpi_definition_version`,
      [ids.org, ids.period, ids.ic, v1])).rows[0];
    expect(g.kpi_definition_version).toBe(1); // snapshotted by trigger

    await admin.query(`UPDATE kpi_definition SET is_active=FALSE WHERE id=$1`, [v1]);
    await admin.query(
      `INSERT INTO kpi_definition (org_id,code,version,name,measure_type,direction,
                                   supersedes_id)
       VALUES ($1,'REV',2,'Revenue v2','currency','higher_is_better',$2)`,
      [ids.org, v1]);

    const joined = await admin.query(
      `SELECT k.name FROM goal g
         JOIN kpi_definition k
           ON k.id = g.kpi_definition_id AND k.version = g.kpi_definition_version
        WHERE g.id = $1`, [g.id]);
    expect(joined.rows[0].name).toBe('Revenue v1');
  });

  it('refuses to change a snapshotted version', async () => {
    const k = (await admin.query(
      `INSERT INTO kpi_definition (org_id,code,version,name,measure_type)
       VALUES ($1,'NPS',1,'NPS','numeric') RETURNING id`, [ids.org])).rows[0].id;
    const g = (await admin.query(
      `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,kpi_definition_id)
       VALUES ($1,$2,$3,'nps',100,$4) RETURNING id`,
      [ids.org, ids.period, ids.ic, k])).rows[0].id;
    await expect(
      admin.query(`UPDATE goal SET kpi_definition_version=2 WHERE id=$1`, [g]),
    ).rejects.toThrow(/snapshot and cannot be changed/);
  });

  it('permits only one active version per code', async () => {
    await admin.query(
      `INSERT INTO kpi_definition (org_id,code,version,name,measure_type)
       VALUES ($1,'DUP',1,'Dup','numeric')`, [ids.org]);
    await expect(admin.query(
      `INSERT INTO kpi_definition (org_id,code,version,name,measure_type)
       VALUES ($1,'DUP',2,'Dup v2','numeric')`, [ids.org]),
    ).rejects.toThrow();
  });
});

describe('goal visibility under RLS', () => {
  it('an IC sees their own goals only', async () => {
    const mine = await newGoal(ids.ic);
    await newGoal(ids.ic2);
    const seen = await as<{ id: string }>(ids.ic, 'SELECT id FROM goal');
    expect(seen.map((r) => r.id)).toContain(mine);
    expect(seen.every((r) => r.id !== undefined)).toBe(true);

    const others = await as<{ c: string }>(ids.ic,
      'SELECT count(*)::int AS c FROM goal WHERE employee_id <> $1', [ids.ic]);
    expect(Number(others[0]!.c)).toBe(0);
  });

  it('a manager sees their reports\' goals', async () => {
    const theirs = await newGoal(ids.ic);
    const seen = await as<{ id: string }>(ids.mgr,
      'SELECT id FROM goal WHERE employee_id = $1', [ids.ic]);
    expect(seen.map((r) => r.id)).toContain(theirs);
  });

  it('an unrelated employee sees nothing of another team', async () => {
    await newGoal(ids.ic);
    const seen = await as(ids.outsider,
      'SELECT id FROM goal WHERE employee_id = $1', [ids.ic]);
    expect(seen).toEqual([]);
  });

  it('targets and check-ins inherit goal visibility', async () => {
    const g = await newGoal(ids.ic);
    await admin.query(
      `INSERT INTO goal_target (goal_id,measure_name,measure_type,target_value)
       VALUES ($1,'m','numeric',10)`, [g]);
    await admin.query(
      `INSERT INTO goal_checkin (goal_id,checked_in_by,status_flag,period_ending)
       VALUES ($1,$2,'on_track','2026-03-31')`, [g, ids.ic]);

    expect(await as(ids.outsider,
      'SELECT id FROM goal_target WHERE goal_id=$1', [g])).toEqual([]);
    expect(await as(ids.outsider,
      'SELECT id FROM goal_checkin WHERE goal_id=$1', [g])).toEqual([]);
    expect((await as(ids.mgr,
      'SELECT id FROM goal_target WHERE goal_id=$1', [g])).length).toBe(1);
  });

  it('a check-in cannot be attributed to someone else', async () => {
    const g = await newGoal(ids.ic);
    await expect(
      as(ids.mgr,
        `INSERT INTO goal_checkin (goal_id,checked_in_by,status_flag,period_ending)
         VALUES ($1,$2,'on_track','2026-03-31')`, [g, ids.ic]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('an IC cannot create a goal for a colleague', async () => {
    await expect(
      as(ids.ic,
        `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight)
         VALUES ($1,$2,$3,'sneaky',10)`, [ids.org, ids.period, ids.ic2]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('an HR admin sees org-wide', async () => {
    const seen = await as<{ c: string }>(ids.hrAdmin,
      'SELECT count(*)::int AS c FROM goal');
    expect(Number(seen[0]!.c)).toBeGreaterThan(0);
  });
});
