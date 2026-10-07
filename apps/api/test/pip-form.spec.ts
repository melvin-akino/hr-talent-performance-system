/**
 * F6 — the December 2025 Performance Improvement Plan form, at the database.
 *
 * TWO THINGS HERE ARE NOT "NEW FEATURE" TESTS.
 *
 * The first is the very first test in the file. Until this form arrived nothing
 * tested whether an employee could acknowledge their own PIP, and they could
 * not: the employee holds only `pip:read` on themselves, the update policy
 * therefore filtered their row out, and the service reported "only the employee
 * can acknowledge it" to the one person who could. It shipped, and was live on
 * the demo host. The form's signatures are the first thing worth testing for
 * that reason: it is the mechanism that failed.
 *
 * The second is the matrix of who may sign as whom. It is the part of this form
 * that is a security boundary rather than a data field, and it is asserted at
 * the database rather than the service, because the service is one of several
 * ways a row can be written.
 *
 * Every actor below connects as `hr_app`, which is not a superuser; the suite
 * refuses to run otherwise, because a superuser bypasses RLS and every refusal
 * asserted here would pass while testing nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '../../../db/migrations');

let container: StartedPostgreSqlContainer;
let admin: Pool;
let app: Pool;
const ids: Record<string, string> = {};

/** Runs SQL as one employee, inside a transaction, under RLS. */
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
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  app = new Pool({
    connectionString: container.getConnectionUri().replace('postgres:postgres', 'hr_app:a'),
  });

  const who = await app.query<{ user: string; bypass: boolean }>(
    `SELECT current_user AS user, usesuper AS bypass
       FROM pg_user WHERE usename = current_user`);
  if (who.rows[0]?.user !== 'hr_app' || who.rows[0]?.bypass) {
    throw new Error(`Test pool must be non-superuser hr_app, got '${who.rows[0]?.user}'`);
  }

  await seed();
}, 240_000);

afterAll(async () => {
  await app?.end();
  await admin?.end();
  await container?.stop();
});

/**
 *   director                      holds `manager`, but is a skip-level
 *     +-- manager                 supervises ic and ic2
 *     |     +-- ic, ic2
 *     +-- deptHead                dept_head over ENGINEERING
 *     +-- dualHat                 dept_head over ENGINEERING *and* hr_admin —
 *                                 the HCM situation, where one person is both
 *   salesHead                     dept_head over SALES
 *   outsider                      in SALES
 *   hrAdmin                       hr_admin, org-wide
 */
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
  ids.deptHead = await emp('depthead', ids.deptEng);
  ids.dualHat = await emp('dualhat', ids.deptEng);
  ids.salesHead = await emp('saleshead', ids.deptSales);
  ids.outsider = await emp('outsider', ids.deptSales);
  ids.hrAdmin = await emp('hradmin', ids.deptEng);

  const line = (child: string, sup: string) => admin.query(
    `INSERT INTO reporting_line (org_id,employee_id,supervisor_employee_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, child, sup]);
  await line(ids.manager, ids.director);
  await line(ids.ic, ids.manager);
  await line(ids.ic2, ids.manager);
  await line(ids.deptHead, ids.director);
  await line(ids.dualHat, ids.director);

  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [org]);
  await admin.query('SELECT app.seed_phase2_grants($1)', [org]);
  await admin.query('SELECT app.seed_line_role_grants($1)', [org]);
  await admin.query('SELECT app.seed_pip_signature_grants($1)', [org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const assign = (e: string, r: string, dept?: string) => admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,scope_department_id,effective_from)
     VALUES ($1,$2,$3,$4,'2020-01-01')`, [org, e, r, dept ?? null]);

  const people = [ids.director, ids.manager, ids.ic, ids.ic2, ids.deptHead,
    ids.dualHat, ids.salesHead, ids.outsider, ids.hrAdmin];
  for (const e of people) await assign(e, await role('employee'));

  await assign(ids.manager, await role('manager'));
  await assign(ids.director, await role('manager'));
  await assign(ids.hrAdmin, await role('hr_admin'));
  // Scope is what makes a department-scoped role mean anything: an unscoped
  // assignment grants nothing at all (can_access's 'department' branch begins
  // `scope_department_id IS NOT NULL`).
  await assign(ids.deptHead, await role('dept_head'), ids.deptEng);
  await assign(ids.salesHead, await role('dept_head'), ids.deptSales);
  await assign(ids.dualHat, await role('dept_head'), ids.deptEng);
  await assign(ids.dualHat, await role('hr_admin'));
}

