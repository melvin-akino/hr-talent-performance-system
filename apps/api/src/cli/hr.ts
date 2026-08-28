/**
 * Operator CLI. Run on the host, never exposed over HTTP.
 *
 *   pnpm hr import-employees --org ACME --file ./staff.csv [--dry-run]
 *   pnpm hr grant-admin --org ACME --employee-no 00123
 *
 * Requires ADMIN_DATABASE_URL (the BYPASSRLS role). Bulk onboarding has no
 * authenticated user by definition, so it cannot run under normal RLS.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { DbService } from '../db/db.service';
import { EmployeeImportService } from '../import/employee-import.service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function importEmployees(): Promise<void> {
  const org = arg('org');
  const file = arg('file');
  if (!org || !file) {
    console.error('usage: hr import-employees --org <CODE> --file <path.csv> [--dry-run]');
    process.exit(1);
  }

  // onModuleInit() is deliberately NOT called: it builds the request-path pool
  // from DATABASE_URL, which the CLI has no use for. Import runs entirely on
  // the admin pool, created lazily inside withAdminContext.
  const db = new DbService();
  const svc = new EmployeeImportService(db);

  const report = await svc.import(readFileSync(file, 'utf8'), org, { dryRun: flag('dry-run') });
  await db.onModuleDestroy();

  console.log(`\n${report.dryRun ? 'DRY RUN — nothing was written' : 'Import complete'}`);
  console.log(`  rows read       ${report.totalRows}`);
  console.log(`  created         ${report.created}`);
  console.log(`  updated         ${report.updated}`);
  console.log(`  reporting lines ${report.reportingLines}`);

  if (report.errors.length > 0) {
    console.error(`\n${report.errors.length} error(s) — nothing was written:\n`);
    for (const e of report.errors.slice(0, 100)) {
      console.error(`  line ${e.row}${e.employeeNo ? ` (${e.employeeNo})` : ''}: ${e.message}`);
    }
    if (report.errors.length > 100) {
      console.error(`  ... and ${report.errors.length - 100} more`);
    }
    process.exit(1);
  }
}

/**
 * Bootstraps the first HR administrator.
 *
 * Necessary because role_assignment forbids self-granting (migration 0004), so
 * the very first admin cannot be created through the application. This is a
 * deliberate one-way door: run it once, from the host, then use the app.
 */
