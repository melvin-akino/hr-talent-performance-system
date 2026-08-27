import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import {
  ReferenceDataService, closeDepartment, createDepartment, createEmploymentType,
  updateDepartment, updateEmploymentType,
} from './reference-data.service';

const updatePosition = z.object({
  title: z.string().trim().min(1).optional(),
  jobFamily: z.string().trim().nullish(),
  jobLevel: z.string().trim().nullish(),
  // Explicit null unranks the position. A position outside the ladder is
  // normal, so clearing has to be expressible.
  rankId: z.string().uuid().nullish(),
});

@Controller()
@UseGuards(AuthGuard)
export class ReferenceDataController {
  constructor(private readonly ref: ReferenceDataService) {}

  // --- Departments ---------------------------------------------------------

  @Get('departments')
  listDepartments(
    @Req() req: AuthenticatedRequest,
    @Query('includeClosed') includeClosed?: string,
  ) {
    return this.ref.listDepartments(req.auth, includeClosed === 'true');
  }

  @Post('departments')
  createDepartment(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.ref.createDepartment(req.auth, createDepartment.parse(body));
  }

  @Patch('departments/:id')
  updateDepartment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.ref.updateDepartment(req.auth, id, updateDepartment.parse(body));
  }

  /** Closes rather than deletes: employment history must keep resolving. */
  @Post('departments/:id/close')
  closeDepartment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.ref.closeDepartment(req.auth, id, closeDepartment.parse(body));
  }

  // --- Employment types ----------------------------------------------------

  @Get('employment-types')
  listEmploymentTypes(@Req() req: AuthenticatedRequest) {
    return this.ref.listEmploymentTypes(req.auth);
  }

  @Post('employment-types')
  createEmploymentType(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.ref.createEmploymentType(req.auth, createEmploymentType.parse(body));
  }

  @Patch('employment-types/:id')
  updateEmploymentType(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.ref.updateEmploymentType(req.auth, id, updateEmploymentType.parse(body));
  }

  /** Read-only: needed by the form-assignment screen. */
  @Get('roles')
  listRoles(@Req() req: AuthenticatedRequest) {
    return this.ref.listRoles(req.auth);
  }

  // --- Positions -----------------------------------------------------------

  @Get('ranks')
  listRanks(@Req() req: AuthenticatedRequest) {
    return this.ref.listRanks(req.auth);
  }

  @Get('positions')
  listPositions(@Req() req: AuthenticatedRequest) {
    return this.ref.listPositions(req.auth);
  }

  @Patch('positions/:id')
  updatePosition(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.ref.updatePosition(req.auth, id, updatePosition.parse(body));
  }
}
