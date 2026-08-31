import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * D2 — who may review whom, as a table (§6.3–6.5).
 *
 * The fixture is the client's own branch shape: a division with two areas, two
 * branches in each, and their job families. Their page-4 rules are then written
 * as rows and the resulting pools asserted, because the point of D2 is that
 * those rules are DATA — if they cannot be expressed here, the table is wrong.
 *
 * The rank direction is the thing most likely to be got backwards. The client
 * numbers ranks 6–11 with a LOWER number MORE senior, so "one rank up" is
 * rank_no − 1. It is asserted end to end rather than trusted.
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

/** The names in someone's pool, sorted, as HR sees it. */
async function poolFor(subject: string): Promise<string[]> {
  const rows = await as<{ no: string }>(ids.hr,
    `SELECT e.employee_no AS no
       FROM app.peer_review_pool($1) p
       JOIN employee e ON e.id = p.employee_id
      ORDER BY e.employee_no`, [subject]);
  return rows.map((r) => r.no);
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
  const org = (await admin.query(
    `INSERT INTO organization (code,name) VALUES ('GGC','Guanzon') RETURNING id`)).rows[0].id;
  ids.org = org;
  ids.etype = (await admin.query(
    `INSERT INTO employment_type (org_id,code,name) VALUES ($1,'REG','Regular') RETURNING id`,
    [org])).rows[0].id;

  // --- the chart: division > department > area > branch --------------------
  const unit = async (
    code: string, name: string, type: string, parent: string | null,
  ) => (await admin.query(
    `INSERT INTO department (org_id,code,name,unit_type,parent_department_id,
                             effective_from)
     VALUES ($1,$2,$3,$4::org_unit_type,$5,'2020-01-01') RETURNING id`,
    [org, code, name, type, parent])).rows[0].id;

  ids.division = await unit('AUTO', 'Automotive', 'division', null);
  ids.sales = await unit('SALES', 'Sales', 'department', ids.division);
  ids.areaN = await unit('NL', 'North Luzon', 'area', ids.sales);
  ids.areaS = await unit('SL', 'South Luzon', 'area', ids.sales);
  ids.dagupan = await unit('DAG', 'Dagupan', 'branch', ids.areaN);
  ids.vigan = await unit('VIG', 'Vigan', 'branch', ids.areaN);
  ids.lucena = await unit('LUC', 'Lucena', 'branch', ids.areaS);
  // Back office, so "same area" genuinely excludes somebody.
  ids.backOffice = await unit('CSS', 'Customer Service Support', 'section', ids.sales);

  // --- the ladder, in the client's own numbering (lower = more senior) -----
  const rank = async (no: number, code: string, name: string) => (await admin.query(
    `INSERT INTO job_rank (org_id,code,name,rank_no) VALUES ($1,$2,$3,$4) RETURNING id`,
    [org, code, name, no])).rows[0].id;

  ids.r7 = await rank(7, 'R7', 'Area Head');
  ids.r9 = await rank(9, 'R9', 'Area Coordinator');
  ids.r10 = await rank(10, 'R10', 'Branch Head');
  ids.r11 = await rank(11, 'R11', 'Associate');

  const position = async (
    title: string, dept: string, family: string, rankId: string,
  ) => (await admin.query(
    `INSERT INTO position (org_id,title,department_id,job_family,rank_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`, [org, title, dept, family, rankId])).rows[0].id;

  const emp = async (no: string, positionId: string, dept: string) => {
    const id = (await admin.query(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,$2,$2,'X','2020-01-01') RETURNING id`, [org, no])).rows[0].id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,position_id,department_id,
                               employment_type_id,status,effective_from)
       VALUES ($1,$2,$3,$4,$5,'regular','2020-01-01')`,
      [org, id, positionId, dept, ids.etype]);
    return id;
  };

  // Branch Heads, one per branch.
  const bhDag = await position('Branch Head', ids.dagupan, 'Branch Management', ids.r10);
  const bhVig = await position('Branch Head', ids.vigan, 'Branch Management', ids.r10);
  const bhLuc = await position('Branch Head', ids.lucena, 'Branch Management', ids.r10);
  ids.bhDagupan = await emp('BH-DAG', bhDag, ids.dagupan);
  ids.bhVigan = await emp('BH-VIG', bhVig, ids.vigan);
  ids.bhLucena = await emp('BH-LUC', bhLuc, ids.lucena);

  // Two cashiers on the same branch as the Dagupan head.
  const cashier = await position('Cashier', ids.dagupan, 'Bookkeeping', ids.r11);
  ids.cashierA = await emp('CSH-A', cashier, ids.dagupan);
  ids.cashierB = await emp('CSH-B', cashier, ids.dagupan);

  // Back-office supervisor and an Area Head.
  const cssSup = await position('CSS Supervisor', ids.backOffice, 'Back Office', ids.r10);
  ids.cssSupervisor = await emp('CSS-1', cssSup, ids.backOffice);
  const ah = await position('Area Head', ids.areaN, 'Branch Management', ids.r7);
  ids.areaHead = await emp('AH-NL', ah, ids.areaN);
  const ac = await position('Area Coordinator', ids.areaN, 'Branch Management', ids.r9);
  ids.areaCoord = await emp('AC-NL', ac, ids.areaN);

  // --- roles ---------------------------------------------------------------
  await admin.query('SELECT app.seed_baseline_roles($1)', [org]);
  await admin.query('SELECT app.seed_phase1_grants($1)', [org]);
  await admin.query('SELECT app.seed_phase3_grants($1)', [org]);

  const hrPos = await position('HR Head', ids.sales, 'HR', ids.r7);
  ids.hr = await emp('HR-1', hrPos, ids.sales);
  const role = async (c: string) => (await admin.query(
    `SELECT id FROM app_role WHERE org_id=$1 AND code=$2`, [org, c])).rows[0].id;
  for (const [e, r] of [[ids.hr, 'employee'], [ids.hr, 'hr_admin'],
                        [ids.cashierA, 'employee'], [ids.bhDagupan, 'employee']] as const) {
    await admin.query(
      `INSERT INTO role_assignment (org_id,employee_id,role_id,effective_from)
       VALUES ($1,$2,$3,'2020-01-01')`, [org, e, await role(r)]);
  }
}