/** An ACTIVE plan about `employee`, supervised by `supervisor`. */
async function activePip(employee: string, supervisor: string): Promise<string> {
  const id = (await admin.query(
    `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
                           starts_on,ends_on)
     VALUES ($1,$2,$3,$3,'Sustained underperformance against agreed targets',
             '2026-03-01','2026-06-01') RETURNING id`,
    [ids.org, employee, supervisor])).rows[0].id;
  await admin.query(
    `INSERT INTO pip_milestone (pip_plan_id,sequence,description,due_on)
     VALUES ($1,1,'Close 5 tickets per week','2026-04-01')`, [id]);
  await admin.query(`UPDATE pip_plan SET state='active' WHERE id=$1`, [id]);
  return id;
}

const sign = (actor: string, plan: string, party: string) => as<{ id: string }>(
  actor,
  `INSERT INTO pip_acknowledgement (org_id, pip_plan_id, party, acknowledged_by)
        VALUES ($1,$2,$3::pip_party,$4) RETURNING id`,
  [ids.org, plan, party, actor]);

const signable = async (actor: string, plan: string) =>
  (await as<{ party: string }>(
    actor, `SELECT party::text FROM app.pip_signable_parties($1) ORDER BY 1`, [plan]))
    .map((r) => r.party);

// ---------------------------------------------------------------------------

describe('an employee acknowledging their own PIP', () => {
  it('can — which, until this form, they could not', async () => {
    // The regression this file exists for. The old path updated pip_plan, which
    // the update policy hid from the employee; this is an insert into a table
    // with its own policy, and it must succeed for the person it is about.
    const plan = await activePip(ids.ic, ids.manager);
    const rows = await sign(ids.ic, plan, 'employee');
    expect(rows).toHaveLength(1);
  });

  it('cannot do it twice', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    await sign(ids.ic, plan, 'employee');
    await expect(sign(ids.ic, plan, 'employee')).rejects.toThrow(/duplicate key|pip_acknowledgement/);
  });

  it('cannot do it on a draft', async () => {
    // A draft can still be reworded or abandoned, and the employee is not told
    // of it until it is activated. A signature on terms that may yet change
    // attests to nothing.
    const draft = (await admin.query(
      `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
                             starts_on,ends_on)
       VALUES ($1,$2,$3,$3,'Sustained underperformance against agreed targets',
               '2026-03-01','2026-06-01') RETURNING id`,
      [ids.org, ids.ic2, ids.manager])).rows[0].id;
    await expect(sign(ids.ic2, draft, 'employee')).rejects.toThrow(/row-level security/);
  });

  it('cannot do it after the plan has closed', async () => {
    const plan = await activePip(ids.ic2, ids.manager);
    await admin.query(
      `UPDATE pip_plan SET state='completed', outcome='successful' WHERE id=$1`, [plan]);
    await expect(sign(ids.ic2, plan, 'employee')).rejects.toThrow(/row-level security/);
  });

  it('cannot sign as anybody else', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    for (const party of ['reporting_officer', 'department_head', 'hcm_representative']) {
      await expect(sign(ids.ic, plan, party), party).rejects.toThrow(/row-level security/);
    }
  });
});

