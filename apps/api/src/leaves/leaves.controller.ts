import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { FeatureGuard, RequireFeature } from '../common/guards/feature.guard';
import {
  LeavesService,
  CreateLeaveTypeDto,
  AllocateLeavesDto,
  ApplyLeaveDto,
} from './leaves.service';

@Controller('leaves')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('feature_leave_management')
export class LeavesController {
  constructor(private readonly leaves: LeavesService) {}

  @Get('types')
  listLeaveTypes(@Req() req: AuthenticatedRequest) {
    return this.leaves.listLeaveTypes(req.auth);
  }

  @Post('types')
  createLeaveType(@Req() req: AuthenticatedRequest, @Body() body: CreateLeaveTypeDto) {
    return this.leaves.createLeaveType(req.auth, body);
  }

  @Post('types/seed-statutory')
  seedStatutoryLeaveTypes(@Req() req: AuthenticatedRequest) {
    return this.leaves.seedStatutoryLeaveTypes(req.auth);
  }

  @Get('balances')
  getLeaveBalances(
    @Req() req: AuthenticatedRequest,
    @Query('employeeId') employeeId?: string,
    @Query('year') year?: string,
  ) {
    const targetEmployeeId = employeeId || req.auth.employeeId;
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.leaves.getLeaveBalances(req.auth, targetEmployeeId, targetYear);
  }

  @Post('allocate')
  allocateLeaves(@Req() req: AuthenticatedRequest, @Body() body: AllocateLeavesDto) {
    return this.leaves.allocateLeaves(req.auth, body);
  }

  @Get('requests')
  listLeaveRequests(
    @Req() req: AuthenticatedRequest,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    return this.leaves.listLeaveRequests(req.auth, { employeeId, status });
  }

  @Post('requests')
  applyLeave(@Req() req: AuthenticatedRequest, @Body() body: ApplyLeaveDto) {
    return this.leaves.applyLeave(req.auth, body);
  }

  @Post('requests/:id/approve')
  approveLeave(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leaves.approveLeave(req.auth, id);
  }

  @Post('requests/:id/reject')
  rejectLeave(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.leaves.rejectLeave(req.auth, id, reason);
  }

  @Post('requests/:id/cancel')
  cancelLeave(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leaves.cancelLeave(req.auth, id);
  }
}
