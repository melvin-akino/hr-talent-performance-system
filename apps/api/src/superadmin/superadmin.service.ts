import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { config } from '../config/config';
import { hashPassword, verifyPassword } from '../common/crypto';
import { logger } from '../common/logger';

export interface CreateTenantDto {
  companyName: string;
  code: string;
  slug?: string;
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
  adminLastName: string;
  planTier?: 'starter' | 'professional' | 'enterprise';
  maxEmployees?: number;
  features?: {
    feature_core_hr?: boolean;
    feature_performance?: boolean;
    feature_kpis?: boolean;
    feature_peer_reviews?: boolean;
    feature_competencies_pip?: boolean;
    feature_leave_management?: boolean;
    feature_time_attendance?: boolean;
    feature_ph_payroll?: boolean;
    feature_bank_disbursement?: boolean;
    feature_bir_statutory_gen?: boolean;
  };
}

@Injectable()
export class SuperadminService {
  private readonly superadminSecret = new TextEncoder().encode(config.SUPERADMIN_SECRET);
  private readonly userSecret = new TextEncoder().encode(config.JWT_SECRET);

  constructor(private readonly db: DbService) {}

  private async withSuperadminContext<T>(
    requestId: string,
    fn: (client: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.db.withSystemContext(requestId, async (client) => {
      await client.query(`SELECT set_config('app.is_superadmin', 'true', true)`);
      return fn(client);
    });
  }

  /**
   * Superadmin authentication
   */
  async login(email: string, pass: string): Promise<{
    token: string;
    user: { id: string; email: string; fullName: string };
    superadmin: { id: string; email: string; fullName: string };
  }> {
    const trimmedEmail = email.trim().toLowerCase();
    const requestId = randomUUID();

    const record = await this.db.withSystemContext(requestId, async (client) => {
      const res = await client.query<{
        id: string;
        email: string;
        password_hash: string;
        full_name: string;
        is_active: boolean;
      }>(
        `SELECT id, email, password_hash, full_name, is_active
           FROM app.platform_superadmin
          WHERE email = $1`,
        [trimmedEmail],
      );
      return res.rows[0] ?? null;
    });

    if (!record || !record.is_active || !verifyPassword(pass, record.password_hash)) {
      logger.warn({ email: trimmedEmail }, 'superadmin login rejected');
      throw new UnauthorizedException('Invalid superadmin credentials');
    }

    const token = await new SignJWT({
      email: record.email,
      fullName: record.full_name,
      isSuperAdmin: true,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(record.id)
      .setIssuer('hr-superadmin')
      .setAudience('hr-platform')
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(this.superadminSecret);

    return {
      token,
      user: {
        id: record.id,
        email: record.email,
        fullName: record.full_name,
      },
      superadmin: {
        id: record.id,
        email: record.email,
        fullName: record.full_name,
      },
    };
  }

  /**
   * Lists all onboarded tenant companies with license & feature metrics
   */
  async listTenants(): Promise<any[]> {
    return this.withSuperadminContext(randomUUID(), async (client) => {
      const res = await client.query(
        `SELECT o.id, o.code, o.name, o.slug, o.status, o.plan_tier,
                o.max_employees, o.trial_ends_at, o.subscription_expires_at, o.created_at,
                (SELECT COUNT(*)::int FROM employee e WHERE e.org_id = o.id AND e.deleted_at IS NULL) AS employee_count,
                to_jsonb(tf) AS features
           FROM organization o
           LEFT JOIN app.tenant_features tf ON tf.org_id = o.id
          ORDER BY o.created_at DESC`,
      );
      return res.rows;
    });
  }

  /**
   * Retrieves single tenant detail with features & recent audit records
   */
  async getTenant(tenantId: string): Promise<any> {
    return this.withSuperadminContext(randomUUID(), async (client) => {
      const orgRes = await client.query(
        `SELECT o.id, o.code, o.name, o.slug, o.status, o.plan_tier,
                o.max_employees, o.trial_ends_at, o.subscription_expires_at, o.created_at,
                (SELECT COUNT(*)::int FROM employee e WHERE e.org_id = o.id AND e.deleted_at IS NULL) AS employee_count,
                to_jsonb(tf) AS features
           FROM organization o
           LEFT JOIN app.tenant_features tf ON tf.org_id = o.id
          WHERE o.id = $1`,
        [tenantId],
      );

      const org = orgRes.rows[0];
      if (!org) throw new NotFoundException('Company tenant not found');

      const auditRes = await client.query(
        `SELECT action, superadmin_email, details, created_at
           FROM app.superadmin_audit_log
          WHERE target_org_id = $1
          ORDER BY created_at DESC
          LIMIT 20`,
        [tenantId],
      );

      return {
        ...org,
        auditLogs: auditRes.rows,
      };
    });
  }

  /**
   * Onboards a brand-new company, configures license, creates admin user & credentials
   */
  async createTenant(dto: CreateTenantDto, superadminEmail: string): Promise<any> {
    const requestId = randomUUID();
    const slug = (dto.slug || dto.code.toLowerCase().replace(/[^a-z0-9]/g, '-')).toLowerCase();

    return this.withSuperadminContext(requestId, async (client) => {
      try {
        // 1. Create Organization
        const orgRes = await client.query(
          `INSERT INTO organization (code, name, slug, plan_tier, max_employees, status)
           VALUES ($1, $2, $3, $4, $5, 'active')
           RETURNING id, code, name, slug, plan_tier, max_employees, status`,
          [
            dto.code.trim().toUpperCase(),
            dto.companyName.trim(),
            slug,
            dto.planTier ?? 'starter',
            dto.maxEmployees ?? 50,
          ],
        );
        const org = orgRes.rows[0];

        // Set current_org_id context for the new tenant
        await client.query("SELECT set_config('app.current_org_id', $1, true)", [org.id]);

        // 2. Seed baseline roles for this tenant (hr_admin, manager, employee, etc.)
        await client.query('SELECT app.seed_baseline_roles($1)', [org.id]);

        // 3. Configure Feature Flags (supports both camelCase and snake_case)
        const feats = (dto.features ?? {}) as any;
        const featCoreHr = feats.feature_core_hr ?? feats.featureCoreHr ?? true;
        const featPerformance = feats.feature_performance ?? feats.featurePerformance ?? true;
        const featKpis = feats.feature_kpis ?? feats.featureKpis ?? true;
        const featPeerReviews = feats.feature_peer_reviews ?? feats.featurePeerReviews ?? false;
        const featCompetenciesPip = feats.feature_competencies_pip ?? feats.featureCompetenciesPip ?? false;
        const featLeaveManagement = feats.feature_leave_management ?? feats.featureLeaveManagement ?? false;
        const featTimeAttendance = feats.feature_time_attendance ?? feats.featureTimeAttendance ?? false;
        const featPhPayroll = feats.feature_ph_payroll ?? feats.featurePhPayroll ?? false;
        const featBankDisbursement = feats.feature_bank_disbursement ?? feats.featureBankDisbursement ?? false;
        const featBirStatutoryGen = feats.feature_bir_statutory_gen ?? feats.featureBirStatutoryGen ?? false;

        await client.query(
          `INSERT INTO app.tenant_features (
             org_id, feature_core_hr, feature_performance, feature_kpis,
             feature_peer_reviews, feature_competencies_pip,
             feature_leave_management, feature_time_attendance,
             feature_ph_payroll, feature_bank_disbursement, feature_bir_statutory_gen,
             updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            org.id,
            featCoreHr,
            featPerformance,
            featKpis,
            featPeerReviews,
            featCompetenciesPip,
            featLeaveManagement,
            featTimeAttendance,
            featPhPayroll,
            featBankDisbursement,
            featBirStatutoryGen,
            superadminEmail,
          ],
        );

        // 4. Create Initial Administrator Employee
        const adminEmail = dto.adminEmail.trim().toLowerCase();
        const empRes = await client.query(
          `INSERT INTO employee (
             org_id, employee_no, first_name, last_name, work_email, hired_on, status
           ) VALUES ($1, 'EMP-0001', $2, $3, $4, CURRENT_DATE, 'active')
           RETURNING id`,
          [org.id, dto.adminFirstName.trim(), dto.adminLastName.trim(), adminEmail],
        );
        const employeeId = empRes.rows[0].id;

        // 5. Create Native Credentials
        const passwordHash = hashPassword(dto.adminPassword);
        await client.query(
          `INSERT INTO app.user_credential (
             employee_id, org_id, email, password_hash, is_verified, must_change_password
           ) VALUES ($1, $2, $3, $4, TRUE, FALSE)`,
          [employeeId, org.id, adminEmail, passwordHash],
        );

        // 6. Assign hr_admin Role
        const roleRes = await client.query(
          `SELECT id FROM app_role WHERE org_id = $1 AND code = 'hr_admin'`,
          [org.id],
        );
        if (roleRes.rows[0]) {
          await client.query(
            `INSERT INTO role_assignment (org_id, employee_id, role_id, effective_from)
             VALUES ($1, $2, $3, CURRENT_DATE)`,
            [org.id, employeeId, roleRes.rows[0].id],
          );
        }

        // 7. Seed Baseline HR Settings
        await client.query(
          `INSERT INTO hr_settings (
             org_id, company_registered_name, company_trade_name
           ) VALUES ($1, $2, $2)
           ON CONFLICT (org_id) DO NOTHING`,
          [org.id, dto.companyName.trim()],
        );

        // 8. Audit Log
        await client.query(
          `INSERT INTO app.superadmin_audit_log (superadmin_email, action, target_org_id, details)
           VALUES ($1, 'ONBOARD_TENANT', $2, $3)`,
          [
            superadminEmail,
            org.id,
            JSON.stringify({ companyName: dto.companyName, adminEmail, planTier: dto.planTier }),
          ],
        );

        return {
          tenant: org,
          organization: org,
          adminUser: { id: employeeId, email: adminEmail },
          adminEmployee: { id: employeeId, email: adminEmail, firstName: dto.adminFirstName, lastName: dto.adminLastName },
          features: {
            feature_core_hr: featCoreHr,
            feature_performance: featPerformance,
            feature_kpis: featKpis,
            feature_peer_reviews: featPeerReviews,
            feature_competencies_pip: featCompetenciesPip,
            feature_leave_management: featLeaveManagement,
            feature_time_attendance: featTimeAttendance,
            feature_ph_payroll: featPhPayroll,
            feature_bank_disbursement: featBankDisbursement,
            feature_bir_statutory_gen: featBirStatutoryGen,
          },
        };
      } catch (err: any) {
        if (err?.code === '23505') {
          if (err.constraint === 'organization_code_key') {
            throw new BadRequestException(
              `Organization code "${dto.code.trim().toUpperCase()}" is already assigned to another tenant. Please specify a unique org code.`,
            );
          }
          if (err.constraint === 'organization_slug_key') {
            throw new BadRequestException(
              `Workspace slug "${slug}" is already in use. Please choose a different URL slug.`,
            );
          }
          if (
            err.constraint === 'user_credential_email_key' ||
            err.constraint?.includes('email') ||
            err.table === 'user_credential'
          ) {
            throw new BadRequestException(
              `Admin email "${dto.adminEmail.trim()}" is already registered in the platform. Please use a unique administrator email.`,
            );
          }
          throw new BadRequestException(`Duplicate entry conflict: ${err.detail || err.message}`);
        }
        throw err;
      }
    });
  }

  /**
   * Toggles tenant module features (e.g. activating Philippine Payroll)
   */
  async updateFeatures(tenantId: string, features: Partial<Record<string, boolean>>, superadminEmail: string): Promise<any> {
    return this.withSuperadminContext(randomUUID(), async (client) => {
      // Build dynamic update
      const allowedKeys = [
        'feature_core_hr',
        'feature_performance',
        'feature_kpis',
        'feature_peer_reviews',
        'feature_competencies_pip',
        'feature_leave_management',
        'feature_time_attendance',
        'feature_ph_payroll', // Crucial toggle
        'feature_bank_disbursement',
        'feature_bir_statutory_gen',
      ];

      const sets: string[] = ['updated_at = now()', 'updated_by = $2'];
      const vals: any[] = [tenantId, superadminEmail];
      let idx = 3;

      for (const [k, v] of Object.entries(features)) {
        const snakeKey = k.replace(/([A-Z])/g, '_$1').toLowerCase();
        const normalizedKey = allowedKeys.includes(k) ? k : allowedKeys.includes(snakeKey) ? snakeKey : null;
        if (normalizedKey && typeof v === 'boolean') {
          sets.push(`${normalizedKey} = $${idx}`);
          vals.push(v);
          idx++;
        }
      }

      const res = await client.query(
        `UPDATE app.tenant_features
            SET ${sets.join(', ')}
          WHERE org_id = $1
          RETURNING *`,
        vals,
      );

      // Audit Log
      await client.query(
        `INSERT INTO app.superadmin_audit_log (superadmin_email, action, target_org_id, details)
         VALUES ($1, 'UPDATE_FEATURES', $2, $3)`,
        [superadminEmail, tenantId, JSON.stringify(features)],
      );

      return res.rows[0];
    });
  }

  /**
   * Updates company subscription status (Active, Trial, Suspended)
   */
  async updateStatus(tenantId: string, status: string, superadminEmail: string): Promise<any> {
    return this.withSuperadminContext(randomUUID(), async (client) => {
      const res = await client.query(
        `UPDATE organization
            SET status = $2, updated_at = now()
          WHERE id = $1
          RETURNING id, name, code, slug, status, plan_tier`,
        [tenantId, status],
      );

      await client.query(
        `INSERT INTO app.superadmin_audit_log (superadmin_email, action, target_org_id, details)
         VALUES ($1, 'UPDATE_STATUS', $2, $3)`,
        [superadminEmail, tenantId, JSON.stringify({ status })],
      );

      return res.rows[0];
    });
  }

  /**
   * Updates employee seat limits & plan tier
   */
  async updateLimits(tenantId: string, limits: { maxEmployees?: number; planTier?: string }, superadminEmail: string): Promise<any> {
    return this.withSuperadminContext(randomUUID(), async (client) => {
      const res = await client.query(
        `UPDATE organization
            SET max_employees = COALESCE($2, max_employees),
                plan_tier = COALESCE($3, plan_tier),
                updated_at = now()
          WHERE id = $1
          RETURNING id, name, code, slug, status, plan_tier, max_employees`,
        [tenantId, limits.maxEmployees, limits.planTier],
      );

      await client.query(
        `INSERT INTO app.superadmin_audit_log (superadmin_email, action, target_org_id, details)
         VALUES ($1, 'UPDATE_LIMITS', $2, $3)`,
        [superadminEmail, tenantId, JSON.stringify(limits)],
      );

      return res.rows[0];
    });
  }

  /**
   * Generates a temporary impersonation token for customer support & troubleshooting
   */
  async impersonateTenant(tenantId: string, superadminEmail: string): Promise<{ token: string; targetUser: any; employee: any; organization: any }> {
    return this.withSuperadminContext(randomUUID(), async (client) => {
      // Find the primary HR admin of this tenant
      const res = await client.query(
        `SELECT e.id, e.work_email, e.first_name, e.last_name, o.name AS org_name
           FROM employee e
           JOIN organization o ON o.id = e.org_id
          WHERE e.org_id = $1 AND e.deleted_at IS NULL
          ORDER BY e.created_at ASC
          LIMIT 1`,
        [tenantId],
      );

      const target = res.rows[0];
      if (!target) throw new NotFoundException('No active employee found for tenant');

      const token = await new SignJWT({
        email: target.work_email,
        orgId: tenantId,
        impersonatedBy: superadminEmail,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(target.id)
        .setIssuer('hr-saas')
        .setAudience('hr-system')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(this.userSecret);

      await client.query(
        `INSERT INTO app.superadmin_audit_log (superadmin_email, action, target_org_id, details)
         VALUES ($1, 'IMPERSONATE_SESSION', $2, $3)`,
        [superadminEmail, tenantId, JSON.stringify({ targetEmployeeId: target.id })],
      );

      return {
        token,
        targetUser: target,
        employee: target,
        organization: { id: tenantId, name: target.org_name },
      };
    });
  }
}
