import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 2: PIP confidentiality, monitoring, and escalation.
 *
 * The confidentiality tests matter most. A PIP visible to a peer or an
 * uninvolved skip-level manager is a serious HR incident, so the hierarchy
 * below deliberately includes a skip-level director who CAN see goals two
 * levels down but must NOT see PIPs there.
 *
 *   director
 *     +-- manager
 *           +-- ic, ic2
 *   outsider (different department)
 *   hrAdmin (org-wide)
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

  // A superuser bypasses RLS unconditionally, which would make every
  // confidentiality assertion below pass while testing nothing.
  const who = await app.query<{ user: string; bypass: boolean }>(
    `SELECT current_user AS user, usesuper AS bypass
       FROM pg_user WHERE usename = current_user`);
  if (who.rows[0]?.user !== 'hr_app' || who.rows[0]?.bypass) {
    throw new Error(`PIP test pool must be non-superuser hr_app, got '${who.rows[0]?.user}'`);
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

  const dept = async (code: string) => (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,$2,$2,'2020-01-01') RETURNING id`, [org, code])).rows[0].id;
  ids.deptEng = await dept('ENG');
  ids.deptSales = await dept('SALES');

  const et = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','R') RETURNING id`,
    [org])).rows[0].id;

  const emp = async (no: string, d: string) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [org, id, d, et]);
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
     VALUES ($1,$2,$3,'2020-01-01')`, [org, child, sup]);
  await line(ids.manager, ids.director);
  await line(ids.ic, ids.manager);
  await line(ids.ic2, ids.manager);

  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [org]);
  await admin.query('SELECT app.seed_phase2_grants($1)', [org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, e, r]);

  const rEmp = await role('employee');
  const rMgr = await role('manager');
  const rAdmin = await role('hr_admin');
  for (const e of Object.values(ids)) {
    if (e !== org && e !== ids.deptEng && e !== ids.deptSales) await assign(e, rEmp);
  }
  await assign(ids.manager, rMgr);
  await assign(ids.director, rMgr);
  await assign(ids.hrAdmin, rAdmin);

  ids.period = (await admin.query(
    `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state,checkin_cadence)
     VALUES ($1,'FY26','annual','2026-01-01','2026-12-31','open','monthly') RETURNING id`,
    [org])).rows[0].id;
}

const newPip = async (employeeId: string, supervisorId: string, withMilestone = true) => {
  const id = (await admin.query(
    `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
                           starts_on,ends_on)
     VALUES ($1,$2,$3,$3,'Sustained underperformance against agreed targets',
             '2026-03-01','2026-06-01') RETURNING id`,
    [ids.org, employeeId, supervisorId])).rows[0].id;
  if (withMilestone) {
    await admin.query(
      `INSERT INTO pip_milestone (pip_plan_id,sequence,description,due_on)
       VALUES ($1,1,'Close 5 tickets per week','2026-04-01')`, [id]);
  }
  return id;
};

// ---------------------------------------------------------------------------

describe('PIP confidentiality', () => {
  it('the subject can read their own PIP', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    const seen = await as<{ id: string }>(ids.ic, 'SELECT id FROM pip_plan WHERE id=$1', [pip]);
    expect(seen).toHaveLength(1);
  });

  it('the direct supervisor can read it', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    const seen = await as(ids.manager, 'SELECT id FROM pip_plan WHERE id=$1', [pip]);
    expect(seen).toHaveLength(1);
  });

  it('a SKIP-LEVEL manager cannot -- even though they can see the same person\'s goals', async () => {
    const pip = await newPip(ids.ic, ids.manager);

    // Establish the asymmetry is real: the director DOES see goals two levels
    // down, so this is a deliberate PIP restriction, not an accident of the
    // hierarchy.
    await admin.query(
      `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight)
       VALUES ($1,$2,$3,'visible goal',100)`, [ids.org, ids.period, ids.ic]);
    const goals = await as(ids.director,
      'SELECT id FROM goal WHERE employee_id=$1', [ids.ic]);
    expect(goals.length).toBeGreaterThan(0);

    const pips = await as(ids.director, 'SELECT id FROM pip_plan WHERE id=$1', [pip]);
    expect(pips).toEqual([]);
  });

  it('a peer cannot read it', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    expect(await as(ids.ic2, 'SELECT id FROM pip_plan WHERE id=$1', [pip])).toEqual([]);
  });

  it('an unrelated employee cannot read it', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    expect(await as(ids.outsider, 'SELECT id FROM pip_plan WHERE id=$1', [pip])).toEqual([]);
  });

  it('HR admin can read it', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    expect(await as(ids.hrAdmin, 'SELECT id FROM pip_plan WHERE id=$1', [pip])).toHaveLength(1);
  });

  it('milestones and reviews inherit plan confidentiality', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    await admin.query(`UPDATE pip_plan SET state='active' WHERE id=$1`, [pip]);
    await admin.query(
      `INSERT INTO pip_review (pip_plan_id,reviewed_by,review_date,progress_summary,status_flag)
       VALUES ($1,$2,'2026-03-15','Some progress','at_risk')`, [pip, ids.manager]);

    expect(await as(ids.ic2,
      'SELECT id FROM pip_milestone WHERE pip_plan_id=$1', [pip])).toEqual([]);
    expect(await as(ids.ic2,
      'SELECT id FROM pip_review WHERE pip_plan_id=$1', [pip])).toEqual([]);
    expect(await as(ids.director,
      'SELECT id FROM pip_review WHERE pip_plan_id=$1', [pip])).toEqual([]);
    // The subject must be able to read their own reviews to respond to them.
    expect((await as(ids.ic,
      'SELECT id FROM pip_review WHERE pip_plan_id=$1', [pip])).length).toBe(1);
  });

  it('a peer cannot create a PIP for someone', async () => {
    await expect(
      as(ids.ic2,
        `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
                               starts_on,ends_on)
         VALUES ($1,$2,$3,$3,'made up','2026-03-01','2026-06-01')`,
        [ids.org, ids.ic, ids.ic2]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a review cannot be attributed to someone else', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    await admin.query(`UPDATE pip_plan SET state='active' WHERE id=$1`, [pip]);
    await expect(
      as(ids.manager,
        `INSERT INTO pip_review (pip_plan_id,reviewed_by,review_date,progress_summary,status_flag)
         VALUES ($1,$2,'2026-04-01','not mine','on_track')`, [pip, ids.director]),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('PIP integrity rules', () => {
  it('cannot be activated without milestones', async () => {
    const pip = await newPip(ids.ic, ids.manager, false);
    await expect(
      admin.query(`UPDATE pip_plan SET state='active' WHERE id=$1`, [pip]),
    ).rejects.toThrow(/without at least one milestone/);
  });

  it('cannot be self-initiated or self-supervised', async () => {
    await expect(admin.query(
      `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
                             starts_on,ends_on)
       VALUES ($1,$2,$2,$3,'self','2026-03-01','2026-06-01')`,
      [ids.org, ids.ic, ids.manager]),
    ).rejects.toThrow(/pip_not_self_initiated/);
  });

  it('cannot be completed without an outcome', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    await admin.query(`UPDATE pip_plan SET state='active' WHERE id=$1`, [pip]);
    await expect(
      admin.query(`UPDATE pip_plan SET state='completed' WHERE id=$1`, [pip]),
    ).rejects.toThrow(/pip_completed_has_outcome/);
  });

  it('records an outcome and stamps closure', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    await admin.query(`UPDATE pip_plan SET state='active' WHERE id=$1`, [pip]);
    await admin.query(
      `UPDATE pip_plan SET state='completed', outcome='successful' WHERE id=$1`, [pip]);
    const res = await admin.query(
      `SELECT outcome, closed_at IS NOT NULL AS closed FROM pip_plan WHERE id=$1`, [pip]);
    expect(res.rows[0].outcome).toBe('successful');
    expect(res.rows[0].closed).toBe(true);
  });

  it('rejects invalid state transitions', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    await expect(
      admin.query(`UPDATE pip_plan SET state='completed', outcome='successful' WHERE id=$1`, [pip]),
    ).rejects.toThrow(/Invalid PIP transition/);
  });

  it('reviews require an active plan', async () => {
    const pip = await newPip(ids.ic, ids.manager); // still draft
    await expect(admin.query(
      `INSERT INTO pip_review (pip_plan_id,reviewed_by,review_date,progress_summary,status_flag)
       VALUES ($1,$2,'2026-03-15','early','on_track')`, [pip, ids.manager]),
    ).rejects.toThrow(/only be recorded against an active PIP/);
  });

  it('reviews are append-only', async () => {
    const pip = await newPip(ids.ic, ids.manager);
    await admin.query(`UPDATE pip_plan SET state='active' WHERE id=$1`, [pip]);
    await admin.query(
      `INSERT INTO pip_review (pip_plan_id,reviewed_by,review_date,progress_summary,status_flag)
       VALUES ($1,$2,'2026-03-15','original','at_risk')`, [pip, ids.manager]);
    await admin.query(`UPDATE pip_review SET progress_summary='rewritten'`);
    await admin.query(`DELETE FROM pip_review`);
    const res = await admin.query(
      `SELECT progress_summary FROM pip_review WHERE pip_plan_id=$1`, [pip]);
    expect(res.rowCount).toBe(1);
    expect(res.rows[0].progress_summary).toBe('original');
  });
});

describe('check-in cadence and overdue tracking', () => {
  const activeGoal = async (employeeId: string, cadence: string | null = null) => {
    const g = (await admin.query(
      `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,state,
                         approved_by,approved_at,checkin_cadence,created_at)
       VALUES ($1,$2,$3,'g',100,'active',$4,now(),$5::checkin_cadence,
               now() - interval '200 days')
       RETURNING id`,
      [ids.org, ids.period, employeeId, ids.manager, cadence])).rows[0].id;
    return g;
  };

  it('flags a goal that has never been checked in', async () => {
    const g = await activeGoal(ids.ic);
    const res = await admin.query(
      `SELECT is_overdue, days_since_checkin FROM goal_checkin_status WHERE goal_id=$1`, [g]);
    expect(res.rows[0].is_overdue).toBe(true);
    expect(res.rows[0].days_since_checkin).toBeGreaterThan(30);
  });

  it('clears once a check-in lands inside the cadence window', async () => {
    const g = await activeGoal(ids.ic);
    await admin.query(
      `INSERT INTO goal_checkin (goal_id,checked_in_by,status_flag,period_ending)
       VALUES ($1,$2,'on_track',CURRENT_DATE)`, [g, ids.ic]);
    const res = await admin.query(
      `SELECT is_overdue, next_checkin_due FROM goal_checkin_status WHERE goal_id=$1`, [g]);
    expect(res.rows[0].is_overdue).toBe(false);
    expect(res.rows[0].next_checkin_due).not.toBeNull();
  });

  it('a per-goal cadence overrides the period default', async () => {
    const g = await activeGoal(ids.ic, 'none');
    const res = await admin.query(
      `SELECT is_overdue, cadence FROM goal_checkin_status WHERE goal_id=$1`, [g]);
    expect(res.rows[0].cadence).toBe('none');
    expect(res.rows[0].is_overdue).toBe(false);
  });

  it('the status view respects RLS -- it does not leak other teams', async () => {
    // security_invoker = true is what makes this true. Without it the view
    // would run as its owner and expose every goal in the organization.
    await activeGoal(ids.ic);
    const seen = await as(ids.outsider,
      'SELECT goal_id FROM goal_checkin_status WHERE employee_id=$1', [ids.ic]);
    expect(seen).toEqual([]);
  });
});

describe('escalation', () => {
  const goalWithCheckins = async (statuses: string[]) => {
    const g = (await admin.query(
      `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,state,
                         approved_by,approved_at)
       VALUES ($1,$2,$3,'esc',100,'active',$4,now()) RETURNING id`,
      [ids.org, ids.period, ids.ic, ids.manager])).rows[0].id;
    let day = 1;
    for (const s of statuses) {
      await admin.query(
        `INSERT INTO goal_checkin (goal_id,checked_in_by,status_flag,period_ending)
         VALUES ($1,$2,$3::checkin_status, DATE '2026-01-01' + $4::int)`,
        [g, ids.ic, s, day]);
      day += 30;
    }
    return g;
  };

  it('ignores a single bad check-in', async () => {
    const g = await goalWithCheckins(['on_track', 'at_risk']);
    const res = await admin.query(
      `SELECT * FROM app.goal_escalations($1) WHERE goal_id=$2`, [ids.period, g]);
    expect(res.rowCount).toBe(0);
  });

  it('escalates two consecutive bad check-ins', async () => {
    const g = await goalWithCheckins(['on_track', 'at_risk', 'off_track']);
    const res = await admin.query(
      `SELECT consecutive_bad, worst_status FROM app.goal_escalations($1) WHERE goal_id=$2`,
      [ids.period, g]);
    expect(res.rows[0].consecutive_bad).toBe(2);
    expect(res.rows[0].worst_status).toBe('off_track');
  });

  it('a recovery resets the streak', async () => {
    const g = await goalWithCheckins(['off_track', 'off_track', 'on_track']);
    const res = await admin.query(
      `SELECT * FROM app.goal_escalations($1) WHERE goal_id=$2`, [ids.period, g]);
    expect(res.rowCount).toBe(0);
  });

  it('counts an unbroken run from the start', async () => {
    const g = await goalWithCheckins(['at_risk', 'at_risk', 'off_track']);
    const res = await admin.query(
      `SELECT consecutive_bad FROM app.goal_escalations($1) WHERE goal_id=$2`,
      [ids.period, g]);
    expect(res.rows[0].consecutive_bad).toBe(3);
  });
});
