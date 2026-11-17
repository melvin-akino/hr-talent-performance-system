import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import {
  ReferenceDataService, closeDepartment, createDepartment, createEmploymentType,
  createPosition, createRank, updateDepartment, updateEmploymentType,
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

  @Post('ranks')
  createRank(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.ref.createRank(req.auth, createRank.parse(body));
  }

  @Get('positions')
  listPositions(@Req() req: AuthenticatedRequest) {
    return this.ref.listPositions(req.auth);
  }

  @Post('positions')
  createPosition(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.ref.createPosition(req.auth, createPosition.parse(body));
  }

  @Patch('positions/:id')
  updatePosition(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.ref.updatePosition(req.auth, id, updatePosition.parse(body));
  }

  // --- Comprehensive Enterprise HR Settings --------------------------------

  @Get('admin/settings')
  getHrSettings(@Req() req: AuthenticatedRequest) {
    return this.ref.getHrSettings(req.auth);
  }

  @Put('admin/settings')
  updateHrSettings(@Req() req: AuthenticatedRequest, @Body() body: any) {
    return this.ref.updateHrSettings(req.auth, body);
  }

  // --- Extended Full CRUD for System Setup --------------------------------

  @Delete('employment-types/:id')
  deleteEmploymentType(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ref.deleteEmploymentType(req.auth, id);
  }

  @Patch('ranks/:id')
  updateRank(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { code?: string; name?: string; rankNo?: number },
  ) {
    return this.ref.updateRank(req.auth, id, body);
  }

  @Delete('ranks/:id')
  deleteRank(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ref.deleteRank(req.auth, id);
  }

  @Delete('positions/:id')
  deletePosition(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ref.deletePosition(req.auth, id);
  }

  // Branches / Regional Hubs
  @Get('branches')
  listBranches(@Req() req: AuthenticatedRequest) {
    return this.ref.listBranches(req.auth);
  }

  @Post('branches')
  createBranch(@Req() req: AuthenticatedRequest, @Body() body: any) {
    return this.ref.createBranch(req.auth, body);
  }

  @Patch('branches/:id')
  updateBranch(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    return this.ref.updateBranch(req.auth, id, body);
  }

  @Delete('branches/:id')
  deleteBranch(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ref.deleteBranch(req.auth, id);
  }

  // Role Assignments
  @Get('admin/role-assignments')
  listRoleAssignments(@Req() req: AuthenticatedRequest) {
    return this.ref.listRoleAssignments(req.auth);
  }

  @Post('admin/role-assignments')
  assignRole(
    @Req() req: AuthenticatedRequest,
    @Body() body: { employeeId: string; roleId: string },
  ) {
    return this.ref.assignRole(req.auth, body);
  }

  @Delete('admin/role-assignments/:id')
  revokeRoleAssignment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ref.revokeRoleAssignment(req.auth, id);
  }

  // Shifts, Leave Types & Salary Matrices Update / Delete
  @Patch('admin/shifts/:id')
  updateShift(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    return this.ref.updateShift(req.auth, id, body);
  }

  @Delete('admin/shifts/:id')
  deleteShift(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ref.deleteShift(req.auth, id);
  }

  @Patch('admin/leave-types/:id')
  updateLeaveType(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    return this.ref.updateLeaveType(req.auth, id, body);
  }

  @Delete('admin/leave-types/:id')
  deleteLeaveType(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ref.deleteLeaveType(req.auth, id);
  }

  @Patch('admin/salary-matrices/:id')
  updateSalaryMatrix(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    return this.ref.updateSalaryMatrix(req.auth, id, body);
  }

  @Delete('admin/salary-matrices/:id')
  deleteSalaryMatrix(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ref.deleteSalaryMatrix(req.auth, id);
  }
}
