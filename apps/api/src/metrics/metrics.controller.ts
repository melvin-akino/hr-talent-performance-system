import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import {
  MetricsService, addScorecardItem, assignScorecard, createIndicator, createScorecard,
} from './metrics.service';

@Controller()
@UseGuards(AuthGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  // --- catalogue -----------------------------------------------------------

  @Get('task-indicators')
  listIndicators(@Req() req: AuthenticatedRequest) {
    return this.metrics.listIndicators(req.auth);
  }

  @Post('task-indicators')
  createIndicator(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.metrics.createIndicator(req.auth, createIndicator.parse(body));
  }

  // --- scorecards ----------------------------------------------------------

  @Get('scorecards')
  list(@Req() req: AuthenticatedRequest) {
    return this.metrics.listScorecards(req.auth);
  }

  @Post('scorecards')
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.metrics.createScorecard(req.auth, createScorecard.parse(body));
  }

  @Get('scorecards/:id')
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.metrics.getScorecard(req.auth, id);
  }

  @Post('scorecards/:id/items')
  addItem(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
          @Body() body: unknown) {
    return this.metrics.addItem(req.auth, id, addScorecardItem.parse(body));
  }

  @Delete('scorecard-items/:id')
  removeItem(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.metrics.removeItem(req.auth, id);
  }

  @Post('scorecards/:id/assignments')
  assign(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
         @Body() body: unknown) {
    return this.metrics.assign(req.auth, id, assignScorecard.parse(body));
  }

  /**
   * What one person is measured on. Returns null rather than 404 when nothing is
   * loaded for them yet — during the load that is the normal state, not a fault.
   */
  @Get('employees/:id/scorecard')
  forEmployee(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
              @Query('asOf') asOf?: string) {
    return this.metrics.forEmployee(req.auth, id, asOf);
  }
}
