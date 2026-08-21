import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { NotificationsService, setPreference } from './notifications.service';
import { FeedbackService, createFeedback, replyToFeedback } from '../feedback/feedback.service';

@Controller()
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly feedback: FeedbackService,
  ) {}

  // --- Feedback ------------------------------------------------------------

  @Get('feedback')
  listFeedback(@Req() req: AuthenticatedRequest) {
    return this.feedback.list(req.auth);
  }

  @Get('employees/:id/feedback')
  feedbackFor(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.feedback.list(req.auth, { subjectEmployeeId: id });
  }

  @Post('feedback')
  createFeedback(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.feedback.create(req.auth, createFeedback.parse(body));
  }

  @Get('feedback/:id')
  feedbackThread(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.feedback.byId(req.auth, id);
  }

  @Post('feedback/:id/replies')
  reply(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.feedback.reply(req.auth, id, replyToFeedback.parse(body));
  }

  @Post('feedback/:id/close')
  closeFeedback(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.feedback.close(req.auth, id);
  }

  // --- Notification preferences & history ----------------------------------

  @Get('notifications/preferences')
  preferences(@Req() req: AuthenticatedRequest) {
    return this.notifications.myPreferences(req.auth);
  }

  @Put('notifications/preferences')
  setPreference(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.notifications.setPreference(req.auth, setPreference.parse(body));
  }

  /** My own notification history — what was sent, held, or failed. */
  @Get('notifications')
  mine(@Req() req: AuthenticatedRequest) {
    return this.notifications.myNotifications(req.auth);
  }

  @Get('notifications/templates')
  templates(@Req() req: AuthenticatedRequest) {
    return this.notifications.listTemplates(req.auth);
  }

  /** Operational view for HR: queue depth and anything stuck. */
  @Get('notifications/queue-health')
  queueHealth(@Req() req: AuthenticatedRequest) {
    return this.notifications.queueHealth(req.auth);
  }

  @Post('notifications/templates')
  createTemplate(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const input = z.object({
      code: z.string().trim().min(1).max(64),
      description: z.string().trim().optional(),
      subject: z.string().trim().min(1),
      bodyText: z.string().trim().min(1),
      bodyHtml: z.string().trim().optional(),
    }).parse(body);
    return this.notifications.createTemplate(req.auth, input);
  }
}
