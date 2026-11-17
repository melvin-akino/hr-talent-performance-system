import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService, RequestContext } from '../db/db.service';

@Injectable()
export class OperationsService {
  constructor(private readonly db: DbService) {}

  private async getCallerRoles(client: PoolClient, ctx: RequestContext): Promise<string[]> {
    const res = await client.query<{ code: string }>(
      `SELECT DISTINCT r.code
         FROM role_assignment ra
         JOIN app_role r ON r.id = ra.role_id
        WHERE ra.employee_id = $1
          AND ra.org_id = app.current_org_id()
          AND ra.effective_from <= CURRENT_DATE
          AND (ra.effective_to IS NULL OR CURRENT_DATE < ra.effective_to)`,
      [ctx.employeeId],
    );
    return res.rows.map((r) => r.code);
  }

  private async requireRole(client: PoolClient, ctx: RequestContext, allowed: string[]) {
    const roles = await this.getCallerRoles(client, ctx);
    if (!roles.some((r) => allowed.includes(r))) {
      throw new ForbiddenException(`Insufficient permissions. Required: ${allowed.join(', ')}`);
    }
    return roles;
  }

  // -------------------------------------------------------------------------
  // 1. Expense & Reimbursement Claims
  // -------------------------------------------------------------------------

  async listExpenses(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const roles = await this.getCallerRoles(client, ctx);
      const isApprover = roles.some((r) => ['hr_admin', 'hr_partner', 'manager'].includes(r));

      const res = await client.query(
        `SELECT ec.*,
                e.employee_no AS "employeeNo",
                e.first_name || ' ' || e.last_name AS "employeeName",
                rev.first_name || ' ' || rev.last_name AS "reviewedByName"
           FROM expense_claim ec
           JOIN employee e ON e.id = ec.employee_id
           LEFT JOIN employee rev ON rev.id = ec.reviewed_by
          WHERE ec.org_id = app.current_org_id()
            AND ($1::boolean = TRUE OR ec.employee_id = $2)
          ORDER BY (ec.status = 'pending') DESC, ec.claim_date DESC, ec.created_at DESC
          LIMIT 200`,
        [isApprover, ctx.employeeId],
      );
      return res.rows;
    });
  }

  async submitExpense(
    ctx: RequestContext,
    dto: { claimDate?: string; category?: string; description: string; amount: number; receiptRef?: string },
  ) {
    if (!dto.description?.trim() || !dto.amount || Number(dto.amount) <= 0) {
      throw new BadRequestException('Valid description and positive amount are required');
    }
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO expense_claim (
           org_id, employee_id, claim_date, category, description, amount, receipt_ref, status
         ) VALUES (app.current_org_id(), $1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, 'pending')
         RETURNING *`,
        [
          ctx.employeeId,
          dto.claimDate || null,
          dto.category || 'travel',
          dto.description.trim(),
          Number(dto.amount),
          dto.receiptRef || null,
        ],
      );
      return res.rows[0];
    });
  }

  async reviewExpense(
    ctx: RequestContext,
    id: string,
    status: 'approved' | 'rejected' | 'paid',
    note?: string,
  ) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const res = await client.query(
        `UPDATE expense_claim
            SET status = $1,
                reviewed_by = $2,
                reviewed_at = now(),
                review_note = COALESCE($3, review_note)
          WHERE id = $4 AND org_id = app.current_org_id()
          RETURNING *`,
        [status, ctx.employeeId, note || null, id],
      );
      if (!res.rows[0]) throw new NotFoundException('Expense claim not found');
      return res.rows[0];
    });
  }

  // -------------------------------------------------------------------------
  // 2. Company Asset & Equipment Tracking
  // -------------------------------------------------------------------------

  async listAssets(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const roles = await this.getCallerRoles(client, ctx);
      const isMgrOrHr = roles.some((r) => ['hr_admin', 'hr_partner', 'manager'].includes(r));

      const res = await client.query(
        `SELECT a.*,
                e.employee_no AS "assignedEmployeeNo",
                e.first_name || ' ' || e.last_name AS "assignedToName"
           FROM company_asset a
           LEFT JOIN employee e ON e.id = a.assigned_to
          WHERE a.org_id = app.current_org_id()
            AND ($1::boolean = TRUE OR a.assigned_to = $2)
          ORDER BY a.status ASC, a.asset_tag ASC`,
        [isMgrOrHr, ctx.employeeId],
      );
      return res.rows;
    });
  }

  async createAsset(
    ctx: RequestContext,
    dto: {
      assetTag: string;
      name: string;
      category?: string;
      serialNo?: string;
      assignedTo?: string;
      condition?: string;
      notes?: string;
    },
  ) {
    if (!dto.assetTag?.trim() || !dto.name?.trim()) {
      throw new BadRequestException('Asset tag and name are required');
    }
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const status = dto.assignedTo ? 'assigned' : 'available';
      const res = await client.query(
        `INSERT INTO company_asset (
           org_id, asset_tag, name, category, serial_no, assigned_to, assigned_on, condition, status, notes
         ) VALUES (
           app.current_org_id(), $1, $2, $3, $4, $5,
           CASE WHEN $5::uuid IS NOT NULL THEN CURRENT_DATE ELSE NULL END,
           $6, $7, $8
         ) RETURNING *`,
        [
          dto.assetTag.trim().toUpperCase(),
          dto.name.trim(),
          dto.category || 'laptop',
          dto.serialNo || null,
          dto.assignedTo || null,
          dto.condition || 'good',
          status,
          dto.notes || null,
        ],
      );
      return res.rows[0];
    });
  }

  async assignOrReturnAsset(
    ctx: RequestContext,
    id: string,
    dto: { assignedTo?: string | null; condition?: string; status?: string; notes?: string },
  ) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const isReturning = dto.assignedTo === null || dto.assignedTo === '';
      const res = await client.query(
        `UPDATE company_asset
            SET assigned_to = $1,
                assigned_on = CASE WHEN $1::uuid IS NOT NULL THEN CURRENT_DATE ELSE assigned_on END,
                returned_on = CASE WHEN $2::boolean = TRUE THEN CURRENT_DATE ELSE NULL END,
                status = COALESCE($3, CASE WHEN $1::uuid IS NOT NULL THEN 'assigned' ELSE 'available' END),
                condition = COALESCE($4, condition),
                notes = COALESCE($5, notes)
          WHERE id = $6 AND org_id = app.current_org_id()
          RETURNING *`,
        [
          isReturning ? null : dto.assignedTo,
          isReturning,
          dto.status || null,
          dto.condition || null,
          dto.notes || null,
          id,
        ],
      );
      if (!res.rows[0]) throw new NotFoundException('Asset not found');
      return res.rows[0];
    });
  }

  // -------------------------------------------------------------------------
  // 3. Training, Seminars & Certification Expiry Tracking
  // -------------------------------------------------------------------------

  async listTrainings(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const roles = await this.getCallerRoles(client, ctx);
      const isMgrOrHr = roles.some((r) => ['hr_admin', 'hr_partner', 'manager'].includes(r));

      const res = await client.query(
        `SELECT t.*,
                e.employee_no AS "employeeNo",
                e.first_name || ' ' || e.last_name AS "employeeName",
                CASE
                  WHEN t.expires_on IS NOT NULL AND t.expires_on < CURRENT_DATE THEN 'expired'
                  WHEN t.expires_on IS NOT NULL AND t.expires_on <= CURRENT_DATE + INTERVAL '60 days' THEN 'expiring_soon'
                  ELSE 'valid'
                END AS "expiryAlert"
           FROM employee_training t
           JOIN employee e ON e.id = t.employee_id
          WHERE t.org_id = app.current_org_id()
            AND ($1::boolean = TRUE OR t.employee_id = $2)
          ORDER BY t.expires_on ASC NULLS LAST, t.completed_on DESC NULLS LAST`,
        [isMgrOrHr, ctx.employeeId],
      );
      return res.rows;
    });
  }

  async recordTraining(
    ctx: RequestContext,
    dto: {
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
    if (!dto.title?.trim()) {
      throw new BadRequestException('Training/Certification title is required');
    }
    return this.db.withContext(ctx, async (client) => {
      const targetEmp = dto.employeeId || ctx.employeeId;
      if (targetEmp !== ctx.employeeId) {
        await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      }
      const res = await client.query(
        `INSERT INTO employee_training (
           org_id, employee_id, title, provider, training_type, completed_on,
           expires_on, hours, credential_no, status, notes
         ) VALUES (
           app.current_org_id(), $1, $2, $3, $4, $5::date, $6::date, $7, $8, 'completed', $9
         ) RETURNING *`,
        [
          targetEmp,
          dto.title.trim(),
          dto.provider || 'Internal HR',
          dto.trainingType || 'seminar',
          dto.completedOn || null,
          dto.expiresOn || null,
          Number(dto.hours || 0),
          dto.credentialNo || null,
          dto.notes || null,
        ],
      );
      return res.rows[0];
    });
  }

  // -------------------------------------------------------------------------
  // 4. Recruitment (ATS) — Requisitions & Applicants
  // -------------------------------------------------------------------------

  async listRequisitions(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const res = await client.query(
        `SELECT r.*,
                d.name AS "departmentName",
                b.name AS "branchName",
                COUNT(a.id)::int AS "applicantCount",
                COUNT(a.id) FILTER (WHERE a.stage = 'hired')::int AS "hiredCount"
           FROM job_requisition r
           LEFT JOIN department d ON d.id = r.department_id
           LEFT JOIN branch b ON b.id = r.branch_id
           LEFT JOIN job_applicant a ON a.requisition_id = r.id
          WHERE r.org_id = app.current_org_id()
          GROUP BY r.id, d.name, b.name
          ORDER BY (r.status = 'open') DESC, r.created_at DESC`,
      );
      return res.rows;
    });
  }

  async createRequisition(
    ctx: RequestContext,
    dto: {
      title: string;
      departmentId?: string;
      branchId?: string;
      employmentType?: string;
      headcountTarget?: number;
      salaryRange?: string;
      description?: string;
    },
  ) {
    if (!dto.title?.trim()) throw new BadRequestException('Job title is required');
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const res = await client.query(
        `INSERT INTO job_requisition (
           org_id, title, department_id, branch_id, employment_type,
           headcount_target, salary_range, description, status, created_by
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, 'open', $8)
         RETURNING *`,
        [
          dto.title.trim(),
          dto.departmentId || null,
          dto.branchId || null,
          dto.employmentType || 'Full-time Regular',
          Number(dto.headcountTarget || 1),
          dto.salaryRange || null,
          dto.description || null,
          ctx.employeeId,
        ],
      );
      return res.rows[0];
    });
  }

  async listApplicants(ctx: RequestContext, requisitionId?: string) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const res = await client.query(
        `SELECT a.*, r.title AS "requisitionTitle"
           FROM job_applicant a
           JOIN job_requisition r ON r.id = a.requisition_id
          WHERE a.org_id = app.current_org_id()
            AND ($1::uuid IS NULL OR a.requisition_id = $1)
          ORDER BY a.created_at DESC`,
        [requisitionId || null],
      );
      return res.rows;
    });
  }

  async createApplicant(
    ctx: RequestContext,
    dto: {
      requisitionId: string;
      fullName: string;
      email: string;
      phone?: string;
      source?: string;
      expectedSalary?: number;
      notes?: string;
    },
  ) {
    if (!dto.requisitionId || !dto.fullName?.trim() || !dto.email?.trim()) {
      throw new BadRequestException('Requisition, full name, and email are required');
    }
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const res = await client.query(
        `INSERT INTO job_applicant (
           org_id, requisition_id, full_name, email, phone, source, expected_salary, notes, stage
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, 'applied')
         RETURNING *`,
        [
          dto.requisitionId,
          dto.fullName.trim(),
          dto.email.trim(),
          dto.phone || null,
          dto.source || 'JobStreet / LinkedIn',
          dto.expectedSalary ? Number(dto.expectedSalary) : null,
          dto.notes || null,
        ],
      );
      return res.rows[0];
    });
  }

  async updateApplicantStage(
    ctx: RequestContext,
    id: string,
    dto: { stage: string; interviewDate?: string; notes?: string },
  ) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const res = await client.query(
        `UPDATE job_applicant
            SET stage = $1,
                interview_date = COALESCE($2::date, interview_date),
                notes = COALESCE($3, notes)
          WHERE id = $4 AND org_id = app.current_org_id()
          RETURNING *`,
        [dto.stage, dto.interviewDate || null, dto.notes || null, id],
      );
      if (!res.rows[0]) throw new NotFoundException('Applicant not found');
      return res.rows[0];
    });
  }

  // -------------------------------------------------------------------------
  // 5. Audit Trail Viewer (HR Admin)
  // -------------------------------------------------------------------------

  async listAuditLogs(ctx: RequestContext, tableName?: string, limit = 100) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin']);
      const safeLimit = Math.min(Math.max(limit || 100, 1), 300);

      const res = await client.query(
        `SELECT al.id::text,
                al.occurred_at AS "occurredAt",
                al.table_name AS "tableName",
                al.record_id AS "recordId",
                al.operation::text AS operation,
                al.changed_columns AS "changedColumns",
                al.new_data AS "newData",
                al.old_data AS "oldData",
                e.employee_no AS "actorEmployeeNo",
                e.first_name || ' ' || e.last_name AS "actorName"
           FROM audit_log al
           LEFT JOIN employee e ON e.id = al.actor_employee_id
          WHERE (
                  al.new_data->>'org_id' = app.current_org_id()::text
               OR al.old_data->>'org_id' = app.current_org_id()::text
                )
            AND ($1::text IS NULL OR al.table_name = $1)
          ORDER BY al.occurred_at DESC
          LIMIT $2`,
        [tableName || null, safeLimit],
      );
      return res.rows;
    });
  }
}
