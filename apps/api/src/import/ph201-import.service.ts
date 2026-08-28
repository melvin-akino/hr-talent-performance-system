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
  // 'rank' USED to be an alias for job_level, the free-text grade. It now means
  // the rank ladder (0028), because in a Guanzon file that is unambiguously
  // what it is -- their own numbering, 6 to 11. A file that used 'rank' for a
  // text grade will now fail with a message telling it to rename the column to
  // job_level. Visibly breaking is the right failure here: silently filing
  // "Senior" as a rank number, or a 6 as a text grade, is the sort of thing
  // nobody notices until peer-review routing picks the wrong people.
  job_level: ['job_level', 'level'],
  rank_no: ['rank', 'rank_no', 'job_rank', 'rank_level'],
  rank_title: ['rank_title', 'rank_name'],
  holdings: ['holdings'],
  group: ['group', 'group_name'],
  division: ['division'],
  section: ['section'],
  area: ['area'],
  branch: ['branch', 'branch_name'],
};

/**
 * The org levels a 201 file may name, in depth order (0027).
 *
 * `department` is required and is the one every file already has. The rest are
 * optional: a file that names none of them imports exactly as it did before,
 * producing a flat list of departments.
 *
 * AREA and SECTION share depth 5 and are deliberately NOT both allowed on one
 * row. They are siblings in depth but different in kind -- a section is back
 * office, an area is a branch network -- so a row naming both is describing two
 * different places, and guessing which one the person is in would put them
 * under the wrong head for peer review.
 */
const UNIT_LEVELS: { field: string; unitType: string; depth: number }[] = [
  { field: 'holdings', unitType: 'holdings', depth: 1 },
  { field: 'group', unitType: 'group', depth: 2 },
  { field: 'division', unitType: 'division', depth: 3 },
  { field: 'department', unitType: 'department', depth: 4 },
  { field: 'section', unitType: 'section', depth: 5 },
  { field: 'area', unitType: 'area', depth: 5 },
  { field: 'branch', unitType: 'branch', depth: 6 },
];

