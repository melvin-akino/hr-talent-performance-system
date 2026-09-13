import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { ReportsService, reportQuery } from './reports.service';

/**
 * The report builder (§7.2, F2).
 *
 * GET, with the filters in the query string, because a report is something
 * people send to each other. A POST body would make every saved report a thing
 * that has to be re-entered by hand.
 *
 * There is NO permission check in this controller, deliberately. The only
 * question it could ask is "may you run reports", and the answer that matters
 * is "on whom" — which app.evaluation_report answers row by row under the
 * caller's own identity. A guard here would be either redundant or, worse, a
 * second and different opinion about visibility.
 */
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** What the filters can offer, scoped to the caller. */
  @Get('evaluations/options')
  options(@Req() req: AuthenticatedRequest) {
    return this.reports.options(req.auth);
  }

  @Get('evaluations')
  run(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.reports.run(req.auth, reportQuery.parse(query));
  }

  @Get('evaluations.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="evaluation-report.csv"')
  exportCsv(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.reports.exportCsv(req.auth, reportQuery.parse(query));
  }
}
