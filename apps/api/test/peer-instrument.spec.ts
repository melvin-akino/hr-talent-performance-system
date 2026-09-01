import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PEER_METRICS, PEER_TEMPLATE_TOTAL, peerTemplate } from '../src/reviews/peer-instrument';
import { assertScoringValid, totalFor, DEFAULT_CLASSIFICATION } from '../src/reviews/scoring';

/**
 * D1 — the 30-point peer instrument, and accepting an invitation (§6.1).
 *
 * The instrument is a seed; the interesting part is either side of it.
 *
 * The property this suite exists for is the last one: a subject must not learn
 * which colleague assessed them, because Q5 is unanswered and that disclosure
 * cannot be taken back. The existing rule (0014) would have shown them, once
 * released, as a side effect of adding a reviewer_role.
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

describe('the instrument itself', () => {
  it('totals 30, exactly as their page states', () => {
    const schema = peerTemplate();
    expect(() => assertScoringValid(schema)).not.toThrow();
    expect(totalFor(schema, DEFAULT_CLASSIFICATION)).toBe(PEER_TEMPLATE_TOTAL);
    expect(PEER_TEMPLATE_TOTAL).toBe(30);
  });

  it('weights customer service at double everything else', () => {
    // The substantive claim the instrument makes about what matters, and so the
    // number most worth pinning.
    const byKey = Object.fromEntries(PEER_METRICS.map((m) => [m.key, m.points]));
    expect(byKey.customer_service).toBe(10);
    expect(byKey.mastery).toBe(5);
    expect(byKey.demeanor_remote).toBe(5);
    expect(byKey.demeanor_in_person).toBe(5);
    expect(byKey.promptness).toBe(5);
  });

  it('makes every line required', () => {
    // A 30-point instrument with an optional line is not a 30-point instrument.
    for (const section of peerTemplate().sections) {
      for (const field of section.fields) expect(field.required).toBe(true);
    }
  });

  it('separates the two demeanour lines', () => {
    // Their page distinguishes phone and messaging from in person, and a single
    // merged line would quietly halve that part of the instrument.
    const labels = PEER_METRICS.map((m) => m.label);
    expect(labels.filter((l) => l.startsWith('Demeanour'))).toHaveLength(2);
  });
});

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
  ids.etype = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','Regular') RETURNING id`,
    [org])).rows[0].id;
  ids.branch = (await admin.query(
    `INSERT INTO department (org_id,code,name,unit_type,effective_from)
     VALUES ($1,'DAG','Dagupan','branch','2020-01-01') RETURNING id`, [org])).rows[0].id;
  ids.rank = (await admin.query(
    `INSERT INTO job_rank (org_id,code,name,rank_no) VALUES ($1,'R11','Associate',11)
     RETURNING id`, [org])).rows[0].id;

  const emp = async (no: string) => {
    const pos = (await admin.query(
      `INSERT INTO position (org_id,title,department_id,job_family,rank_id)
       VALUES ($1,$2,$3,'Branch',$4) RETURNING id`,
      [org, `Associate ${no}`, ids.branch, ids.rank])).rows[0].id;
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,position_id,department_id,
                               employment_type_id,status,effective_from)
       VALUES ($1,$2,$3,$4,$5,'regular','2020-01-01')`,
      [org, id, pos, ids.branch, ids.etype]);
    return id;
  };

  ids.subject = await emp('SUBJ');
  ids.reviewer = await emp('REV');
  ids.other = await emp('OTHER');
  ids.hr = await emp('HR');

  for (const fn of ['seed_baseline_roles', 'seed_phase1_grants', 'seed_phase3_grants',
                    'seed_line_role_grants', 'seed_dept_head_review_grants']) {
    await admin.query(`SELECT app.${fn}($1)`, [org]);
  }
  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const rEmp = await role('employee');
  for (const e of [ids.subject, ids.reviewer, ids.other, ids.hr]) {
    await admin.query(
      `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
       VALUES ($1,$2,$3,'2020-01-01')`, [org, e, rEmp]);
  }
  await admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, ids.hr, await role('hr_admin')]);

  // The instrument, seeded the way provision-org does.
  const scale = (await admin.query(
    `INSERT INTO rating_scale (org_id,code,version,name,published_at)
     VALUES ($1,'STD',1,'Standard',now()) RETURNING id`, [org])).rows[0].id;
  const template = (await admin.query(
    `INSERT INTO form_template (org_id,code,name) VALUES ($1,'PEER-30','Peer review')
     RETURNING id`, [org])).rows[0].id;
  await admin.query(
    `INSERT INTO form_version (form_template_id,version,schema_json,rating_scale_id,
                               published_at,is_active)
     VALUES ($1,1,$2::jsonb,$3,now(),TRUE)`,
    [template, JSON.stringify(peerTemplate()), scale]);

  ids.cycle = (await admin.query(
    `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
     VALUES ($1,'FY2026','2026-01-01','2026-12-31','open') RETURNING id`,
    [org])).rows[0].id;
  await admin.query(
    `INSERT INTO review_summary (review_cycle_id, subject_employee_id)
     VALUES ($1,$2)`, [ids.cycle, ids.subject]);

  const rule = (await admin.query(
    `INSERT INTO peer_review_rule (org_id,code,name,min_reviewers,max_reviewers)
     VALUES ($1,'ALL','All staff',1,5) RETURNING id`, [org])).rows[0].id;
  await admin.query(
    `INSERT INTO peer_review_rule_source (org_id,rule_id,label,rank_delta,relation)
     VALUES ($1,$2,'Colleagues on the branch',0,'same_unit')`, [org, rule]);
}

describe('accepting an invitation', () => {
  it('creates the review instance in the same step', async () => {
    // D3 stopped at 'accepted' because the instrument did not exist. Apart, the
    // two leave somebody who has agreed to review with nothing to fill in.
    ids.solicitation = (await admin.query<{ id: string }>(
      `INSERT INTO peer_review_solicitation (org_id, review_cycle_id,
                                             subject_employee_id,
                                             reviewer_employee_id, source_label)
       VALUES ($1,$2,$3,$4,'Colleagues') RETURNING id`,
      [ids.org, ids.cycle, ids.subject, ids.reviewer])).rows[0]!.id;

    const instance = await one<{ id: string }>(ids.hr,
      `SELECT app.accept_peer_solicitation($1) AS id`, [ids.solicitation]);
    expect(instance!.id).toBeTruthy();
    ids.instance = instance!.id;

    const row = await one<{ role: string; state: string; code: string }>(ids.hr,
      `SELECT ri.reviewer_role::text AS role, ri.state::text AS state, t.code
         FROM review_instance ri
         JOIN form_version v ON v.id = ri.form_version_id
         JOIN form_template t ON t.id = v.form_template_id
        WHERE ri.id = $1`, [ids.instance]);
    expect(row!.role).toBe('peer');
    expect(row!.state).toBe('not_started');
    expect(row!.code).toBe('PEER-30');
  });

  it('marks the invitation accepted', async () => {
    const s = await one<{ state: string; responded: string }>(ids.hr,
      `SELECT state::text AS state, responded_at::text AS responded
         FROM peer_review_solicitation WHERE id = $1`, [ids.solicitation]);
    expect(s!.state).toBe('accepted');
    expect(s!.responded).toBeTruthy();
  });

  it('refuses an invitation that is not outstanding', async () => {
    await expect(as(ids.hr,
      `SELECT app.accept_peer_solicitation($1)`, [ids.solicitation]))
      .rejects.toThrow(/not outstanding/);
  });

  it('says so when no peer form is published', async () => {
    // A missing instrument must not present as a missing invitation.
    const other = (await admin.query<{ id: string }>(
      `INSERT INTO organization (code,name) VALUES ('NOFORM','No form') RETURNING id`))
      .rows[0]!.id;
    await admin.query(`UPDATE form_template SET code = 'PEER-OFF' WHERE org_id = $1`,
      [ids.org]);

    const fresh = (await admin.query<{ id: string }>(
      `INSERT INTO peer_review_solicitation (org_id, review_cycle_id,
                                             subject_employee_id,
                                             reviewer_employee_id, source_label)
       VALUES ($1,$2,$3,$4,'Colleagues') RETURNING id`,
      [ids.org, ids.cycle, ids.subject, ids.other])).rows[0]!.id;

    await expect(as(ids.hr, `SELECT app.accept_peer_solicitation($1)`, [fresh]))
      .rejects.toThrow(/No peer-review form is published/);

    await admin.query(`UPDATE form_template SET code = 'PEER-30' WHERE org_id = $1`,
      [ids.org]);
    await admin.query(`DELETE FROM peer_review_solicitation WHERE id = $1`, [fresh]);
    await admin.query(`DELETE FROM organization WHERE id = $1`, [other]);
  });
});

describe('a subject does not learn who assessed them', () => {
  it('hides a peer instance even after the review is released', async () => {
    // THE test of this migration. 0014 lets a subject read any instance about
    // them once released; applied to a peer instance that discloses which
    // colleague wrote it, which is exactly what Q5 has not decided. Shipping it
    // as a side effect of adding a reviewer_role would answer the question for
    // the client, irreversibly, in the direction that cannot be taken back.
    await admin.query(
      `UPDATE review_summary SET released_at = now(), signed_off_at = now(),
                                 signed_off_by = $2
        WHERE review_cycle_id = $1`, [ids.cycle, ids.hr]);

    const released = await one<{ released: boolean }>(ids.hr,
      `SELECT app.review_released($1,$2) AS released`, [ids.cycle, ids.subject]);
    expect(released!.released).toBe(true);

    const seen = await as(ids.subject,
      `SELECT id FROM review_instance WHERE id = $1`, [ids.instance]);
    expect(seen).toEqual([]);
  });

  it('still shows the reviewer their own work', async () => {
    // The restrictive policy removes exactly one audience, not the reviewer's
    // access to what they are being asked to write.
    const mine = await as(ids.reviewer,
      `SELECT id FROM review_instance WHERE id = $1`, [ids.instance]);
    expect(mine).toHaveLength(1);
  });

  it('still shows HR the panel', async () => {
    // Somebody has to be able to see whether a panel is complete.
    const theirs = await as(ids.hr,
      `SELECT id FROM review_instance WHERE id = $1`, [ids.instance]);
    expect(theirs).toHaveLength(1);
  });

  it('leaves the subject’s other released reviews visible', async () => {
    // The carve-out is peer instances only. A supervisor's released assessment
    // must still reach them -- a performance record you cannot see is
    // indefensible, and that rule is not what Q5 is about.
    const supervisorInstance = (await admin.query<{ id: string }>(
      `INSERT INTO review_instance (review_cycle_id, subject_employee_id,
                                    reviewer_employee_id, reviewer_role,
                                    form_version_id, state)
            SELECT $1,$2,$3,'supervisor', v.id, 'submitted'
              FROM form_version v LIMIT 1
       RETURNING id`, [ids.cycle, ids.subject, ids.other])).rows[0]!.id;

    const seen = await as(ids.subject,
      `SELECT id FROM review_instance WHERE id = $1`, [supervisorInstance]);
    expect(seen).toHaveLength(1);
  });
});
