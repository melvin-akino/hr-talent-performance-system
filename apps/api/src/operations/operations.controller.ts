import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { OperationsService } from './operations.service';

@Controller('operations')
@UseGuards(AuthGuard)
export class OperationsController {
  constructor(private readonly ops: OperationsService) {}

  // Expenses
  @Get('expenses')
  listExpenses(@Req() req: AuthenticatedRequest) {
    return this.ops.listExpenses(req.auth);
  }

  @Post('expenses')
  submitExpense(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      claimDate?: string;
      category?: string;
      description: string;
      amount: number;
      receiptRef?: string;
    },
  ) {
    return this.ops.submitExpense(req.auth, body);
  }

  @Post('expenses/:id/approve')
  approveExpense(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
  ) {
    return this.ops.reviewExpense(req.auth, id, 'approved', body?.note);
  }

  @Post('expenses/:id/reject')
  rejectExpense(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
  ) {
    return this.ops.reviewExpense(req.auth, id, 'rejected', body?.note);
  }

  @Post('expenses/:id/mark-paid')
  markExpensePaid(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ops.reviewExpense(req.auth, id, 'paid');
  }

  // Company Assets
  @Get('assets')
  listAssets(@Req() req: AuthenticatedRequest) {
    return this.ops.listAssets(req.auth);
  }

  @Post('assets')
  createAsset(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      assetTag: string;
      name: string;
      category?: string;
      serialNo?: string;
      assignedTo?: string;
      condition?: string;
      notes?: string;
    },
  ) {
    return this.ops.createAsset(req.auth, body);
  }

  @Patch('assets/:id/assign')
  assignOrReturnAsset(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      assignedTo?: string | null;
      condition?: string;
      status?: string;
      notes?: string;
    },
  ) {
    return this.ops.assignOrReturnAsset(req.auth, id, body);
  }

  // Training & Certifications
  @Get('trainings')
  listTrainings(@Req() req: AuthenticatedRequest) {
    return this.ops.listTrainings(req.auth);
  }

  @Post('trainings')
  recordTraining(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      employeeId?: string;
      title: string;
      provider?: string;
      trainingType?: string;
      completedOn?: string;
      expiresOn?: string;
      hours?: number;
      credentialNo?: string;
      notes?: string;
    },
  ) {
    return this.ops.recordTraining(req.auth, body);
  }

  // Recruitment (ATS)
  @Get('requisitions')
  listRequisitions(@Req() req: AuthenticatedRequest) {
    return this.ops.listRequisitions(req.auth);
  }

  @Post('requisitions')
  createRequisition(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      title: string;
      departmentId?: string;
      branchId?: string;
      employmentType?: string;
      headcountTarget?: number;
      salaryRange?: string;
      description?: string;
    },
  ) {
    return this.ops.createRequisition(req.auth, body);
  }

  @Get('applicants')
  listApplicants(
    @Req() req: AuthenticatedRequest,
    @Query('requisitionId') requisitionId?: string,
  ) {
    return this.ops.listApplicants(req.auth, requisitionId);
  }

  @Post('applicants')
  createApplicant(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      requisitionId: string;
      fullName: string;
      email: string;
      phone?: string;
      source?: string;
      expectedSalary?: number;
      notes?: string;
    },
  ) {
    return this.ops.createApplicant(req.auth, body);
  }

  @Patch('applicants/:id/stage')
  updateApplicantStage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { stage: string; interviewDate?: string; notes?: string },
  ) {
    return this.ops.updateApplicantStage(req.auth, id, body);
  }

  // Audit Trail Viewer
  @Get('audit-logs')
  listAuditLogs(
    @Req() req: AuthenticatedRequest,
    @Query('table') table?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ops.listAuditLogs(
      req.auth,
      table || undefined,
      limit ? parseInt(limit, 10) : 100,
    );
  }
}
