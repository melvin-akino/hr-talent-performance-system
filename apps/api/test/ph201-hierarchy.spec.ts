import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ph201ImportService } from '../src/import/ph201-import.service';
import { EmployeeImportService } from '../src/import/employee-import.service';

/**
 * A1b / A2b — a real staff file lands with its levels and its ladder set.
 *
 * Everything Phase A built (the holdings→branch levels in 0027, the rank ladder
 * in 0028) worked only because the pilot CSV was hand-built to populate it. A
 * file straight out of the client's HR system carries Division, Area, Branch and
 * Rank columns, and until now the importer read none of them: the org chart
 * landed flat and everybody landed off the ladder. That gap would not have
 * surfaced until the day they handed over their real 201 file.
 */

const MIGRATIONS = join(__dirname, '../../../db/migrations');

let container: StartedPostgreSqlContainer;
let admin: Pool;
let service: Ph201ImportService;

/** The importer writes through withAdminContext; this stands in for it. */
function fakeDb(pool: Pool) {
  return {
    withAdminContext: async <T>(_id: string, fn: (c: unknown) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

const HEADER = [
  'Employee_ID', 'Last_Name', 'First_Name', 'Work_Email', 'Date_Hired',
  'Division', 'Department', 'Section', 'Area', 'Branch',
  'Position', 'Rank', 'Rank_Title', 'Supervisor_ID', 'Employment_Status',
].join(',');

function row(o: {
  id: string; last: string; first: string; division?: string; dept?: string;
  section?: string; area?: string; branch?: string; position?: string;
  rank?: string; rankTitle?: string; supervisor?: string;
}): string {
  return [
    o.id, o.last, o.first, `${o.first.toLowerCase()}@acme.test`, '2024-01-01',
    o.division ?? '', o.dept ?? 'Operations', o.section ?? '', o.area ?? '',
    o.branch ?? '', o.position ?? 'Specialist', o.rank ?? '', o.rankTitle ?? '',
    o.supervisor ?? '', 'Regular',
  ].join(',');
}

const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

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
  await admin.query(`INSERT INTO organization (code,name) VALUES ('ACME','Acme')`);

  const db = fakeDb(admin) as never;
  service = new Ph201ImportService(db, new EmployeeImportService(db));
}, 240_000);

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

describe('org levels from the file (A1b)', () => {
  it('builds the parent chain and puts the person in the deepest unit', async () => {
    const report = await service.import(csv(
      row({ id: 'H-1', last: 'Reyes', first: 'Ana', division: 'Automotive',
            dept: 'Sales', area: 'North Luzon', branch: 'Dagupan' }),
    ), 'ACME', { dryRun: true });

    expect(report.errors).toEqual([]);
    const byCode = new Map(report.departmentsCreated.map((d) => [d.code, d]));

    expect(byCode.get('AUTOMOTI')?.unitType).toBe('division');
    expect(byCode.get('AUTOMOTI')?.parentCode).toBeNull();
    expect(byCode.get('SALES')?.unitType).toBe('department');
    expect(byCode.get('SALES')?.parentCode).toBe('AUTOMOTI');
    expect(byCode.get('NL')?.unitType).toBe('area');
    expect(byCode.get('NL')?.parentCode).toBe('SALES');
    expect(byCode.get('DAGUPAN')?.unitType).toBe('branch');
    expect(byCode.get('DAGUPAN')?.parentCode).toBe('NL');
  });

  it('still imports a file that names no levels at all', async () => {
    // The existing shape has to keep working: most 201 files carry only
    // Department, and those must import exactly as they did before.
    const report = await service.import(csv(
      row({ id: 'H-2', last: 'Santos', first: 'Ben', dept: 'Finance' }),
    ), 'ACME', { dryRun: true });

    expect(report.errors).toEqual([]);
    expect(report.departmentsCreated).toEqual([
      { code: 'FIN', name: 'Finance', unitType: 'department', parentCode: null },
    ]);
  });

  it('refuses a row naming both a section and an area', async () => {
    // They share depth 5 but differ in KIND — back office and branch network.
    // Guessing would put the person under the wrong head for peer review.
    const report = await service.import(csv(
      row({ id: 'H-3', last: 'Cruz', first: 'Cely', dept: 'HCM',
            section: 'Hiring and Selection', area: 'North Luzon' }),
    ), 'ACME', { dryRun: true });

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.message).toMatch(/both a section and an area/);
  });

  it('refuses the same unit hanging under two different parents', async () => {
    // One node cannot sit in two places on the tree, and picking either
    // silently would misroute everyone beneath it.
    const report = await service.import(csv(
      row({ id: 'H-4', last: 'A', first: 'Ana', division: 'Automotive',
            dept: 'Sales' }),
      row({ id: 'H-5', last: 'B', first: 'Ben', division: 'Realty',
            dept: 'Sales' }),
    ), 'ACME', { dryRun: true });

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.message).toMatch(/appears under/);
  });

  it('writes the tree, and a re-import does not reshape it', async () => {
    const file = csv(
      row({ id: 'H-10', last: 'Head', first: 'Hilda', division: 'Automotive',
            dept: 'Motors' }),
      row({ id: 'H-11', last: 'Staff', first: 'Sam', division: 'Automotive',
            dept: 'Motors', area: 'Ilocos', branch: 'Vigan', supervisor: 'H-10' }),
    );
    const written = await service.import(file, 'ACME');
    expect(written.errors).toEqual([]);

    const tree = await admin.query(
      `SELECT d.code, d.unit_type::text AS unit_type, p.code AS parent
         FROM department d
         LEFT JOIN department p ON p.id = d.parent_department_id
        WHERE d.code IN ('AUTOMOTI','MOTORS','ILOCOS','VIGAN')
        ORDER BY d.code`);
    expect(tree.rows).toEqual([
      { code: 'AUTOMOTI', unit_type: 'division', parent: null },
      { code: 'ILOCOS', unit_type: 'area', parent: 'MOTORS' },
      { code: 'MOTORS', unit_type: 'department', parent: 'AUTOMOTI' },
      { code: 'VIGAN', unit_type: 'branch', parent: 'ILOCOS' },
    ]);

    // Somebody detaches the unit by hand afterwards. A re-import must not
    // silently reattach it -- and must say that it did not, so the difference
    // is visible rather than merely absent.
    await admin.query(
      `UPDATE department SET parent_department_id = NULL WHERE code = 'ILOCOS'`);
    const again = await service.import(file, 'ACME');

    const after = await admin.query(
      `SELECT parent_department_id FROM department WHERE code = 'ILOCOS'`);
    expect(after.rows[0]!.parent_department_id).toBeNull();

    expect(again.unitDifferences).toContainEqual({
      code: 'ILOCOS', name: 'Ilocos', field: 'parent',
      stored: '(none)', inFile: 'MOTORS',
    });

    // Put it back for the assertion below.
    await admin.query(
      `UPDATE department SET parent_department_id =
         (SELECT id FROM department WHERE code = 'MOTORS')
        WHERE code = 'ILOCOS'`);
  });

  it('places the employee in the branch, not the department', async () => {
    // This is what makes an Area Head's subtree grant reach them.
    const emp = await admin.query(
      `SELECT d.code FROM employee e
         JOIN employment em ON em.employee_id = e.id AND em.effective_to IS NULL
         JOIN department d ON d.id = em.department_id
        WHERE e.employee_no = 'H-11'`);
    expect(emp.rows[0]!.code).toBe('VIGAN');
  });
});

