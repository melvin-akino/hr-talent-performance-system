import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ph201ImportService } from '../src/import/ph201-import.service';
import { EmployeeImportService } from '../src/import/employee-import.service';

/**
 * Philippine 201 file import.
 *
 * The important assertions are about what is DELIBERATELY not stored: the
 * statutory identifiers and personal data a performance system has no use for.
 * A regression that quietly starts importing TIN or SSS numbers would be a
 * data-protection problem, not a feature.
 */

const MIGRATIONS = join(__dirname, '../../../db/migrations');

let container: StartedPostgreSqlContainer;
let admin: Pool;
let service: Ph201ImportService;

function fakeDb(pool: Pool) {
  return {
    async withAdminContext<T>(_id: string, fn: (c: never) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(client as never);
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

// Mirrors the real file, including its trailing comma on data rows.
const HEADER =
  'Employee_ID,Last_Name,First_Name,Middle_Name,Birthdate,Gender,Civil_Status,Address,' +
  'Contact_Number,Email,Work_Email,Date_Hired,Department,Position,Supervisor_ID,' +
  'Employment_Status,TIN,SSS_No,PhilHealth_No,PagIBIG_No,NBI_Clearance_Status,PEME_Status,' +
  'Contract_Status,Emergency_Contact_Name,Emergency_Contact_Relationship,' +
  'Emergency_Contact_Number,Dependents_Count,Dependent_1_Name,Dependent_1_Birthdate,' +
  'Dependent_2_Name,Dependent_2_Birthdate,Annual_Sick_Leave_Allocation,Sick_Leave_Used,' +
  'Annual_Vacation_Leave_Allocation,Vacation_Leave_Used,201_Completeness';

function row(o: {
  id: string; last: string; first: string; email?: string; hired?: string;
  dept?: string; position?: string; supervisor?: string; status?: string;
}): string {
  return [
    o.id, o.last, o.first, 'M', '1990-01-01', 'Male', 'Single', '"1 Main St, Manila"',
    '9171234567', `${o.first.toLowerCase()}@personal.test`, o.email ?? '',
    o.hired ?? '2024-01-01', o.dept ?? 'Operations', o.position ?? 'Specialist',
    o.supervisor ?? '', o.status ?? 'Regular',
    '123-456-789-000', '34-1234567-8', '120345678901', '121234567890',
    'Submitted', 'Passed', 'Signed', 'Contact', 'Father', '9171112222',
    '0', '', '', '', '', '15', '3', '15', '5', 'Complete',
  ].join(',') + ',';  // trailing comma, exactly as exported
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

describe('department code derivation', () => {
  it('uses known Philippine department names', () => {
    expect(Ph201ImportService.departmentCode('Human Resources')).toBe('HR');
    expect(Ph201ImportService.departmentCode('Operations')).toBe('OPS');
    expect(Ph201ImportService.departmentCode('Information Technology')).toBe('IT');
  });

  it('derives initials for unknown multi-word names', () => {
    expect(Ph201ImportService.departmentCode('Business Development')).toBe('BD');
    // Filler words are dropped so "Research and Development" is RD, not RAD.
    expect(Ph201ImportService.departmentCode('Corporate and Legal Affairs')).toBe('CLA');
  });

  it('is deterministic for single words', () => {
    expect(Ph201ImportService.departmentCode('Warehouse')).toBe('WAREHOUS');
  });
});

describe('201 import', () => {
  it('tolerates the trailing comma Excel exports leave behind', async () => {
    const report = await service.import(
      csv(row({ id: 'E-1', last: 'Dela Cruz', first: 'Juan',
                email: 'juan@acme.test' })), 'ACME', { dryRun: true });
    expect(report.errors).toEqual([]);
    expect(report.totalRows).toBe(1);
    expect(report.created).toBe(1);
  });

  it('creates missing departments and employment types', async () => {
    const report = await service.import(
      csv(
        row({ id: 'E-10', last: 'A', first: 'Ana', email: 'ana@acme.test',
              dept: 'Human Resources' }),
        row({ id: 'E-11', last: 'B', first: 'Ben', email: 'ben@acme.test',
              dept: 'Operations', status: 'Probationary', supervisor: 'E-10' }),
      ), 'ACME');

    expect(report.errors).toEqual([]);
    expect(report.departmentsCreated.map((d) => d.code).sort()).toEqual(['HR', 'OPS']);
    expect(report.employmentTypesCreated.map((t) => t.code).sort()).toEqual(['PROB', 'REG']);
    expect(report.reportingLines).toBe(1);
  });

  it('a dry run leaves NO trace — including departments', async () => {
    // The original bug: reference data was created in its own committed
    // transaction, so `--dry-run` silently created real departments and
    // employment types while rolling back only the people.
    const before = await admin.query<{ d: string; t: string; e: string }>(
      `SELECT (SELECT count(*)::int FROM department) AS d,
              (SELECT count(*)::int FROM employment_type) AS t,
              (SELECT count(*)::int FROM employee) AS e`);

    const report = await service.import(
      csv(row({ id: 'E-DRY', last: 'Dry', first: 'Run', email: 'dry@acme.test',
                dept: 'Aviation Safety', status: 'Seasonal' })),
      'ACME', { dryRun: true });

    expect(report.errors).toEqual([]);
    expect(report.created).toBe(1);
    expect(report.departmentsCreated.map((d) => d.code)).toContain('AS');

    const after = await admin.query<{ d: string; t: string; e: string }>(
      `SELECT (SELECT count(*)::int FROM department) AS d,
              (SELECT count(*)::int FROM employment_type) AS t,
              (SELECT count(*)::int FROM employee) AS e`);

    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('rejects an unrecognised employment status rather than guessing', async () => {
    const report = await service.import(
      csv(row({ id: 'E-20', last: 'C', first: 'Cy', email: 'cy@acme.test',
                status: 'Floating' })), 'ACME', { dryRun: true });
    expect(report.errors[0]?.message).toMatch(/Unrecognised employment status 'Floating'/);
    expect(report.created).toBe(0);
  });

  it('maps Philippine employment terms correctly', async () => {
    await service.import(
      csv(
        row({ id: 'E-30', last: 'D', first: 'Dee', email: 'dee@acme.test',
              status: 'Project-based' }),
        row({ id: 'E-31', last: 'E', first: 'Eve', email: 'eve@acme.test',
              status: 'OJT' }),
        row({ id: 'E-32', last: 'F', first: 'Fay', email: 'fay@acme.test',
              status: 'Contractual' }),
      ), 'ACME');

    const res = await admin.query<{ employee_no: string; status: string }>(
      `SELECT e.employee_no, em.status::text AS status
         FROM employee e JOIN employment em ON em.employee_id = e.id
        WHERE e.employee_no IN ('E-30','E-31','E-32') ORDER BY e.employee_no`);
    expect(res.rows.map((r) => r.status)).toEqual(['project', 'intern', 'fixed_term']);
  });

  it('marks interns and consultants as not review-eligible', async () => {
    const res = await admin.query<{ code: string; eligible: boolean }>(
      `SELECT code, is_eligible_for_review AS eligible FROM employment_type
        WHERE code IN ('INT','REG') ORDER BY code`);
    expect(res.rows.find((r) => r.code === 'INT')!.eligible).toBe(false);
    expect(res.rows.find((r) => r.code === 'REG')!.eligible).toBe(true);
  });

  it('reports employees missing a work email or supervisor', async () => {
    const report = await service.import(
      csv(
        row({ id: 'E-40', last: 'G', first: 'Gus' }),                 // no work email
        row({ id: 'E-41', last: 'H', first: 'Hana', email: 'h@acme.test',
              supervisor: 'E-40' }),
      ), 'ACME', { dryRun: true });

    expect(report.missingWorkEmails).toContain('E-40');
    expect(report.missingSupervisors).toContain('E-40');
    expect(report.missingSupervisors).not.toContain('E-41');
  });

  it('flags a department code collision instead of merging two departments', async () => {
    const report = await service.import(
      csv(
        row({ id: 'E-50', last: 'I', first: 'Ida', email: 'i@acme.test',
              dept: 'Business Development' }),
        row({ id: 'E-51', last: 'J', first: 'Jun', email: 'j@acme.test',
              dept: 'Brand Design' }),   // also derives to 'BD'
      ), 'ACME', { dryRun: true });

    expect(report.errors[0]?.message).toMatch(/would be shared by/);
  });

  it('detects reporting cycles through the standard importer', async () => {
    const report = await service.import(
      csv(
        row({ id: 'E-60', last: 'K', first: 'Kay', email: 'k@acme.test',
              supervisor: 'E-61' }),
        row({ id: 'E-61', last: 'L', first: 'Lou', email: 'l@acme.test',
              supervisor: 'E-60' }),
      ), 'ACME', { dryRun: true });
    expect(report.errors.some((e) => /cycle/i.test(e.message))).toBe(true);
  });
});

describe('data protection — what must NOT be stored', () => {
  it('imports no statutory identifiers or personal data', async () => {
    await service.import(
      csv(row({ id: 'E-70', last: 'Privacy', first: 'Test',
                email: 'privacy@acme.test' })), 'ACME');

    // Scan every text/varchar column of every table for values that appear
    // only in the 201 file. A future mapping change that widened the import
    // would fail here rather than in a breach notification.
    const needles = [
      '123-456-789-000',   // TIN
      '34-1234567-8',      // SSS
      '120345678901',      // PhilHealth
      '121234567890',      // Pag-IBIG
      '9171234567',        // contact number
      '1 Main St',         // address
      'privacy@personal.test',
    ];

    const columns = await admin.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='public'
          AND data_type IN ('text','character varying','citext')`);

    const hits: string[] = [];
    for (const c of columns.rows) {
      for (const needle of needles) {
        const res = await admin.query<{ n: string }>(
          `SELECT count(*)::int AS n FROM ${c.table_name}
            WHERE ${c.column_name}::text LIKE $1`, [`%${needle}%`]);
        if (Number(res.rows[0]!.n) > 0) {
          hits.push(`${c.table_name}.${c.column_name} contains "${needle}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('imports the work email and not the personal one', async () => {
    const res = await admin.query<{ work_email: string }>(
      `SELECT work_email FROM employee WHERE employee_no = 'E-70'`);
    expect(res.rows[0]!.work_email).toBe('privacy@acme.test');
  });

  it('reports the columns it deliberately left behind', async () => {
    const report = await service.import(
      csv(row({ id: 'E-80', last: 'M', first: 'Mia', email: 'm@acme.test' })),
      'ACME', { dryRun: true });

    for (const col of ['TIN', 'SSS_No', 'PhilHealth_No', 'PagIBIG_No', 'Address',
                       'Birthdate', 'Dependents_Count', 'Sick_Leave_Used']) {
      expect(report.columnsNotImported).toContain(col);
    }
  });
});
