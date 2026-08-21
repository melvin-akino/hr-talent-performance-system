import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 4: competency frameworks, mapping, assessment, gap analysis.
 *
 * The interesting cases are the boundaries between "never assessed" and
 * "assessed below requirement" (routinely conflated, and they mean completely
 * different things), and the inheritance of review confidentiality by
 * assessments made inside a review.
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

  // Two positions in the same job family, so the family report aggregates.
  ids.posSenior = (await admin.query(
    `INSERT INTO position (org_id,title,job_family,job_level,department_id)
     VALUES ($1,'Senior Engineer','Engineering','L4',$2) RETURNING id`,
    [ids.org, ids.dept])).rows[0].id;
  ids.posJunior = (await admin.query(
    `INSERT INTO position (org_id,title,job_family,job_level,department_id)
     VALUES ($1,'Engineer','Engineering','L2',$2) RETURNING id`,
    [ids.org, ids.dept])).rows[0].id;

  const emp = async (no: string, position: string | null) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [ids.org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,position_id,department_id,
                               employment_type_id,status,effective_from)
       VALUES ($1,$2,$3,$4,$5,'regular','2020-01-01')`,
      [ids.org, id, position, ids.dept, et]);
    return id;
  };

  ids.manager = await emp('manager', ids.posSenior);
  ids.ic = await emp('ic', ids.posSenior);
  ids.ic2 = await emp('ic2', ids.posJunior);
  ids.peer = await emp('peer', ids.posJunior);
  ids.hrAdmin = await emp('hradmin', null);

  await admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01'), ($1,$4,$3,'2020-01-01')`,
    [ids.org, ids.ic, ids.manager, ids.ic2]);

  await admin.query('SELECT app.seed_baseline_roles($1)', [ids.org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [ids.org]);
  await admin.query('SELECT app.seed_phase3_grants($1)', [ids.org]);
  await admin.query('SELECT app.seed_phase4_grants($1)', [ids.org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [ids.org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [ids.org, e, r]);
  const rEmp = await role('employee');
  for (const e of [ids.manager, ids.ic, ids.ic2, ids.peer, ids.hrAdmin]) await assign(e, rEmp);
  await assign(ids.manager, await role('manager'));
  await assign(ids.hrAdmin, await role('hr_admin'));

  // Framework: two competencies, five levels each.
  // Created as a DRAFT, exactly as the service does: competencies and levels
  // are added while editable, then the framework is published and frozen.
  ids.framework = (await admin.query(
    `INSERT INTO competency_framework (org_id,code,version,name)
     VALUES ($1,'CORE',1,'Core Framework v1') RETURNING id`,
    [ids.org])).rows[0].id;

  const competency = async (code: string, name: string, category: string) => {
    const id = (await admin.query(
      `INSERT INTO competency (framework_id,code,name,category)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [ids.framework, code, name, category])).rows[0].id;
    for (let n = 1; n <= 5; n++) {
      await admin.query(
        `INSERT INTO competency_level (competency_id,level_no,label,behavioral_indicator)
         VALUES ($1,$2,$3,$4)`,
        [id, n, `Level ${n}`, `Demonstrates level ${n} behaviour`]);
    }
    return id;
  };

  ids.compJudgement = await competency('JUDG', 'Technical judgement', 'technical');
  ids.compComms = await competency('COMM', 'Communication', 'core');
  await admin.query(
    `UPDATE competency_framework SET is_active=TRUE, published_at=now() WHERE id=$1`,
    [ids.framework]);

  // Senior role demands more than junior.
  await admin.query(
    `INSERT INTO position_competency_map (org_id,position_id,competency_id,required_level,weight)
     VALUES ($1,$2,$3,4,60), ($1,$2,$4,3,40), ($1,$5,$3,2,50), ($1,$5,$4,2,50)`,
    [ids.org, ids.posSenior, ids.compJudgement, ids.compComms, ids.posJunior]);
}

// ---------------------------------------------------------------------------

describe('framework versioning', () => {
  it('a published framework cannot be edited', async () => {
    await expect(
      admin.query(`UPDATE competency SET name='renamed' WHERE id=$1`, [ids.compComms]),
    ).rejects.toThrow(/published and cannot be edited/);
  });

  it('levels of a published framework cannot be edited', async () => {
    await expect(
      admin.query(
        `UPDATE competency_level SET label='changed'
          WHERE competency_id=$1 AND level_no=3`, [ids.compComms]),
    ).rejects.toThrow(/published and cannot be edited/);
  });

  it('only one active version per code', async () => {
    await expect(admin.query(
      `INSERT INTO competency_framework (org_id,code,version,name,is_active,published_at)
       VALUES ($1,'CORE',2,'Core v2',TRUE,now())`, [ids.org]),
    ).rejects.toThrow();
  });

  it('an active framework must be published', async () => {
    await expect(admin.query(
      `INSERT INTO competency_framework (org_id,code,version,name,is_active)
       VALUES ($1,'DRAFT',1,'Draft',TRUE)`, [ids.org]),
    ).rejects.toThrow(/active_is_published/);
  });

  it('an assessment snapshots the framework version', async () => {
    const res = await admin.query<{ framework_version: number }>(
      `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                          assessed_level,assessed_by)
       VALUES ($1,$2,$3,3,$4) RETURNING framework_version`,
      [ids.org, ids.ic2, ids.compComms, ids.manager]);
    expect(res.rows[0].framework_version).toBe(1);
  });
});

describe('level validation', () => {
  it('rejects a required level outside the competency scale', async () => {
    await expect(admin.query(
      `INSERT INTO position_competency_map (org_id,position_id,competency_id,required_level)
       VALUES ($1,$2,$3,9)`, [ids.org, ids.posJunior, ids.compJudgement]),
    ).rejects.toThrow(/not defined for this competency/);
  });

  it('rejects an assessed level outside the scale', async () => {
    await expect(admin.query(
      `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                          assessed_level,assessed_by)
       VALUES ($1,$2,$3,8,$4)`, [ids.org, ids.ic, ids.compJudgement, ids.manager]),
    ).rejects.toThrow(/not defined for this competency/);
  });
});

describe('assessments are append-only', () => {
  it('discards updates and deletes; re-assessment adds a row', async () => {
    await admin.query(
      `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                          assessed_level,assessed_by,notes,assessed_on)
       VALUES ($1,$2,$3,2,$4,'original','2026-01-15')`,
      [ids.org, ids.peer, ids.compComms, ids.manager]);
    await admin.query(`UPDATE competency_assessment SET notes='rewritten'
                        WHERE subject_employee_id=$1`, [ids.peer]);
    await admin.query(`DELETE FROM competency_assessment WHERE subject_employee_id=$1`,
      [ids.peer]);

    const res = await admin.query(
      `SELECT notes FROM competency_assessment WHERE subject_employee_id=$1`, [ids.peer]);
    expect(res.rowCount).toBe(1);
    expect(res.rows[0].notes).toBe('original');
  });
});

describe('gap analysis', () => {
  it('distinguishes "never assessed" from a gap of zero', async () => {
    // ic holds Senior: judgement requires 4, communication requires 3.
    // Assess judgement only.
    await admin.query(
      `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                          assessed_level,assessed_by,assessed_on)
       VALUES ($1,$2,$3,4,$4,'2026-02-01')`,
      [ids.org, ids.ic, ids.compJudgement, ids.manager]);

    const rows = await admin.query<{
      competency_code: string; required_level: number;
      assessed_level: number | null; gap: number | null;
    }>(`SELECT * FROM app.competency_gaps($1)`, [ids.ic]);

    const judg = rows.rows.find((r) => r.competency_code === 'JUDG')!;
    const comm = rows.rows.find((r) => r.competency_code === 'COMM')!;

    expect(judg.assessed_level).toBe(4);
    expect(judg.gap).toBe(0);          // meets requirement exactly
    expect(comm.assessed_level).toBeNull();
    expect(comm.gap).toBeNull();       // NOT 0, and NOT -3
  });

  it('reports a negative gap below requirement and positive above', async () => {
    // Its own employee, so the result cannot be perturbed by assessments other
    // tests happen to have written for the shared fixtures.
    const subject = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,'gaptest','Gap','Test','2020-01-01') RETURNING id`,
      [ids.org])).rows[0].id;
    const et = (await admin.query(
      `SELECT id FROM employment_type WHERE org_id=$1 LIMIT 1`, [ids.org])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,position_id,department_id,
                               employment_type_id,status,effective_from)
       VALUES ($1,$2,$3,$4,$5,'regular','2020-01-01')`,
      [ids.org, subject, ids.posJunior, ids.dept, et]);

    await admin.query(
      `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                          assessed_level,assessed_by,assessed_on)
       VALUES ($1,$2,$3,1,$4,'2026-02-01'), ($1,$2,$5,5,$4,'2026-02-01')`,
      [ids.org, subject, ids.compJudgement, ids.manager, ids.compComms]);

    const rows = await admin.query<{
      competency_code: string; gap: number | null;
    }>(`SELECT * FROM app.competency_gaps($1)`, [subject]);

    // Junior requires level 2 in both.
    expect(rows.rows.find((r) => r.competency_code === 'JUDG')!.gap).toBe(-1);
    expect(rows.rows.find((r) => r.competency_code === 'COMM')!.gap).toBe(3);
  });

  it('uses the most recent assessment, not the first', async () => {
    await admin.query(
      `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                          assessed_level,assessed_by,assessed_on)
       VALUES ($1,$2,$3,5,$4,'2026-06-01')`,
      [ids.org, ids.ic, ids.compJudgement, ids.manager]);

    const rows = await admin.query<{ competency_code: string; assessed_level: number }>(
      `SELECT * FROM app.competency_gaps($1)`, [ids.ic]);
    expect(rows.rows.find((r) => r.competency_code === 'JUDG')!.assessed_level).toBe(5);
  });

  it('respects the as-of date, ignoring later assessments', async () => {
    const rows = await admin.query<{ competency_code: string; assessed_level: number }>(
      `SELECT * FROM app.competency_gaps($1, '2026-03-01'::date)`, [ids.ic]);
    // The June re-assessment must not appear in a March-dated report.
    expect(rows.rows.find((r) => r.competency_code === 'JUDG')!.assessed_level).toBe(4);
  });

  it('returns nothing for an employee with no mapped position', async () => {
    const rows = await admin.query(`SELECT * FROM app.competency_gaps($1)`, [ids.hrAdmin]);
    expect(rows.rowCount).toBe(0);
  });
});

describe('confidentiality', () => {
  it('an employee reads their own assessments', async () => {
    const rows = await as(ids.ic,
      `SELECT id FROM competency_assessment WHERE subject_employee_id=$1`, [ids.ic]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('a peer cannot read someone else\'s assessments', async () => {
    expect(await as(ids.peer,
      `SELECT id FROM competency_assessment WHERE subject_employee_id=$1`, [ids.ic]))
      .toEqual([]);
  });

  it('a manager can read their report\'s assessments', async () => {
    const rows = await as(ids.manager,
      `SELECT id FROM competency_assessment WHERE subject_employee_id=$1`, [ids.ic]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('nobody can assess themselves', async () => {
    await expect(
      as(ids.manager,
        `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                            assessed_level,assessed_by)
         VALUES ($1,$2,$3,5,$2)`, [ids.org, ids.manager, ids.compComms]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('an assessment cannot be attributed to someone else', async () => {
    await expect(
      as(ids.manager,
        `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                            assessed_level,assessed_by)
         VALUES ($1,$2,$3,5,$4)`, [ids.org, ids.ic, ids.compComms, ids.hrAdmin]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('an employee cannot assess anyone', async () => {
    await expect(
      as(ids.ic,
        `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                            assessed_level,assessed_by)
         VALUES ($1,$2,$3,5,$4)`, [ids.org, ids.ic2, ids.compComms, ids.ic]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('an assessment made inside a review inherits the release rule', async () => {
    // Build an unreleased supervisor review of ic, and attach an assessment.
    const cycle = (await admin.query(
      `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
       VALUES ($1,'C1','2026-01-01','2026-03-31','open') RETURNING id`,
      [ids.org])).rows[0].id;
    const scale = (await admin.query(
      `INSERT INTO rating_scale (org_id,code,version,name,published_at)
       VALUES ($1,'S',1,'Scale',now()) RETURNING id`, [ids.org])).rows[0].id;
    const tpl = (await admin.query(
      `INSERT INTO form_template (org_id,code,name) VALUES ($1,'T','T') RETURNING id`,
      [ids.org])).rows[0].id;
    const fv = (await admin.query(
      `INSERT INTO form_version (form_template_id,version,schema_json,rating_scale_id,
                                 published_at,is_active)
       VALUES ($1,1,'{"sections":[]}'::jsonb,$2,now(),TRUE) RETURNING id`,
      [tpl, scale])).rows[0].id;
    await admin.query(
      `INSERT INTO review_summary (review_cycle_id,subject_employee_id) VALUES ($1,$2)`,
      [cycle, ids.ic]);
    const supR = (await admin.query(
      `INSERT INTO review_instance (review_cycle_id,subject_employee_id,
                                    reviewer_employee_id,reviewer_role,form_version_id)
       VALUES ($1,$2,$3,'supervisor',$4) RETURNING id`,
      [cycle, ids.ic, ids.manager, fv])).rows[0].id;

    const assessment = (await admin.query(
      `INSERT INTO competency_assessment (org_id,subject_employee_id,competency_id,
                                          assessed_level,assessed_by,review_instance_id)
       VALUES ($1,$2,$3,1,$4,$5) RETURNING id`,
      [ids.org, ids.ic, ids.compComms, ids.manager, supR])).rows[0].id;

    // Before release: invisible to the subject, visible to the reviewer.
    expect(await as(ids.ic,
      `SELECT id FROM competency_assessment WHERE id=$1`, [assessment])).toEqual([]);
    expect(await as(ids.manager,
      `SELECT id FROM competency_assessment WHERE id=$1`, [assessment])).toHaveLength(1);

    // After release: the subject can read it.
    await admin.query(
      `UPDATE review_summary SET released_at=now()
        WHERE review_cycle_id=$1 AND subject_employee_id=$2`, [cycle, ids.ic]);
    expect(await as(ids.ic,
      `SELECT id FROM competency_assessment WHERE id=$1`, [assessment])).toHaveLength(1);
  });
});

describe('job family gap report', () => {
  it('aggregates across everyone in the family', async () => {
    const rows = await admin.query<{
      code: string; peoplemapped: number; notassessed: number; below: number;
    }>(
      `WITH people AS (
         SELECT e.id AS employee_id FROM employee e
           JOIN employment em ON em.employee_id=e.id AND em.effective_to IS NULL
           JOIN position p ON p.id=em.position_id
          WHERE p.job_family='Engineering' AND e.deleted_at IS NULL
       ), gaps AS (
         SELECT g.* FROM people pe
          CROSS JOIN LATERAL app.competency_gaps(pe.employee_id) g
       )
       SELECT competency_code AS code,
              COUNT(*)::int AS peoplemapped,
              COUNT(*) FILTER (WHERE assessed_level IS NULL)::int AS notassessed,
              COUNT(*) FILTER (WHERE gap IS NOT NULL AND gap < 0)::int AS below
         FROM gaps GROUP BY competency_code ORDER BY competency_code`);

    // Derived, not hardcoded: other tests legitimately add people to this job
    // family, and a literal here would make this test fail for the wrong reason.
    const headcount = Number((await admin.query<{ c: string }>(
      `SELECT count(*)::int AS c FROM employee e
         JOIN employment em ON em.employee_id=e.id AND em.effective_to IS NULL
         JOIN position p ON p.id=em.position_id
        WHERE p.job_family='Engineering' AND e.deleted_at IS NULL`)).rows[0]!.c);

    const comm = rows.rows.find((r) => r.code === 'COMM')!;
    expect(comm.peoplemapped).toBe(headcount);
    // Every mapped person is accounted for in exactly one bucket.
    expect(comm.notassessed + comm.below).toBeLessThanOrEqual(headcount);
    // The manager has never been assessed, so this bucket must be non-empty —
    // which is the coverage signal HR actually acts on.
    expect(comm.notassessed).toBeGreaterThan(0);
  });
});
