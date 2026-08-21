import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 3: review confidentiality, form versioning, and cycle integrity.
 *
 * The confidentiality tests are the point. An employee reading their
 * supervisor's candid assessment before it is released would change how
 * managers write reviews, permanently and for the worse. Equally, an employee
 * unable to read a review that HAS been signed off is indefensible. Both
 * directions are tested.
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
    throw new Error(`Review test pool must be non-superuser hr_app, got '${who.rows[0]?.user}'`);
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
  ids.dept = (await admin.query(
    `INSERT INTO department (org_id,code,name,effective_from)
     VALUES ($1,'ENG','Engineering','2020-01-01') RETURNING id`, [org])).rows[0].id;
  ids.etReg = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','Regular') RETURNING id`,
    [org])).rows[0].id;
  ids.etIntern = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name,is_eligible_for_review)
     VALUES ($1,'INT','Intern',FALSE) RETURNING id`, [org])).rows[0].id;

  const emp = async (no: string, type = ids.etReg) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,department_id,employment_type_id,
                               status,effective_from)
       VALUES ($1,$2,$3,$4,'regular','2020-01-01')`, [org, id, ids.dept, type]);
    return id;
  };

  ids.manager = await emp('manager');
  ids.ic = await emp('ic');
  ids.peer = await emp('peer');
  ids.hrAdmin = await emp('hradmin');
  ids.intern = await emp('intern', ids.etIntern);

  await admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01'), ($1,$4,$3,'2020-01-01'), ($1,$5,$3,'2020-01-01')`,
    [org, ids.ic, ids.manager, ids.peer, ids.intern]);

  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [org]);
  await admin.query('SELECT app.seed_phase2_grants($1)', [org]);
  await admin.query('SELECT app.seed_phase3_grants($1)', [org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const assign = (e: string, r: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, e, r]);
  const rEmp = await role('employee');
  for (const e of [ids.manager, ids.ic, ids.peer, ids.hrAdmin, ids.intern]) {
    await assign(e, rEmp);
  }
  await assign(ids.manager, await role('manager'));
  await assign(ids.hrAdmin, await role('hr_admin'));

  // Rating scale + default form template
  ids.scale = (await admin.query(
    `INSERT INTO rating_scale (org_id,code,version,name,published_at)
     VALUES ($1,'STD',1,'Standard 1-5',now()) RETURNING id`, [org])).rows[0].id;
  for (let i = 1; i <= 5; i++) {
    // Separate placeholders for sequence (smallint) and value (numeric):
    // reusing $2 for both makes Postgres unable to deduce a single type.
    await admin.query(
      `INSERT INTO rating_scale_point (rating_scale_id,sequence,value,label)
       VALUES ($1,$2,$3,$4)`, [ids.scale, i, i, `Level ${i}`]);
  }

  ids.template = (await admin.query(
    `INSERT INTO form_template (org_id,code,name) VALUES ($1,'STD','Standard') RETURNING id`,
    [org])).rows[0].id;
  ids.formVersion = (await admin.query(
    `INSERT INTO form_version (form_template_id,version,schema_json,rating_scale_id,
                               published_at,is_active)
     VALUES ($1,1,$2::jsonb,$3,now(),TRUE) RETURNING id`,
    [ids.template, JSON.stringify({
      sections: [{
        key: 'perf', title: 'Performance',
        fields: [
          { key: 'overall', label: 'Overall rating', type: 'rating', required: true },
          { key: 'comments', label: 'Comments', type: 'textarea', required: false },
        ],
      }],
    }), ids.scale])).rows[0].id;
  await admin.query(
    `INSERT INTO form_template_assignment (org_id,form_template_id) VALUES ($1,$2)`,
    [org, ids.template]);

  ids.cycle = (await admin.query(
    `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
     VALUES ($1,'FY26 Review','2026-01-01','2026-03-31','open') RETURNING id`,
    [org])).rows[0].id;
}