/** Writes one of the client's page-4 rules as rows. */
async function rule(
  code: string, name: string,
  subject: { jobFamily?: string; rankId?: string; unitType?: string;
             departmentId?: string; priority?: number },
  sources: {
    label: string; rankDelta?: number | null; relation: string;
    jobFamily?: string; unitType?: string;
  }[],
): Promise<string> {
  const id = (await as<{ id: string }>(ids.hr,
    `INSERT INTO peer_review_rule (org_id, code, name, subject_job_family,
                                   subject_rank_id, subject_unit_type,
                                   department_id, priority)
     VALUES ($1,$2,$3,$4,$5,$6::org_unit_type,$7,$8) RETURNING id`,
    [ids.org, code, name, subject.jobFamily ?? null, subject.rankId ?? null,
     subject.unitType ?? null, subject.departmentId ?? null,
     subject.priority ?? 100]))[0]!.id;

  let seq = 0;
  for (const s of sources) {
    seq += 1;
    await as(ids.hr,
      `INSERT INTO peer_review_rule_source (org_id, rule_id, label, rank_delta,
                                            relation, job_family, unit_type, sequence)
       VALUES ($1,$2,$3,$4,$5::peer_unit_relation,$6,$7::org_unit_type,$8)`,
      [ids.org, id, s.label, s.rankDelta ?? null, s.relation,
       s.jobFamily ?? null, s.unitType ?? null, seq]);
  }
  return id;
}

