import {
  Body, Controller, ForbiddenException, Get, Header, Post, Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { DbService, type RequestContext } from '../db/db.service';
import { Ph201ImportService, TEMPLATE_COLUMNS, buildTemplate } from './ph201-import.service';

const importBody = z.object({
  // The file's text, read in the browser. Not multipart: a 201 file is a few
  // hundred rows of text, and adding an upload pipeline buys nothing but
  // another thing to configure wrong.
  csv: z.string().min(1).max(5_000_000),
});

/**
 * The 201 importer, over HTTP.
 *
 * TENANCY IS THE WHOLE RISK HERE, so it is worth being explicit.
 *
 * Ph201ImportService runs under `withAdminContext` — it bypasses RLS, because
 * it has to create departments, ranks and employment types that do not exist
 * yet, and it takes the organisation as a PARAMETER. That is safe for a CLI an
 * operator runs against a database they already administer. Exposed naively it
 * would be a tenant boundary decided by the caller: post somebody else's org
 * code and the import lands in their company.
 *
 * So this controller does two things before it hands anything to the importer:
 *
 *   1. asserts `employee:write` as the CALLER, inside their own RLS context;
 *   2. reads the org code from the caller's own employee row.
 *
 * The request body carries the file and nothing else. There is deliberately no
 * way to say which organisation to import into.
 */
@Controller('import')
@UseGuards(AuthGuard)
export class ImportController {
  constructor(
    private readonly ph201: Ph201ImportService,
    private readonly db: DbService,
  ) {}

  /**
   * A blank file with the right headers.
   *
   * Generated from the parser's own alias table rather than written out here.
   * A hand-maintained template drifts from the code that reads it, silently:
   * this repository's own seed file carried `job_level=R11` where the ladder
   * needed `rank_no=11`, so every import quietly produced no ranks at all and
   * nothing said so. A template that cannot disagree with the parser is the
   * only kind worth shipping.
   */
  @Get('template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="201-template.csv"')
  template(): string {
    return buildTemplate();
  }

  /** What the file would do. Changes nothing. */
  @Post('employees/preview')
  async preview(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const { csv } = importBody.parse(body);
    const orgCode = await this.authorise(req.auth);
    return this.ph201.import(csv, orgCode, { dryRun: true, as: req.auth });
  }

  /** The same run, committed. */
  @Post('employees')
  async apply(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const { csv } = importBody.parse(body);
    const orgCode = await this.authorise(req.auth);
    return this.ph201.import(csv, orgCode, { dryRun: false, as: req.auth });
  }

  /**
   * Returns the caller's org code, having established they may write employees.
   *
   * Both halves run in the caller's context, so the permission check is the
   * same predicate every other screen is subject to and the org code is the
   * one RLS would have scoped them to anyway.
   */
  private async authorise(ctx: RequestContext): Promise<string> {
    return this.db.withContext(ctx, async (client) => {
      // NOT app.can_access('employee', 'write', NULL). That predicate is
      // target-scoped and a 201 file's people have no rows yet, so it returns
      // FALSE always -- see migration 0044, which exists for this reason.
      //
      // The SAME function the INSERT policy uses, deliberately. This check only
      // exists to fail early with a sentence the operator can act on; RLS is
      // what actually enforces it, row by row, and asking a different question
      // here would eventually mean answering differently.
      const ok = await client.query<{ ok: boolean }>(
        `SELECT app.can_create_employee(app.current_org_id()) AS ok`);
      if (!ok.rows[0]?.ok) {
        throw new ForbiddenException(
          'Importing staff needs organisation-wide employee:write permission.');
      }

      const org = await client.query<{ code: string }>(
        `SELECT o.code FROM organization o
           JOIN employee e ON e.org_id = o.id
          WHERE e.id = $1`, [ctx.employeeId]);
      const code = org.rows[0]?.code;
      if (!code) throw new ForbiddenException('No organisation for this account');
      return code;
    });
  }

  /** What the template contains, for the screen that explains it. */
  @Get('columns')
  columns() {
    return TEMPLATE_COLUMNS;
  }
}
