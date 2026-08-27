import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EvaluationsService, openEvaluation, scoreLines } from './evaluations.service';

@Controller('evaluations')
@UseGuards(AuthGuard)
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query('employeeId') employeeId?: string) {
    return this.evaluations.list(req.auth, employeeId);
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluations.get(req.auth, id);
  }

  @Post()
  open(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.evaluations.open(req.auth, openEvaluation.parse(body));
  }

  @Post(':id/scores')
  score(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string,
        @Body() body: unknown) {
    return this.evaluations.score(req.auth, id, scoreLines.parse(body));
  }

  @Post(':id/submit')
  submit(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluations.submit(req.auth, id);
  }

  @Post(':id/acknowledge')
  acknowledge(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluations.acknowledge(req.auth, id);
  }
}
