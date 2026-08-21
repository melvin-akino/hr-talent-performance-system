import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { logger } from '../common/logger';

/**
 * Bulk onboarding of existing staff.
 *
 * Design decisions worth knowing before changing this:
 *
 * 1. ALL-OR-NOTHING. The whole import runs in one transaction. A partial org
 *    chart is worse than no org chart -- half-loaded reporting lines produce
 *    an authorization model that is silently wrong rather than obviously
 *    broken.
 *
 * 2. VALIDATE EVERYTHING FIRST, then write. Every row is checked, and all
 *    errors are reported together. HR should not fix one typo per run.
 *
 * 3. IDEMPOTENT on employee_no. Re-running the same file updates in place
 *    rather than duplicating, because the first import is never the last one.
 *
 * 4. Supervisors are resolved by employee_no AFTER all employees exist, so the
 *    file does not need to be topologically sorted. Nobody hand-sorts a CSV.
 */

const row = z.object({
  employee_no: z.string().trim().min(1),
  first_name: z.string().trim().min(1),
  middle_name: z.string().trim().optional().or(z.literal('')),
  last_name: z.string().trim().min(1),
  work_email: z.string().trim().email().optional().or(z.literal('')),
  hired_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  department_code: z.string().trim().min(1),
  position_title: z.string().trim().optional().or(z.literal('')),
  // Optional, and added after the original format was agreed — existing files
  // keep importing unchanged. Without job_family the Phase 4 job-family gap
  // report has nothing to group by, so it is worth populating.
  job_family: z.string().trim().optional().or(z.literal('')),
  job_level: z.string().trim().optional().or(z.literal('')),
  employment_type_code: z.string().trim().min(1),
  employment_status: z.enum([
    'probationary', 'regular', 'project', 'fixed_term', 'consultant', 'intern',
  ]),
  supervisor_employee_no: z.string().trim().optional().or(z.literal('')),
});

type ImportRow = z.infer<typeof row>;

export interface ImportReport {
  dryRun: boolean;
  totalRows: number;
  created: number;
  updated: number;
  reportingLines: number;
  errors: { row: number; employeeNo?: string | undefined; message: string }[];
}

@Injectable()
export class EmployeeImportService {
  constructor(private readonly db: DbService) {}

  /**
   * @param opts.client Run inside a transaction the CALLER owns, instead of
   *   opening one. The caller is then responsible for rolling back on a dry
   *   run. This exists so the 201 importer can create departments and employee
   *   rows in a single transaction — otherwise a `--dry-run` commits the
   *   reference data and only rolls back the people, which is not a dry run.
   */
  async import(
    csv: string,
    orgCode: string,
    opts: { dryRun?: boolean; client?: PoolClient } = {},
  ): Promise<ImportReport> {
    const report: ImportReport = {
      dryRun: opts.dryRun ?? false,
      totalRows: 0,
      created: 0,
      updated: 0,
      reportingLines: 0,
      errors: [],
    };

    let raw: Record<string, string>[];
    try {
      raw = parse(csv, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        bom: true, // Excel exports carry a BOM; without this the first column
                   // header becomes "﻿employee_no" and nothing matches.
      });
    } catch (err) {
      report.errors.push({ row: 0, message: `Malformed CSV: ${(err as Error).message}` });
      return report;
    }

    report.totalRows = raw.length;

    // --- Pass 1: structural validation ------------------------------------
    const rows: { line: number; data: ImportRow }[] = [];
    const seenNos = new Set<string>();