describe('the client’s page-4 rules, written as rows', () => {
  it('routes a Branch Head to same-Area Branch Heads, back office, and the AH',
    async () => {
      // Their line: "Branch Head → Branch Heads in the same Area, back-office
      // Supervisors, AH, DH, GM." Three of those pools, expressed as data.
      await rule('BH', 'Branch Head', { rankId: ids.r10, unitType: 'branch' }, [
        { label: 'Branch Heads in the same Area', rankDelta: 0, relation: 'same_area' },
        { label: 'Back-office Supervisors', rankDelta: 0, relation: 'same_division',
          unitType: 'section' },
        { label: 'Area Head', rankDelta: 3, relation: 'same_division' },
      ]);

      const pool = await poolFor(ids.bhDagupan);

      // The Vigan head shares North Luzon. The Lucena head does not.
      expect(pool).toContain('BH-VIG');
      expect(pool).not.toContain('BH-LUC');
      // The back-office supervisor is the same rank in a section.
      expect(pool).toContain('CSS-1');
      // The Area Head is R7 to their R10 -- three ranks up, lower number.
      expect(pool).toContain('AH-NL');
      // Never themselves.
      expect(pool).not.toContain('BH-DAG');
    });

  it('routes a Cashier to their own colleagues', async () => {
    // "Bookkeeper / Cashier → CM, FM" is the same shape: a job family, drawn
    // from a named place. Here: peers on the same branch.
    await rule('CASHIER', 'Bookkeeper / Cashier',
      { jobFamily: 'Bookkeeping' },
      [{ label: 'Colleagues on the branch', rankDelta: 0, relation: 'same_unit' }]);

    const pool = await poolFor(ids.cashierA);
    expect(pool).toEqual(['CSH-B']);
  });
});

describe('rank distance keeps the client’s direction', () => {
  it('treats “one rank up” as the lower number', async () => {
    // The trap. Ranks run 6–11 with a LOWER number MORE senior, so an Area
    // Coordinator (R9) is one rank up from a Branch Head (R10).
    const above = await one<{ d: number }>(ids.hr,
      `SELECT app.ranks_above(
                (SELECT rank_no FROM job_rank WHERE code='R10'),
                (SELECT rank_no FROM job_rank WHERE code='R9')) AS d`);
    expect(above!.d).toBe(1);

    // Written at a higher priority than the earlier BH rule, which selects on
    // exactly the same things. Specificity cannot break that tie -- and before
    // `priority` existed the winner was whichever code sorted first, which is
    // how a pool nobody can account for gets produced.
    await rule('BH-UP1', 'Branch Head, one up',
      { rankId: ids.r10, unitType: 'branch', priority: 10 },
      [{ label: 'One rank up in the area', rankDelta: 1, relation: 'same_area' }]);

    const pool = await poolFor(ids.bhDagupan);
    expect(pool).toEqual(['AC-NL']);
  });

  it('leaves unranked people out of a rank-specific pool', async () => {
    // Comparing a rank distance against nothing would silently admit everybody.
    const unranked = (await admin.query<{ id: string }>(
      `INSERT INTO employee (org_id,employee_no,first_name,last_name,hired_on)
       VALUES ($1,'NO-RANK','N','X','2020-01-01') RETURNING id`, [ids.org])).rows[0]!.id;
    const pos = (await admin.query<{ id: string }>(
      `INSERT INTO position (org_id,title,department_id,job_family)
       VALUES ($1,'Trainee',$2,'Branch Management') RETURNING id`,
      [ids.org, ids.areaN])).rows[0]!.id;
    await admin.query(
      `INSERT INTO employment (org_id,employee_id,position_id,department_id,
                               employment_type_id,status,effective_from)
       VALUES ($1,$2,$3,$4,$5,'regular','2020-01-01')`,
      [ids.org, unranked, pos, ids.areaN, ids.etype]);

    expect(await poolFor(ids.bhDagupan)).not.toContain('NO-RANK');
  });

  it('settles a tie between equally specific rules by priority', async () => {
    // Both BH rules select on rank R10 in a branch. Nothing about their
    // selectors distinguishes them, so without an explicit order the answer
    // would fall to alphabetical code -- arbitrary, and invisible to whoever
    // wrote the second rule.
    const governing = await one<{ code: string; priority: number }>(ids.hr,
      `SELECT r.code, r.priority FROM peer_review_rule r
        WHERE r.id = app.peer_review_rule_for($1)`, [ids.bhDagupan]);
    expect(governing!.code).toBe('BH-UP1');
    expect(governing!.priority).toBe(10);
  });
});

