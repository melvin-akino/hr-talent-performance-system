import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { EmployeeImportService, type ImportReport } from './employee-import.service';
import { logger } from '../common/logger';

/**
 * Imports a Philippine 201 file.
 *
 * The 201 file is the full personnel record; this system is performance and
 * talent only (decisions.md D-002). So this converter deliberately takes a
 * SUBSET and leaves the rest where it lives:
 *
 *   NOT imported — TIN, SSS, PhilHealth, Pag-IBIG, address, birthdate, gender,
 *   civil status, contact numbers, emergency contacts, dependents, leave
 *   balances, NBI/PEME/contract status.
 *
 * That is a data-protection decision, not an oversight. Government IDs this
 * system never processes would enlarge the blast radius of a breach on an
 * on-prem box for no functional gain. If the system is ever made the 201
 * repository of record, that needs its own decision, new tables, encryption at
 * rest, and a retention policy — not a quiet widening of this mapping.
 *
 * Conversion is a pure transform to the internal format, then handed to
 * EmployeeImportService so the 201 path inherits every existing guarantee:
 * all-or-nothing, cycle detection, duplicate rejection, idempotency.
 */

/** Column names accepted from a 201 file, lowercased and trimmed. */
const COLUMN_ALIASES: Record<string, string[]> = {
  employee_no: ['employee_id', 'employee_no', 'employee number', 'emp_id'],
  last_name: ['last_name', 'surname'],
  first_name: ['first_name', 'given_name'],
  middle_name: ['middle_name'],
  work_email: ['work_email', 'company_email', 'official_email'],
  personal_email: ['email', 'personal_email'],
  hired_on: ['date_hired', 'hire_date', 'date_of_hire'],
  department: ['department', 'dept'],
  position: ['position', 'job_title', 'designation'],
  employment_status: ['employment_status', 'status', 'employment_type'],
  supervisor_no: ['supervisor_id', 'supervisor_employee_id', 'reports_to', 'manager_id'],
  job_family: ['job_family', 'family'],
  job_level: ['job_level', 'level', 'rank'],
};

/**
 * PH employment terms → the system's employment_status enum.
 *
 * Unknown values are rejected rather than guessed: silently filing a
 * "Seasonal" worker as "regular" misstates their employment, which is exactly
 * the kind of error a 201 file exists to prevent.
 */
const STATUS_MAP: Record<string, { status: string; typeCode: string; typeName: string }> = {
  regular: { status: 'regular', typeCode: 'REG', typeName: 'Regular' },
  permanent: { status: 'regular', typeCode: 'REG', typeName: 'Regular' },
  probationary: { status: 'probationary', typeCode: 'PROB', typeName: 'Probationary' },
  probi: { status: 'probationary', typeCode: 'PROB', typeName: 'Probationary' },
  project: { status: 'project', typeCode: 'PROJ', typeName: 'Project-based' },
  'project-based': { status: 'project', typeCode: 'PROJ', typeName: 'Project-based' },
  'project based': { status: 'project', typeCode: 'PROJ', typeName: 'Project-based' },
  contractual: { status: 'fixed_term', typeCode: 'CONTR', typeName: 'Contractual' },
  contract: { status: 'fixed_term', typeCode: 'CONTR', typeName: 'Contractual' },
  'fixed-term': { status: 'fixed_term', typeCode: 'CONTR', typeName: 'Contractual' },
  'fixed term': { status: 'fixed_term', typeCode: 'CONTR', typeName: 'Contractual' },
  seasonal: { status: 'fixed_term', typeCode: 'SEAS', typeName: 'Seasonal' },
  casual: { status: 'fixed_term', typeCode: 'CAS', typeName: 'Casual' },
  consultant: { status: 'consultant', typeCode: 'CONS', typeName: 'Consultant' },
  consultancy: { status: 'consultant', typeCode: 'CONS', typeName: 'Consultant' },
  intern: { status: 'intern', typeCode: 'INT', typeName: 'Intern' },
  ojt: { status: 'intern', typeCode: 'INT', typeName: 'Intern / OJT' },
  trainee: { status: 'intern', typeCode: 'INT', typeName: 'Intern / OJT' },
};