describe('who may sign as whom', () => {
  it('the reporting officer signs as the reporting officer, and only that', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    await expect(sign(ids.manager, plan, 'employee')).rejects.toThrow(/row-level security/);
    await expect(sign(ids.manager, plan, 'department_head')).rejects.toThrow(/row-level security/);
    await expect(sign(ids.manager, plan, 'hcm_representative')).rejects.toThrow(/row-level security/);
    expect(await sign(ids.manager, plan, 'reporting_officer')).toHaveLength(1);
  });

  it('a department head signs for their own unit', async () => {
    const plan = await activePip(ids.ic, ids.manager);          // ic is in ENGINEERING
    expect(await sign(ids.deptHead, plan, 'department_head')).toHaveLength(1);
  });

  it("a department head cannot sign for another unit's plan, nor even see it", async () => {
    const plan = await activePip(ids.outsider, ids.salesHead);  // outsider is in SALES
    await expect(sign(ids.deptHead, plan, 'department_head')).rejects.toThrow(/row-level security/);
    expect(await as(ids.deptHead, `SELECT 1 FROM pip_plan WHERE id=$1`, [plan])).toHaveLength(0);
  });

  it('a department head cannot sign as HCM, or as the reporting officer', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    await expect(sign(ids.deptHead, plan, 'hcm_representative')).rejects.toThrow(/row-level security/);
    await expect(sign(ids.deptHead, plan, 'reporting_officer')).rejects.toThrow(/row-level security/);
  });

  it('HR signs as HCM, and cannot sign as the department head', async () => {
    // The reason these are two resources and not one action: if both parties
    // rode 'pip' + 'approve', HR could sign as the department head.
    const plan = await activePip(ids.ic, ids.manager);
    await expect(sign(ids.hrAdmin, plan, 'department_head')).rejects.toThrow(/row-level security/);
    expect(await sign(ids.hrAdmin, plan, 'hcm_representative')).toHaveLength(1);
  });

  it('one person may hold two parties on somebody else’s plan — which is HCM', async () => {
    // In HCM the department head and the HCM representative are the same person.
    // Forbidding it would make the form unsignable for the unit that wrote it;
    // recording who signed as what is the control.
    const plan = await activePip(ids.ic, ids.manager);
    expect(await sign(ids.dualHat, plan, 'department_head')).toHaveLength(1);
    expect(await sign(ids.dualHat, plan, 'hcm_representative')).toHaveLength(1);
  });

  it('nobody signs the department or HCM line on their OWN plan', async () => {
    // dualHat holds both roles and is also the subject of this plan. The
    // employee line is the only one a person may hold about themselves.
    const plan = await activePip(ids.dualHat, ids.director);
    await expect(sign(ids.dualHat, plan, 'department_head')).rejects.toThrow(/row-level security/);
    await expect(sign(ids.dualHat, plan, 'hcm_representative')).rejects.toThrow(/row-level security/);
    expect(await sign(ids.dualHat, plan, 'employee')).toHaveLength(1);
  });

  it('a skip-level manager, a peer and a stranger can neither see nor sign', async () => {
    // 0011's rule, and still true: a director reads goals two levels down but
    // not PIPs. Adding signatories must not have widened it.
    const plan = await activePip(ids.ic, ids.manager);
    for (const who of [ids.director, ids.ic2, ids.outsider]) {
      expect(await as(who, `SELECT 1 FROM pip_plan WHERE id=$1`, [plan]), who).toHaveLength(0);
      for (const party of ['employee', 'reporting_officer', 'department_head', 'hcm_representative']) {
        await expect(sign(who, plan, party), `${who} as ${party}`).rejects.toThrow(/row-level security/);
      }
    }
  });

  it('refuses a signature entered in somebody else’s name', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    await expect(as(
      ids.manager,
      `INSERT INTO pip_acknowledgement (org_id, pip_plan_id, party, acknowledged_by)
            VALUES ($1,$2,'employee',$3)`,
      [ids.org, plan, ids.ic],
    )).rejects.toThrow(/row-level security/);
  });
});

describe('the parties the screen offers', () => {
  it('lists exactly what the caller could sign, from the one definition', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    expect(await signable(ids.ic, plan)).toEqual(['employee']);
    expect(await signable(ids.manager, plan)).toEqual(['reporting_officer']);
    expect(await signable(ids.deptHead, plan)).toEqual(['department_head']);
    expect(await signable(ids.hrAdmin, plan)).toEqual(['hcm_representative']);
    expect(await signable(ids.dualHat, plan)).toEqual(['department_head', 'hcm_representative']);
    expect(await signable(ids.director, plan)).toEqual([]);
    expect(await signable(ids.ic2, plan)).toEqual([]);
  });

  it('drops a party once it has signed', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    await sign(ids.manager, plan, 'reporting_officer');
    expect(await signable(ids.manager, plan)).toEqual([]);
  });

  it('offers nothing on a plan that is not active', async () => {
    const draft = (await admin.query(
      `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
                             starts_on,ends_on)
       VALUES ($1,$2,$3,$3,'Sustained underperformance against agreed targets',
               '2026-03-01','2026-06-01') RETURNING id`,
      [ids.org, ids.ic, ids.manager])).rows[0].id;
    expect(await signable(ids.ic, draft)).toEqual([]);
    expect(await signable(ids.manager, draft)).toEqual([]);
  });
});

