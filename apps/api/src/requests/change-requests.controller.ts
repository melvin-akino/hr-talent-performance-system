import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { ChangeRequestsService, createRequest, decide } from './change-requests.service';

/**
 * Requests (§7.9, F4).
 *
 * No permission check here, for the same reason the report builder has none:
 * every question this controller could ask is answered row by row by RLS on
 * change_request, under the caller's own identity. A guard would be a second
 * opinion about visibility, and two opinions is how they diverge.
 */
@Controller('requests')
@UseGuards(AuthGuard)
export class ChangeRequestsController {
  constructor(private readonly requests: ChangeRequestsService) {}

  /** Everything the caller raised, plus everything they may decide. */
  @Get()
  list(@Req() req: AuthenticatedRequest, @Query('state') state?: string) {
    return this.requests.list(req.auth, state);
  }

  @Get(':id')
  byId(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.byId(req.auth, id);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.requests.create(req.auth, createRequest.parse(body));
  }

  @Patch(':id/decision')
  decide(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.requests.decide(req.auth, id, decide.parse(body));
  }

  @Patch(':id/withdrawal')
  withdraw(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.withdraw(req.auth, id);
  }
}
