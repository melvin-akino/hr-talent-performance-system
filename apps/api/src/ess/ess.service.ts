import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService, RequestContext } from '../db/db.service';

@Injectable()
export class EssService {
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
  // 1. Company Announcements & Bulletins
  // -------------------------------------------------------------------------

  async listAnnouncements(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT a.*,
                e.first_name || ' ' || e.last_name AS "publishedByName"
           FROM company_announcement a
           LEFT JOIN employee e ON e.id = a.published_by
          WHERE a.org_id = app.current_org_id()
            AND (a.expires_at IS NULL OR a.expires_at >= CURRENT_DATE)
          ORDER BY a.is_pinned DESC, a.published_at DESC
          LIMIT 50`,
      );
      return res.rows;
    });
  }

  async createAnnouncement(
    ctx: RequestContext,
    dto: { title: string; category?: string; body: string; isPinned?: boolean; expiresAt?: string },
  ) {
    if (!dto.title?.trim() || !dto.body?.trim()) {
      throw new BadRequestException('Title and body are required');
    }
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const res = await client.query(
        `INSERT INTO company_announcement (
           org_id, title, category, body, is_pinned, published_by, expires_at
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          dto.title.trim(),
          dto.category || 'general',
          dto.body.trim(),
          Boolean(dto.isPinned),
          ctx.employeeId,
          dto.expiresAt || null,
        ],
      );
      return res.rows[0];
    });
  }

  async deleteAnnouncement(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner']);
      const res = await client.query(
        `DELETE FROM company_announcement
          WHERE id = $1 AND org_id = app.current_org_id()
          RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException('Announcement not found');
      return { deleted: true };
    });
  }

  // -------------------------------------------------------------------------
  // 2. Employee Self-Service Profile, COE & Change Requests
  // -------------------------------------------------------------------------

  async getMyProfile(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT e.id, e.employee_no AS "employeeNo",
                e.first_name AS "firstName", e.last_name AS "lastName",
                e.work_email AS "workEmail",
                e.status::text AS status,
                e.hired_on::text AS "hiredOn",
                p.title AS "positionTitle",
                d.name AS "departmentName",
                b.name AS "branchName",
                c.monthly_rate AS "monthlyRate",
                c.pay_type AS "payType",
                c.pay_frequency AS "payFrequency",
                c.tin, c.sss_no AS "sssNo", c.philhealth_no AS "philhealthNo", c.pagibig_no AS "pagibigNo",
                c.bank_name AS "bankName", c.bank_account_no AS "bankAccountNo",
                c.bank_account_name AS "bankAccountName"
           FROM employee e
           LEFT JOIN employment em ON em.employee_id = e.id AND em.effective_to IS NULL
           LEFT JOIN position p ON p.id = em.position_id
           LEFT JOIN department d ON d.id = em.department_id
           LEFT JOIN employee_compensation c ON c.employee_id = e.id
           LEFT JOIN branch b ON b.id = c.branch_id
          WHERE e.id = $1 AND e.org_id = app.current_org_id()`,
        [ctx.employeeId],
      );
      if (!res.rows[0]) throw new NotFoundException('Profile not found');
      return res.rows[0];
    });
  }

  async generateCoe(ctx: RequestContext, includeCompensation = false) {
    return this.db.withContext(ctx, async (client) => {
      const profile = await this.getMyProfile(ctx);
      const orgRes = await client.query(
        `SELECT o.name AS "orgName",
                COALESCE(hs.company_registered_name, o.name) AS "registeredName",
                COALESCE(hs.official_business_address, 'Bonifacio Global City, Taguig, Philippines') AS "companyAddress",
                COALESCE(hs.official_hr_email, 'hr@company.com') AS "hrEmail",
                COALESCE(hs.contact_number, '') AS "contactNumber"
           FROM organization o
           LEFT JOIN hr_settings hs ON hs.org_id = o.id
          WHERE o.id = app.current_org_id()`,
      );

      return {
        issuedOn: new Date().toISOString().slice(0, 10),
        referenceNo: `COE-${new Date().getFullYear()}-${profile.employeeNo}`,
        company: orgRes.rows[0] || {},
        employee: {
          employeeNo: profile.employeeNo,
          fullName: `${profile.firstName} ${profile.lastName}`,
          positionTitle: profile.positionTitle || 'Staff Member',
          departmentName: profile.departmentName || 'Operations',
          branchName: profile.branchName || 'Main Office',
          status: profile.status,
          hiredOn: profile.hiredOn,
          ...(includeCompensation ? { monthlyRate: Number(profile.monthlyRate || 0) } : {}),
        },
      };
    });
  }

  async listProfileRequests(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const roles = await this.getCallerRoles(client, ctx);
      const isHr = roles.includes('hr_admin') || roles.includes('hr_partner');

      const res = await client.query(
        `SELECT r.*,
                e.employee_no AS "employeeNo",
                e.first_name || ' ' || e.last_name AS "employeeName",
                rev.first_name || ' ' || rev.last_name AS "reviewedByName"
           FROM ess_profile_request r
           JOIN employee e ON e.id = r.employee_id
           LEFT JOIN employee rev ON rev.id = r.reviewed_by
          WHERE r.org_id = app.current_org_id()
            AND ($1::boolean = TRUE OR r.employee_id = $2)
          ORDER BY (r.status = 'pending') DESC, r.created_at DESC
          LIMIT 100`,
        [isHr, ctx.employeeId],
      );
      return res.rows;
    });
  }

  async submitProfileRequest(
    ctx: RequestContext,
    dto: {
      requestType: string;
      requestedChanges: Record<string, string>;
      reason: string;
    },
  ) {
    if (!dto.requestType || !dto.reason?.trim()) {
      throw new BadRequestException('Request type and reason are required');
    }
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `INSERT INTO ess_profile_request (
           org_id, employee_id, request_type, requested_changes, reason, status
         ) VALUES (app.current_org_id(), $1, $2, $3::jsonb, $4, 'pending')
         RETURNING *`,
        [
          ctx.employeeId,
          dto.requestType,
          JSON.stringify(dto.requestedChanges || {}),
          dto.reason.trim(),
        ],
      );
      return res.rows[0];
    });
  }

  async reviewProfileRequest(
    ctx: RequestContext,
    requestId: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner']);

      const reqRes = await client.query(
        `SELECT * FROM ess_profile_request WHERE id = $1 AND org_id = app.current_org_id()`,
        [requestId],
      );
      const req = reqRes.rows[0];
      if (!req) throw new NotFoundException('Profile request not found');
      if (req.status !== 'pending') {
        throw new BadRequestException(`Request is already ${req.status}`);
      }

      if (decision === 'approved') {
        const ch = (req.requested_changes || {}) as Record<string, string>;
        if (req.request_type === 'bank_account') {
          await client.query(
            `UPDATE employee_compensation
                SET bank_name = COALESCE($1, bank_name),
                    bank_account_no = COALESCE($2, bank_account_no),
                    bank_account_name = COALESCE($3, bank_account_name),
                    updated_at = now()
              WHERE employee_id = $4 AND org_id = app.current_org_id()`,
            [ch.bankName || null, ch.bankAccountNo || null, ch.bankAccountName || null, req.employee_id],
          );
        } else if (req.request_type === 'government_id') {
          await client.query(
            `UPDATE employee_compensation
                SET tin = COALESCE($1, tin),
                    sss_no = COALESCE($2, sss_no),
                    philhealth_no = COALESCE($3, philhealth_no),
                    pagibig_no = COALESCE($4, pagibig_no),
                    updated_at = now()
              WHERE employee_id = $5 AND org_id = app.current_org_id()`,
            [ch.tin || null, ch.sssNo || null, ch.philhealthNo || null, ch.pagibigNo || null, req.employee_id],
          );
        } else if (req.request_type === 'contact_info' && ch.workEmail) {
          await client.query(
            `UPDATE employee
                SET work_email = $1,
                    updated_at = now()
              WHERE id = $2 AND org_id = app.current_org_id()`,
            [ch.workEmail.trim(), req.employee_id],
          );
        }
      }

      const upd = await client.query(
        `UPDATE ess_profile_request
            SET status = $1,
                reviewed_by = $2,
                reviewed_at = now(),
                review_note = $3
          WHERE id = $4 AND org_id = app.current_org_id()
          RETURNING *`,
        [decision, ctx.employeeId, note || null, requestId],
      );
      return upd.rows[0];
    });
  }

  // -------------------------------------------------------------------------
  // 3. Offboarding Clearance & Final Pay Engine
  // -------------------------------------------------------------------------

  async listOffboardingCases(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const roles = await this.getCallerRoles(client, ctx);
      const isHrOrMgr = roles.some((r) => ['hr_admin', 'hr_partner', 'manager'].includes(r));

      const casesRes = await client.query(
        `SELECT oc.*,
                e.employee_no AS "employeeNo",
                e.first_name || ' ' || e.last_name AS "employeeName",
                p.title AS "positionTitle",
                d.name AS "departmentName"
           FROM offboarding_case oc
           JOIN employee e ON e.id = oc.employee_id
           LEFT JOIN employment em ON em.employee_id = e.id AND em.effective_to IS NULL
           LEFT JOIN position p ON p.id = em.position_id
           LEFT JOIN department d ON d.id = em.department_id
          WHERE oc.org_id = app.current_org_id()
            AND ($1::boolean = TRUE OR oc.employee_id = $2)
          ORDER BY oc.created_at DESC`,
        [isHrOrMgr, ctx.employeeId],
      );

      const itemsRes = await client.query(
        `SELECT ci.*,
                e.first_name || ' ' || e.last_name AS "clearedByName"
           FROM offboarding_clearance_item ci
           LEFT JOIN employee e ON e.id = ci.cleared_by
          WHERE ci.org_id = app.current_org_id()
          ORDER BY ci.created_at ASC`,
      );

      const byCase = new Map<string, any[]>();
      for (const item of itemsRes.rows) {
        const list = byCase.get(item.offboarding_case_id) || [];
        list.push(item);
        byCase.set(item.offboarding_case_id, list);
      }

      return casesRes.rows.map((c) => ({
        ...c,
        clearanceItems: byCase.get(c.id) || [],
      }));
    });
  }

  async createOffboardingCase(
    ctx: RequestContext,
    dto: { employeeId: string; separationDate: string; separationReason?: string; remarks?: string },
  ) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner']);

      const caseRes = await client.query(
        `INSERT INTO offboarding_case (
           org_id, employee_id, separation_date, separation_reason, remarks, status, created_by
         ) VALUES (app.current_org_id(), $1, $2::date, $3, $4, 'in_clearance', $5)
         RETURNING *`,
        [
          dto.employeeId,
          dto.separationDate,
          dto.separationReason || 'resignation',
          dto.remarks || null,
          ctx.employeeId,
        ],
      );
      const oc = caseRes.rows[0];

      const defaultClearance = [
        { area: 'IT & Assets', title: 'Return company laptop, ID badge, and access keys' },
        { area: 'Department Handover', title: 'Complete project handover & documentation' },
        { area: 'Finance & Loans', title: 'Reconcile cash advances & employee loans' },
        { area: 'HR Exit Interview', title: 'Complete HR exit interview & NDA reminder' },
      ];
      for (const item of defaultClearance) {
        await client.query(
          `INSERT INTO offboarding_clearance_item (
             org_id, offboarding_case_id, department_area, item_title, status
           ) VALUES (app.current_org_id(), $1, $2, $3, 'pending')`,
          [oc.id, item.area, item.title],
        );
      }
      return oc;
    });
  }

  async updateClearanceItem(
    ctx: RequestContext,
    itemId: string,
    dto: { status: 'pending' | 'cleared' | 'waived'; notes?: string },
  ) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);
      const res = await client.query(
        `UPDATE offboarding_clearance_item
            SET status = $1::text,
                notes = COALESCE($2, notes),
                cleared_by = CASE WHEN $1::text IN ('cleared', 'waived') THEN $3::uuid ELSE NULL END,
                cleared_at = CASE WHEN $1::text IN ('cleared', 'waived') THEN now() ELSE NULL END
          WHERE id = $4 AND org_id = app.current_org_id()
          RETURNING *`,
        [dto.status, dto.notes || null, ctx.employeeId, itemId],
      );
      if (!res.rows[0]) throw new NotFoundException('Clearance item not found');

      // Auto-advance case status to 'cleared' if all items are cleared/waived
      const caseId = res.rows[0].offboarding_case_id;
      const pendingRes = await client.query(
        `SELECT COUNT(*)::int AS cnt
           FROM offboarding_clearance_item
          WHERE offboarding_case_id = $1 AND status = 'pending'`,
        [caseId],
      );
      if ((pendingRes.rows[0]?.cnt ?? 1) === 0) {
        await client.query(
          `UPDATE offboarding_case
              SET status = CASE WHEN status = 'in_clearance' THEN 'cleared' ELSE status END,
                  updated_at = now()
            WHERE id = $1 AND org_id = app.current_org_id()`,
          [caseId],
        );
      }
      return res.rows[0];
    });
  }

  async computeFinalPay(
    ctx: RequestContext,
    caseId: string,
    dto: {
      unpaidBasicPay?: number;
      separationPay?: number;
      otherAdditions?: number;
      otherDeductions?: number;
    },
  ) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner', 'manager']);

      const caseRes = await client.query(
        `SELECT * FROM offboarding_case WHERE id = $1 AND org_id = app.current_org_id()`,
        [caseId],
      );
      const oc = caseRes.rows[0];
      if (!oc) throw new NotFoundException('Offboarding case not found');

      const year = new Date(oc.separation_date).getFullYear();

      // 1. Pro-rated 13th Month Accrual for the separation year
      const accrualRes = await client.query(
        `SELECT COALESCE(SUM(accrual_amount), 0)::numeric(14,2) AS total
           FROM thirteenth_month_accrual
          WHERE employee_id = $1 AND org_id = app.current_org_id() AND year = $2`,
        [oc.employee_id, year],
      );
      const prorated13th = Number(accrualRes.rows[0]?.total || 0);

      // 2. Unused SIL Monetization (remaining SIL days * daily_rate)
      const silRes = await client.query(
        `SELECT COALESCE(SUM((la.allocated_days - la.used_days) * COALESCE(ec.daily_rate, 0)), 0)::numeric(14,2) AS val
           FROM leave_allocation la
           JOIN leave_type lt ON lt.id = la.leave_type_id
           LEFT JOIN employee_compensation ec ON ec.employee_id = la.employee_id
          WHERE la.employee_id = $1
            AND la.org_id = app.current_org_id()
            AND la.year = $2
            AND lt.code = 'SIL'`,
        [oc.employee_id, year],
      );
      const silMonetization = Math.max(0, Number(silRes.rows[0]?.val || 0));

      // 3. Outstanding Active Loans
      const loanRes = await client.query(
        `SELECT COALESCE(SUM(remaining_balance), 0)::numeric(14,2) AS bal
           FROM employee_loan
          WHERE employee_id = $1 AND org_id = app.current_org_id() AND status = 'active'`,
        [oc.employee_id],
      );
      const outstandingLoans = Number(loanRes.rows[0]?.bal || 0);

      const unpaidBasic = Number(dto.unpaidBasicPay || 0);
      const sepPay = Number(dto.separationPay || 0);
      const otherAdd = Number(dto.otherAdditions || 0);
      const otherDed = Number(dto.otherDeductions || 0);

      const netFinalPay =
        Math.round(
          (unpaidBasic + prorated13th + silMonetization + sepPay + otherAdd - outstandingLoans - otherDed) * 100,
        ) / 100;

      const upd = await client.query(
        `UPDATE offboarding_case
            SET unpaid_basic_pay = $1,
                prorated_13th_month = $2,
                sil_monetization = $3,
                separation_pay = $4,
                other_additions = $5,
                outstanding_loans_deduction = $6,
                other_deductions = $7,
                net_final_pay = $8,
                status = 'final_pay_computed',
                computed_by = $9,
                updated_at = now()
          WHERE id = $10 AND org_id = app.current_org_id()
          RETURNING *`,
        [
          unpaidBasic,
          prorated13th,
          silMonetization,
          sepPay,
          otherAdd,
          outstandingLoans,
          otherDed,
          netFinalPay,
          ctx.employeeId,
          caseId,
        ],
      );
      return upd.rows[0];
    });
  }

  async releaseFinalPay(ctx: RequestContext, caseId: string) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'manager']);

      const pendingRes = await client.query(
        `SELECT COUNT(*)::int AS cnt
           FROM offboarding_clearance_item
          WHERE offboarding_case_id = $1 AND status = 'pending'`,
        [caseId],
      );
      if ((pendingRes.rows[0]?.cnt ?? 0) > 0) {
        throw new BadRequestException(
          'All clearance items must be cleared or waived before releasing final pay.',
        );
      }

      const caseRes = await client.query(
        `UPDATE offboarding_case
            SET status = 'released',
                released_by = $1,
                released_at = now(),
                updated_at = now()
          WHERE id = $2 AND org_id = app.current_org_id()
          RETURNING *`,
        [ctx.employeeId, caseId],
      );
      if (!caseRes.rows[0]) throw new NotFoundException('Offboarding case not found');

      // Settle active loans if final pay deducted them
      await client.query(
        `UPDATE employee_loan
            SET remaining_balance = 0,
                status = 'fully_paid',
                updated_at = now()
          WHERE employee_id = $1 AND org_id = app.current_org_id() AND status = 'active'`,
        [caseRes.rows[0].employee_id],
      );

      return caseRes.rows[0];
    });
  }

  // -------------------------------------------------------------------------
  // 4. Digital 201 File Document Vault & Policy Acknowledgment
  // -------------------------------------------------------------------------

  async listDocuments(ctx: RequestContext, employeeId?: string) {
    return this.db.withContext(ctx, async (client) => {
      const roles = await this.getCallerRoles(client, ctx);
      const isHr = roles.some((r) => ['hr_admin', 'hr_partner'].includes(r));

      const params: any[] = [];
      let filter = '';
      if (isHr && employeeId) {
        params.push(employeeId);
        filter = `AND (d.employee_id = $1 OR d.employee_id IS NULL)`;
      } else if (!isHr) {
        params.push(ctx.employeeId);
        filter = `AND (d.employee_id = $1 OR d.employee_id IS NULL)`;
      }

      const res = await client.query(
        `SELECT d.id,
                d.employee_id AS "employeeId",
                e.first_name || ' ' || e.last_name AS "employeeName",
                e.employee_no AS "employeeNo",
                d.doc_type AS "docType",
                d.title,
                d.file_name AS "fileName",
                d.mime_type AS "mimeType",
                d.file_size_bytes AS "fileSizeBytes",
                d.requires_ack AS "requiresAck",
                d.acknowledged_at AS "acknowledgedAt",
                d.uploaded_at AS "uploadedAt"
           FROM employee_document d
           LEFT JOIN employee e ON e.id = d.employee_id
          WHERE d.org_id = app.current_org_id()
            ${filter}
          ORDER BY d.uploaded_at DESC`,
        params,
      );
      return res.rows;
    });
  }

  async uploadDocument(
    ctx: RequestContext,
    dto: {
      employeeId?: string | null;
      docType: string;
      title: string;
      fileName: string;
      mimeType?: string;
      fileDataBase64: string;
      requiresAck?: boolean;
    },
  ) {
    if (!dto.title?.trim() || !dto.fileName?.trim() || !dto.fileDataBase64) {
      throw new BadRequestException('Title, fileName, and file content are required');
    }
    const raw =
      (dto.fileDataBase64.includes(',')
        ? dto.fileDataBase64.split(',')[1]
        : dto.fileDataBase64) ?? '';
    const sizeBytes = Buffer.byteLength(raw, 'base64');
    if (sizeBytes > 2 * 1024 * 1024) {
      throw new BadRequestException('File exceeds maximum 2MB limit');
    }

    return this.db.withContext(ctx, async (client) => {
      const roles = await this.getCallerRoles(client, ctx);
      const isHr = roles.some((r) => ['hr_admin', 'hr_partner'].includes(r));
      const targetEmpId = isHr ? (dto.employeeId || null) : ctx.employeeId;

      const res = await client.query(
        `INSERT INTO employee_document (
           org_id, employee_id, doc_type, title, file_name, mime_type,
           file_size_bytes, file_data_base64, file_url, requires_ack, uploaded_by
         ) VALUES (
           app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, '', $8, $9
         )
         RETURNING id, employee_id AS "employeeId", doc_type AS "docType",
                   title, file_name AS "fileName", mime_type AS "mimeType",
                   file_size_bytes AS "fileSizeBytes", requires_ack AS "requiresAck",
                   uploaded_at AS "uploadedAt"`,
        [
          targetEmpId,
          dto.docType || 'other',
          dto.title.trim(),
          dto.fileName.trim(),
          dto.mimeType || 'application/octet-stream',
          sizeBytes,
          raw,
          Boolean(dto.requiresAck),
          ctx.employeeId,
        ],
      );
      return res.rows[0];
    });
  }

  async getDocumentContent(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT id, employee_id, file_name, mime_type, file_data_base64
           FROM employee_document
          WHERE id = $1 AND org_id = app.current_org_id()`,
        [id],
      );
      const doc = res.rows[0];
      if (!doc) throw new NotFoundException('Document not found');
      const roles = await this.getCallerRoles(client, ctx);
      const isHr = roles.some((r) => ['hr_admin', 'hr_partner'].includes(r));
      if (!isHr && doc.employee_id && doc.employee_id !== ctx.employeeId) {
        throw new ForbiddenException('Not authorized to access this document');
      }
      return doc;
    });
  }

  async acknowledgeDocument(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE employee_document
            SET acknowledged_at = now(),
                acknowledged_by = $1
          WHERE id = $2 AND org_id = app.current_org_id()
            AND (employee_id = $1 OR employee_id IS NULL)
          RETURNING id, acknowledged_at AS "acknowledgedAt"`,
        [ctx.employeeId, id],
      );
      if (!res.rows[0]) throw new NotFoundException('Document not found');
      return res.rows[0];
    });
  }

  async deleteDocument(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      await this.requireRole(client, ctx, ['hr_admin', 'hr_partner']);
      const res = await client.query(
        `DELETE FROM employee_document WHERE id = $1 AND org_id = app.current_org_id() RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException('Document not found');
      return { deleted: true };
    });
  }
}
