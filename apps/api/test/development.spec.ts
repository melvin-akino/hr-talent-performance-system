import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 6: development plans, career paths, learning library.
 *
 * The tests that matter most are the joins BACK to Phase 4. A development plan
 * whose actions are free text is a wish list; the value is that a competency gap
 * produces an action, and an action points at something an employee can actually
 * go and do.
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
  ids.org = (await admin.query(
    `INSERT INTO organization (code,name) VALUES ('ACME','Acme') RETURNING id`)).rows[0].id;
  ids.dept = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'ENG','Engineering','2020-01-01') RETURNING id`, [ids.org])).rows[0].id;
  const et = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','R') RETURNING id`,
    [ids.org])).rows[0].id;

  ids.posEngineer = (await admin.query(
    `INSERT INTO position (org_id,title,job_family,job_level,department_id)
     VALUES ($1,'Engineer','Engineering','L2',$2) RETURNING id`,
    [ids.org, ids.dept])).rows[0].id;
  ids.posSenior = (await admin.query(
    `INSERT INTO position (org_id,title,job_family,job_level,department_id)
     VALUES ($1,'Senior Engineer','Engineering','L4',$2) RETURNING id`,
    [ids.org, ids.dept])).rows[0].id;
  ids.posLead = (await admin.query(
    `INSERT INTO position (org_id,title,job_family,job_level,department_id)
     VALUES ($1,'Tech Lead','Engineering','L5',$2) RETURNING id`,
    [ids.org, ids.dept])).rows[0].id;

  const emp = async (no: string, position: string | null) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on,work_email)
       VALUES ($1,$2,$2,'X','2020-01-01',$3) RETURNING id`,
      [ids.org, no, `${no}@acme.test`])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,position_id,department_id,
                               employment_type_id,status,effective_from)
       VALUES ($1,$2,$3,$4,$5,'regular','2020-01-01')`,
      [ids.org, id, position, ids.dept, et]);
    return id;
  };

  ids.manager = await emp('manager', ids.posLead);
  ids.ic = await emp('ic', ids.posEngineer);
  ids.peer = await emp('peer', ids.posEngineer);
  ids.hrAdmin = await emp('hradmin', null);

  await admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01'), ($1,$4,$3,'2020-01-01')`,
    [ids.org, ids.ic, ids.manager, ids.peer]);

  await admin.query('SELECT app.seed_baseline_roles($1)', [ids.org]);
  await admin.query('SELECT app.seed_phase4_grants($1)', [ids.org]);
  await admin.query('SELECT app.seed_phase6_grants($1)', [ids.org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [ids.org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [ids.org, e, r]);
  const rEmp = await role('employee');
  for (const e of [ids.manager, ids.ic, ids.peer, ids.hrAdmin]) await assign(e, rEmp);
  await assign(ids.manager, await role('manager'));
  await assign(ids.hrAdmin, await role('hr_admin'));

  // Competency framework (Phase 4) — the thing development plans hang off.
  ids.framework = (await admin.query(
    `INSERT INTO competency_framework (org_id,code,version,name)
     VALUES ($1,'CORE',1,'Core') RETURNING id`, [ids.org])).rows[0].id;

  const competency = async (code: string, name: string) => {
    const id = (await admin.query(
      `INSERT INTO competency (framework_id,code,name) VALUES ($1,$2,$3) RETURNING id`,
      [ids.framework, code, name])).rows[0].id;
    for (let n = 1; n <= 5; n++) {
      await admin.query(
        `INSERT INTO competency_level (competency_id,level_no,label)
         VALUES ($1,$2,$3)`, [id, n, `Level ${n}`]);
    }
    return id;
  };
  ids.compJudgement = await competency('JUDG', 'Technical judgement');
  ids.compComms = await competency('COMM', 'Communication');
  await admin.query(
    `UPDATE competency_framework SET is_active=TRUE, published_at=now() WHERE id=$1`,
    [ids.framework]);

  // Senior requires more than Engineer; that difference is the career gap.
  await admin.query(
    `INSERT INTO position_competency_map (org_id,position_id,competency_id,required_level)
     VALUES ($1,$2,$3,2),($1,$2,$4,2),($1,$5,$3,4),($1,$5,$4,3)`,
    [ids.org, ids.posEngineer, ids.compJudgement, ids.compComms, ids.posSenior]);

  // ic is at 2 on judgement (meets Engineer, short of Senior) and unassessed
  // on communication.
  await admin.query(
    `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                        assessed_level,assessed_by,assessed_on)
     VALUES ($1,$2,$3,2,$4,'2026-06-30')`,
    [ids.org, ids.ic, ids.compJudgement, ids.manager]);

  ids.course = (await admin.query(
    `INSERT INTO learning_resource (org_id,title,resource_type,competency_id,url)
     VALUES ($1,'Systems Design Intensive','course',$2,'https://learn.test/sd')
     RETURNING id`, [ids.org, ids.compJudgement])).rows[0].id;
  ids.workshop = (await admin.query(
    `INSERT INTO learning_resource (org_id,title,resource_type,competency_id)
     VALUES ($1,'Writing for Engineers','workshop',$2) RETURNING id`,
    [ids.org, ids.compComms])).rows[0].id;

  await admin.query(
    `INSERT INTO career_path (org_id,from_position_id,to_position_id,move_type,
                              typical_months)
     VALUES ($1,$2,$3,'promotion',18)`,
    [ids.org, ids.posEngineer, ids.posSenior]);
}

const plan = async (employeeId: string, withAction = true) => {
  const id = (await admin.query<{ id: string }>(
    `INSERT INTO development_plan (org_id,employee_id,title)
     VALUES ($1,$2,'Growth plan') RETURNING id`, [ids.org, employeeId])).rows[0].id;
  if (withAction) {
    await admin.query(
      `INSERT INTO dev_action (development_plan_id,sequence,description,competency_id,
                               target_level)
       VALUES ($1,1,'Lead a system design review',$2,4)`, [id, ids.compJudgement]);
  }
  return id;
};

// ---------------------------------------------------------------------------

describe('development plan lifecycle', () => {
  it('cannot start with no actions', async () => {
    const p = await plan(ids.ic, false);
    await expect(
      admin.query(`UPDATE development_plan SET state='active' WHERE id=$1`, [p]),
    ).rejects.toThrow(/at least one action/);
  });

  it('starts once it has an action, and stamps closure on completion', async () => {
    const p = await plan(ids.ic);
    await admin.query(`UPDATE development_plan SET state='active' WHERE id=$1`, [p]);
    await admin.query(`UPDATE development_plan SET state='completed' WHERE id=$1`, [p]);
    const res = await admin.query(
      `SELECT state, closed_at IS NOT NULL AS closed FROM development_plan WHERE id=$1`,
      [p]);
    expect(res.rows[0].state).toBe('completed');
    expect(res.rows[0].closed).toBe(true);
  });

  it('rejects invalid transitions', async () => {
    const p = await plan(ids.ic);
    await expect(
      admin.query(`UPDATE development_plan SET state='completed' WHERE id=$1`, [p]),
    ).rejects.toThrow(/Invalid development plan transition/);
  });

  it('a completed action must carry a completion date', async () => {
    const p = await plan(ids.ic);
    await expect(
      admin.query(
        `UPDATE dev_action SET status='completed' WHERE development_plan_id=$1`, [p]),
    ).rejects.toThrow(/dev_action_completion_pair/);
  });

  it('rejects a target level outside the competency scale', async () => {
    const p = await plan(ids.ic, false);
    await expect(
      admin.query(
        `INSERT INTO dev_action (development_plan_id,sequence,description,
                                 competency_id,target_level)
         VALUES ($1,1,'impossible',$2,9)`, [p, ids.compJudgement]),
    ).rejects.toThrow(/not defined for this competency/);
  });
});

describe('learning closes the loop', () => {
  it('completing assigned learning completes the linked development action', async () => {
    const p = await plan(ids.ic);
    const action = (await admin.query<{ id: string }>(
      `SELECT id FROM dev_action WHERE development_plan_id=$1`, [p])).rows[0].id;

    const assignment = (await admin.query<{ id: string }>(
      `INSERT INTO learning_assignment (org_id,employee_id,learning_resource_id,
                                        assigned_by,dev_action_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [ids.org, ids.ic, ids.course, ids.manager, action])).rows[0].id;

    await admin.query(
      `UPDATE learning_assignment SET state='completed', completed_on=CURRENT_DATE
        WHERE id=$1`, [assignment]);

    // The plan must not show outstanding work that is actually finished.
    const res = await admin.query<{ status: string; completed_on: string }>(
      `SELECT status::text AS status, completed_on::text FROM dev_action WHERE id=$1`,
      [action]);
    expect(res.rows[0].status).toBe('completed');
    expect(res.rows[0].completed_on).not.toBeNull();

    await admin.query(`DELETE FROM learning_assignment WHERE id=$1`, [assignment]);
  });

  it('refuses to assign the same resource twice to one person', async () => {
    await admin.query(
      `INSERT INTO learning_assignment (org_id,employee_id,learning_resource_id,assigned_by)
       VALUES ($1,$2,$3,$4)`, [ids.org, ids.peer, ids.course, ids.manager]);
    await expect(
      admin.query(
        `INSERT INTO learning_assignment (org_id,employee_id,learning_resource_id,
                                          assigned_by)
         VALUES ($1,$2,$3,$4)`, [ids.org, ids.peer, ids.course, ids.manager]),
    ).rejects.toThrow();
  });

  it('a completed assignment must carry a completion date', async () => {
    await expect(
      admin.query(
        `UPDATE learning_assignment SET state='completed'
          WHERE employee_id=$1 AND learning_resource_id=$2`, [ids.peer, ids.course]),
    ).rejects.toThrow(/learning_assignment_completion_pair/);
  });
});

describe('gap-driven recommendations', () => {
  it('recommends library resources for competencies below requirement', async () => {
    // ic holds Engineer (both required at 2), is assessed 2 on judgement and
    // never assessed on communication.
    const rows = await admin.query<{
      competency_name: string; gap: number | null; resource_title: string;
      already_assigned: boolean;
    }>(`SELECT * FROM app.recommended_learning($1)`, [ids.ic]);

    // Judgement meets requirement, so it must NOT be recommended.
    expect(rows.rows.some((r) => r.competency_name === 'Technical judgement')).toBe(false);
    // Communication is unassessed — a development conversation, and the one
    // organisations forget.
    const comm = rows.rows.find((r) => r.competency_name === 'Communication');
    expect(comm).toBeDefined();
    expect(comm!.gap).toBeNull();
    expect(comm!.resource_title).toBe('Writing for Engineers');
  });

  it('marks resources the employee already has', async () => {
    await admin.query(
      `INSERT INTO learning_assignment (org_id,employee_id,learning_resource_id,assigned_by)
       VALUES ($1,$2,$3,$4)`, [ids.org, ids.ic, ids.workshop, ids.manager]);
    const rows = await admin.query<{ already_assigned: boolean }>(
      `SELECT * FROM app.recommended_learning($1)`, [ids.ic]);
    expect(rows.rows[0].already_assigned).toBe(true);
    await admin.query(
      `DELETE FROM learning_assignment WHERE employee_id=$1 AND learning_resource_id=$2`,
      [ids.ic, ids.workshop]);
  });

  it('recommends nothing when every requirement is met', async () => {
    await admin.query(
      `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                          assessed_level,assessed_by,assessed_on)
       VALUES ($1,$2,$3,5,$4,'2026-07-01')`,
      [ids.org, ids.peer, ids.compComms, ids.manager]);
    await admin.query(
      `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                          assessed_level,assessed_by,assessed_on)
       VALUES ($1,$2,$3,5,$4,'2026-07-01')`,
      [ids.org, ids.peer, ids.compJudgement, ids.manager]);
    const rows = await admin.query(`SELECT * FROM app.recommended_learning($1)`, [ids.peer]);
    expect(rows.rowCount).toBe(0);
  });
});

describe('career options', () => {
  it('shows reachable positions and how far off the requirements are', async () => {
    const rows = await admin.query<{
      to_position_title: string; move_type: string; typical_months: number;
      requirements_total: string; requirements_met: string;
      requirements_unassessed: string;
    }>(`SELECT * FROM app.career_options($1)`, [ids.ic]);

    expect(rows.rowCount).toBe(1);
    const senior = rows.rows[0];
    expect(senior.to_position_title).toBe('Senior Engineer');
    expect(senior.move_type).toBe('promotion');
    expect(senior.typical_months).toBe(18);
    // Senior needs judgement 4 (ic is 2) and communication 3 (never assessed).
    expect(Number(senior.requirements_total)).toBe(2);
    expect(Number(senior.requirements_met)).toBe(0);
    expect(Number(senior.requirements_unassessed)).toBe(1);
  });

  it('returns nothing for a position with no onward paths', async () => {
    const rows = await admin.query(`SELECT * FROM app.career_options($1)`, [ids.manager]);
    expect(rows.rowCount).toBe(0);
  });

  it('rejects a path from a position to itself', async () => {
    await expect(
      admin.query(
        `INSERT INTO career_path (org_id,from_position_id,to_position_id)
         VALUES ($1,$2,$2)`, [ids.org, ids.posEngineer]),
    ).rejects.toThrow(/career_path_not_self/);
  });

  it('rejects a duplicate path between the same two positions', async () => {
    await expect(
      admin.query(
        `INSERT INTO career_path (org_id,from_position_id,to_position_id)
         VALUES ($1,$2,$3)`, [ids.org, ids.posEngineer, ids.posSenior]),
    ).rejects.toThrow();
  });
});

describe('visibility', () => {
  it('an employee sees and writes their own plan', async () => {
    const rows = await as<{ id: string }>(ids.ic,
      `INSERT INTO development_plan (org_id,employee_id,title)
       VALUES ($1,$2,'Self-authored') RETURNING id`, [ids.org, ids.ic]);
    expect(rows).toHaveLength(1);
    expect((await as(ids.ic,
      `SELECT id FROM development_plan WHERE id=$1`, [rows[0]!.id]))).toHaveLength(1);
  });

  it('a manager sees a report\'s plan — development is not discipline', async () => {
    const p = await plan(ids.ic);
    expect(await as(ids.manager,
      `SELECT id FROM development_plan WHERE id=$1`, [p])).toHaveLength(1);
  });

  it('a peer cannot see someone else\'s plan', async () => {
    const p = await plan(ids.ic);
    expect(await as(ids.peer,
      `SELECT id FROM development_plan WHERE id=$1`, [p])).toEqual([]);
  });

  it('a peer cannot create a plan for someone else', async () => {
    await expect(
      as(ids.peer,
        `INSERT INTO development_plan (org_id,employee_id,title)
         VALUES ($1,$2,'imposed')`, [ids.org, ids.ic]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('the library and career paths are readable across the tenant', async () => {
    // A career ladder nobody can see is not a ladder.
    expect((await as(ids.ic, `SELECT id FROM learning_resource`)).length).toBeGreaterThan(0);
    expect((await as(ids.ic, `SELECT id FROM career_path`)).length).toBeGreaterThan(0);
  });

  it('a plain employee cannot add to the library or define career paths', async () => {
    await expect(
      as(ids.ic,
        `INSERT INTO learning_resource (org_id,title,resource_type)
         VALUES ($1,'Rogue course','course')`, [ids.org]),
    ).rejects.toThrow(/row-level security/i);

    await expect(
      as(ids.ic,
        `INSERT INTO career_path (org_id,from_position_id,to_position_id)
         VALUES ($1,$2,$3)`, [ids.org, ids.posSenior, ids.posLead]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('an employee sees their own assigned learning, not a colleague\'s', async () => {
    expect(await as(ids.ic,
      `SELECT id FROM learning_assignment WHERE employee_id=$1`, [ids.peer])).toEqual([]);
  });
});
