import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import {
  CompetenciesService, assessCompetencies, createFramework, mapPosition,
} from './competencies.service';

@Controller()
@UseGuards(AuthGuard)
export class CompetenciesController {
  constructor(private readonly competencies: CompetenciesService) {}

  // --- Frameworks ----------------------------------------------------------

  @Get('competency-frameworks')
  list(@Req() req: AuthenticatedRequest, @Query('includeRetired') retired?: string) {
    return this.competencies.listFrameworks(req.auth, retired === 'true');
  }

  @Post('competency-frameworks')
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.competencies.createFramework(req.auth, createFramework.parse(body));
  }

  @Post('competency-frameworks/:id/publish')
  publish(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.competencies.publishFramework(req.auth, id);
  }

  // --- Position mapping ----------------------------------------------------

  @Post('position-competencies')
  map(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.competencies.mapPosition(req.auth, mapPosition.parse(body));
  }

  @Get('positions/:id/competencies')
  requirements(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.competencies.positionRequirements(req.auth, id);
  }

  // --- Assessment ----------------------------------------------------------

  @Post('competency-assessments')
  assess(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.competencies.assess(req.auth, assessCompetencies.parse(body));
  }

  @Get('employees/:id/competency-assessments')
  history(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('competencyId') competencyId?: string,
  ) {
    return this.competencies.assessmentHistory(req.auth, id, competencyId);
  }

  // --- Gap analysis --------------------------------------------------------

  @Get('employees/me/competency-gaps')
  myGaps(@Req() req: AuthenticatedRequest, @Query('asOf') asOf?: string) {
    return this.competencies.gaps(req.auth, req.auth.employeeId, asOf);
  }

  @Get('employees/:id/competency-gaps')
  gaps(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.competencies.gaps(req.auth, id, asOf);
  }

  @Get('job-families')
  jobFamilies(@Req() req: AuthenticatedRequest) {
    return this.competencies.jobFamilies(req.auth);
  }

  /** The Phase 4 exit criterion: a gap report for one job family. */
  @Get('job-families/:family/competency-gaps')
  familyGaps(
    @Req() req: AuthenticatedRequest,
    @Param('family') family: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.competencies.jobFamilyGaps(req.auth, family, asOf);
  }
}
