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
  AttendanceService,
  ClockInOutDto,
  KioskPunchDto,
  EnrollPinDto,
  ManualDtrDto,
  CreateShiftDto,
  CreateHolidayDto,
  RosterAssignDto,
  ShiftSwapDto,
  CompOffAwardDto,
  TimesheetAdjustmentDto,
  DisciplinaryMemoDto,
  BusinessTripDto,
  MealVoucherDto,
} from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /**
   * Kiosk Terminal Punch (Public tablet mode: Emp No + PIN)
   */
  @Post('kiosk/punch')
  kioskPunch(@Body() body: KioskPunchDto) {
    return this.attendance.kioskPunch(body);
  }

  /**
   * Protected Routes requiring Tenant Auth and Feature Enablement
   */
  @Post('enroll-pin')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  enrollKioskPin(@Req() req: AuthenticatedRequest, @Body() body: EnrollPinDto) {
    return this.attendance.enrollKioskPin(req.auth, body);
  }

  @Get('enrollments')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listTerminalEnrollments(@Req() req: AuthenticatedRequest) {
    return this.attendance.listTerminalEnrollments(req.auth);
  }

  @Post('clock')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  clock(@Req() req: AuthenticatedRequest, @Body() body: ClockInOutDto) {
    return this.attendance.clock(req.auth, body);
  }

  @Get('records')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listRecords(
    @Req() req: AuthenticatedRequest,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('employeeId') employeeId?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.attendance.listRecords(req.auth, {
      startDate: startDate || new Date().toISOString().slice(0, 10),
      endDate: endDate || new Date().toISOString().slice(0, 10),
      employeeId,
      branchId,
    });
  }

  @Post('records/manual')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  recordManualDtr(@Req() req: AuthenticatedRequest, @Body() body: ManualDtrDto) {
    return this.attendance.recordManualDtr(req.auth, body);
  }

  @Post('records/:id/approve')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  approveDtr(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.attendance.approveDtr(req.auth, id);
  }

  @Get('shifts')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listShifts(@Req() req: AuthenticatedRequest) {
    return this.attendance.listShifts(req.auth);
  }

  @Post('shifts')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  createShift(@Req() req: AuthenticatedRequest, @Body() body: CreateShiftDto) {
    return this.attendance.createShift(req.auth, body);
  }

  @Post('roster/batch')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  batchAssignRoster(@Req() req: AuthenticatedRequest, @Body() body: RosterAssignDto) {
    return this.attendance.batchAssignRoster(req.auth, body);
  }

  @Get('roster')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listRoster(
    @Req() req: AuthenticatedRequest,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('employeeId') employeeId?: string,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    return this.attendance.listRoster(req.auth, {
      startDate: startDate || today,
      endDate: endDate || today,
      employeeId,
    });
  }

  @Post('shift-swap')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  applyShiftSwap(@Req() req: AuthenticatedRequest, @Body() body: ShiftSwapDto) {
    return this.attendance.applyShiftSwap(req.auth, body);
  }

  @Get('shift-swap')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listShiftSwaps(@Req() req: AuthenticatedRequest) {
    return this.attendance.listShiftSwaps(req.auth);
  }

  @Post('shift-swap/:id/approve')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  approveShiftSwap(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.attendance.approveShiftSwap(req.auth, id);
  }

  @Post('comp-off/award')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  awardCompOff(@Req() req: AuthenticatedRequest, @Body() body: CompOffAwardDto) {
    return this.attendance.awardCompOff(req.auth, body);
  }

  @Get('comp-off')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listCompOffBalances(
    @Req() req: AuthenticatedRequest,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.attendance.listCompOffBalances(req.auth, employeeId);
  }

  @Post('adjustments')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  requestTimesheetAdjustment(@Req() req: AuthenticatedRequest, @Body() body: TimesheetAdjustmentDto) {
    return this.attendance.requestTimesheetAdjustment(req.auth, body);
  }

  @Get('adjustments')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listTimesheetAdjustments(@Req() req: AuthenticatedRequest) {
    return this.attendance.listTimesheetAdjustments(req.auth);
  }

  @Post('adjustments/:id/approve')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  approveTimesheetAdjustment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.attendance.approveTimesheetAdjustment(req.auth, id);
  }

  @Get('tardiness-summary')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  getTardinessSummary(
    @Req() req: AuthenticatedRequest,
    @Query('month') month?: string,
  ) {
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    return this.attendance.getTardinessInfractionsSummary(req.auth, targetMonth);
  }

  @Post('memos')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  issueDisciplinaryMemo(@Req() req: AuthenticatedRequest, @Body() body: DisciplinaryMemoDto) {
    return this.attendance.issueDisciplinaryMemo(req.auth, body);
  }

  @Get('memos')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listDisciplinaryMemos(
    @Req() req: AuthenticatedRequest,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.attendance.listDisciplinaryMemos(req.auth, employeeId);
  }

  @Post('business-trips')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  applyBusinessTrip(@Req() req: AuthenticatedRequest, @Body() body: BusinessTripDto) {
    return this.attendance.applyBusinessTrip(req.auth, body);
  }

  @Get('business-trips')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listBusinessTrips(@Req() req: AuthenticatedRequest) {
    return this.attendance.listBusinessTrips(req.auth);
  }

  @Post('business-trips/:id/approve')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  approveBusinessTrip(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.attendance.approveBusinessTrip(req.auth, id);
  }

  @Post('meal-vouchers')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  issueMealVoucher(@Req() req: AuthenticatedRequest, @Body() body: MealVoucherDto) {
    return this.attendance.issueMealVoucher(req.auth, body);
  }

  @Get('meal-vouchers')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listMealVouchers(@Req() req: AuthenticatedRequest) {
    return this.attendance.listMealVouchers(req.auth);
  }

  @Post('meal-vouchers/redeem')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  redeemMealVoucher(@Req() req: AuthenticatedRequest, @Body('voucherCode') voucherCode: string) {
    return this.attendance.redeemMealVoucher(req.auth, voucherCode);
  }

  @Get('holidays')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  listHolidays(
    @Req() req: AuthenticatedRequest,
    @Query('year') year?: string,
  ) {
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.attendance.listHolidays(req.auth, targetYear);
  }

  @Post('holidays')
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireFeature('feature_time_attendance')
  createHoliday(@Req() req: AuthenticatedRequest, @Body() body: CreateHolidayDto) {
    return this.attendance.createHoliday(req.auth, body);
  }
}