/** Common PH department names → short codes. */
const DEPARTMENT_CODES: Record<string, string> = {
  'human resources': 'HR',
  'hr': 'HR',
  'operations': 'OPS',
  'information technology': 'IT',
  'it': 'IT',
  'finance': 'FIN',
  'accounting': 'ACCTG',
  'sales': 'SALES',
  'marketing': 'MKTG',
  'engineering': 'ENG',
  'administration': 'ADMIN',
  'admin': 'ADMIN',
  'legal': 'LEGAL',
  'customer service': 'CS',
  'procurement': 'PROC',
  'logistics': 'LOG',
  'production': 'PROD',
  'quality assurance': 'QA',
  'research and development': 'RND',
  'executive': 'EXEC',
};

export interface Ph201Report extends ImportReport {
  departmentsCreated: { code: string; name: string }[];
  employmentTypesCreated: { code: string; name: string }[];
  /** Columns present in the file that this system deliberately does not store. */
  columnsNotImported: string[];
  missingWorkEmails: string[];
  missingSupervisors: string[];
}

@Injectable()
export class Ph201ImportService {
  constructor(
    private readonly db: DbService,
    private readonly employees: EmployeeImportService,
  ) {}

  /** Deterministic code for a department name not in the known map. */
  static departmentCode(name: string): string {
    const key = name.trim().toLowerCase();
    const known = DEPARTMENT_CODES[key];
    if (known) return known;

    const words = name.trim().split(/\s+/).filter((w) => !/^(and|of|the|&)$/i.test(w));
    if (words.length > 1) {
      return words.map((w) => w[0]!.toUpperCase()).join('').slice(0, 8);
    }
    return name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }

  async import(
    csv: string, orgCode: string, opts: { dryRun?: boolean } = {},
  ): Promise<Ph201Report> {
    const report: Ph201Report = {
      dryRun: opts.dryRun ?? false,
      totalRows: 0, created: 0, updated: 0, reportingLines: 0, errors: [],
      departmentsCreated: [], employmentTypesCreated: [],
      columnsNotImported: [], missingWorkEmails: [], missingSupervisors: [],
    };

    let rows: Record<string, string>[];
    let headers: string[] = [];
    try {
      rows = parse(csv, {
        columns: (header: string[]) => {
          headers = header.map((h) => h.trim());
          return headers.map((h) => h.toLowerCase());
        },
        skip_empty_lines: true,
        trim: true,
        bom: true,
        // 201 files exported from Excel/Sheets routinely carry a trailing comma
        // on data rows, giving them one more field than the header. Rejecting
        // the whole file over that would be needlessly brittle.
        relax_column_count: true,
      });
    } catch (err) {
      report.errors.push({ row: 0, message: `Malformed CSV: ${(err as Error).message}` });
      return report;
    }

    report.totalRows = rows.length;

    // Resolve each internal field to whichever alias the file actually uses.
    const found = new Map<string, string>();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      const match = aliases.find((a) => headers.some((h) => h.toLowerCase() === a));
      if (match) found.set(field, match);
    }

    // personal_email is recognised only so it is never mistaken for the work
    // address. It is deliberately dropped, so it must be reported as not
    // imported — otherwise its absence from this list reads as "stored".
    const mapped = new Set(found.values());
    mapped.delete(found.get('personal_email') ?? '');
    report.columnsNotImported = headers.filter((h) => !mapped.has(h.toLowerCase()));

    for (const required of ['employee_no', 'first_name', 'last_name', 'hired_on',
                            'department', 'employment_status']) {
      if (!found.has(required)) {
        report.errors.push({
          row: 0,
          message: `Required column missing: expected one of ` +
                   `${COLUMN_ALIASES[required]!.join(', ')}`,
        });
      }
    }
    if (report.errors.length > 0) return report;

    const get = (row: Record<string, string>, field: string): string =>
      (found.has(field) ? (row[found.get(field)!] ?? '') : '').trim();

    // --- transform ---------------------------------------------------------
    const departments = new Map<string, string>();   // code -> name
    const types = new Map<string, string>();         // code -> name
    const out: string[][] = [];