/** A subject with a self-review and a supervisor review. */
const setupReview = async (subject: string, supervisor: string) => {
  const cycle = (await admin.query(
    `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
     VALUES ($1,$2,'2026-01-01','2026-03-31','open') RETURNING id`,
    [ids.org, `C-${Math.random()}`])).rows[0].id;
  await admin.query(
    `INSERT INTO review_summary (review_cycle_id,subject_employee_id) VALUES ($1,$2)`,
    [cycle, subject]);
  const selfR = (await admin.query(
    `INSERT INTO review_instance (review_cycle_id,subject_employee_id,
                                  reviewer_employee_id,reviewer_role,form_version_id)
     VALUES ($1,$2,$2,'self',$3) RETURNING id`,
    [cycle, subject, ids.formVersion])).rows[0].id;
  const supR = (await admin.query(
    `INSERT INTO review_instance (review_cycle_id,subject_employee_id,
                                  reviewer_employee_id,reviewer_role,form_version_id)
     VALUES ($1,$2,$3,'supervisor',$4) RETURNING id`,
    [cycle, subject, supervisor, ids.formVersion])).rows[0].id;
  const summary = (await admin.query(
    `SELECT id FROM review_summary WHERE review_cycle_id=$1 AND subject_employee_id=$2`,
    [cycle, subject])).rows[0].id;
  return { cycle, selfR, supR, summary };
};

// ---------------------------------------------------------------------------