async function grantAdmin(): Promise<void> {
  const org = arg('org');
  const employeeNo = arg('employee-no');
  if (!org || !employeeNo) {
    console.error('usage: hr grant-admin --org <CODE> --employee-no <NO>');
    process.exit(1);
  }
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) {
    console.error('ADMIN_DATABASE_URL must be set');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.request_id', $1, true)`, [randomUUID()]);
    const res = await client.query<{ employee: string }>(
      `INSERT INTO role_assignment (org_id, employee_id, role_id, effective_from)
       SELECT o.id, e.id, r.id, CURRENT_DATE
         FROM organization o
         JOIN employee e ON e.org_id = o.id AND e.employee_no = $2
         JOIN app_role r ON r.org_id = o.id AND r.code = 'hr_admin'
        WHERE o.code = $1
          AND NOT EXISTS (
              SELECT 1 FROM role_assignment ra
               WHERE ra.employee_id = e.id AND ra.role_id = r.id
                 AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_DATE))
      RETURNING (SELECT last_name FROM employee WHERE id = employee_id) AS employee`,
      [org, employeeNo],
    );
    await client.query('COMMIT');
    console.log(
      res.rowCount
        ? `Granted hr_admin to ${employeeNo}.`
        : `No change — employee not found, or already an admin.`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * Import a Philippine 201 file directly, without hand-converting it first.
 * Maps only performance-relevant columns; see Ph201ImportService for why.
 */
async function import201(): Promise<void> {
  const org = arg('org');
  const file = arg('file');
  if (!org || !file) {
    console.error('usage: hr import-201 --org <CODE> --file <201.csv> [--dry-run]');
    process.exit(1);
  }

  const { Ph201ImportService } = await import('../import/ph201-import.service');
  const db = new DbService();
  const svc = new Ph201ImportService(db, new EmployeeImportService(db));
  const report = await svc.import(readFileSync(file, 'utf8'), org,
    { dryRun: flag('dry-run') });
  await db.onModuleDestroy();

  console.log(`\n${report.dryRun ? 'DRY RUN — nothing was written' : 'Import complete'}`);
  console.log(`  rows read       ${report.totalRows}`);
  console.log(`  created         ${report.created}`);
  console.log(`  updated         ${report.updated}`);
  console.log(`  reporting lines ${report.reportingLines}`);

  if (report.departmentsCreated.length > 0) {
    console.log(`\n  org units created:`);
    // Indented by level, so the shape of the tree the file describes is
    // visible in the dry run. Reading it back as a flat list is how a
    // division ends up filed as a department without anyone noticing.
    const unitDepth: Record<string, number> = {
      holdings: 0, group: 1, division: 2, department: 3,
      section: 4, area: 4, branch: 5,
    };
    for (const d of report.departmentsCreated) {
      const pad = '  '.repeat(unitDepth[d.unitType ?? 'department'] ?? 3);
      const level = d.unitType && d.unitType !== 'department'
        ? `  [${d.unitType}]`
        : '';
      console.log(`    ${pad}${d.code}  ${d.name}${level}`);
    }
  }
  if (report.ranksCreated.length > 0) {
    console.log(`\n  ranks created (a LOWER number is more senior):`);
    for (const r of report.ranksCreated) {
      console.log(`    ${r.code}  ${r.name}  (rank ${r.rankNo})`);
    }
  }
  if (report.positionsRanked > 0) {
    console.log(`\n  positions placed on the ladder: ${report.positionsRanked}`);
  }
  if (report.unitDifferences.length > 0) {
    console.log(`\n  NOTE: ${report.unitDifferences.length} existing org unit(s) are `
                + `described differently by this file. Nothing was changed - set `
                + `these in Setup if the file is right:`);
    for (const d of report.unitDifferences) {
      console.log(`    ${d.code}  ${d.name}: ${d.field} is ${d.stored}, file says ${d.inFile}`);
    }
  }
  if (report.employmentTypesCreated.length > 0) {
    console.log(`\n  employment types created:`);
    for (const t of report.employmentTypesCreated) console.log(`    ${t.code}  ${t.name}`);
  }
  if (report.missingWorkEmails.length > 0) {
    console.log(`\n  WARNING: ${report.missingWorkEmails.length} employee(s) have no ` +
                `work email and will not be able to sign in:`);
    console.log(`    ${report.missingWorkEmails.slice(0, 20).join(', ')}`);
  }
  if (report.missingSupervisors.length > 0) {
    console.log(`\n  NOTE: ${report.missingSupervisors.length} employee(s) have no ` +
                `supervisor. Expect one (the top of the org chart); more than that ` +
                `means managers will not see those people.`);
    console.log(`    ${report.missingSupervisors.slice(0, 20).join(', ')}`);
  }
  if (report.columnsNotImported.length > 0) {
    console.log(`\n  Columns present in the file but NOT imported ` +
                `(they stay in your 201 file):`);
    console.log(`    ${report.columnsNotImported.join(', ')}`);
  }

  if (report.errors.length > 0) {
    console.error(`\n${report.errors.length} error(s) — nothing was written:\n`);
    for (const e of report.errors.slice(0, 100)) {
      console.error(`  line ${e.row}${e.employeeNo ? ` (${e.employeeNo})` : ''}: ${e.message}`);
    }
    process.exit(1);
  }
}

const commands: Record<string, () => Promise<void>> = {
  'import-employees': importEmployees,
  'import-201': import201,
  'grant-admin': grantAdmin,
  'provision-org': async () => {
    const org = arg('org');
    const name = arg('name');
    if (!org || !name) {
      console.error('usage: hr provision-org --org <CODE> --name "<Legal name>" ' +
                    '[--timezone Asia/Manila]');
      process.exit(1);
    }
    const { provisionOrg } = await import('./provision-org');
    await provisionOrg(org, name, arg('timezone') ?? 'Asia/Manila');
  },
  'sync-roles': async () => {
    const org = arg('org');
    if (!org) {
      console.error('usage: hr sync-roles --org <CODE> [--dry-run]');
      process.exit(1);
    }
    const { syncRoles } = await import('./sync-roles');
    await syncRoles(org, flag('dry-run'));
  },
  'open-goal-period': async () => {
    const org = arg('org');
    const name = arg('name');
    const starts = arg('starts');
    const ends = arg('ends');
    if (!org || !name || !starts || !ends) {
      console.error('usage: hr open-goal-period --org <CODE> --name <NAME> ' +
                    '--starts <YYYY-MM-DD> --ends <YYYY-MM-DD> ' +
                    '[--type annual] [--cadence monthly]');
      process.exit(1);
    }
    const { openGoalPeriod } = await import('./goal-period');
    await openGoalPeriod({
      orgCode: org, name, startsOn: starts, endsOn: ends,
      periodType: arg('type') ?? 'annual',
      cadence: arg('cadence') ?? 'monthly',
    });
  },
  preflight: async () => {
    const org = arg('org');
    if (!org) {
      console.error('usage: hr preflight --org <CODE>');
      process.exit(1);
    }
    const { preflight } = await import('./preflight');
    process.exitCode = await preflight(org);
  },
  'seed-demo': async () => {
    const { seedDemo } = await import('./seed-demo');
    // --yes-i-mean-it overrides the "this organisation holds people I did not
    // create" refusal only; NODE_ENV=production is refused regardless.
    await seedDemo(arg('org') ?? 'ACME', { confirmed: flag('yes-i-mean-it') });
  },
  // For an org whose staff are already imported: adds the activity, leaves the
  // people alone. `seed-demo` cannot do this — it brings its own CSV.
  'seed-activity': async () => {
    const org = arg('org');
    if (!org) {
      console.error('usage: hr seed-activity --org <CODE> --yes-i-mean-it');
      process.exit(1);
    }
    const { seedActivity } = await import('./seed-activity');
    await seedActivity(org, { confirmed: flag('yes-i-mean-it') });
  },
};

const cmd = process.argv[2] ?? '';
const handler = commands[cmd];
if (!handler) {
  console.error(`Unknown command '${cmd}'.\nAvailable: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
handler().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
