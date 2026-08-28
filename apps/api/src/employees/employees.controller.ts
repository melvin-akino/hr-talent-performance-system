import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EmployeesService } from './employees.service';

const listQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  afterLastName: z.string().optional(),
  afterId: z.string().uuid().optional(),
  asOf: z.coerce.date().optional(),
});

@Controller('employees')
@UseGuards(AuthGuard)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

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
