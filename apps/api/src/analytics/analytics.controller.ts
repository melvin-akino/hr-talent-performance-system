import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { AnalyticsService, setPotential } from './analytics.service';

@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('cycles/:id/distribution')
  distribution(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.analytics.distribution(req.auth, id);
  }

  @Get('cycles/:id/calibration-movement')
  calibrationMovement(
    @Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.analytics.calibrationMovement(req.auth, id);
  }

  @Get('cycles/:id/rater-comparison')
  raterComparison(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.analytics.raterComparison(req.auth, id);
  }

  @Get('cycles/:id/nine-box')
  nineBox(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.analytics.nineBox(req.auth, id);
  }

  @Get('cycles/:id/progress')
  progress(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.analytics.progress(req.auth, id);
  }

  @Get('employees/me/trend')
  myTrend(@Req() req: AuthenticatedRequest) {
    return this.analytics.trend(req.auth, req.auth.employeeId);
  }

  @Get('employees/:id/trend')
  trend(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.analytics.trend(req.auth, id);
  }

  /** Potential is recorded during calibration, separately from performance. */
  @Post('review-summaries/:id/potential')
  setPotential(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.analytics.setPotential(req.auth, id, setPotential.parse(body));
  }
}