describe('the rank ladder from the file (A2b)', () => {
  it('creates ranks and puts positions on them', async () => {
    const report = await service.import(csv(
      row({ id: 'R-1', last: 'Uno', first: 'Ursula', dept: 'Retail',
            position: 'Department Manager', rank: '6', rankTitle: 'Dept Manager' }),
      row({ id: 'R-2', last: 'Dos', first: 'Dina', dept: 'Retail',
            position: 'Team Leader', rank: '11', rankTitle: 'Team Leader',
            supervisor: 'R-1' }),
    ), 'ACME');

    expect(report.errors).toEqual([]);
    expect(report.ranksCreated).toEqual([
      { code: 'R6', name: 'Dept Manager', rankNo: 6 },
      { code: 'R11', name: 'Team Leader', rankNo: 11 },
    ]);
    expect(report.positionsRanked).toBe(2);

    const placed = await admin.query(
      `SELECT p.title, r.rank_no FROM position p
         JOIN job_rank r ON r.id = p.rank_id
        WHERE p.title IN ('Department Manager','Team Leader')
        ORDER BY r.rank_no`);
    expect(placed.rows).toEqual([
      { title: 'Department Manager', rank_no: 6 },
      { title: 'Team Leader', rank_no: 11 },
    ]);
  });

  it('keeps the client direction: a lower number is more senior', async () => {
    // The one thing about this ladder that is easy to get backwards, so it is
    // asserted through the imported data rather than trusted from 0028.
    const above = await admin.query(
      `SELECT app.ranks_above(
                (SELECT rank_no FROM job_rank WHERE code = 'R11'),
                (SELECT rank_no FROM job_rank WHERE code = 'R6')) AS d`);
    expect(Number(above.rows[0]!.d)).toBe(5);
  });

  it('names a rank the file does not title', async () => {
    const report = await service.import(csv(
      row({ id: 'R-5', last: 'Nine', first: 'Nina', dept: 'Retail',
            position: 'Area Coordinator', rank: '9' }),
    ), 'ACME', { dryRun: true });
    expect(report.ranksCreated).toEqual([
      { code: 'R9', name: 'Rank 9', rankNo: 9 },
    ]);
  });

  it('rejects a text grade in the rank column instead of guessing', async () => {
    // 'rank' used to alias job_level. Failing visibly is the right behaviour:
    // filing "Senior" as a rank number would misroute peer review silently.
    const report = await service.import(csv(
      row({ id: 'R-9', last: 'Tex', first: 'Tara', dept: 'Retail', rank: 'Senior' }),
    ), 'ACME', { dryRun: true });

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.message).toMatch(/rename it to job_level/);
  });

  it('refuses one position carrying two different ranks', async () => {
    const report = await service.import(csv(
      row({ id: 'R-20', last: 'A', first: 'Ana', dept: 'Retail',
            position: 'Cashier', rank: '10' }),
      row({ id: 'R-21', last: 'B', first: 'Ben', dept: 'Retail',
            position: 'Cashier', rank: '11' }),
    ), 'ACME', { dryRun: true });

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.message).toMatch(/One position, one rank/);
  });

  it('leaves ranks alone when the file has no rank column', async () => {
    const noRank = [
      'Employee_ID,Last_Name,First_Name,Work_Email,Date_Hired,Department,'
      + 'Position,Supervisor_ID,Employment_Status',
      'R-30,Plain,Pia,pia@acme.test,2024-01-01,Logistics,Clerk,,Regular',
    ].join('\n');

    const report = await service.import(noRank, 'ACME', { dryRun: true });
    expect(report.errors).toEqual([]);
    expect(report.ranksCreated).toEqual([]);
    expect(report.positionsRanked).toBe(0);
  });

  it('a dry run leaves no ranks behind', async () => {
    await service.import(csv(
      row({ id: 'R-40', last: 'Ghost', first: 'Gina', dept: 'Retail',
            position: 'Phantom', rank: '7', rankTitle: 'Should Not Exist' }),
    ), 'ACME', { dryRun: true });

    const found = await admin.query(
      `SELECT 1 FROM job_rank WHERE code = 'R7'`);
    expect(found.rowCount).toBe(0);
  });
});
