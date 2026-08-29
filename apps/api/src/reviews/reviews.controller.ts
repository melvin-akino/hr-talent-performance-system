import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { ReviewsService, createCycle, saveResponses } from './reviews.service';
import {
  FormsService, assignTemplate, createRatingScale, createTemplate, formSchema,
} from './forms.service';
import {
  EvaluationDefinitionsService, createDefinition, retireDefinition,
  updateDefinition,
} from './evaluation-definitions.service';

@Controller()
@UseGuards(AuthGuard)
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly forms: FormsService,
    private readonly definitions: EvaluationDefinitionsService,
  ) {}

  // --- Evaluation definitions (C1) -----------------------------------------
  //
  // The client's five evaluation types are five rows here, not five features.

  @Get('evaluation-definitions')
  listDefinitions(@Req() req: AuthenticatedRequest,
                  @Query('includeRetired') includeRetired?: string) {
    return this.definitions.list(req.auth, includeRetired === 'true');
  }

  @Post('evaluation-definitions')
  createDefinition(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.definitions.create(req.auth, createDefinition.parse(body));
  }

  @Patch('evaluation-definitions/:id')
  updateDefinition(@Req() req: AuthenticatedRequest,
                   @Param('id', ParseUUIDPipe) id: string,
                   @Body() body: unknown) {
    return this.definitions.update(req.auth, id, updateDefinition.parse(body));
  }

  @Patch('evaluation-definitions/:id/active')
  retireDefinition(@Req() req: AuthenticatedRequest,
                   @Param('id', ParseUUIDPipe) id: string,
                   @Body() body: unknown) {
    const { isActive } = retireDefinition.parse(body);
    return this.definitions.setActive(req.auth, id, isActive);
  }

  // --- Rating scales & form templates --------------------------------------

  @Get('rating-scales')
  listScales(@Req() req: AuthenticatedRequest) {
    return this.forms.listScales(req.auth);
  }

  @Post('rating-scales')
  createScale(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.forms.createScale(req.auth, createRatingScale.parse(body));
  }

  @Get('form-templates')
  listTemplates(@Req() req: AuthenticatedRequest) {
    return this.forms.listTemplates(req.auth);
  }

  @Post('form-templates')
  createTemplate(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.forms.createTemplate(req.auth, createTemplate.parse(body));
  }

  @Post('form-templates/:id/versions')
  publishVersion(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = z.object({
      schema: formSchema,
      ratingScaleId: z.string().uuid().optional(),
    }).parse(body);
    return this.forms.publishVersion(req.auth, id, input);
  }

  @Get('form-versions/:id')
  getVersion(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.getVersion(req.auth, id);
  }

  @Get('form-assignments')
  listAssignments(@Req() req: AuthenticatedRequest) {
    return this.forms.listAssignments(req.auth);
  }

  @Post('form-assignments')
  assign(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.forms.assign(req.auth, assignTemplate.parse(body));
  }

  /** Preview which form an employee would receive. */
  @Get('form-assignments/resolve/:employeeId')
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.forms.resolveFor(req.auth, employeeId);
  }

  // --- Review cycles -------------------------------------------------------

  @Get('review-cycles')
  listCycles(@Req() req: AuthenticatedRequest) {
    return this.reviews.listCycles(req.auth);
  }

  @Post('review-cycles')
  createCycle(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.reviews.createCycle(req.auth, createCycle.parse(body));
  }

  @Post('review-cycles/:id/generate')
  generate(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { asOf } = z.object({
      asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(body ?? {});
    return this.reviews.generateInstances(req.auth, id, asOf);
  }

  @Patch('review-cycles/:id/state')
  setState(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { state } = z.object({
      state: z.enum(['open', 'calibration', 'closed']),
    }).parse(body);
    return this.reviews.setCycleState(req.auth, id, state);
  }

  @Get('review-cycles/:id/summaries')
  summaries(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.summaries(req.auth, id);
  }

  // --- Reviewer inbox ------------------------------------------------------

  @Get('reviews/assigned')
  assigned(@Req() req: AuthenticatedRequest, @Query('cycleId') cycleId?: string) {
    return this.reviews.myAssignments(req.auth, cycleId);
  }

  @Get('reviews/mine')
  mine(@Req() req: AuthenticatedRequest) {
    return this.reviews.myReviews(req.auth);
  }

  @Get('reviews/:id')
  instance(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.getInstance(req.auth, id);
  }

  @Get('reviews/:id/goals')
  goalContext(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.goalContext(req.auth, id);
  }

  @Patch('reviews/:id')
  saveDraft(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reviews.saveDraft(req.auth, id, saveResponses.parse(body));
  }

  @Post('reviews/:id/submit')
  submit(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.submit(req.auth, id);
  }

  @Post('reviews/:id/return')
  returnForRevision(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { reason } = z.object({ reason: z.string().trim().min(1) }).parse(body);
    return this.reviews.returnForRevision(req.auth, id, reason);
  }

  // --- Calibration & sign-off ----------------------------------------------

  @Post('review-summaries/:id/calibrate')
  calibrate(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = z.object({
      calibratedRating: z.number(),
      calibrationNotes: z.string().trim().optional(),
    }).parse(body);
    return this.reviews.calibrate(req.auth, id, input);
  }

  @Post('review-summaries/:id/signoff')
  signOff(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.signOff(req.auth, id);
  }

  @Post('review-summaries/:id/acknowledge')
  acknowledge(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { comment } = z.object({ comment: z.string().trim().optional() })
      .parse(body ?? {});
    return this.reviews.acknowledge(req.auth, id, comment);
  }
}
