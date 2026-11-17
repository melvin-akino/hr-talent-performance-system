import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
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

  /**
   * 201 Digital Document Vault
   */
  @Post(':id/documents')
  uploadDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { docType: string; title: string; fileUrl: string; fileName: string; fileSizeBytes?: number },
  ) {
    return this.employees.uploadDocument(req.auth, { ...body, employeeId: id });
  }

  @Get(':id/documents')
  listDocuments(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.employees.listDocuments(req.auth, id);
  }

  @Delete(':id/documents/:docId')
  deleteDocument(
    @Req() req: AuthenticatedRequest,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.employees.deleteDocument(req.auth, docId);
  }

  /**
   * 201 Merits, Commendations & Certifications
   */
  @Post(':id/merits')
  recordMerit(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { awardTitle: string; awardType: string; awardedOn?: string; issuer: string; description?: string; certificateUrl?: string },
  ) {
    return this.employees.recordMeritAward(req.auth, { ...body, employeeId: id });
  }

  @Get(':id/merits')
  listMerits(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.employees.listMeritAwards(req.auth, id);
  }
}
