import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService, type RequestContext } from '../db/db.service';
import { toCsv } from '../common/csv';

/**
 * The report builder (requirements §7.2, F2).
 *
 * ALL OF THE WORK IS IN app.evaluation_report, AND THAT IS THE POINT.
 *
 * This service validates a query string and hands it to one SQL function. It
 * does not assemble the report, does not decide who may appear in it, and
 * contains no branch on role: the same call returns a section to a Department
 * Head and the organisation to HCM because the function runs as the caller and
 * every source underneath filters itself.
 *
 * That also means the report can never show what the screen behind it would
 * not — an unreleased review stays invisible here because review_summary's own
 * policy says so, not because this file remembered to ask.
 */

/**
 * The filters, as the query string carries them.
 *
 * Arrays arrive comma-separated because that is what a link in an email looks
 * like; a report is the thing people bookmark and send to each other, so the
 * URL has to survive being pasted. zod's enum list is the whole validation —
 * an unknown `kind` is a 400 rather than a silently empty report, which is the
 * difference between "you asked for something that does not exist" and "there
 * is nothing there", and only one of those is true.
 */
const csvList = <T extends string>(values: readonly [T, ...T[]]) =>
  z.string()
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();

export const reportQuery = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  kinds: csvList(['review', 'task_evaluation', 'pip', 'competency', 'employment_event'] as const),
  evalTypes: csvList(['probationary', 'annual', 'semi_annual', 'project', 'kpi'] as const),
  departmentId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  // Free text, not an enum: it matches a PIP outcome ('successful'), and it
  // also matches a review's rating. Constraining it to pip_outcome would make
  // the filter useless for every other source and would have to be widened the
  // first time somebody asks for "everyone who scored 5".
  results: z.string().trim().min(1).max(200)
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.string()).min(1))
    .optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
});

export type ReportQuery = z.infer<typeof reportQuery>;

interface ReportRow {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  department: string | null;
  occurredOn: string;
  kind: string;
  evalType: string | null;
  title: string;
  detail: string | null;
  result: string | null;
  refId: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  async run(ctx: RequestContext, q: ReportQuery): Promise<{
    rows: ReportRow[];
    truncated: boolean;
    limit: number;
  }> {
    const limit = q.limit ?? 1000;

    const rows = await this.db.withContext(ctx, async (client) => {
      const res = await client.query<ReportRow>(
        `SELECT employee_id   AS "employeeId",
                employee_no   AS "employeeNo",
                employee_name AS "employeeName",
                department,
                occurred_on::text AS "occurredOn",
                kind::text        AS kind,
                eval_type::text   AS "evalType",
                title, detail, result,
                ref_id AS "refId"
           FROM app.evaluation_report(
                  $1::date, $2::date,
                  $3::timeline_kind[], $4::evaluation_type[],
                  $5::uuid, $6::text, $7::text[], $8::int)`,
        [
          q.from ?? null, q.to ?? null,
          q.kinds ?? null, q.evalTypes ?? null,
          q.departmentId ?? null, q.name ?? null, q.results ?? null,
          // One more than asked for, so the caller can be TOLD the report was
          // cut rather than reading a truncated list as a complete one. A
          // report that silently stops is a report somebody makes a decision
          // on.
          limit + 1,
        ],
      );
      return res.rows;
    });

    return {
      rows: rows.slice(0, limit),
      truncated: rows.length > limit,
      limit,
    };
  }

  /**
   * The same report as a file.
   *
   * Deliberately the same query rather than a wider one: a CSV that contains
   * more than the screen showed is a confidentiality surprise waiting to
   * happen, and an export whose filters mean something slightly different from
   * the filters above it is worse than no export.
   */
  async exportCsv(ctx: RequestContext, q: ReportQuery): Promise<string> {
    const { rows } = await this.run(ctx, { ...q, limit: q.limit ?? 10_000 });
    return toCsv(rows.map((r) => ({
      'Employee No': r.employeeNo,
      Employee: r.employeeName,
      Department: r.department,
      Date: r.occurredOn,
      Source: r.kind.replace(/_/g, ' '),
      'Evaluation Type': r.evalType?.replace(/_/g, ' ') ?? '',
      Title: r.title,
      Detail: r.detail,
      Result: r.result,
    })));
  }

  /**
   * What can be filtered on, for the screen to render.
   *
   * The departments come from the database under the caller's RLS, so the
   * dropdown offers a Department Head their own units and nothing else — the
   * filter list is scoped by the same rule as the report it filters. The
   * enums are listed here rather than queried because they are compiled into
   * the zod schema above and a list that disagreed with the validator would
   * offer options that return 400.
   */
  async options(ctx: RequestContext) {
    const departments = await this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT id, code, name, unit_type AS "unitType"
           FROM department
          WHERE effective_to IS NULL
          ORDER BY name`);
      return res.rows;
    });

    return {
      departments,
      kinds: [
        { value: 'review', label: 'Review' },
        { value: 'task_evaluation', label: 'Task evaluation' },
        { value: 'pip', label: 'Improvement plan' },
        { value: 'competency', label: 'Competency assessment' },
        { value: 'employment_event', label: 'Employment event' },
      ],
      evalTypes: [
        { value: 'probationary', label: 'Probationary' },
        { value: 'annual', label: 'Annual' },
        { value: 'semi_annual', label: 'Semi-annual' },
        { value: 'project', label: 'Project / term' },
        { value: 'kpi', label: 'KPI' },
      ],
      // Offered as a convenience on the results box. Not a closed list — see
      // the schema note on `results`.
      pipOutcomes: ['successful', 'extended', 'unsuccessful', 'withdrawn'],
    };
  }
}
