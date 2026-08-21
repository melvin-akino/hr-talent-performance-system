import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import {
  DevelopmentService, assignLearning, createCareerPath, createLearningResource,
  createPlan, updateAction,
} from './development.service';

@Controller()
@UseGuards(AuthGuard)
export class DevelopmentController {
  constructor(private readonly development: DevelopmentService) {}

  // --- Development plans ---------------------------------------------------

  @Get('development-plans')
  listPlans(@Req() req: AuthenticatedRequest, @Query('employeeId') employeeId?: string) {
    return this.development.listPlans(req.auth, employeeId);
  }

  @Get('employees/me/development-plans')
  myPlans(@Req() req: AuthenticatedRequest) {
    return this.development.listPlans(req.auth, req.auth.employeeId);
  }

  @Post('development-plans')
  createPlan(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.development.createPlan(req.auth, createPlan.parse(body));
  }

  @Get('development-plans/:id')
  plan(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.development.planById(req.auth, id);
  }

  @Patch('development-plans/:id/state')
  setPlanState(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { state } = z.object({
      state: z.enum(['active', 'completed', 'cancelled']),
    }).parse(body);
    return this.development.setPlanState(req.auth, id, state);
  }

  @Patch('dev-actions/:id')
  updateAction(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.development.updateAction(req.auth, id, updateAction.parse(body));
  }

  // --- Learning library ----------------------------------------------------

  @Get('learning-resources')
  listResources(
    @Req() req: AuthenticatedRequest,
    @Query('competencyId') competencyId?: string,
  ) {
    return this.development.listResources(req.auth, competencyId);
  }

  @Post('learning-resources')
  createResource(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.development.createResource(req.auth, createLearningResource.parse(body));
  }

  /** The "HR library per employee" view. */
  @Get('employees/me/learning')
  myLearning(@Req() req: AuthenticatedRequest) {
    return this.development.myLearning(req.auth);
  }

  @Get('employees/:id/learning')
  employeeLearning(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.development.myLearning(req.auth, id);
  }

  @Post('learning-assignments')
  assign(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.development.assign(req.auth, assignLearning.parse(body));
  }

  @Patch('learning-assignments/:id/state')
  setAssignmentState(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { state } = z.object({
      state: z.enum(['assigned', 'in_progress', 'completed', 'waived']),
    }).parse(body);
    return this.development.setAssignmentState(req.auth, id, state);
  }

  // --- Career paths & recommendations --------------------------------------

  @Get('career-paths')
  careerPaths(@Req() req: AuthenticatedRequest) {
    return this.development.listCareerPaths(req.auth);
  }

  @Post('career-paths')
  createCareerPath(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.development.createCareerPath(req.auth, createCareerPath.parse(body));
  }

  @Get('employees/me/career-options')
  myCareerOptions(@Req() req: AuthenticatedRequest) {
    return this.development.careerOptions(req.auth);
  }

  @Get('employees/:id/career-options')
  careerOptions(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.development.careerOptions(req.auth, id);
  }

  /** Library resources that address the employee's current competency gaps. */
  @Get('employees/me/learning-recommendations')
  myRecommendations(@Req() req: AuthenticatedRequest) {
    return this.development.recommendations(req.auth);
  }

  @Get('employees/:id/learning-recommendations')
  recommendations(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.development.recommendations(req.auth, id);
  }
}
