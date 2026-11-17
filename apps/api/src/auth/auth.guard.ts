import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { config } from '../config/config';
import { DbService } from '../db/db.service';
import { logger } from '../common/logger';

export interface AuthenticatedRequest extends Request {
  auth: {
    employeeId: string;
    requestId: string;
    subject: string;
    orgId?: string | undefined;
    isSuperAdmin?: boolean | undefined;
    roles?: string[] | undefined;
  };
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly nativeSecret = new TextEncoder().encode(config.JWT_SECRET);
  private readonly superadminSecret = new TextEncoder().encode(config.SUPERADMIN_SECRET);
  private jwks: JWTVerifyGetKey | null = null;

  private readonly subjectCache = new Map<string, { id: string; expires: number }>();
  private static readonly CACHE_TTL_MS = 60_000;
  private static readonly CACHE_MAX = 5_000;

  constructor(private readonly db: DbService) {
    if (config.OIDC_ISSUER_URL) {
      this.jwks = createRemoteJWKSet(
        new URL(config.OIDC_JWKS_URL ?? `${config.OIDC_ISSUER_URL}/protocol/openid-connect/certs`),
      );
    }
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = header.slice(7);
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();

    // 1. Try Native SaaS Token (Fastest, zero external network hops)
    try {
      const { payload } = await jwtVerify(token, this.nativeSecret, {
        issuer: 'hr-saas',
        audience: 'hr-system',
        clockTolerance: config.OIDC_CLOCK_TOLERANCE,
      });

      if (payload.sub) {
        req.auth = {
          employeeId: payload.sub,
          subject: payload.sub,
          orgId: typeof payload.orgId === 'string' ? payload.orgId : undefined,
          roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : undefined,
          requestId,
        };
        return true;
      }
    } catch {
      // Token is not a native SaaS user token, attempt other verifications
    }

    // 2. Try Platform Superadmin Token
    try {
      const { payload } = await jwtVerify(token, this.superadminSecret, {
        issuer: 'hr-superadmin',
        audience: 'hr-platform',
        clockTolerance: config.OIDC_CLOCK_TOLERANCE,
      });

      if (payload.sub && payload.isSuperAdmin) {
        req.auth = {
          employeeId: payload.sub,
          subject: payload.sub,
          isSuperAdmin: true,
          requestId,
        };
        return true;
      }
    } catch {
      // Token is not a superadmin token
    }

    // 3. Fallback to OIDC / Keycloak JWKS if configured
    if (this.jwks && config.OIDC_ISSUER_URL) {
      try {
        const verifyOpts: { issuer: string; clockTolerance: number; audience?: string } = {
          issuer: config.OIDC_ISSUER_URL,
          clockTolerance: config.OIDC_CLOCK_TOLERANCE,
        };
        if (config.OIDC_AUDIENCE) {
          verifyOpts.audience = config.OIDC_AUDIENCE;
        }

        const { payload } = await jwtVerify(token, this.jwks, verifyOpts);

        const subject = payload.sub;
        if (!subject) throw new UnauthorizedException('Token has no subject');

        const employeeId = await this.resolveEmployee(subject, payload);
        if (!employeeId) {
          logger.warn({ subject }, 'authenticated subject has no employee record');
          throw new UnauthorizedException('No employee record linked to this account');
        }

        req.auth = {
          employeeId,
          subject,
          requestId,
        };
        return true;
      } catch (err) {
        if (err instanceof UnauthorizedException) {
          throw err;
        }
        logger.warn({ err }, 'oidc verification failed');
      }
    }

    throw new UnauthorizedException('Invalid or expired authentication token');
  }

  private async resolveEmployee(
    subject: string,
    payload: JWTPayload,
  ): Promise<string | null> {
    const cached = this.subjectCache.get(subject);
    if (cached && cached.expires > Date.now()) return cached.id;

    const email = typeof payload.email === 'string' ? payload.email : null;

    const id = await this.db.withSystemContext(randomUUID(), async (client) => {
      const res = await client.query<{ employee_id: string | null }>(
        'SELECT app.resolve_employee_by_subject($1, $2) AS employee_id',
        [subject, email],
      );
      return res.rows[0]?.employee_id ?? null;
    });

    if (id) {
      if (this.subjectCache.size >= AuthGuard.CACHE_MAX) this.subjectCache.clear();
      this.subjectCache.set(subject, {
        id,
        expires: Date.now() + AuthGuard.CACHE_TTL_MS,
      });
    }
    return id;
  }
}
