import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { DbService, RequestContext } from '../db/db.service';

/**
 * The levels an org unit can be, ordered as they nest — which is also the order
 * a picker should offer them in.
 *
 * REGION is absent on purpose (migration 0027): it behaves as a cross-cutting
 * attribute rather than a parent of branch.
 */
export const orgUnitType = z.enum([
  'holdings', 'group', 'division', 'department', 'section', 'area', 'branch',
]);

export const createDepartment = z.object({
  code: z.string().trim().min(1).max(16)
    .regex(/^[A-Z0-9_-]+$/, 'Use uppercase letters, digits, hyphen or underscore'),
  name: z.string().trim().min(1),
  // Defaults to department: the common case, and the level every row created
  // before migration 0027 already carries.
  unitType: orgUnitType.default('department'),
  parentDepartmentId: z.string().uuid().nullish(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateDepartment = z.object({
  code: z.string().trim().min(1).max(16).regex(/^[A-Z0-9_-]+$/).optional(),
  name: z.string().trim().min(1).optional(),
  unitType: orgUnitType.optional(),
  // Explicit null clears the parent, making it a top-level department.
  parentDepartmentId: z.string().uuid().nullish(),
});

export const closeDepartment = z.object({
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const updateEmploymentType = z.object({
  code: z.string().trim().min(1).max(16).regex(/^[A-Z0-9_-]+$/).optional(),
  name: z.string().trim().min(1).optional(),
  isEligibleForReview: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const createEmploymentType = z.object({
  code: z.string().trim().min(1).max(16).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1),
  isEligibleForReview: z.boolean().default(true),
});

/**
 * A rung on the ladder.
 *
 * rankNo is NOT bounded here beyond sanity. The client's ladder runs 6..11 and
 * the importer enforces 1..99, but a tenant is entitled to number its own
 * grades however it likes; a range invented in this file would be a rule nobody
 * agreed to, enforced in the one place least able to explain itself.
 */
export const createRank = z.object({
  code: z.string().trim().min(1).max(16)
    .regex(/^[A-Z0-9_-]+$/, 'Use uppercase letters, digits, hyphen or underscore'),
  name: z.string().trim().min(1),
  rankNo: z.number().int().min(1).max(99),
});

export const createPosition = z.object({
  title: z.string().trim().min(1),
  departmentId: z.string().uuid().nullish(),
  jobFamily: z.string().trim().nullish(),
  jobLevel: z.string().trim().nullish(),
  rankId: z.string().uuid().nullish(),
});

/**
 * Admin CRUD for the reference data the 201 importer creates on the fly.
 *
 * Codes are derived on import (Operations -> OPS). That guess is usually right
 * and occasionally wrong, so HR needs to correct it — which is safe, because
 * every foreign key is on the UUID. The code is a human-facing key used only to
 * match import rows.
 *
 * The destructive guards (closing a populated department, deactivating a type
 * people still hold, hierarchy cycles) live in migration 0018 as triggers, not
 * here: this service is not the only writer, and an invariant enforced in one
 * place is not an invariant.
 */
@Injectable()
export class ReferenceDataService {
  constructor(private readonly db: DbService) {}

  // --- Departments ---------------------------------------------------------

  async listDepartments(ctx: RequestContext, includeClosed = false) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT d.id, d.code, d.name,
                d.unit_type::text            AS "unitType",
                p.unit_type::text            AS "parentUnitType",
                d.parent_department_id       AS "parentDepartmentId",
                p.name                       AS "parentName",
                d.effective_from::text       AS "effectiveFrom",
                d.effective_to::text         AS "effectiveTo",
                (d.effective_to IS NULL)     AS "isCurrent",
                -- Headcount drives what an admin may safely do: a populated
                -- department cannot be closed.
                (SELECT count(*)::int
                   FROM employment em
                   JOIN employee e ON e.id = em.employee_id
                  WHERE em.department_id = d.id
                    AND em.effective_to IS NULL
                    AND e.deleted_at IS NULL
                    AND e.status <> 'separated')        AS "headcount",
                (SELECT count(*)::int FROM department c
                  WHERE c.parent_department_id = d.id
                    AND c.effective_to IS NULL)         AS "childCount"
           FROM department d
           LEFT JOIN department p ON p.id = d.parent_department_id
          WHERE ($1::boolean OR d.effective_to IS NULL)
          ORDER BY d.code`,
        [includeClosed]);
      return res.rows;
    });
  }

  async createDepartment(ctx: RequestContext, input: z.infer<typeof createDepartment>) {
    return this.db.withContext(ctx, async (client) => {
      const orgId = await this.orgOf(client, ctx);

      const res = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO department (org_id, code, name, unit_type,
                                 parent_department_id, effective_from)
              VALUES ($1,$2,$3,$4::org_unit_type,$5,COALESCE($6::date, CURRENT_DATE))
         RETURNING id`,
        [orgId, input.code, input.name, input.unitType,
         input.parentDepartmentId ?? null, input.effectiveFrom ?? null]));

      const id = res.rows[0]?.id;
      // RLS WITH CHECK failures return no row rather than raising.
      if (!id) throw new ForbiddenException('Not permitted to create departments');
      return { id };
    });
  }

  async updateDepartment(
    ctx: RequestContext, id: string, patch: z.infer<typeof updateDepartment>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ id: string }>(
        `UPDATE department
            SET code = COALESCE($2, code),
                name = COALESCE($3, name),
                unit_type = COALESCE($6::org_unit_type, unit_type),
                -- Distinguish "not supplied" from "explicitly cleared":
                -- $5 is a flag saying the caller intends to change the parent.
                parent_department_id = CASE WHEN $5 THEN $4::uuid
                                            ELSE parent_department_id END
          WHERE id = $1 AND effective_to IS NULL
      RETURNING id`,
        [id, patch.code ?? null, patch.name ?? null,
         patch.parentDepartmentId ?? null,
         patch.parentDepartmentId !== undefined,
         patch.unitType ?? null]));

      if (!res.rows[0]) {
        throw new NotFoundException('Department not found, closed, or not permitted');
      }
      return { id };
    });
  }

  /** Closes a department as of a date. Refused if anyone is still assigned. */
  async closeDepartment(
    ctx: RequestContext, id: string, input: z.infer<typeof closeDepartment>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ id: string }>(
        `UPDATE department SET effective_to = $2
          WHERE id = $1 AND effective_to IS NULL RETURNING id`,
        [id, input.effectiveTo]));
      if (!res.rows[0]) {
        throw new NotFoundException('Department not found, already closed, or not permitted');
      }
      return { id, closed: true };
    });
  }

  // --- Employment types ----------------------------------------------------

  async listEmploymentTypes(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT t.id, t.code, t.name,
                t.is_eligible_for_review AS "isEligibleForReview",
                t.is_active              AS "isActive",
                (SELECT count(*)::int
                   FROM employment em
                   JOIN employee e ON e.id = em.employee_id
                  WHERE em.employment_type_id = t.id
                    AND em.effective_to IS NULL
                    AND e.deleted_at IS NULL
                    AND e.status <> 'separated') AS "headcount"
           FROM employment_type t
          ORDER BY t.code`);
      return res.rows;
    });
  }

  async createEmploymentType(
    ctx: RequestContext, input: z.infer<typeof createEmploymentType>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Requesting employee not found');

      const res = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO employment_type (org_id, code, name, is_eligible_for_review)
              VALUES ($1,$2,$3,$4) RETURNING id`,
        [orgId, input.code, input.name, input.isEligibleForReview]));
      const id = res.rows[0]?.id;
      if (!id) throw new ForbiddenException('Not permitted to create employment types');
      return { id };
    });
  }

  /**
   * `isEligibleForReview` decides whether a review cycle picks these people up,
   * so it belongs to HR rather than to whatever the importer inferred.
   */
  async updateEmploymentType(
    ctx: RequestContext, id: string, patch: z.infer<typeof updateEmploymentType>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ id: string }>(
        `UPDATE employment_type
            SET code = COALESCE($5, code),
                name = COALESCE($2, name),
                is_eligible_for_review = COALESCE($3, is_eligible_for_review),
                is_active = COALESCE($4, is_active)
          WHERE id = $1 RETURNING id`,
        [id, patch.name ?? null, patch.isEligibleForReview ?? null,
         patch.isActive ?? null, patch.code ?? null]));
      if (!res.rows[0]) {
        throw new NotFoundException('Employment type not found or not permitted');
      }
      return { id };
    });
  }

  /**
   * Roles, for screens that target a role rather than a person — form template
   * assignment in particular ("templates by user & EE type").
   *
   * Read-only and name-only. Roles are defined by the baseline seed and their
   * grants are security configuration, not something an admin screen should
   * casually edit.
   */
  async listRoles(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT r.id, r.code, r.name,
                r.is_security_admin AS "isSecurityAdmin",
                (SELECT count(*)::int FROM role_assignment ra
                  WHERE ra.role_id = r.id
                    AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_DATE))
                  AS "assignedCount"
           FROM app_role r
          ORDER BY r.code`);
      return res.rows;
    });
  }

  /** Positions, so an admin can see and set job family / level. */
  async listPositions(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT p.id, p.title, p.job_family AS "jobFamily", p.job_level AS "jobLevel",
                p.rank_id AS "rankId", r.code AS "rankCode", r.name AS "rankName",
                r.rank_no AS "rankNo",
                d.name AS "departmentName", p.is_active AS "isActive",
                (SELECT count(*)::int
                   FROM employment em
                   JOIN employee e ON e.id = em.employee_id
                  WHERE em.position_id = p.id AND em.effective_to IS NULL
                    AND e.deleted_at IS NULL) AS "headcount"
           FROM position p
           LEFT JOIN department d ON d.id = p.department_id
           LEFT JOIN job_rank r ON r.id = p.rank_id
          ORDER BY p.title`);
      return res.rows;
    });
  }

  /**
   * The rank ladder, most senior first.
   *
   * Ordered by rank_no ascending because the client's numbering puts the lower
   * number at the top (6 = Department Manager). Sorting "descending because
   * bigger is better" would silently invert every picker.
   */
  async listRanks(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT r.id, r.code, r.name, r.rank_no AS "rankNo", r.is_active AS "isActive",
                (SELECT count(*)::int FROM position p WHERE p.rank_id = r.id) AS "positionCount"
           FROM job_rank r
          ORDER BY r.rank_no`);
      return res.rows;
    });
  }

  /**
   * Adds a rung.
   *
   * Until this existed the ladder could only arrive by CSV import, which is
   * exactly how GGCHCM ended up with no ranks at all: the seed file had no rank
   * column, and there was no other way in. A structure you can only create by
   * re-importing every employee is one that stays empty.
   */
  async createRank(ctx: RequestContext, input: z.infer<typeof createRank>) {
    return this.db.withContext(ctx, async (client) => {
      const orgId = await this.orgOf(client, ctx);
      const res = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO job_rank (org_id, code, name, rank_no)
              VALUES ($1,$2,$3,$4) RETURNING id`,
        [orgId, input.code, input.name, input.rankNo]));

      const id = res.rows[0]?.id;
      if (!id) throw new ForbiddenException('Not permitted to create ranks');
      return { id };
    });
  }

  async createPosition(ctx: RequestContext, input: z.infer<typeof createPosition>) {
    return this.db.withContext(ctx, async (client) => {
      const orgId = await this.orgOf(client, ctx);
      const res = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO position (org_id, department_id, title, job_family,
                               job_level, rank_id)
              VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [orgId, input.departmentId ?? null, input.title,
         input.jobFamily ?? null, input.jobLevel ?? null, input.rankId ?? null]));

      const id = res.rows[0]?.id;
      if (!id) throw new ForbiddenException('Not permitted to create positions');
      return { id };
    });
  }

  async updatePosition(
    ctx: RequestContext, id: string,
    patch: {
      title?: string | undefined;
      jobFamily?: string | null | undefined;
      jobLevel?: string | null | undefined;
      rankId?: string | null | undefined;
    },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ id: string }>(
        `UPDATE position
            SET title = COALESCE($2, title),
                job_family = CASE WHEN $4 THEN $3 ELSE job_family END,
                job_level  = CASE WHEN $6 THEN $5 ELSE job_level END,
                -- Explicit null unranks the position, which is a real thing to
                -- want; $8 separates "clear it" from "leave it alone".
                rank_id    = CASE WHEN $8 THEN $7::uuid ELSE rank_id END
          WHERE id = $1 RETURNING id`,
        [id, patch.title ?? null, patch.jobFamily ?? null,
         patch.jobFamily !== undefined, patch.jobLevel ?? null,
         patch.jobLevel !== undefined, patch.rankId ?? null,
         patch.rankId !== undefined]));
      if (!res.rows[0]) throw new NotFoundException('Position not found or not permitted');
      return { id };
    });
  }

  /**
   * Trigger and constraint violations carry messages written for the operator
   * ("2 employee(s) are still assigned to it"). Surfacing them as 400s is the
   * whole point; swallowing them would leave an unexplained 500.
   */
  /**
   * The caller's tenant.
   *
   * Read from the employee row rather than taken from the request: org_id is
   * what RLS scopes every insert by, so a value the caller could influence
   * would be a tenant boundary decided by the caller.
   */
  private async orgOf(client: PoolClient, ctx: RequestContext): Promise<string> {
    const org = await client.query<{ org_id: string }>(
      'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
    const orgId = org.rows[0]?.org_id;
    if (!orgId) throw new NotFoundException('Requesting employee not found');
    return orgId;
  }

  // --- Comprehensive HR Settings -------------------------------------------

  async getHrSettings(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      let res = await client.query(
        `SELECT * FROM hr_settings WHERE org_id = app.current_org_id()`,
      );
      if (!res.rows[0]) {
        const orgRes = await client.query(
          `SELECT name FROM organization WHERE id = app.current_org_id()`,
        );
        const orgName = orgRes.rows[0]?.name || 'My Company Inc.';
        const insertRes = await client.query(
          `INSERT INTO hr_settings (
             org_id, company_registered_name, company_trade_name
           ) VALUES (app.current_org_id(), $1, $1)
           ON CONFLICT (org_id) DO UPDATE SET updated_at = now()
           RETURNING *`,
          [orgName],
        );
        return insertRes.rows[0];
      }
      return res.rows[0];
    });
  }

  async updateHrSettings(ctx: RequestContext, payload: any) {
    return this.db.withContext(ctx, async (client) => {
      await this.getHrSettings(ctx);

      const fields: string[] = [];
      const values: any[] = [];

      const allowedKeys = [
        'company_registered_name',
        'company_trade_name',
        'tin',
        'rdo_code',
        'sss_employer_no',
        'philhealth_employer_no',
        'pagibig_employer_no',
        'sec_dti_reg_no',
        'official_business_address',
        'contact_number',
        'official_hr_email',
        'standard_working_days_per_week',
        'standard_hours_per_day',
        'probationary_months',
        'retirement_age',
        'required_201_documents',
        'default_shift_code',
        'grace_period_mins',
        'tardiness_monthly_threshold',
        'overtime_approval_required',
        'enable_kiosk_camera',
        'require_kiosk_passcode',
        'allow_mobile_attendance',
        'pay_frequency',
        'cutoff_1_start',
        'cutoff_1_end',
        'cutoff_2_start',
        'cutoff_2_end',
        'payout_day_quindena_1',
        'payout_day_quindena_2',
        'train_tax_active',
        'sss_wisp_active',
        'thirteenth_month_tax_exempt_ceiling',
        'service_charge_enabled',
        'service_charge_staff_share_pct',
        'default_currency',
        'enforce_payroll_maker_checker',
      ];

      for (const key of allowedKeys) {
        if (payload[key] !== undefined) {
          values.push(payload[key]);
          fields.push(`${key} = $${values.length}`);
        }
      }

      if (fields.length === 0) {
        return this.getHrSettings(ctx);
      }

      values.push(new Date());
      fields.push(`updated_at = $${values.length}`);

      const res = await client.query(
        `UPDATE hr_settings
            SET ${fields.join(', ')}
          WHERE org_id = app.current_org_id()
          RETURNING *`,
        values,
      );
      return res.rows[0];
    });
  }

  // --- Extended Full CRUD for System Setup --------------------------------

  async deleteEmploymentType(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const check = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM employment WHERE employment_type_id = $1 AND effective_to IS NULL`,
        [id],
      );
      if ((check.rows[0]?.cnt ?? 0) > 0) {
        throw new BadRequestException('Cannot delete an employment type that active employees hold. Deactivate it instead.');
      }
      const res = await client.query(`DELETE FROM employment_type WHERE id = $1 RETURNING id`, [id]);
      if (!res.rows[0]) throw new NotFoundException('Employment type not found');
      return { deleted: true };
    });
  }

  async updateRank(
    ctx: RequestContext,
    id: string,
    input: { code?: string; name?: string; rankNo?: number },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (input.code !== undefined) { vals.push(input.code.trim().toUpperCase()); sets.push(`code = $${vals.length}`); }
      if (input.name !== undefined) { vals.push(input.name.trim()); sets.push(`name = $${vals.length}`); }
      if (input.rankNo !== undefined) { vals.push(input.rankNo); sets.push(`rank_no = $${vals.length}`); }
      if (sets.length === 0) throw new BadRequestException('Nothing to update');
      vals.push(id);
      const res = await this.wrap(() => client.query(
        `UPDATE job_rank SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING id`,
        vals,
      ));
      if (!res.rows[0]) throw new NotFoundException('Rank not found');
      return { id };
    });
  }

  async deleteRank(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const check = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM position WHERE rank_id = $1`,
        [id],
      );
      if ((check.rows[0]?.cnt ?? 0) > 0) {
        throw new BadRequestException('Cannot delete a rank still assigned to positions.');
      }
      const res = await client.query(`DELETE FROM job_rank WHERE id = $1 RETURNING id`, [id]);
      if (!res.rows[0]) throw new NotFoundException('Rank not found');
      return { deleted: true };
    });
  }

  async deletePosition(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const check = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM employment WHERE position_id = $1 AND effective_to IS NULL`,
        [id],
      );
      if ((check.rows[0]?.cnt ?? 0) > 0) {
        throw new BadRequestException('Cannot delete a position held by active employees.');
      }
      const res = await client.query(`DELETE FROM position WHERE id = $1 RETURNING id`, [id]);
      if (!res.rows[0]) throw new NotFoundException('Position not found');
      return { deleted: true };
    });
  }

  // --- Branches / Regional Hubs CRUD ---------------------------------------

  async listBranches(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT b.*,
                (SELECT count(*)::int
                   FROM employee_compensation ec
                   JOIN employee e ON e.id = ec.employee_id
                  WHERE ec.branch_id = b.id
                    AND e.deleted_at IS NULL
                    AND e.status <> 'separated') AS headcount
           FROM branch b
          WHERE b.org_id = app.current_org_id()
          ORDER BY b.code ASC`,
      );
      return res.rows;
    });
  }

  async createBranch(
    ctx: RequestContext,
    dto: {
      code: string;
      name: string;
      region?: string;
      address?: string;
      birRdoCode?: string;
      sssBranchCode?: string;
      philhealthEmployerNo?: string;
      pagibigEmployerNo?: string;
    },
  ) {
    if (!dto.code?.trim() || !dto.name?.trim()) {
      throw new BadRequestException('Branch code and name are required');
    }
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query(
        `INSERT INTO branch (
           org_id, code, name, region, address, bir_rdo_code,
           sss_branch_code, philhealth_employer_no, pagibig_employer_no
         ) VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          dto.code.trim().toUpperCase(),
          dto.name.trim(),
          dto.region || 'NCR',
          dto.address || null,
          dto.birRdoCode || null,
          dto.sssBranchCode || null,
          dto.philhealthEmployerNo || null,
          dto.pagibigEmployerNo || null,
        ],
      ));
      return res.rows[0];
    });
  }

  async updateBranch(
    ctx: RequestContext,
    id: string,
    dto: {
      code?: string;
      name?: string;
      region?: string;
      address?: string | null;
      birRdoCode?: string | null;
      sssBranchCode?: string | null;
      philhealthEmployerNo?: string | null;
      pagibigEmployerNo?: string | null;
      isHeadOffice?: boolean;
    },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query(
        `UPDATE branch
            SET code = COALESCE($1, code),
                name = COALESCE($2, name),
                region = COALESCE($3, region),
                address = COALESCE($4, address),
                bir_rdo_code = COALESCE($5, bir_rdo_code),
                sss_branch_code = COALESCE($6, sss_branch_code),
                philhealth_employer_no = COALESCE($7, philhealth_employer_no),
                pagibig_employer_no = COALESCE($8, pagibig_employer_no),
                is_head_office = COALESCE($9, is_head_office),
                updated_at = now()
          WHERE id = $10 AND org_id = app.current_org_id()
          RETURNING *`,
        [
          dto.code ? dto.code.trim().toUpperCase() : null,
          dto.name ? dto.name.trim() : null,
          dto.region ?? null,
          dto.address ?? null,
          dto.birRdoCode ?? null,
          dto.sssBranchCode ?? null,
          dto.philhealthEmployerNo ?? null,
          dto.pagibigEmployerNo ?? null,
          dto.isHeadOffice ?? null,
          id,
        ],
      ));
      if (!res.rows[0]) throw new NotFoundException('Branch not found');
      return res.rows[0];
    });
  }

  async deleteBranch(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const check = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM employee_compensation WHERE branch_id = $1`,
        [id],
      );
      if ((check.rows[0]?.cnt ?? 0) > 0) {
        throw new BadRequestException('Cannot delete a branch with assigned employees.');
      }
      const res = await client.query(
        `DELETE FROM branch WHERE id = $1 AND org_id = app.current_org_id() RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException('Branch not found');
      return { deleted: true };
    });
  }

  // --- Role Assignments CRUD -----------------------------------------------

  async listRoleAssignments(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT ra.id,
                ra.employee_id AS "employeeId",
                e.employee_no AS "employeeNo",
                e.first_name || ' ' || e.last_name AS "employeeName",
                ra.role_id AS "roleId",
                r.code AS "roleCode",
                r.name AS "roleName",
                ra.effective_from::text AS "effectiveFrom"
           FROM role_assignment ra
           JOIN employee e ON e.id = ra.employee_id
           JOIN app_role r ON r.id = ra.role_id
          WHERE ra.org_id = app.current_org_id()
            AND (ra.effective_to IS NULL OR CURRENT_DATE < ra.effective_to)
            AND e.deleted_at IS NULL
          ORDER BY r.code ASC, e.last_name ASC`,
      );
      return res.rows;
    });
  }

  async assignRole(ctx: RequestContext, dto: { employeeId: string; roleId: string }) {
    return this.db.withContext(ctx, async (client) => {
      const existing = await client.query(
        `SELECT id FROM role_assignment
          WHERE org_id = app.current_org_id()
            AND employee_id = $1 AND role_id = $2
            AND (effective_to IS NULL OR CURRENT_DATE < effective_to)`,
        [dto.employeeId, dto.roleId],
      );
      if (existing.rows[0]) return existing.rows[0];
      const res = await this.wrap(() => client.query(
        `INSERT INTO role_assignment (org_id, employee_id, role_id, effective_from)
         VALUES (app.current_org_id(), $1, $2, CURRENT_DATE)
         RETURNING id`,
        [dto.employeeId, dto.roleId],
      ));
      return res.rows[0];
    });
  }

  async revokeRoleAssignment(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE role_assignment
            SET effective_to = CURRENT_DATE
          WHERE id = $1 AND org_id = app.current_org_id()
          RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException('Role assignment not found');
      return { revoked: true };
    });
  }

  // --- Shifts, Leave Types & Salary Matrices Update / Delete ---------------

  async updateShift(
    ctx: RequestContext,
    id: string,
    dto: {
      code?: string;
      name?: string;
      startTime?: string;
      endTime?: string;
      breakMinutes?: number;
      gracePeriodMins?: number;
      isNightShift?: boolean;
      isActive?: boolean;
    },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query(
        `UPDATE attendance_shift
            SET code = COALESCE($1, code),
                name = COALESCE($2, name),
                start_time = COALESCE($3::time, start_time),
                end_time = COALESCE($4::time, end_time),
                break_minutes = COALESCE($5, break_minutes),
                grace_period_mins = COALESCE($6, grace_period_mins),
                is_night_shift = COALESCE($7, is_night_shift),
                is_active = COALESCE($8, is_active),
                updated_at = now()
          WHERE id = $9 AND org_id = app.current_org_id()
          RETURNING *`,
        [
          dto.code ? dto.code.trim().toUpperCase() : null,
          dto.name ? dto.name.trim() : null,
          dto.startTime ?? null,
          dto.endTime ?? null,
          dto.breakMinutes ?? null,
          dto.gracePeriodMins ?? null,
          dto.isNightShift ?? null,
          dto.isActive ?? null,
          id,
        ],
      ));
      if (!res.rows[0]) throw new NotFoundException('Shift not found');
      return res.rows[0];
    });
  }

  async deleteShift(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `DELETE FROM attendance_shift WHERE id = $1 AND org_id = app.current_org_id() RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException('Shift not found');
      return { deleted: true };
    });
  }

  async updateLeaveType(
    ctx: RequestContext,
    id: string,
    dto: {
      name?: string;
      defaultDaysPerYear?: number;
      isPaid?: boolean;
      canCashConvert?: boolean;
      canCarryOver?: boolean;
      maxCarryOverDays?: number;
      isActive?: boolean;
    },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query(
        `UPDATE leave_type
            SET name = COALESCE($1, name),
                default_days_per_year = COALESCE($2, default_days_per_year),
                is_paid = COALESCE($3, is_paid),
                can_cash_convert = COALESCE($4, can_cash_convert),
                can_carry_over = COALESCE($5, can_carry_over),
                max_carry_over_days = COALESCE($6, max_carry_over_days),
                is_active = COALESCE($7, is_active),
                updated_at = now()
          WHERE id = $8 AND org_id = app.current_org_id()
          RETURNING *`,
        [
          dto.name ? dto.name.trim() : null,
          dto.defaultDaysPerYear ?? null,
          dto.isPaid ?? null,
          dto.canCashConvert ?? null,
          dto.canCarryOver ?? null,
          dto.maxCarryOverDays ?? null,
          dto.isActive ?? null,
          id,
        ],
      ));
      if (!res.rows[0]) throw new NotFoundException('Leave type not found');
      return res.rows[0];
    });
  }

  async deleteLeaveType(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const check = await client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM leave_request WHERE leave_type_id = $1`,
        [id],
      );
      if ((check.rows[0]?.cnt ?? 0) > 0) {
        throw new BadRequestException('Cannot delete a leave type that has filed requests. Deactivate it instead.');
      }
      const res = await client.query(
        `DELETE FROM leave_type WHERE id = $1 AND org_id = app.current_org_id() RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException('Leave type not found');
      return { deleted: true };
    });
  }

  async updateSalaryMatrix(
    ctx: RequestContext,
    id: string,
    dto: {
      gradeCode?: string;
      gradeName?: string;
      minMonthlyRate?: number;
      maxMonthlyRate?: number;
      industryType?: string;
      region?: string;
    },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query(
        `UPDATE salary_grade_matrix
            SET grade_code = COALESCE($1, grade_code),
                grade_name = COALESCE($2, grade_name),
                min_monthly_rate = COALESCE($3, min_monthly_rate),
                max_monthly_rate = COALESCE($4, max_monthly_rate),
                industry_type = COALESCE($5, industry_type),
                region = COALESCE($6, region),
                updated_at = now()
          WHERE id = $7 AND org_id = app.current_org_id()
          RETURNING *`,
        [
          dto.gradeCode ? dto.gradeCode.trim().toUpperCase() : null,
          dto.gradeName ? dto.gradeName.trim() : null,
          dto.minMonthlyRate ?? null,
          dto.maxMonthlyRate ?? null,
          dto.industryType ?? null,
          dto.region ?? null,
          id,
        ],
      ));
      if (!res.rows[0]) throw new NotFoundException('Salary matrix grade not found');
      return res.rows[0];
    });
  }

  async deleteSalaryMatrix(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `DELETE FROM salary_grade_matrix WHERE id = $1 AND org_id = app.current_org_id() RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException('Salary matrix grade not found');
      return { deleted: true };
    });
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {

    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; message?: string; constraint?: string };
      if (e.code === 'P0001' || e.code === '23514') {
        throw new BadRequestException(e.message ?? 'Not allowed');
      }
      if (e.code === '23505') {
        throw new BadRequestException(
          e.constraint === 'department_current_code_uq'
            ? 'Another active department already uses that code.'
            : 'That code is already in use.');
      }
      if (e.code === '23503') {
        throw new BadRequestException('Referenced record does not exist.');
      }
      throw err;
    }
  }
}