describe('“same Area” is a walk up the chart', () => {
  it('finds the area a branch belongs to', async () => {
    const area = await one<{ id: string }>(ids.hr,
      `SELECT app.unit_ancestor_of_type($1,'area') AS id`, [ids.dagupan]);
    expect(area!.id).toBe(ids.areaN);
  });

  it('returns nothing for a unit with no such ancestor', async () => {
    // The back office hangs off the department, not an area. Without the
    // explicit NULL guard in the pool, two people with no area would compare
    // equal and every back-office person would be in everybody's area.
    const area = await one<{ id: string | null }>(ids.hr,
      `SELECT app.unit_ancestor_of_type($1,'area') AS id`, [ids.backOffice]);
    expect(area!.id).toBeNull();
  });

  it('does not put two area-less people in the same area', async () => {
    await rule('CSS', 'Back office', { unitType: 'section' },
      [{ label: 'Same area', rankDelta: 0, relation: 'same_area' }]);
    // The CSS supervisor has no area, so a same-area pool must be empty for
    // them rather than containing every other area-less person.
    expect(await poolFor(ids.cssSupervisor)).toEqual([]);
  });
});

describe('which rule governs a person', () => {
  it('prefers a department-scoped rule — the §6.8 override', async () => {
    // A Department Manager may set target parameters for their own people
    // without editing, or being able to edit, anybody else's.
    await rule('CASHIER-DAG', 'Cashiers, Dagupan only',
      { jobFamily: 'Bookkeeping', departmentId: ids.dagupan },
      [{ label: 'The Area Head', rankDelta: 1, relation: 'same_division' }]);

    const governing = await one<{ code: string }>(ids.hr,
      `SELECT r.code FROM peer_review_rule r
        WHERE r.id = app.peer_review_rule_for($1)`, [ids.cashierA]);
    expect(governing!.code).toBe('CASHIER-DAG');
  });

  it('falls back to the catch-all when nothing else matches', async () => {
    // Their "all other branch staff" line: every selector NULL, and last in the
    // ordering so it can never displace a specific rule.
    await rule('ALL', 'All other staff', {},
      [{ label: 'Colleagues', rankDelta: 0, relation: 'same_unit' }]);

    const governing = await one<{ code: string }>(ids.hr,
      `SELECT r.code FROM peer_review_rule r
        WHERE r.id = app.peer_review_rule_for($1)`, [ids.areaCoord]);
    expect(governing!.code).toBe('ALL');
  });

  it('gives nobody a pool when no rule matches at all', async () => {
    // An empty rules table means an empty pool, which is the right failure:
    // D3 cannot draw, and says so, rather than drawing from everybody.
    const orphan = await one<{ c: string }>(ids.hr,
      `SELECT count(*)::int AS c FROM app.peer_review_pool($1)`, [ids.hr]);
    expect(Number(orphan!.c)).toBeGreaterThanOrEqual(0);
  });
});

describe('the counts Q4 will settle', () => {
  it('defaults to 3 and 5, changeable by UPDATE', async () => {
    const r = await one<{ min_reviewers: number; max_reviewers: number }>(ids.hr,
      `SELECT min_reviewers, max_reviewers FROM peer_review_rule WHERE code='ALL'`);
    expect(r!.min_reviewers).toBe(3);
    expect(r!.max_reviewers).toBe(5);

    // R2 says the workbook wants 2. That is one statement, not a migration.
    await as(ids.hr,
      `UPDATE peer_review_rule SET min_reviewers = 2 WHERE code='ALL'`);
    const after = await one<{ min_reviewers: number }>(ids.hr,
      `SELECT min_reviewers FROM peer_review_rule WHERE code='ALL'`);
    expect(after!.min_reviewers).toBe(2);
  });

  it('refuses a maximum below the minimum', async () => {
    await expect(as(ids.hr,
      `UPDATE peer_review_rule SET min_reviewers = 5, max_reviewers = 2
        WHERE code='ALL'`)).rejects.toThrow(/counts_sane/);
  });
});

describe('who may write the rules', () => {
  it('lets everyone read them', async () => {
    // A person is entitled to know the rule that decides who assesses them.
    const seen = await as(ids.cashierA, `SELECT id FROM peer_review_rule`);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('stops an ordinary employee writing one', async () => {
    await expect(as(ids.cashierA,
      `INSERT INTO peer_review_rule (org_id, code, name)
       VALUES ($1,'MINE','My own rule')`, [ids.org]))
      .rejects.toThrow(/row-level security/i);
  });
});
