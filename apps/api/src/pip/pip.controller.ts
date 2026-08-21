import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import {
  PipService, assessMilestone, closePip, createPip, createPipReview,
} from './pip.service';
import { MonitoringService } from './monitoring.service';

@Controller()
@UseGuards(AuthGuard)
export class PipController {
  constructor(
    private readonly pip: PipService,
    private readonly monitoring: MonitoringService,
  ) {}

  // --- PIP -----------------------------------------------------------------

  @Get('pips')
  list(
    @Req() req: AuthenticatedRequest,
    @Query('employeeId') employeeId?: string,
    @Query('state') state?: string,
  ) {
    return this.pip.list(req.auth, { employeeId, state });
  }

  @Post('pips')
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.pip.create(req.auth, createPip.parse(body));
  }

  @Get('pips/:id')
  byId(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.pip.byId(req.auth, id);
  }

  @Get('pips/:id/milestones')
  milestones(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.pip.milestones(req.auth, id);
  }

  @Get('pips/:id/reviews')
  reviews(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.pip.reviews(req.auth, id);
  }

  @Post('pips/:id/activate')
  activate(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.pip.activate(req.auth, id);
  }

  /** Only the subject employee may acknowledge. */
  @Post('pips/:id/acknowledge')
  acknowledge(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.pip.acknowledge(req.auth, id);
  }

  @Post('pips/:id/reviews')
  addReview(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.pip.addReview(req.auth, id, createPipReview.parse(body));
  }

  @Post('pips/:id/close')
  close(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.pip.close(req.auth, id, closePip.parse(body));
  }

  @Post('pips/:id/cancel')
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { reason } = z.object({ reason: z.string().trim().min(1) }).parse(body);
    return this.pip.cancel(req.auth, id, reason);
  }

  @Post('pip-milestones/:id/assess')
  assess(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.pip.assessMilestone(req.auth, id, assessMilestone.parse(body));
  }

  // --- Monitoring ----------------------------------------------------------

  @Get('monitoring/:periodId/overdue')
  overdue(@Req() req: AuthenticatedRequest, @Param('periodId', ParseUUIDPipe) periodId: string) {
    return this.monitoring.overdue(req.auth, periodId);
  }

  @Get('monitoring/:periodId/escalations')
  escalations(
    @Req() req: AuthenticatedRequest,
    @Param('periodId', ParseUUIDPipe) periodId: string,
  ) {
    return this.monitoring.escalations(req.auth, periodId);
  }

  @Get('monitoring/:periodId/compliance')
  compliance(
    @Req() req: AuthenticatedRequest,
    @Param('periodId', ParseUUIDPipe) periodId: string,
  ) {
    return this.monitoring.complianceSummary(req.auth, periodId);
  }

  @Get('goals/:id/trend')
  trend(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.monitoring.trend(req.auth, id);
  }
}
