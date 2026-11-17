import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { config } from '../config/config';
import { verifyPassword } from '../common/crypto';
import { logger } from '../common/logger';

export interface TenantFeatures {
  feature_core_hr: boolean;
  feature_performance: boolean;
  feature_kpis: boolean;
  feature_peer_reviews: boolean;
  feature_competencies_pip: boolean;
  feature_leave_management: boolean;
  feature_time_attendance: boolean;
  feature_ph_payroll: boolean;
  feature_bank_disbursement: boolean;
  feature_bir_statutory_gen: boolean;
}

@Injectable()
export class AuthService {
  private readonly secretKey = new TextEncoder().encode(config.JWT_SECRET);

  constructor(private readonly db: DbService) {}

  async login(email: string, pass: string): Promise<{
    token: string;
    employee: { id: string; firstName: string; lastName: string; email: string; employeeNo: string };
    organization: { id: string; name: string; code: string; slug: string; status: string; planTier: string };
    roles: string[];
    features: TenantFeatures;
  }> {
    const trimmedEmail = email.trim().toLowerCase();
    const requestId = randomUUID();

    const record = await this.db.withSystemContext(requestId, async (client) => {
      const res = await client.query<{
        employee_id: string;
        org_id: string;
        password_hash: string;
        is_verified: boolean;
        first_name: string;
        last_name: string;
        employee_no: string;
        work_email: string;
        org_name: string;
        org_code: string;
        org_slug: string;
        org_status: string;
        org_plan_tier: string;
      }>(
        `SELECT * FROM app.lookup_user_for_auth($1)`,
        [trimmedEmail],
      );
      return res.rows[0] ?? null;
    });

    if (!record) {
      logger.warn({ email: trimmedEmail }, 'login failed: user not found');
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!verifyPassword(pass, record.password_hash)) {
      logger.warn({ email: trimmedEmail }, 'login failed: invalid password');
      throw new UnauthorizedException('Invalid email or password');
    }

    if (record.org_status === 'suspended') {
      throw new UnauthorizedException('Company account is suspended. Please contact platform administrator.');
    }

    // Fetch user roles & active tenant features
    const { roles, features } = await this.db.withSystemContext(requestId, async (client) => {
      // 1. Roles
      const roleRes = await client.query<{ code: string }>(
        `SELECT code FROM app.get_user_roles_for_auth($1, $2)`,
        [record.employee_id, record.org_id],
      );

      // 2. Features
      const featRes = await client.query<TenantFeatures>(
        `SELECT * FROM app.get_tenant_features_for_auth($1)`,
        [record.org_id],
      );

      // Update last login
      await client.query(`SELECT app.record_user_login($1)`, [record.employee_id]);

      return {
        roles: roleRes.rows.map((r) => r.code),
        features: featRes.rows[0] ?? {
          feature_core_hr: true,
          feature_performance: true,
          feature_kpis: true,
          feature_peer_reviews: false,
          feature_competencies_pip: false,
          feature_leave_management: false,
          feature_time_attendance: false,
          feature_ph_payroll: false,
          feature_bank_disbursement: false,
          feature_bir_statutory_gen: false,
        },
      };
    });

    // Sign native SaaS JWT
    const token = await new SignJWT({
      email: trimmedEmail,
      orgId: record.org_id,
      roles,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(record.employee_id)
      .setIssuer('hr-saas')
      .setAudience('hr-system')
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(this.secretKey);

    return {
      token,
      employee: {
        id: record.employee_id,
        firstName: record.first_name,
        lastName: record.last_name,
        email: record.work_email,
        employeeNo: record.employee_no,
      },
      organization: {
        id: record.org_id,
        name: record.org_name,
        code: record.org_code,
        slug: record.org_slug,
        status: record.org_status,
        planTier: record.org_plan_tier,
      },
      roles,
      features,
    };
  }

  async getMe(employeeId: string, requestId: string) {
    return this.db.withContext({ employeeId, requestId }, async (client) => {
      const empRes = await client.query(
        `SELECT e.id, e.org_id, e.first_name, e.last_name, e.work_email, e.employee_no,
                o.name AS org_name, o.code AS org_code, o.slug AS org_slug,
                o.status AS org_status, o.plan_tier AS org_plan_tier
           FROM employee e
           JOIN organization o ON o.id = e.org_id
          WHERE e.id = $1 AND e.deleted_at IS NULL`,
        [employeeId],
      );

      const emp = empRes.rows[0];
      if (!emp) throw new UnauthorizedException('Employee record not found');

      const roleRes = await client.query<{ code: string }>(
        `SELECT DISTINCT r.code
           FROM role_assignment ra
           JOIN app_role r ON r.id = ra.role_id
          WHERE ra.employee_id = $1
            AND ra.effective_from <= CURRENT_DATE
            AND (ra.effective_to IS NULL OR CURRENT_DATE < ra.effective_to)`,
        [employeeId],
      );

      const featRes = await client.query<TenantFeatures>(
        `SELECT feature_core_hr, feature_performance, feature_kpis,
                feature_peer_reviews, feature_competencies_pip,
                feature_leave_management, feature_time_attendance,
                feature_ph_payroll, feature_bank_disbursement, feature_bir_statutory_gen
           FROM app.tenant_features
          WHERE org_id = $1`,
        [emp.org_id],
      );

      return {
        id: emp.id,
        firstName: emp.first_name,
        lastName: emp.last_name,
        email: emp.work_email,
        employeeNo: emp.employee_no,
        organization: {
          id: emp.org_id,
          name: emp.org_name,
          code: emp.org_code,
          slug: emp.org_slug,
          status: emp.org_status,
          planTier: emp.org_plan_tier,
        },
        roles: roleRes.rows.map((r) => r.code),
        features: featRes.rows[0],
      };
    });
  }
}
