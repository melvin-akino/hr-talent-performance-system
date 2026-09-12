import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EmployeesService } from './employees.service';
import {
  EmployeeLifecycleService, correctEmployee, createEmployee, recordEvent,
  separate,
} from './employee-lifecycle.service';


const listQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  afterLastName: z.string().optional(),
  afterId: z.string().uuid().optional(),
  asOf: z.coerce.date().optional(),
});

@Controller('employees')
@UseGuards(AuthGuard)
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly lifecycle: EmployeeLifecycleService,
  ) {}

  /*
   * THE FOUR OPERATIONS OF D-016, AND WHY THERE IS NO PUT.
   *
   * Employment is effective-dated. Correcting a misspelt surname and recording
   * a promotion are one word in English and opposites in the data: a correction
   * rewrites history because the old value was never true, a change appends to
   * it because the old value WAS true until a date.
   *
   * A single update endpoint would let a transfer overwrite the row it should
   * have closed. Nothing would error — and every goal and review pointing at
   * the old department would silently re-parent itself, so "which section was
   * this person in when they were rated" would quietly change for every past
   * cycle. So: Add, Correct, Record a change, End employment. Four verbs.
   */

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.lifecycle.create(req.auth, createEmployee.parse(body));
  }

  /** A correction only. Cannot move a period — that is an event. */
  @Patch(':id')
  correct(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.lifecycle.correct(req.auth, id, correctEmployee.parse(body));
  }

  /** Something happened: regularisation, promotion, transfer, demotion, rehire. */
  @Post(':id/employment-events')
  recordEvent(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.lifecycle.recordEvent(req.auth, id, recordEvent.parse(body));
  }

  /**
   * What separating them would orphan — read this before posting the separation.
   * Advisory, not a veto: HR sometimes must separate somebody mid-cycle, and a
   * system that refuses outright gets worked around in the database.
   */
  @Get(':id/separation-blockers')
  separationBlockers(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lifecycle.separationBlockers(req.auth, id);
  }

  @Post(':id/separation')
  separate(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.lifecycle.separate(req.auth, id, separate.parse(body));
  }


  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.employees.me(req.auth);
  }

  /** Phase 0 exit criteria: a manager sees exactly their own reports. */
  @Get('me/reports')
  reports(@Req() req: AuthenticatedRequest, @Query('asOf') asOf?: string) {
    return this.employees.directReports(req.auth, asOf ? new Date(asOf) : undefined);
  }

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.employees.list(req.auth, listQuery.parse(query));
  }

  @Get(':id/timeline')
  timeline(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.employees.timeline(req.auth, id, from, to);
  }

  @Get(':id')
  byId(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.byId(req.auth, id);
  }
}
