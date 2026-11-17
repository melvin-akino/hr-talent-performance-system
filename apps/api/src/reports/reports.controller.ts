import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import {
  ReportsService,
  reportQuery,
  workforceQuery,
  statutorySummaryQuery,
  payrollRegisterQuery,
  attendanceAnalysisQuery,
  leaveUtilizationQuery,
  performanceDistributionQuery,
} from './reports.service';

/**
 * Enterprise & SME Multi-Tenant Report Builder.
 * Exposes executive and operational reports across Performance, Workforce,
 * Statutory Payroll, Attendance, and Statutory Leaves with CSV streaming.
 */
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Dropdown filter options scoped to the authenticated caller */
  @Get('evaluations/options')
  options(@Req() req: AuthenticatedRequest) {
    return this.reports.options(req.auth);
  }

  @Get('options')
  allOptions(@Req() req: AuthenticatedRequest) {
    return this.reports.options(req.auth);
  }

  // --- Evaluation History ---
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

  // --- 1. Workforce & Demographics ---
  @Get('workforce')
  workforce(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.workforceReport(req.auth, workforceQuery.parse(q));
  }

  @Get('workforce.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="workforce-demographics-report.csv"')
  exportWorkforceCsv(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.exportWorkforceCsv(req.auth, workforceQuery.parse(q));
  }

  // --- 2. Statutory Contributions Master Summary ---
  @Get('statutory-summary')
  statutorySummary(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.statutorySummaryReport(req.auth, statutorySummaryQuery.parse(q));
  }

  @Get('statutory-summary.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="statutory-contributions-master-summary.csv"')
  exportStatutorySummaryCsv(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.exportStatutorySummaryCsv(req.auth, statutorySummaryQuery.parse(q));
  }

  // --- 3. Payroll Register & Branch Cost Summary ---
  @Get('payroll-register')
  payrollRegister(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.payrollRegisterReport(req.auth, payrollRegisterQuery.parse(q));
  }

  @Get('payroll-register.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payroll-register-cost-summary.csv"')
  exportPayrollRegisterCsv(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.exportPayrollRegisterCsv(req.auth, payrollRegisterQuery.parse(q));
  }

  // --- 4. Attendance, Tardiness & Overtime Analysis ---
  @Get('attendance-analysis')
  attendanceAnalysis(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.attendanceAnalysisReport(req.auth, attendanceAnalysisQuery.parse(q));
  }

  @Get('attendance-analysis.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="attendance-tardiness-overtime-analysis.csv"')
  exportAttendanceAnalysisCsv(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.exportAttendanceAnalysisCsv(req.auth, attendanceAnalysisQuery.parse(q));
  }

  // --- 5. Leave Balances & Statutory Utilization ---
  @Get('leave-utilization')
  leaveUtilization(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.leaveUtilizationReport(req.auth, leaveUtilizationQuery.parse(q));
  }

  @Get('leave-utilization.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="leave-balances-utilization-report.csv"')
  exportLeaveUtilizationCsv(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.exportLeaveUtilizationCsv(req.auth, leaveUtilizationQuery.parse(q));
  }

  // --- 6. Performance Bell Curve & Rating Distribution ---
  @Get('performance-distribution')
  performanceDistribution(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.performanceDistributionReport(req.auth, performanceDistributionQuery.parse(q));
  }

  @Get('performance-distribution.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="performance-bell-curve-distribution.csv"')
  exportPerformanceDistributionCsv(@Req() req: AuthenticatedRequest, @Query() q: unknown) {
    return this.reports.exportPerformanceDistributionCsv(req.auth, performanceDistributionQuery.parse(q));
  }

  // --- 7. Executive Intelligence & Outflow Analytics ---
  @Get('executive-dashboard')
  executiveDashboard(@Req() req: AuthenticatedRequest) {
    return this.reports.executiveDashboard(req.auth);
  }
}