/** The client's ladder runs 6..11. Anything outside it is a typo, not a rank. */
const RANK_MIN = 1;
const RANK_MAX = 99;

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
  /** Every org unit created, at whatever level -- not only departments. */
  departmentsCreated: { code: string; name: string; unitType?: string;
                        parentCode?: string | null }[];
  employmentTypesCreated: { code: string; name: string }[];
  ranksCreated: { code: string; name: string; rankNo: number }[];
  /**
   * Existing org units this file describes differently. Never an error and never
   * changed automatically -- see the note at the write site.
   */
  unitDifferences: {
    code: string; name: string; field: 'level' | 'parent';
    stored: string; inFile: string;
  }[];
  /** Positions placed on the ladder, so a dry run shows the ladder taking shape. */
  positionsRanked: number;
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
      ranksCreated: [], positionsRanked: 0, unitDifferences: [],
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
    interface Unit { code: string; name: string; unitType: string;
                     parentCode: string | null; depth: number }
    const units = new Map<string, Unit>();           // code -> unit
    const types = new Map<string, string>();         // code -> name
    const ranks = new Map<number, string>();         // rank_no -> title
    // position title + unit code -> rank_no, applied after the people land.
    const positionRanks = new Map<string, number>();
    const out: string[][] = [];

    /**
     * Resolves a row's org units into a parent chain and returns the deepest.
     *
     * Returns null on a contradiction, having recorded the error -- the caller
     * skips the row, as it does for an unrecognised employment status.
     */
    const resolveUnits = (
      row: Record<string, string>, line: number, employeeNo: string,
    ): string | null => {
      const named = UNIT_LEVELS
        .map((l) => ({ ...l, name: get(row, l.field) }))
        .filter((l) => l.name !== '');

      if (named.some((l) => l.unitType === 'section')
          && named.some((l) => l.unitType === 'area')) {
        report.errors.push({
          row: line, employeeNo,
          message: 'Row names both a section and an area. They sit at the same '
                 + 'level but are different kinds of unit -- back office and '
                 + 'branch network -- so a person is in one or the other. '
                 + 'Leave the column that does not apply empty.',
        });
        return null;
      }

      let parentCode: string | null = null;
      let deepest: string | null = null;

      for (const level of named) {
        const code = Ph201ImportService.departmentCode(level.name);
        const existing = units.get(code);

        if (existing && existing.name !== level.name) {
          report.errors.push({
            row: line, employeeNo,
            message: `Org unit code '${code}' would be shared by '${existing.name}' `
                   + `and '${level.name}'. Give one of them an explicit code.`,
          });
          return null;
        }

        // The same unit under two different parents is a real contradiction:
        // one node cannot hang in two places on the tree, and picking either
        // silently would misroute everyone beneath it.
        if (existing && existing.parentCode !== parentCode) {
          report.errors.push({
            row: line, employeeNo,
            message: `'${level.name}' appears under '${parentCode ?? 'no parent'}' `
                   + `here and under '${existing.parentCode ?? 'no parent'}' `
                   + 'elsewhere in the file.',
          });
          return null;
        }

        if (!existing) {
          units.set(code, {
            code, name: level.name, unitType: level.unitType, parentCode,
            depth: level.depth,
          });
        }
        parentCode = code;
        deepest = code;
      }

      return deepest;
    };

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

      // The person lands in the DEEPEST unit their row names -- their branch if
      // they have one, their section if not, their department otherwise. That is
      // what makes an Area Head's subtree grant reach them.
      const departmentCode = resolveUnits(row, line, employeeNo);
      if (!departmentCode) return;

      const rankRaw = get(row, 'rank_no');
      let rankNo: number | null = null;
      if (rankRaw) {
        if (!/^\d+$/.test(rankRaw)) {
          report.errors.push({
            row: line, employeeNo,
            message: `Rank '${rankRaw}' is not a number. The rank column is the `
                   + 'ladder position (a lower number is more senior). If this '
                   + 'column holds a text grade, rename it to job_level.',
          });
          return;
        }
        rankNo = Number(rankRaw);
        if (rankNo < RANK_MIN || rankNo > RANK_MAX) {
          report.errors.push({
            row: line, employeeNo,
            message: `Rank ${rankNo} is outside ${RANK_MIN}-${RANK_MAX}.`,
          });
          return;
        }
        const title = get(row, 'rank_title') || `Rank ${rankNo}`;
        const knownTitle = ranks.get(rankNo);
        if (knownTitle && knownTitle !== title) {
          report.errors.push({
            row: line, employeeNo,
            message: `Rank ${rankNo} is named '${knownTitle}' elsewhere in the `
                   + `file and '${title}' here.`,
          });
          return;
        }
        ranks.set(rankNo, title);
      }

      const workEmail = get(row, 'work_email');
      if (!workEmail) report.missingWorkEmails.push(employeeNo);

      const supervisor = get(row, 'supervisor_no');
      if (!supervisor) report.missingSupervisors.push(employeeNo);

      // A position is (title, unit), so everyone holding it shares a rank. Two
      // rows disagreeing is a fact about the file, not something to average.
      const positionTitle = get(row, 'position');
      if (rankNo !== null && positionTitle) {
        const key = `${positionTitle} ${departmentCode}`;
        const seen = positionRanks.get(key);
        if (seen !== undefined && seen !== rankNo) {
          report.errors.push({
            row: line, employeeNo,
            message: `'${positionTitle}' is rank ${seen} elsewhere in the file `
                   + `and rank ${rankNo} here. One position, one rank.`,
          });
          return;
        }
        positionRanks.set(key, rankNo);
      }

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

      // Shallowest first, so a parent always exists before its child needs it.
      // The hierarchy trigger (0027) rejects an inverted parent, so getting this
      // order wrong would fail loudly rather than build a wrong tree -- but
      // failing on a real import is not much of a consolation.
      const ordered = [...units.values()].sort((a, b) => a.depth - b.depth);
      const unitIds = new Map<string, string>();

      for (const unit of ordered) {
        const parentId = unit.parentCode ? unitIds.get(unit.parentCode) ?? null : null;

        const res = await client.query<{ id: string }>(
          `INSERT INTO department (org_id, code, name, unit_type,
                                   parent_department_id, effective_from)
                SELECT $1, $2, $3, $4::org_unit_type, $5, '1900-01-01'
                 WHERE NOT EXISTS (SELECT 1 FROM department
                                    WHERE org_id = $1 AND code = $2)
             RETURNING id`,
          [orgId, unit.code, unit.name, unit.unitType, parentId]);

        if (res.rows[0]) {
          unitIds.set(unit.code, res.rows[0].id);
          report.departmentsCreated.push({
            code: unit.code, name: unit.name, unitType: unit.unitType,
            parentCode: unit.parentCode,
          });
        } else {
          // Already there from an earlier import.
          //
          // STRUCTURE IS SET ON CREATION ONLY. Neither the level nor the parent
          // is written to a unit that already exists; where the file disagrees
          // it is reported for a human to settle in Setup.
          //
          // The tempting alternative -- backfill whatever is still NULL -- was
          // written first and a test caught it. A parent of NULL is not "unset":
          // it is also what somebody means when they deliberately detach a unit,
          // and COALESCE cannot tell the two apart, so the next import silently
          // reattached it. `unit_type` has the same problem with no NULL at all
          // (NOT NULL DEFAULT 'department'), so a unit sitting at 'department'
          // is indistinguishable from one deliberately set there.
          //
          // The cost is that units created before this change keep their flat
          // shape until someone fixes them; the report says which. That is the
          // better failure: a re-import that quietly reshapes an org chart is
          // one nobody can safely re-run.
          const existing = await client.query<{
            id: string; unit_type: string; parent_code: string | null;
          }>(
            `SELECT d.id, d.unit_type::text, p.code AS parent_code
               FROM department d
               LEFT JOIN department p ON p.id = d.parent_department_id
              WHERE d.org_id = $1 AND d.code = $2`,
            [orgId, unit.code]);

          const row = existing.rows[0];
          if (row) {
            unitIds.set(unit.code, row.id);
            if (row.unit_type !== unit.unitType) {
              report.unitDifferences.push({
                code: unit.code, name: unit.name, field: 'level',
                stored: row.unit_type, inFile: unit.unitType,
              });
            }
            if ((row.parent_code ?? null) !== unit.parentCode) {
              report.unitDifferences.push({
                code: unit.code, name: unit.name, field: 'parent',
                stored: row.parent_code ?? '(none)',
                inFile: unit.parentCode ?? '(none)',
              });
            }
          }
        }
      }

      for (const [rankNo, name] of [...ranks.entries()].sort((a, b) => a[0] - b[0])) {
        const code = `R${rankNo}`;
        const res = await client.query(
          `INSERT INTO job_rank (org_id, code, name, rank_no)
                VALUES ($1, $2, $3, $4)
           ON CONFLICT (org_id, code) DO NOTHING
             RETURNING id`, [orgId, code, name, rankNo]);
        if (res.rowCount) report.ranksCreated.push({ code, name, rankNo });
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

      // Ranks are applied AFTER the people land, because a position row does
      // not exist until the employee holding it is imported. Same transaction,
      // so a dry run still leaves nothing behind.
      for (const [key, rankNo] of positionRanks) {
        const [title, unitCode] = key.split(' ') as [string, string];
        const res = await client.query(
          `UPDATE position p
              SET rank_id = r.id
             FROM job_rank r, department d
            WHERE p.org_id = $1 AND p.title = $2
              AND d.org_id = $1 AND d.code = $3 AND p.department_id = d.id
              AND r.org_id = $1 AND r.rank_no = $4
              AND p.rank_id IS DISTINCT FROM r.id`,
          [orgId, title, unitCode, rankNo]);
        report.positionsRanked += res.rowCount ?? 0;
      }

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
      ranksCreated: report.ranksCreated.length,
      positionsRanked: report.positionsRanked,
      notImported: report.columnsNotImported.length,
    }, '201 import complete');

    return report;
  }
}

/** Sentinel used to discard a dry run's transaction. */
class Ph201Rollback extends Error {}
