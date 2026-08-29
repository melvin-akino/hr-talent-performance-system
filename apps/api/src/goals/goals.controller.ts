import {
  Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Patch, Query,
  Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { GoalsService } from './goals.service';
import { KpiService } from './kpi.service';
import { DashboardService } from './dashboard.service';
import * as dto from './dto';

@Controller()
@UseGuards(AuthGuard)
export class GoalsController {
  constructor(
    private readonly goals: GoalsService,
    private readonly kpi: KpiService,
    private readonly dashboards: DashboardService,
  ) {}

  // --- KPI library --------------------------------------------------------

  @Get('kpi-definitions')
  listDefinitions(@Req() req: AuthenticatedRequest, @Query('includeRetired') retired?: string) {
    return this.kpi.listDefinitions(req.auth, retired === 'true');
  }

  @Post('kpi-definitions')
  createDefinition(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.kpi.createDefinition(req.auth, dto.createKpiDefinition.parse(body));
  }

  @Post('kpi-definitions/:code/versions')
  publishVersion(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    return this.kpi.publishNewVersion(req.auth, code, dto.createKpiDefinition.parse(body));
  }

  // --- Goal periods -------------------------------------------------------

  @Get('goal-periods')
  listPeriods(@Req() req: AuthenticatedRequest) {
    return this.kpi.listPeriods(req.auth);
  }

  @Post('goal-periods')
  createPeriod(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.kpi.createPeriod(req.auth, dto.createGoalPeriod.parse(body));
  }

  @Patch('goal-periods/:id/state')
  setPeriodState(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { state } = z.object({ state: z.enum(['open', 'locked', 'closed']) }).parse(body);
    return this.kpi.setPeriodState(req.auth, id, state);
  }

  @Get('goal-periods/:id/weight-violations')
  weightViolations(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.kpi.weightViolations(req.auth, id);
  }

  // --- Goals --------------------------------------------------------------

  @Post('goals')
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.goals.create(req.auth, dto.createGoal.parse(body));
  }

  @Get('goals/:id')
  byId(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.byId(req.auth, id);
  }

  @Patch('goals/:id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.goals.update(req.auth, id, dto.updateGoal.parse(body));
  }

  @Get('goals/:id/children')
  children(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.children(req.auth, id);
  }

  @Post('goals/:id/submit')
  submit(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.submit(req.auth, id);
  }

  @Post('goals/:id/approve')
  approve(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.approve(req.auth, id);
  }

  /** HCM releases a target the supervisor already approved (C5, §4.3). */
  @Post('goals/:id/hcm-approve')
  hcmApprove(@Req() req: AuthenticatedRequest,
             @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.hcmApprove(req.auth, id);
  }

  /** HCM sends a target back to be rewritten, with the reason attached. */
  @Post('goals/:id/hcm-revise')
  hcmRevise(@Req() req: AuthenticatedRequest,
            @Param('id', ParseUUIDPipe) id: string,
            @Body() body: unknown) {
    const { note } = z.object({
      note: z.string().trim().min(1).max(2000),
    }).parse(body);
    return this.goals.hcmRevise(req.auth, id, note);
  }

  @Post('goals/:id/complete')
  complete(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { outcome } = z.object({ outcome: z.enum(['achieved', 'missed']) }).parse(body);
    return this.goals.complete(req.auth, id, outcome);
  }

  @Post('goals/:id/cancel')
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { reason } = z.object({ reason: z.string().trim().min(1) }).parse(body);
    return this.goals.cancel(req.auth, id, reason);
  }

  // --- Check-ins (the KPI monitoring trail) --------------------------------

  @Post('goals/:id/checkins')
  checkIn(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.goals.checkIn(req.auth, id, dto.createCheckin.parse(body));
  }

  @Get('goals/:id/checkins')
  checkinHistory(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.checkinHistory(req.auth, id);
  }

  // --- Employee goal lists -------------------------------------------------

  @Get('employees/me/goals')
  myGoals(@Req() req: AuthenticatedRequest, @Query('periodId') periodId?: string) {
    return this.goals.listForEmployee(req.auth, req.auth.employeeId, periodId);
  }

  @Get('employees/:employeeId/goals')
  employeeGoals(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query('periodId') periodId?: string,
  ) {
    return this.goals.listForEmployee(req.auth, employeeId, periodId);
  }

  // --- Dashboards ----------------------------------------------------------

  @Get('dashboards/employee/:periodId')
  employeeDashboard(
    @Req() req: AuthenticatedRequest,
    @Param('periodId', ParseUUIDPipe) periodId: string,
  ) {
    return this.dashboards.employee(req.auth, periodId);
  }

  @Get('dashboards/manager/:periodId')
  managerDashboard(
    @Req() req: AuthenticatedRequest,
    @Param('periodId', ParseUUIDPipe) periodId: string,
  ) {
    return this.dashboards.manager(req.auth, periodId);
  }

  @Get('dashboards/hr/:periodId')
  hrDashboard(
    @Req() req: AuthenticatedRequest,
    @Param('periodId', ParseUUIDPipe) periodId: string,
  ) {
    return this.dashboards.hr(req.auth, periodId);
  }

  @Get('dashboards/export/:periodId')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="goals.csv"')
  exportCsv(
    @Req() req: AuthenticatedRequest,
    @Param('periodId', ParseUUIDPipe) periodId: string,
  ) {
    return this.dashboards.exportCsv(req.auth, periodId);
  }
}
