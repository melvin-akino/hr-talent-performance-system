import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { FeatureGuard, RequireFeature } from '../common/guards/feature.guard';
import {
  PayrollService,
  CreateBranchDto,
  UpsertCompensationDto,
  ComputePayrollRunDto,
  CreateLoanDto,
  CreatePayrollEntryItemDto,
  DistributeServiceChargeDto,
  SalaryGradeMatrixDto,
  PayrollAdjustmentDto,
  CalculateRetroPayDto,
} from './payroll.service';

@Controller('payroll')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('feature_ph_payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /**
   * Branches / Multi-corporate structure
   */
  @Get('branches')
  listBranches(@Req() req: AuthenticatedRequest) {
    return this.payroll.listBranches(req.auth);
  }

  @Post('branches')
  createBranch(@Req() req: AuthenticatedRequest, @Body() body: CreateBranchDto) {
    return this.payroll.createBranch(req.auth, body);
  }

  /**
   * Compensation & Statutory Profiles
   */
  @Get('compensation')
  listCompensation(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    return this.payroll.listCompensation(req.auth, branchId);
  }

  @Get('compensation/:employeeId')
  getCompensation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.payroll.getCompensation(req.auth, employeeId);
  }

  @Put('compensation/:employeeId')
  upsertCompensation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: UpsertCompensationDto,
  ) {
    return this.payroll.upsertCompensation(req.auth, employeeId, body);
  }

  /**
   * Payroll Runs & Processing
   */
  @Get('runs')
  listPayrollRuns(
    @Req() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    return this.payroll.listPayrollRuns(req.auth, branchId);
  }

  @Get('runs/:id')
  getPayrollRun(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payroll.getPayrollRun(req.auth, id);
  }

  @Post('runs/compute')
  computePayrollRun(
    @Req() req: AuthenticatedRequest,
    @Body() body: ComputePayrollRunDto,
  ) {
    return this.payroll.computePayrollRun(req.auth, body);
  }

  @Post('runs/:id/approve')
  approvePayrollRun(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payroll.approvePayrollRun(req.auth, id);
  }

  @Post('runs/:id/disburse')
  disbursePayrollRun(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payroll.disbursePayrollRun(req.auth, id);
  }

  /**
   * Bank Disbursement Exports (BPI, BDO, Metrobank, UnionBank)
   */
  @Get('runs/:id/disbursement/:bank')
  async exportDisbursement(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bank') bank: string,
    @Res() res: Response,
  ) {
    const file = await this.payroll.generateDisbursementFile(req.auth, id, bank);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return res.send(file.content);
  }

  /**
   * Statutory Reports Exports (SSS, PhilHealth, Pag-IBIG, BIR)
   */
  @Get('runs/:id/statutory/:agency')
  async exportStatutoryReport(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agency') agency: 'sss' | 'philhealth' | 'pagibig' | 'bir',
    @Res() res: Response,
  ) {
    const file = await this.payroll.generateStatutoryReport(req.auth, id, agency);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return res.send(file.content);
  }

  /**
   * BIR Form 2316 (Annual Tax Certificate) & BIR Form 1601-C Monthly Return Summary
   */
  @Get('my-bir-2316')
  myBir2316(
    @Req() req: AuthenticatedRequest,
    @Query('year') year?: string,
  ) {
    return this.payroll.getBir2316(
      req.auth,
      req.auth.employeeId,
      year ? parseInt(year, 10) : new Date().getFullYear(),
    );
  }

  @Get('bir-2316/:employeeId')
  employeeBir2316(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query('year') year?: string,
  ) {
    return this.payroll.getBir2316(
      req.auth,
      employeeId,
      year ? parseInt(year, 10) : new Date().getFullYear(),
    );
  }

  @Get('bir-1601c')
  bir1601cSummary(
    @Req() req: AuthenticatedRequest,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    return this.payroll.getBir1601cSummary(
      req.auth,
      year ? parseInt(year, 10) : now.getFullYear(),
      month ? parseInt(month, 10) : now.getMonth() + 1,
    );
  }

  @Get('13th-month/preview')
  previewThirteenthMonth(
    @Req() req: AuthenticatedRequest,
    @Query('year') year?: string,
    @Query('branchId') branchId?: string,
  ) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.payroll.previewThirteenthMonth(req.auth, y, branchId);
  }

  @Post('runs/compute-13th-month')
  computeThirteenthMonthRun(
    @Req() req: AuthenticatedRequest,
    @Body() body: { year: number; payoutDate?: string; branchId?: string },
  ) {
    return this.payroll.computeThirteenthMonthRun(req.auth, body);
  }

  @Get('year-end-tax')
  getYearEndTaxReconciliation(
    @Req() req: AuthenticatedRequest,
    @Query('year') year?: string,
  ) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.payroll.getYearEndTaxReconciliation(req.auth, y);
  }

  @Get('bir-1604c/csv')
  async exportBir1604cCsv(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('year') year?: string,
  ) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    const file = await this.payroll.exportBir1604cCsv(req.auth, y);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return res.send(file.csv);
  }

  /**
   * Employee Loans & Amortization
   */
  @Post('loans')
  createEmployeeLoan(@Req() req: AuthenticatedRequest, @Body() body: CreateLoanDto) {
    return this.payroll.createEmployeeLoan(req.auth, body);
  }

  @Get('loans')
  listEmployeeLoans(
    @Req() req: AuthenticatedRequest,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.payroll.listEmployeeLoans(req.auth, employeeId);
  }

  @Patch('loans/:id/status')
  updateLoanStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: 'active' | 'paused',
  ) {
    return this.payroll.updateLoanStatus(req.auth, id, status);
  }

  /**
   * Recurring & Ad-hoc Items (Deductions & Allowances)
   */
  @Post('entries')
  createPayrollEntryItem(@Req() req: AuthenticatedRequest, @Body() body: CreatePayrollEntryItemDto) {
    return this.payroll.createPayrollEntryItem(req.auth, body);
  }

  @Get('entries')
  listPayrollEntryItems(
    @Req() req: AuthenticatedRequest,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.payroll.listPayrollEntryItems(req.auth, employeeId);
  }

  /**
   * Hospitality Service Charge Pool
   */
  @Post('service-charge')
  distributeServiceCharge(@Req() req: AuthenticatedRequest, @Body() body: DistributeServiceChargeDto) {
    return this.payroll.distributeServiceCharge(req.auth, body);
  }

  @Get('service-charge')
  listServiceCharges(@Req() req: AuthenticatedRequest) {
    return this.payroll.listServiceCharges(req.auth);
  }

  /**
   * Salary Grade Matrix by Region / Rank
   */
  @Post('salary-matrix')
  upsertSalaryGradeMatrix(@Req() req: AuthenticatedRequest, @Body() body: SalaryGradeMatrixDto) {
    return this.payroll.upsertSalaryGradeMatrix(req.auth, body);
  }

  @Get('salary-matrix')
  listSalaryGradeMatrix(
    @Req() req: AuthenticatedRequest,
    @Query('region') region?: string,
  ) {
    return this.payroll.listSalaryGradeMatrix(req.auth, region);
  }

  /**
   * Adjustments & Retroactive Pay
   */
  @Post('adjustments')
  createPayrollAdjustment(@Req() req: AuthenticatedRequest, @Body() body: PayrollAdjustmentDto) {
    return this.payroll.createPayrollAdjustment(req.auth, body);
  }

  @Get('adjustments')
  listPayrollAdjustments(
    @Req() req: AuthenticatedRequest,
    @Query('payrollRunId') payrollRunId?: string,
  ) {
    return this.payroll.listPayrollAdjustments(req.auth, payrollRunId);
  }

  @Post('retro-pay')
  calculateRetroPay(@Req() req: AuthenticatedRequest, @Body() body: CalculateRetroPayDto) {
    return this.payroll.calculateRetroPay(req.auth, body);
  }

  /**
   * Employee Self-Service (ESS): View My Historical Payslips
   */
  @Get('my-payslips')
  getMyPayslips(@Req() req: AuthenticatedRequest) {
    return this.payroll.getMyPayslips(req.auth);
  }

  /**
   * Employee Self-Service (ESS): View Specific Payslip Breakdown
   */
  @Get('my-payslips/:id')
  getMyPayslipDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payroll.getMyPayslipDetail(req.auth, id);
  }

  /**
   * BIR Form 2316 Certificate of Compensation Payment / Tax Withheld
   */
  @Get('employees/:employeeId/bir2316')
  getBir2316(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query('year') year?: string,
  ) {
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.payroll.generateBir2316(req.auth, employeeId, targetYear);
  }
}
