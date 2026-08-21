import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EmployeeImportService } from '../src/import/employee-import.service';

/**
 * End-to-end import against a real database.
 *
 * The importer is the only way real staff data enters the system, and a
 * half-loaded org chart produces an authorization model that is silently wrong
 * rather than obviously broken. So this exercises the actual constraints, not
 * a mocked client.
 */

const MIGRATIONS = join(__dirname, '../../../db/migrations');

let container: StartedPostgreSqlContainer;
let admin: Pool;
let service: EmployeeImportService;

/** Minimal DbService stand-in: withAdminContext is the only method used. */
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

const CSV_HEADER =
  'employee_no,first_name,middle_name,last_name,work_email,hired_on,' +
  'department_code,position_title,employment_type_code,employment_status,' +
  'supervisor_employee_no';

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  admin = new Pool({ connectionString: container.getConnectionUri() });

  await admin.query(`
    CREATE ROLE hr_migrator LOGIN BYPASSRLS PASSWORD 'm';
    CREATE ROLE hr_app LOGIN NOBYPASSRLS PASSWORD 'a';
  `);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }

  const org = (await admin.query(
    `INSERT INTO organization (code, name) VALUES ('ACME','Acme') RETURNING id`)).rows[0].id;
  await admin.query(
    `INSERT INTO department (org_id, code, name, effective_from)
     VALUES ($1,'ENG','Engineering','2020-01-01'), ($1,'SALES','Sales','2020-01-01')`, [org]);
  await admin.query(
    `INSERT INTO employment_type (org_id, code, name) VALUES ($1,'REG','Regular')`, [org]);

  service = new EmployeeImportService(fakeDb(admin) as never);
}, 180_000);

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

const rows = (...lines: string[]) => [CSV_HEADER, ...lines].join('\n');

describe('employee import', () => {
  it('rejects the whole file when any row is invalid', async () => {
    const report = await service.import(
      rows(
        '1,Ana,,Cruz,ana@acme.test,2020-01-01,ENG,Engineer,REG,regular,',
        '2,Bob,,Reyes,not-an-email,2020-01-01,ENG,Engineer,REG,regular,1',
      ),
      'ACME',
    );
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toMatch(/work_email/);
    expect(report.created).toBe(0);

    const count = await admin.query('SELECT count(*)::int AS c FROM employee');
    expect(count.rows[0].c).toBe(0); // nothing written
  });

  it('detects reporting cycles before writing anything', async () => {
    const report = await service.import(
      rows(
        '1,Ana,,Cruz,ana@acme.test,2020-01-01,ENG,Engineer,REG,regular,2',
        '2,Bob,,Reyes,bob@acme.test,2020-01-01,ENG,Engineer,REG,regular,1',
      ),
      'ACME',
    );
    expect(report.errors.some((e) => /cycle/i.test(e.message))).toBe(true);
  });

  it('rejects a supervisor who is not present in the file', async () => {
    const report = await service.import(
      rows('1,Ana,,Cruz,ana@acme.test,2020-01-01,ENG,Engineer,REG,regular,999'),
      'ACME',
    );
    expect(report.errors[0]?.message).toMatch(/'999' is not present/);
  });

  it('rejects duplicate employee numbers within one file', async () => {
    const report = await service.import(
      rows(
        '1,Ana,,Cruz,ana@acme.test,2020-01-01,ENG,Engineer,REG,regular,',
        '1,Bob,,Reyes,bob@acme.test,2020-01-01,ENG,Engineer,REG,regular,',
      ),
      'ACME',
    );
    expect(report.errors[0]?.message).toMatch(/Duplicate employee_no/);
  });

  it('dry run writes nothing but exercises every constraint', async () => {
    const report = await service.import(
      rows('1,Ana,,Cruz,ana@acme.test,2020-01-01,ENG,Engineer,REG,regular,'),
      'ACME',
      { dryRun: true },
    );
    expect(report.errors).toHaveLength(0);
    expect(report.created).toBe(1);
    const count = await admin.query('SELECT count(*)::int AS c FROM employee');
    expect(count.rows[0].c).toBe(0);
  });

  it('imports employees and reporting lines regardless of row order', async () => {
    // Report listed BEFORE their supervisor -- nobody topologically sorts a CSV.
    const report = await service.import(
      rows(
        '2,Bob,,Reyes,bob@acme.test,2021-01-01,ENG,Engineer,REG,regular,1',
        '1,Ana,,Cruz,ana@acme.test,2020-01-01,ENG,Manager,REG,regular,',
      ),
      'ACME',
    );
    expect(report.errors).toHaveLength(0);
    expect(report.created).toBe(2);
    expect(report.reportingLines).toBe(1);

    const line = await admin.query(
      `SELECT s.employee_no AS supervisor
         FROM reporting_line rl
         JOIN employee e ON e.id = rl.employee_id
         JOIN employee s ON s.id = rl.supervisor_employee_id
        WHERE e.employee_no = '2'`);
    expect(line.rows[0].supervisor).toBe('1');
  });

  it('is idempotent -- re-running updates instead of duplicating', async () => {
    const csv = rows(
      '1,Ana,,Cruz-Reyes,ana@acme.test,2020-01-01,ENG,Manager,REG,regular,',
      '2,Bob,,Reyes,bob@acme.test,2021-01-01,ENG,Engineer,REG,regular,1',
    );
    const report = await service.import(csv, 'ACME');

    expect(report.created).toBe(0);
    expect(report.updated).toBe(2);
    expect(report.reportingLines).toBe(0); // existing line reused, not duplicated

    const employees = await admin.query('SELECT count(*)::int AS c FROM employee');
    expect(employees.rows[0].c).toBe(2);

    const employments = await admin.query('SELECT count(*)::int AS c FROM employment');
    expect(employments.rows[0].c).toBe(2);

    const positions = await admin.query('SELECT count(*)::int AS c FROM position');
    expect(positions.rows[0].c).toBe(2); // Manager + Engineer, not 4

    const renamed = await admin.query(
      `SELECT last_name FROM employee WHERE employee_no = '1'`);
    expect(renamed.rows[0].last_name).toBe('Cruz-Reyes');
  });

  it('seeds the baseline role matrix', async () => {
    const roles = await admin.query<{ code: string }>(
      'SELECT code FROM app_role ORDER BY code');
    expect(roles.rows.map((r) => r.code)).toEqual(
      ['employee', 'hr_admin', 'hr_partner', 'manager']);

    const grants = await admin.query('SELECT count(*)::int AS c FROM access_grant');
    expect(grants.rows[0].c).toBeGreaterThan(0);
  });

  it('handles a UTF-8 BOM from an Excel export', async () => {
    const report = await service.import(
      '﻿' + rows('9,Cy,,Tan,cy@acme.test,2022-01-01,SALES,Seller,REG,regular,'),
      'ACME',
    );
    expect(report.errors).toHaveLength(0);
    expect(report.created).toBe(1);
  });
});
