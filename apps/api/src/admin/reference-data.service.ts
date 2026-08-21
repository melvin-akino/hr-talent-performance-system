import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';

export const createDepartment = z.object({
  code: z.string().trim().min(1).max(16)
    .regex(/^[A-Z0-9_-]+$/, 'Use uppercase letters, digits, hyphen or underscore'),
  name: z.string().trim().min(1),
  parentDepartmentId: z.string().uuid().nullish(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateDepartment = z.object({
  code: z.string().trim().min(1).max(16).regex(/^[A-Z0-9_-]+$/).optional(),
  name: z.string().trim().min(1).optional(),
  // Explicit null clears the parent, making it a top-level department.
  parentDepartmentId: z.string().uuid().nullish(),
});

export const closeDepartment = z.object({
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const updateEmploymentType = z.object({
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
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Requesting employee not found');

      const res = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO department (org_id, code, name, parent_department_id, effective_from)
              VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE)) RETURNING id`,
        [orgId, input.code, input.name, input.parentDepartmentId ?? null,
         input.effectiveFrom ?? null]));

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
                -- Distinguish "not supplied" from "explicitly cleared":
                -- $5 is a flag saying the caller intends to change the parent.
                parent_department_id = CASE WHEN $5 THEN $4::uuid
                                            ELSE parent_department_id END
          WHERE id = $1 AND effective_to IS NULL
      RETURNING id`,
        [id, patch.code ?? null, patch.name ?? null,
         patch.parentDepartmentId ?? null,
         patch.parentDepartmentId !== undefined]));

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
            SET name = COALESCE($2, name),
                is_eligible_for_review = COALESCE($3, is_eligible_for_review),
                is_active = COALESCE($4, is_active)
          WHERE id = $1 RETURNING id`,
        [id, patch.name ?? null, patch.isEligibleForReview ?? null,
         patch.isActive ?? null]));
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
                d.name AS "departmentName", p.is_active AS "isActive",
                (SELECT count(*)::int
                   FROM employment em
                   JOIN employee e ON e.id = em.employee_id
                  WHERE em.position_id = p.id AND em.effective_to IS NULL
                    AND e.deleted_at IS NULL) AS "headcount"
           FROM position p
           LEFT JOIN department d ON d.id = p.department_id
          ORDER BY p.title`);
      return res.rows;
    });
  }

  async updatePosition(
    ctx: RequestContext, id: string,
    patch: {
      title?: string | undefined;
      jobFamily?: string | null | undefined;
      jobLevel?: string | null | undefined;
    },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ id: string }>(
        `UPDATE position
            SET title = COALESCE($2, title),
                job_family = CASE WHEN $4 THEN $3 ELSE job_family END,
                job_level  = CASE WHEN $6 THEN $5 ELSE job_level END
          WHERE id = $1 RETURNING id`,
        [id, patch.title ?? null, patch.jobFamily ?? null,
         patch.jobFamily !== undefined, patch.jobLevel ?? null,
         patch.jobLevel !== undefined]));
      if (!res.rows[0]) throw new NotFoundException('Position not found or not permitted');
      return { id };
    });
  }

  /**
   * Trigger and constraint violations carry messages written for the operator
   * ("2 employee(s) are still assigned to it"). Surfacing them as 400s is the
   * whole point; swallowing them would leave an unexplained 500.
   */
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