    raw.forEach((r, i) => {
      const line = i + 2; // +1 for zero-index, +1 for the header row
      const parsed = row.safeParse(r);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          report.errors.push({
            row: line,
            employeeNo: r.employee_no,
            message: `${issue.path.join('.')}: ${issue.message}`,
          });
        }
        return;
      }
      if (seenNos.has(parsed.data.employee_no)) {
        report.errors.push({
          row: line,
          employeeNo: parsed.data.employee_no,
          message: 'Duplicate employee_no within the file',
        });
        return;
      }
      seenNos.add(parsed.data.employee_no);
      rows.push({ line, data: parsed.data });
    });

    // --- Pass 2: referential validation -----------------------------------
    for (const { line, data } of rows) {
      const sup = data.supervisor_employee_no;
      if (!sup) continue;
      if (sup === data.employee_no) {
        report.errors.push({
          row: line,
          employeeNo: data.employee_no,
          message: 'Employee cannot be their own supervisor',
        });
      } else if (!seenNos.has(sup)) {
        report.errors.push({
          row: line,
          employeeNo: data.employee_no,
          message: `supervisor_employee_no '${sup}' is not present in this file`,
        });
      }
    }

    // Reporting cycles would make app.reports_to() traverse until its depth cap
    // on every permission check. Catch it here, where the fix is cheap.
    for (const cycle of this.findCycles(rows.map((r) => r.data))) {
      report.errors.push({
        row: 0,
        message: `Reporting cycle detected: ${cycle.join(' -> ')}`,
      });
    }

    if (report.errors.length > 0) return report;

    // --- Pass 3: write ------------------------------------------------------
    // Admin (BYPASSRLS) connection: bulk import has no authenticated user, so
    // under normal RLS every INSERT would be denied. This is an operator CLI
    // path only -- see DbService.withAdminContext.
    const writes = async (client: PoolClient) => {
      const orgId = await this.resolveOrg(client, orgCode);
      const idByNo = new Map<string, string>();

      for (const { data } of rows) {
        const departmentId = await this.resolveDepartment(client, orgId, data.department_code);
        const typeId = await this.resolveEmploymentType(client, orgId, data.employment_type_code);
        const positionId = data.position_title
          ? await this.resolvePosition(client, orgId, data.position_title, departmentId,
                                       data.job_family || null, data.job_level || null)
          : null;

        const upsert = await client.query<{ id: string; inserted: boolean }>(
          `INSERT INTO employee (org_id, employee_no, first_name, middle_name,
                                 last_name, work_email, hired_on, status)
                VALUES ($1, $2, $3, NULLIF($4,''), $5, NULLIF($6,'')::citext, $7, 'active')
           ON CONFLICT (org_id, employee_no) DO UPDATE
                   SET first_name = EXCLUDED.first_name,
                       middle_name = EXCLUDED.middle_name,
                       last_name  = EXCLUDED.last_name,
                       work_email = EXCLUDED.work_email
             RETURNING id, (xmax = 0) AS inserted`,
          [orgId, data.employee_no, data.first_name, data.middle_name ?? '',
           data.last_name, data.work_email ?? '', data.hired_on],
        );

        const upserted = upsert.rows[0];
        if (!upserted) {
          throw new Error(`Upsert returned no row for employee ${data.employee_no}`);
        }
        const employeeId = upserted.id;
        idByNo.set(data.employee_no, employeeId);
        if (upserted.inserted) report.created++;
        else report.updated++;

        // Employment is effective-dated from the hire date. On re-import the
        // existing open period is reused rather than duplicated -- the
        // exclusion constraint would reject an overlap anyway, and failing the
        // whole import because someone re-ran the file is unhelpful.
        // NOT EXISTS rather than ON CONFLICT: ON CONFLICT only works against
        // unique indexes, and overlap here is prevented by an EXCLUSION
        // constraint, which it cannot target.
        await client.query(
          `INSERT INTO employment (org_id, employee_id, position_id, department_id,
                                   employment_type_id, status, effective_from)
                SELECT $1, $2, $3, $4, $5, $6, $7
                 WHERE NOT EXISTS (
                       SELECT 1 FROM employment
                        WHERE employee_id = $2
                          AND daterange(effective_from, effective_to, '[)')
                              && daterange($7::date, NULL, '[)'))`,
          [orgId, employeeId, positionId, departmentId, typeId,
           data.employment_status, data.hired_on],
        );
      }

      // Reporting lines last, once every employee_no resolves to an id.
      for (const { data } of rows) {
        if (!data.supervisor_employee_no) continue;
        const employeeId = idByNo.get(data.employee_no)!;
        const supervisorId = idByNo.get(data.supervisor_employee_no)!;
        const res = await client.query(
          `INSERT INTO reporting_line (org_id, employee_id, supervisor_employee_id,
                                       line_type, effective_from)
                SELECT $1, $2, $3, 'primary', $4
                 WHERE NOT EXISTS (
                       SELECT 1 FROM reporting_line
                        WHERE employee_id = $2
                          AND line_type = 'primary'
                          AND daterange(effective_from, effective_to, '[)')
                              && daterange($4::date, NULL, '[)'))`,
          [orgId, employeeId, supervisorId, data.hired_on],
        );
        report.reportingLines += res.rowCount ?? 0;
      }

      await client.query('SELECT app.seed_baseline_roles($1)', [orgId]);
    };

    if (opts.client) {
      // Caller-owned transaction: it decides whether to commit or roll back,
      // so a dry run there discards reference data too.
      await writes(opts.client);
    } else {
      await this.db.withAdminContext(randomUUID(), async (client) => {
        await writes(client);
        if (opts.dryRun) {
          // Force a rollback so a dry run reports exactly what a real run would
          // do, having actually exercised every constraint.
          throw new DryRunRollback();
        }
      }).catch((err) => {
        if (err instanceof DryRunRollback) return;
        throw err;
      });
    }

    logger.info({ report }, 'employee import complete');
    return report;
  }

  /** Iterative DFS over the supervisor graph. */
  private findCycles(rows: ImportRow[]): string[][] {
    const parent = new Map<string, string>();
    for (const r of rows) {
      if (r.supervisor_employee_no) parent.set(r.employee_no, r.supervisor_employee_no);
    }
    const cycles: string[][] = [];
    const settled = new Set<string>();

    for (const start of parent.keys()) {
      if (settled.has(start)) continue;
      const path: string[] = [];
      const onPath = new Map<string, number>();
      let node: string | undefined = start;

      while (node && !settled.has(node)) {
        if (onPath.has(node)) {
          cycles.push([...path.slice(onPath.get(node)!), node]);
          break;
        }
        onPath.set(node, path.length);
        path.push(node);
        node = parent.get(node);
      }
      for (const n of path) settled.add(n);
    }
    return cycles;
  }

  private async resolveOrg(client: PoolClient, code: string): Promise<string> {
    const res = await client.query<{ id: string }>(
      'SELECT id FROM organization WHERE code = $1', [code]);
    if (!res.rows[0]) throw new Error(`Organization '${code}' does not exist`);
    return res.rows[0].id;
  }

  private async resolveDepartment(
    client: PoolClient, orgId: string, code: string,
  ): Promise<string> {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM department
        WHERE org_id = $1 AND code = $2
          AND (effective_to IS NULL OR effective_to > CURRENT_DATE)
        ORDER BY effective_from DESC LIMIT 1`,
      [orgId, code]);
    if (!res.rows[0]) throw new Error(`Department '${code}' does not exist`);
    return res.rows[0].id;
  }

  private async resolveEmploymentType(
    client: PoolClient, orgId: string, code: string,
  ): Promise<string> {
    const res = await client.query<{ id: string }>(
      'SELECT id FROM employment_type WHERE org_id = $1 AND code = $2', [orgId, code]);
    if (!res.rows[0]) throw new Error(`Employment type '${code}' does not exist`);
    return res.rows[0].id;
  }

  private async resolvePosition(
    client: PoolClient, orgId: string, title: string, departmentId: string,
    jobFamily: string | null = null, jobLevel: string | null = null,
  ): Promise<string> {
    const res = await client.query<{ id: string }>(
      `INSERT INTO position (org_id, title, department_id, job_family, job_level)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
         RETURNING id`,
      [orgId, title, departmentId, jobFamily, jobLevel]);
    if (res.rows[0]) return res.rows[0].id;

    // Existing position: fill in family/level if the file now supplies them and
    // the record predates those columns. Never blank an existing value.
    if (jobFamily || jobLevel) {
      await client.query(
        `UPDATE position
            SET job_family = COALESCE($4, job_family),
                job_level  = COALESCE($5, job_level)
          WHERE org_id = $1 AND title = $2 AND department_id = $3`,
        [orgId, title, departmentId, jobFamily, jobLevel]);
    }
    // ON CONFLICT DO NOTHING returns no row when the position already exists,
    // which is the normal path on re-import.
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM position WHERE org_id = $1 AND title = $2 AND department_id = $3',
      [orgId, title, departmentId]);
    const found = existing.rows[0];
    if (!found) throw new Error(`Failed to resolve position '${title}'`);
    return found.id;
  }
}

class DryRunRollback extends Error {}