    rows.forEach((row, i) => {
      const line = i + 2;
      const employeeNo = get(row, 'employee_no');
      if (!employeeNo) {
        report.errors.push({ row: line, message: 'employee_no is empty' });
        return;
      }

      const statusRaw = get(row, 'employment_status');
      const status = STATUS_MAP[statusRaw.toLowerCase()];
      if (!status) {
        report.errors.push({
          row: line, employeeNo,
          message: `Unrecognised employment status '${statusRaw}'. Known values: ` +
                   `${[...new Set(Object.values(STATUS_MAP).map((s) => s.typeName))].join(', ')}`,
        });
        return;
      }
      types.set(status.typeCode, status.typeName);

      const departmentName = get(row, 'department');
      const departmentCode = Ph201ImportService.departmentCode(departmentName);
      const clash = departments.get(departmentCode);
      if (clash && clash !== departmentName) {
        report.errors.push({
          row: line, employeeNo,
          message: `Department code '${departmentCode}' would be shared by ` +
                   `'${clash}' and '${departmentName}'. Give one of them an explicit code.`,
        });
        return;
      }
      departments.set(departmentCode, departmentName);

      const workEmail = get(row, 'work_email');
      if (!workEmail) report.missingWorkEmails.push(employeeNo);

      const supervisor = get(row, 'supervisor_no');
      if (!supervisor) report.missingSupervisors.push(employeeNo);

      out.push([
        employeeNo,
        get(row, 'first_name'),
        get(row, 'middle_name'),
        get(row, 'last_name'),
        // Only the WORK email is imported. The personal address stays in the
        // 201 file: it is not needed to authenticate anyone and would be one
        // more piece of personal data to protect here.
        workEmail,
        get(row, 'hired_on'),
        departmentCode,
        get(row, 'position'),
        get(row, 'job_family'),
        get(row, 'job_level'),
        status.typeCode,
        status.status,
        supervisor,
      ]);
    });

    if (report.errors.length > 0) return report;

    // --- write, in ONE transaction -----------------------------------------
    // Reference data and people must share a transaction. Creating departments
    // in a separate committed transaction would make `--dry-run` leave real
    // departments behind — a dry run that changes the database is a trap.
    const header = [
      'employee_no', 'first_name', 'middle_name', 'last_name', 'work_email',
      'hired_on', 'department_code', 'position_title', 'job_family', 'job_level',
      'employment_type_code', 'employment_status', 'supervisor_employee_no',
    ];
    const escape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const internal = [
      header.join(','),
      ...out.map((r) => r.map(escape).join(',')),
    ].join('\n');

    await this.db.withAdminContext(randomUUID(), async (client) => {
      const org = await client.query<{ id: string }>(
        'SELECT id FROM organization WHERE code = $1', [orgCode]);
      const orgId = org.rows[0]?.id;
      if (!orgId) throw new Error(`Organization '${orgCode}' does not exist`);

      for (const [code, name] of departments) {
        const res = await client.query(
          `INSERT INTO department (org_id, code, name, effective_from)
                SELECT $1, $2, $3, '1900-01-01'
                 WHERE NOT EXISTS (SELECT 1 FROM department
                                    WHERE org_id = $1 AND code = $2)
             RETURNING id`, [orgId, code, name]);
        if (res.rowCount) report.departmentsCreated.push({ code, name });
      }

      for (const [code, name] of types) {
        const res = await client.query(
          `INSERT INTO employment_type (org_id, code, name, is_eligible_for_review)
                VALUES ($1,$2,$3,$4)
           ON CONFLICT (org_id, code) DO NOTHING
             RETURNING id`,
          // Consultants and interns are excluded from review cycles by default;
          // HR can change this per type afterwards.
          [orgId, code, name, !['CONS', 'INT'].includes(code)]);
        if (res.rowCount) report.employmentTypesCreated.push({ code, name });
      }

      // Same client, same transaction: inherits every guarantee of the
      // standard importer (all-or-nothing, cycle detection, idempotency).
      const result = await this.employees.import(internal, orgCode, { client });
      report.created = result.created;
      report.updated = result.updated;
      report.reportingLines = result.reportingLines;
      report.errors = result.errors;

      if (opts.dryRun || result.errors.length > 0) {
        throw new Ph201Rollback();
      }
    }).catch((err) => {
      if (err instanceof Ph201Rollback) return;
      throw err;
    });

    // A dry run reports what WOULD be created; nothing was actually written.
    if (opts.dryRun && report.errors.length === 0) {
      logger.info({ report }, '201 dry run complete — rolled back');
    }

    logger.info({
      rows: report.totalRows,
      departmentsCreated: report.departmentsCreated.length,
      notImported: report.columnsNotImported.length,
    }, '201 import complete');

    return report;
  }
}

/** Sentinel used to discard a dry run's transaction. */
class Ph201Rollback extends Error {}