describe('review confidentiality', () => {
  it('an employee CANNOT see their supervisor\'s review before release', async () => {
    const { supR } = await setupReview(ids.ic, ids.manager);
    await admin.query(
      `INSERT INTO form_response (review_instance_id,field_key,value_json)
       VALUES ($1,'comments','"needs improvement"'::jsonb)`, [supR]);

    expect(await as(ids.ic, 'SELECT id FROM review_instance WHERE id=$1', [supR])).toEqual([]);
    expect(await as(ids.ic,
      'SELECT id FROM form_response WHERE review_instance_id=$1', [supR])).toEqual([]);
  });

  it('an employee CAN always see their own self-review', async () => {
    const { selfR } = await setupReview(ids.ic, ids.manager);
    expect(await as(ids.ic,
      'SELECT id FROM review_instance WHERE id=$1', [selfR])).toHaveLength(1);
  });

  it('an employee CAN see the supervisor review once released', async () => {
    const { supR, summary } = await setupReview(ids.ic, ids.manager);
    await admin.query(`UPDATE review_summary SET released_at = now() WHERE id=$1`, [summary]);
    expect(await as(ids.ic,
      'SELECT id FROM review_instance WHERE id=$1', [supR])).toHaveLength(1);
  });

  it('a peer can never see either review', async () => {
    const { selfR, supR } = await setupReview(ids.ic, ids.manager);
    expect(await as(ids.peer, 'SELECT id FROM review_instance WHERE id=$1', [selfR])).toEqual([]);
    expect(await as(ids.peer, 'SELECT id FROM review_instance WHERE id=$1', [supR])).toEqual([]);
  });

  it('the supervisor sees their own draft', async () => {
    const { supR } = await setupReview(ids.ic, ids.manager);
    expect(await as(ids.manager,
      'SELECT id FROM review_instance WHERE id=$1', [supR])).toHaveLength(1);
  });

  it('the summary is hidden from the subject until released', async () => {
    const { summary } = await setupReview(ids.ic, ids.manager);
    await admin.query(`UPDATE review_summary SET overall_rating=2 WHERE id=$1`, [summary]);
    expect(await as(ids.ic, 'SELECT id FROM review_summary WHERE id=$1', [summary])).toEqual([]);

    await admin.query(`UPDATE review_summary SET released_at=now() WHERE id=$1`, [summary]);
    expect(await as(ids.ic,
      'SELECT id FROM review_summary WHERE id=$1', [summary])).toHaveLength(1);
  });

  it('HR sees reviews regardless of release', async () => {
    const { supR } = await setupReview(ids.ic, ids.manager);
    expect(await as(ids.hrAdmin,
      'SELECT id FROM review_instance WHERE id=$1', [supR])).toHaveLength(1);
  });

  it('a reviewer cannot write answers into someone else\'s review', async () => {
    const { supR } = await setupReview(ids.ic, ids.manager);
    await expect(
      as(ids.peer,
        `INSERT INTO form_response (review_instance_id,field_key,value_json)
         VALUES ($1,'comments','"tampered"'::jsonb)`, [supR]),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('review integrity', () => {
  it('answers are frozen once submitted', async () => {
    const { supR } = await setupReview(ids.ic, ids.manager);
    await admin.query(
      `INSERT INTO form_response (review_instance_id,field_key,value_json)
       VALUES ($1,'overall','4'::jsonb)`, [supR]);
    await admin.query(`UPDATE review_instance SET state='submitted' WHERE id=$1`, [supR]);

    await expect(admin.query(
      `UPDATE form_response SET value_json='1'::jsonb WHERE review_instance_id=$1`, [supR]),
    ).rejects.toThrow(/submitted and can no longer be edited/);
    await expect(admin.query(
      `INSERT INTO form_response (review_instance_id,field_key,value_json)
       VALUES ($1,'comments','"late"'::jsonb)`, [supR]),
    ).rejects.toThrow(/submitted and can no longer be edited/);
  });

  it('a returned review becomes editable again, and records why', async () => {
    const { supR } = await setupReview(ids.ic, ids.manager);
    await admin.query(`UPDATE review_instance SET state='submitted' WHERE id=$1`, [supR]);
    await expect(
      admin.query(`UPDATE review_instance SET state='returned' WHERE id=$1`, [supR]),
    ).rejects.toThrow(/must record a reason/);

    await admin.query(
      `UPDATE review_instance SET state='returned', returned_reason='Add specifics'
        WHERE id=$1`, [supR]);
    await admin.query(
      `INSERT INTO form_response (review_instance_id,field_key,value_json)
       VALUES ($1,'comments','"revised"'::jsonb)`, [supR]);
    const res = await admin.query(
      `SELECT submitted_at FROM review_instance WHERE id=$1`, [supR]);
    expect(res.rows[0].submitted_at).toBeNull();
  });

  it('there is no quiet un-submit', async () => {
    const { supR } = await setupReview(ids.ic, ids.manager);
    await admin.query(`UPDATE review_instance SET state='submitted' WHERE id=$1`, [supR]);
    await expect(
      admin.query(`UPDATE review_instance SET state='in_progress' WHERE id=$1`, [supR]),
    ).rejects.toThrow(/Invalid review transition/);
  });

  it('a self-review must have reviewer = subject', async () => {
    await expect(admin.query(
      `INSERT INTO review_instance (review_cycle_id,subject_employee_id,
                                    reviewer_employee_id,reviewer_role,form_version_id)
       VALUES ($1,$2,$3,'self',$4)`,
      [ids.cycle, ids.ic, ids.manager, ids.formVersion]),
    ).rejects.toThrow(/review_instance_self_consistent/);
  });

  it('ratings are final after sign-off', async () => {
    const { summary } = await setupReview(ids.ic, ids.manager);
    await admin.query(
      `UPDATE review_summary SET overall_rating=4, signed_off_by=$2, signed_off_at=now()
        WHERE id=$1`, [summary, ids.manager]);
    await expect(
      admin.query(`UPDATE review_summary SET overall_rating=2 WHERE id=$1`, [summary]),
    ).rejects.toThrow(/signed off and its ratings are final/);
  });

  it('sign-off implies release', async () => {
    const { summary } = await setupReview(ids.ic, ids.manager);
    await admin.query(
      `UPDATE review_summary SET signed_off_by=$2, signed_off_at=now() WHERE id=$1`,
      [summary, ids.manager]);
    const res = await admin.query(
      `SELECT released_at FROM review_summary WHERE id=$1`, [summary]);
    expect(res.rows[0].released_at).not.toBeNull();
  });
});

describe('form versioning', () => {
  it('published versions are immutable', async () => {
    await expect(admin.query(
      `UPDATE form_version SET schema_json='{"sections":[]}'::jsonb WHERE id=$1`,
      [ids.formVersion]),
    ).rejects.toThrow(/Published form versions are immutable/);
  });

  it('a review keeps rendering the version it was created against', async () => {
    const { supR } = await setupReview(ids.ic, ids.manager);

    await admin.query(`UPDATE form_version SET is_active=FALSE WHERE id=$1`, [ids.formVersion]);
    await admin.query(
      `INSERT INTO form_version (form_template_id,version,schema_json,published_at,is_active)
       VALUES ($1,2,'{"sections":[{"key":"new","title":"New","fields":[]}]}'::jsonb,now(),TRUE)`,
      [ids.template]);

    const res = await admin.query(
      `SELECT v.version FROM review_instance ri
         JOIN form_version v ON v.id = ri.form_version_id WHERE ri.id=$1`, [supR]);
    expect(res.rows[0].version).toBe(1);

    // Restore v1 as active for later tests.
    await admin.query(`UPDATE form_version SET is_active=FALSE WHERE form_template_id=$1`,
      [ids.template]);
    await admin.query(`UPDATE form_version SET is_active=TRUE WHERE id=$1`, [ids.formVersion]);
  });

  it('only one active version per template', async () => {
    await expect(admin.query(
      `INSERT INTO form_version (form_template_id,version,schema_json,published_at,is_active)
       VALUES ($1,99,'{"sections":[]}'::jsonb,now(),TRUE)`, [ids.template]),
    ).rejects.toThrow();
  });

  it('an active version must be published', async () => {
    await expect(admin.query(
      `INSERT INTO form_version (form_template_id,version,schema_json,is_active)
       VALUES ($1,98,'{"sections":[]}'::jsonb,TRUE)`, [ids.template]),
    ).rejects.toThrow(/form_version_active_is_published/);
  });

  it('two assignments cannot claim the same combination', async () => {
    const t2 = (await admin.query(
      `INSERT INTO form_template (org_id,code,name) VALUES ($1,'ALT','Alt') RETURNING id`,
      [ids.org])).rows[0].id;
    await expect(admin.query(
      `INSERT INTO form_template_assignment (org_id,form_template_id) VALUES ($1,$2)`,
      [ids.org, t2]),
    ).rejects.toThrow();
  });
});

describe('goal attainment feeds the review', () => {
  it('computes weight-weighted attainment across goals', async () => {
    const period = (await admin.query(
      `INSERT INTO goal_period (org_id,name,period_type,starts_on,ends_on,state)
       VALUES ($1,'RVW','annual','2026-01-01','2026-12-31','open') RETURNING id`,
      [ids.org])).rows[0].id;

    // 70% weight at 100% attainment, 30% weight at 50% => 85%.
    for (const [weight, target, actual] of [[70, 100, 100], [30, 100, 50]] as const) {
      const g = (await admin.query(
        `INSERT INTO goal (org_id,goal_period_id,employee_id,title,weight,state,
                           approved_by,approved_at)
         VALUES ($1,$2,$3,'g',$4,'active',$5,now()) RETURNING id`,
        [ids.org, period, ids.ic, weight, ids.manager])).rows[0].id;
      await admin.query(
        `INSERT INTO goal_target (goal_id,measure_name,measure_type,target_value,actual_value)
         VALUES ($1,'m','numeric',$2,$3)`, [g, target, actual]);
    }

    const res = await admin.query<{ pct: string }>(
      `SELECT app.review_goal_attainment($1,$2)::float8 AS pct`, [ids.ic, period]);
    expect(Number(res.rows[0].pct)).toBe(85);
  });
});

describe('form template resolution', () => {
  it('falls back to the organisation default', async () => {
    const res = await admin.query<{ id: string }>(
      'SELECT app.resolve_form_version($1) AS id', [ids.ic]);
    expect(res.rows[0].id).toBe(ids.formVersion);
  });

  it('review-ineligible employment types are excluded from generation', async () => {
    // The intern's type has is_eligible_for_review = FALSE, so the generation
    // query must not pick them up.
    const res = await admin.query<{ c: string }>(
      `SELECT count(*)::int AS c
         FROM employee e
         JOIN employment em ON em.employee_id = e.id AND em.effective_to IS NULL
         JOIN employment_type et ON et.id = em.employment_type_id
                                AND et.is_eligible_for_review
        WHERE e.id = $1`, [ids.intern]);
    expect(Number(res.rows[0].c)).toBe(0);
  });
});