describe('signatures as a record', () => {
  it('are visible to whoever can see the plan, and to nobody else', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    await sign(ids.ic, plan, 'employee');

    const count = async (who: string) => (await as(
      who, `SELECT 1 FROM pip_acknowledgement WHERE pip_plan_id=$1`, [plan])).length;
    expect(await count(ids.ic)).toBe(1);
    expect(await count(ids.manager)).toBe(1);
    expect(await count(ids.deptHead)).toBe(1);
    expect(await count(ids.hrAdmin)).toBe(1);
    expect(await count(ids.director)).toBe(0);
    expect(await count(ids.ic2)).toBe(0);
  });

  it('can be neither edited nor removed', async () => {
    // Even by a superuser: the protection is a rule on the table, not a policy.
    // A signature that can be quietly changed is not evidence of anything.
    const plan = await activePip(ids.ic, ids.manager);
    await sign(ids.ic, plan, 'employee');

    // No RETURNING: Postgres refuses it on a table with a do-nothing rule, which
    // is itself the rule announcing it is there.
    const updated = await admin.query(
      `UPDATE pip_acknowledgement SET acknowledged_by = $2
        WHERE pip_plan_id = $1`, [plan, ids.manager]);
    const deleted = await admin.query(
      `DELETE FROM pip_acknowledgement WHERE pip_plan_id = $1`, [plan]);
    expect(updated.rowCount).toBe(0);
    expect(deleted.rowCount).toBe(0);

    const still = await admin.query(
      `SELECT acknowledged_by FROM pip_acknowledgement WHERE pip_plan_id = $1`, [plan]);
    expect(still.rows[0].acknowledged_by).toBe(ids.ic);
  });

  it('are audited', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    await sign(ids.manager, plan, 'reporting_officer');
    const audit = await admin.query(
      `SELECT operation::text AS op, actor_employee_id AS actor
         FROM audit_log WHERE table_name = 'pip_acknowledgement'
          AND new_data->>'pip_plan_id' = $1`, [plan]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].op).toBe('INSERT');
  });
});

describe('the fields the form added to the plan', () => {
  const insert = (extra: string, values: unknown[] = []) => admin.query(
    `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
                           starts_on,ends_on ${extra ? ', ' + extra.split('=')[0] : ''})
     VALUES ($1,$2,$3,$3,'Sustained underperformance against agreed targets',
             '2026-03-01','2026-06-01' ${extra ? ', ' + extra.split('=')[1] : ''})
     RETURNING id`,
    [ids.org, ids.ic2, ids.manager, ...values]);

  it('accepts a fully completed form', async () => {
    const r = await admin.query(
      `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
          starts_on,ends_on, series_no, evaluated_on, latest_evaluation_on,
          evaluation_part1_score, evaluation_part2_score, evaluation_overall_score,
          pef_reference, pip_reference, record_of_infractions, target_score,
          initial_review_on, final_review_on, skills_to_improve,
          officer_responsibility, additional_remarks)
       VALUES ($1,$2,$3,$3,'Sustained underperformance against agreed targets',
          '2026-03-01','2026-06-01','PIP-2026-001','2026-02-27','2026-01-31',
          38.5, 17, 55.5, 'PEF-2026-014', NULL, 'Two late arrivals logged in January',
          70, '2026-04-01', '2026-05-29', 'Turnaround time on tickets',
          'Weekly coaching and a shadowing assignment', 'Employee agreed to the targets')
       RETURNING id`, [ids.org, ids.ic2, ids.manager]);
    expect(r.rowCount).toBe(1);
  });

  it('does not insist that overall equals part 1 plus part 2', async () => {
    // Deliberate. If the form's overall is an average across quarters it need not
    // equal the latest quarter's two parts (R18), and a constraint here would
    // reject real data on a guess. 40 + 20 is not 70, and that is allowed.
    const r = await admin.query(
      `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
          starts_on,ends_on, evaluation_part1_score, evaluation_part2_score,
          evaluation_overall_score)
       VALUES ($1,$2,$3,$3,'Sustained underperformance against agreed targets',
          '2026-03-01','2026-06-01', 40, 20, 70) RETURNING id`,
      [ids.org, ids.ic2, ids.manager]);
    expect(r.rowCount).toBe(1);
  });

  it('keeps the series number unique per organisation, ignoring case and padding', async () => {
    await insert('series_no=$4', ['PIP-UNIQ-1']);
    await expect(insert('series_no=$4', ['pip-uniq-1 '])).rejects.toThrow(/pip_plan_series_uq/);
  });

  it('refuses a blank series number rather than storing it', async () => {
    await expect(insert('series_no=$4', ['   '])).rejects.toThrow(/pip_series_not_blank/);
  });

  it('lets many plans carry no series number at all', async () => {
    await insert('', []);
    await insert('', []);
  });

  it('refuses scores outside 0-100', async () => {
    await expect(insert('evaluation_part1_score=$4', [101]))
      .rejects.toThrow(/pip_evaluation_scores_in_range/);
    await expect(insert('evaluation_overall_score=$4', [-1]))
      .rejects.toThrow(/pip_evaluation_scores_in_range/);
    await expect(insert('target_score=$4', [100.5])).rejects.toThrow(/pip_target_in_range/);
  });

  it('refuses an initial review after the final one', async () => {
    await expect(admin.query(
      `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
          starts_on,ends_on, initial_review_on, final_review_on)
       VALUES ($1,$2,$3,$3,'Sustained underperformance against agreed targets',
          '2026-03-01','2026-06-01','2026-05-20','2026-04-01')`,
      [ids.org, ids.ic2, ids.manager])).rejects.toThrow(/pip_review_dates_ordered/);
  });
});

