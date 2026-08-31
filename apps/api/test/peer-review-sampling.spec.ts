import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * D3 — drawing reviewers, and the record of who was drawn and why (§6.2, §6.6).
 *
 * The properties that matter:
 *
 *   1. somebody who declined is never drawn as their own replacement — the
 *      failure an unconstrained random draw produces every time;
 *   2. a decline and its replacement happen together, so a panel is never
 *      quietly one short;
 *   3. the subject cannot see who was asked to assess them.
 *
 * The pool is exhausted deliberately in one test, because "fewer than asked" is
 * a real outcome and must not read as an error.
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

/** Everyone asked so far, by employee number. */
const askedFor = async (subject: string) => (await as<{ no: string; state: string }>(
  ids.hr,
  `SELECT e.employee_no AS no, s.state::text AS state
     FROM peer_review_solicitation s
     JOIN employee e ON e.id = s.reviewer_employee_id
    WHERE s.review_cycle_id = $1 AND s.subject_employee_id = $2
    ORDER BY e.employee_no`, [ids.cycle, subject])).map((r) => `${r.no}:${r.state}`);

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

  ids.division = (await admin.query(
    `INSERT INTO department (org_id,code,name,unit_type,effective_from)
     VALUES ($1,'AUTO','Automotive','division','2020-01-01') RETURNING id`,
    [org])).rows[0].id;
  ids.branch = (await admin.query(
    `INSERT INTO department (org_id,code,name,unit_type,parent_department_id,
                             effective_from)
     VALUES ($1,'DAG','Dagupan','branch',$2,'2020-01-01') RETURNING id`,
    [org, ids.division])).rows[0].id;
  ids.smallBranch = (await admin.query(
    `INSERT INTO department (org_id,code,name,unit_type,parent_department_id,
                             effective_from)
     VALUES ($1,'VIG','Vigan','branch',$2,'2020-01-01') RETURNING id`,
    [org, ids.division])).rows[0].id;

  ids.rank = (await admin.query(
    `INSERT INTO job_rank (org_id,code,name,rank_no) VALUES ($1,'R11','Associate',11)
     RETURNING id`, [org])).rows[0].id;

  const position = async (title: string, dept: string) => (await admin.query(
    `INSERT INTO position (org_id,title,department_id,job_family,rank_id)
     VALUES ($1,$2,$3,'Branch',$4) RETURNING id`,
    [org, title, dept, ids.rank])).rows[0].id;

  const emp = async (no: string, dept: string) => {
    const pos = await position(`Associate ${no}`, dept);
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,position_id,department_id,
                               employment_type_id,status,effective_from)
       VALUES ($1,$2,$3,$4,$5,'regular','2020-01-01')`,
      [org, id, pos, dept, ids.etype]);
    return id;
  };

  // Six on the main branch: the subject plus five possible reviewers.
  ids.subject = await emp('SUBJ', ids.branch);
  ids.p1 = await emp('P1', ids.branch);
  ids.p2 = await emp('P2', ids.branch);
  ids.p3 = await emp('P3', ids.branch);
  ids.p4 = await emp('P4', ids.branch);
  ids.p5 = await emp('P5', ids.branch);

  // A branch with only two people, so the pool can be exhausted on purpose.
  ids.lonely = await emp('LONE', ids.smallBranch);
  ids.lonelyPeer = await emp('LONE-P', ids.smallBranch);

  ids.hr = await emp('HR', ids.division);

  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [org]);
  await admin.query('SELECT app.seed_phase3_grants($1)', [org]);
  await admin.query('SELECT app.seed_line_role_grants($1)', [org]);
  await admin.query('SELECT app.seed_dept_head_review_grants($1)', [org]);

  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  const rEmp = await role('employee');
  for (const e of [ids.subject, ids.p1, ids.p2, ids.p3, ids.p4, ids.p5,
                   ids.lonely, ids.lonelyPeer, ids.hr]) {
    await admin.query(
      `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
       VALUES ($1,$2,$3,'2020-01-01')`, [org, e, rEmp]);
  }
  await admin.query(
    `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
     VALUES ($1,$2,$3,'2020-01-01')`, [org, ids.hr, await role('hr_admin')]);

  ids.cycle = (await admin.query(
    `INSERT INTO review_cycle (org_id,name,opens_on,closes_on,state)
     VALUES ($1,'FY2026','2026-01-01','2026-12-31','open') RETURNING id`,
    [org])).rows[0].id;

  // One catch-all rule: colleagues on the same unit, a panel of three.
  const rule = (await admin.query(
    `INSERT INTO peer_review_rule (org_id,code,name,min_reviewers,max_reviewers)
     VALUES ($1,'ALL','All staff',3,5) RETURNING id`, [org])).rows[0].id;
  await admin.query(
    `INSERT INTO peer_review_rule_source (org_id,rule_id,label,rank_delta,relation)
     VALUES ($1,$2,'Colleagues on the branch',0,'same_unit')`, [org, rule]);
}

describe('drawing a panel', () => {
  it('draws the rule’s minimum, from the right pool', async () => {
    const drawn = await as<{ reviewer_employee_id: string; source_label: string }>(
      ids.hr,
      `SELECT * FROM app.draw_peer_reviewers($1, $2, NULL, CURRENT_DATE, 0.42)`,
      [ids.cycle, ids.subject]);

    expect(drawn).toHaveLength(3);
    for (const d of drawn) {
      expect(d.source_label).toBe('Colleagues on the branch');
      expect(d.reviewer_employee_id).not.toBe(ids.subject);
    }
  });

  it('records who drew them and when', async () => {
    // The audit trail's other half: not merely that somebody was drawn, but
    // that a named person ran the draw.
    const row = await one<{ drawn_by: string; drawn_at: string; state: string }>(
      ids.hr,
      `SELECT drawn_by, drawn_at::text, state::text AS state
         FROM peer_review_solicitation
        WHERE review_cycle_id = $1 AND subject_employee_id = $2 LIMIT 1`,
      [ids.cycle, ids.subject]);
    expect(row!.drawn_by).toBe(ids.hr);
    expect(row!.drawn_at).toBeTruthy();
    expect(row!.state).toBe('drawn');
  });

  it('never asks the same person twice', async () => {
    // A second draw must reach for people not yet asked.
    const before = await askedFor(ids.subject);
    await as(ids.hr,
      `SELECT * FROM app.draw_peer_reviewers($1, $2, 1::smallint, CURRENT_DATE, 0.7)`,
      [ids.cycle, ids.subject]);
    const after = await askedFor(ids.subject);

    expect(after).toHaveLength(before.length + 1);
    expect(new Set(after.map((a) => a.split(':')[0])).size).toBe(after.length);
  });

  it('refuses when no rule covers the person', async () => {
    // Distinct from an empty pool, and it has to be: "nobody is eligible" and
    // "nobody decided who is eligible" are different problems with different
    // fixes, and silence would make them look the same.
    await as(ids.hr, `UPDATE peer_review_rule SET is_active = FALSE`);

    await expect(as(ids.hr,
      `SELECT * FROM app.draw_peer_reviewers($1, $2, 1::smallint)`,
      [ids.cycle, ids.subject])).rejects.toThrow(/No peer-review rule covers/);

    await as(ids.hr, `UPDATE peer_review_rule SET is_active = TRUE`);
  });
});

describe('the six-month interaction gate', () => {
  it('declines and draws a replacement in one step', async () => {
    // Their §6.6: "No, thank them, draw a replacement". Doing the two apart
    // leaves a window where the panel is quietly one short.
    const outstanding = await one<{ id: string; reviewer: string }>(ids.hr,
      `SELECT id, reviewer_employee_id AS reviewer FROM peer_review_solicitation
        WHERE review_cycle_id = $1 AND subject_employee_id = $2 AND state = 'drawn'
        LIMIT 1`, [ids.cycle, ids.subject]);

    const replacement = await as<{ reviewer_employee_id: string }>(ids.hr,
      `SELECT * FROM app.decline_and_replace($1,'no_interaction',NULL,
                                             CURRENT_DATE, 0.13)`,
      [outstanding!.id]);

    expect(replacement).toHaveLength(1);
    // The whole point: the person who just said no is not their own
    // replacement, which an unconstrained random draw would do freely.
    expect(replacement[0]!.reviewer_employee_id).not.toBe(outstanding!.reviewer);

    const declined = await one<{ state: string; reason: string; responded: string }>(
      ids.hr,
      `SELECT state::text AS state, decline_reason::text AS reason,
              responded_at::text AS responded
         FROM peer_review_solicitation WHERE id = $1`, [outstanding!.id]);
    expect(declined!.state).toBe('declined');
    expect(declined!.reason).toBe('no_interaction');
    expect(declined!.responded).toBeTruthy();
  });

  it('links the replacement to what it replaced', async () => {
    const chain = await one<{ c: string }>(ids.hr,
      `SELECT count(*)::int AS c FROM peer_review_solicitation
        WHERE replaces_id IS NOT NULL`);
    expect(Number(chain!.c)).toBe(1);
  });

  it('refuses a decline with no reason', async () => {
    const outstanding = await one<{ id: string }>(ids.hr,
      `SELECT id FROM peer_review_solicitation
        WHERE review_cycle_id = $1 AND state = 'drawn' LIMIT 1`, [ids.cycle]);
    await expect(as(ids.hr,
      `UPDATE peer_review_solicitation SET state='declined' WHERE id=$1`,
      [outstanding!.id])).rejects.toThrow(/must record why/);
  });

  it('will not let an answer be changed', async () => {
    // A reviewer who said they had no interaction must not be talked back into
    // it, which is the one thing the gate exists to prevent.
    const declined = await one<{ id: string }>(ids.hr,
      `SELECT id FROM peer_review_solicitation WHERE state = 'declined' LIMIT 1`);
    await expect(as(ids.hr,
      `UPDATE peer_review_solicitation SET state='accepted' WHERE id=$1`,
      [declined!.id])).rejects.toThrow(/cannot change state/);
  });

  it('keeps a reason off anything that is not a decline', async () => {
    const outstanding = await one<{ id: string }>(ids.hr,
      `SELECT id FROM peer_review_solicitation WHERE state = 'drawn' LIMIT 1`);
    await expect(as(ids.hr,
      `UPDATE peer_review_solicitation
          SET state='accepted', decline_reason='unavailable' WHERE id=$1`,
      [outstanding!.id])).rejects.toThrow(/reason_only_on_decline/);
  });
});

describe('when the pool runs out', () => {
  it('returns fewer than asked, without pretending it is an error', async () => {
    // One colleague, a panel of three requested. A short panel is a fact about
    // the rule; D4 is where the minimum is enforced.
    const drawn = await as<{ reviewer_employee_id: string }>(ids.hr,
      `SELECT * FROM app.draw_peer_reviewers($1, $2, 3::smallint, CURRENT_DATE, 0.5)`,
      [ids.cycle, ids.lonely]);

    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.reviewer_employee_id).toBe(ids.lonelyPeer);
  });

  it('draws nobody at all once everyone has been asked', async () => {
    const again = await as(ids.hr,
      `SELECT * FROM app.draw_peer_reviewers($1, $2, 3::smallint, CURRENT_DATE, 0.9)`,
      [ids.cycle, ids.lonely]);
    expect(again).toEqual([]);
  });

  it('shows the shortfall in the panel status', async () => {
    const status = await one<{
      asked: number; accepted: number; outstanding: number;
      declined: number; minimum: number;
    }>(ids.hr, `SELECT * FROM app.peer_panel_status($1,$2)`, [ids.cycle, ids.lonely]);

    expect(status!.asked).toBe(1);
    expect(status!.minimum).toBe(3);
    // The number HCM is watching: one asked against a minimum of three.
    expect(status!.accepted).toBeLessThan(status!.minimum);
  });
});

describe('who can see an invitation', () => {
  it('lets a reviewer see their own', async () => {
    const mine = await as(ids.p1,
      `SELECT id FROM peer_review_solicitation
        WHERE reviewer_employee_id = $1`, [ids.p1]);
    expect(mine.length).toBeGreaterThan(0);
  });

  it('keeps the subject from seeing who was asked about them', async () => {
    // Knowing who is about to assess you, before they have written anything, is
    // the part of peer review most likely to change what gets written. Q5 will
    // decide what a subject may see afterwards; until then the narrow answer is
    // the safe one, because a link disclosed cannot be undisclosed.
    const theirs = await as(ids.subject,
      `SELECT id FROM peer_review_solicitation WHERE subject_employee_id = $1`,
      [ids.subject]);
    expect(theirs).toEqual([]);
  });

  it('lets HR see the whole panel', async () => {
    const all = await as(ids.hr,
      `SELECT id FROM peer_review_solicitation WHERE subject_employee_id = $1`,
      [ids.subject]);
    expect(all.length).toBeGreaterThan(0);
  });

  it('keeps an unrelated colleague out', async () => {
    const nosy = await as(ids.p5,
      `SELECT id FROM peer_review_solicitation WHERE subject_employee_id = $1`,
      [ids.lonely]);
    expect(nosy).toEqual([]);
  });
});

/**
 * Runs `setseed` and then the query as SEPARATE statements in one transaction,
 * which is how app.draw_peer_reviewers does it.
 *
 * Putting setseed() in the target list of the same SELECT does not work: its
 * evaluation is not ordered against the random() in the ORDER BY, so the seed
 * may be applied after the values it was meant to determine. That was the first
 * version of this test, and it failed for that reason rather than because
 * anything in the migration was wrong.
 */
async function seededOrdering(seed: number, subject: string): Promise<string[]> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_employee_id', $1, true)`,
      [ids.hr]);
    await client.query('SELECT setseed($1)', [seed]);
    const res = await client.query<{ id: string }>(
      `SELECT employee_id AS id FROM app.peer_review_pool($1) ORDER BY random()`,
      [subject]);
    await client.query('COMMIT');
    return res.rows.map((r) => r.id);
  } finally {
    client.release();
  }
}

describe('a draw can be reproduced', () => {
  it('orders the same candidate set the same way for the same seed', async () => {
    // "Show me how this panel was picked" is a fair question from somebody
    // disputing their score, and setseed() is what makes it answerable.
    //
    // The claim is precisely that a seed fixes the ordering of a GIVEN
    // candidate set. It does not make two different subjects draw the same
    // people: each is excluded from their own pool, so their sets differ.
    const first = await seededOrdering(0.25, ids.subject);
    const second = await seededOrdering(0.25, ids.subject);
    expect(first.length).toBeGreaterThan(1);
    expect(first).toEqual(second);
  });

  it('orders it differently for a different seed', async () => {
    // Otherwise the seed would be decorative and every draw would pick the same
    // people, which is the opposite of drawing at random.
    const a = await seededOrdering(0.1, ids.subject);
    const b = await seededOrdering(0.9, ids.subject);
    expect(a).toHaveLength(b.length);
    expect(a).not.toEqual(b);
  });
});