describe('the reviews the schedule names', () => {
  const review = (plan: string, kind: string, score: number | null) => as(
    ids.manager,
    `INSERT INTO pip_review (pip_plan_id, reviewed_by, review_date, progress_summary,
                            status_flag, kind, score, created_by)
          VALUES ($1,$2,'2026-04-01','Discussed progress','on_track',
                  $3::pip_review_kind,$4,$2)`,
    [plan, ids.manager, kind, score]);

  it('require a score for an initial or a final review', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    await expect(review(plan, 'initial', null)).rejects.toThrow(/pip_review_scheduled_has_score/);
    await expect(review(plan, 'final', null)).rejects.toThrow(/pip_review_scheduled_has_score/);
  });

  it('do not require one for an ordinary review', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    await review(plan, 'interim', null);
    await review(plan, 'interim', null);
  });

  it('allow one initial and one final, and no more', async () => {
    // pip_review is append-only, so a second "final" could never be corrected.
    // Refusing it outright is kinder than leaving two to disagree.
    const plan = await activePip(ids.ic, ids.manager);
    await review(plan, 'initial', 50);
    await review(plan, 'final', 66);
    await expect(review(plan, 'initial', 51)).rejects.toThrow(/pip_review_one_initial_final/);
    await expect(review(plan, 'final', 67)).rejects.toThrow(/pip_review_one_initial_final/);
  });

  it('refuse a score outside 0-100', async () => {
    const plan = await activePip(ids.ic, ids.manager);
    await expect(review(plan, 'initial', 101)).rejects.toThrow(/pip_review_score_in_range/);
  });
});

describe('plans signed before the table existed', () => {
  it('keep their employee signature, carried across by the migration', async () => {
    // Applied in two stages on a scratch database: everything up to 0048, a plan
    // the employee had acknowledged under the old column, then 0049. Applied
    // in one go (as the suite above does) there is nothing to carry across.
    const url = container.getConnectionUri().replace(/\/hr(\?|$)/, '/pre49$1');
    await admin.query('CREATE DATABASE pre49');
    const scratch = new Pool({ connectionString: url });
    try {
      const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();
      for (const f of files.filter((n) => n < '0049')) {
        await scratch.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
      }

      const org = (await scratch.query(
        `INSERT INTO organization (code,name) VALUES ('OLD','Old') RETURNING id`)).rows[0].id;
      const person = async (no: string) => (await scratch.query(
        `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
         VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [org, no])).rows[0].id;
      const subject = await person('subject');
      const boss = await person('boss');
      const plan = (await scratch.query(
        `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
                               starts_on,ends_on,acknowledged_at)
         VALUES ($1,$2,$3,$3,'Sustained underperformance against agreed targets',
                 '2026-03-01','2026-06-01','2026-03-02 09:30:00+00') RETURNING id`,
        [org, subject, boss])).rows[0].id;
      const unsigned = (await scratch.query(
        `INSERT INTO pip_plan (org_id,employee_id,initiated_by,supervisor_id,reason,
                               starts_on,ends_on)
         VALUES ($1,$2,$3,$3,'Another concern, stated in full here',
                 '2026-03-01','2026-06-01') RETURNING id`, [org, subject, boss])).rows[0].id;

      await scratch.query(readFileSync(join(MIGRATIONS, files.find((n) => n.startsWith('0049'))!), 'utf8'));

      const signed = await scratch.query(
        `SELECT party::text AS party, acknowledged_by, acknowledged_at
           FROM pip_acknowledgement WHERE pip_plan_id = $1`, [plan]);
      expect(signed.rows).toHaveLength(1);
      expect(signed.rows[0].party).toBe('employee');
      expect(signed.rows[0].acknowledged_by).toBe(subject);
      // The moment is the one that was recorded, not the moment of migration.
      expect(new Date(signed.rows[0].acknowledged_at).toISOString())
        .toBe('2026-03-02T09:30:00.000Z');

      const none = await scratch.query(
        `SELECT 1 FROM pip_acknowledgement WHERE pip_plan_id = $1`, [unsigned]);
      expect(none.rowCount).toBe(0);
    } finally {
      await scratch.end();
      await admin.query('DROP DATABASE pre49');
    }
  }, 120_000);
});
