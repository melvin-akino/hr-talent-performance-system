import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { config, requireServerConfig } from '../config/config';
import { DbService } from '../db/db.service';
import { logger } from '../common/logger';

const oidc = requireServerConfig();

export interface AuthenticatedRequest extends Request {
  auth: {
    employeeId: string;
    requestId: string;
    subject: string;
  };
}

/**
 * Verifies the Keycloak-issued access token and resolves it to an employee id.
 *
 * The employee id is resolved from the token SUBJECT via `employee.idp_subject`
 * -- never from a claim the client could influence, and never from the email
 * claim alone (emails get reassigned; a rehire or a name change would silently
 * hand over someone else's record).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  /**
   * Key retrieval may take an internal path (OIDC_JWKS_URL); the issuer claim
   * asserted below is always the public OIDC_ISSUER_URL regardless.
   */
  private readonly jwks = createRemoteJWKSet(
    new URL(config.OIDC_JWKS_URL ?? `${oidc.OIDC_ISSUER_URL}/protocol/openid-connect/certs`),
  );

  /**
   * subject -> employeeId. Bounded and short-lived: an employee's identity
   * link changes almost never, but a stale entry after a separation must not
   * outlive the session by long.
   */
  private readonly subjectCache = new Map<string, { id: string; expires: number }>();
  private static readonly CACHE_TTL_MS = 60_000;
  private static readonly CACHE_MAX = 5_000;

  constructor(private readonly db: DbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(header.slice(7), this.jwks, {
        issuer: oidc.OIDC_ISSUER_URL,
        audience: oidc.OIDC_AUDIENCE,
        clockTolerance: config.OIDC_CLOCK_TOLERANCE,
      }));
    } catch (err) {
      logger.warn({ err }, 'token verification failed');
      throw new UnauthorizedException('Invalid token');
    }

    const subject = payload.sub;
    if (!subject) throw new UnauthorizedException('Token has no subject');

    const employeeId = await this.resolveEmployee(subject, payload);
    if (!employeeId) {
      // Authenticated against the IdP but not linked to an employee record.
      // This is the expected state for service accounts and for staff who
      // exist in AD but were never imported -- deny rather than auto-create.
      logger.warn({ subject }, 'authenticated subject has no employee record');
      throw new UnauthorizedException('No employee record linked to this account');
    }

    req.auth = {
      employeeId,
      subject,
      requestId: (req.headers['x-request-id'] as string) ?? randomUUID(),
    };
    return true;
  }

  private async resolveEmployee(
    subject: string,
    payload: JWTPayload,
  ): Promise<string | null> {
    const cached = this.subjectCache.get(subject);
    if (cached && cached.expires > Date.now()) return cached.id;

    const email = typeof payload.email === 'string' ? payload.email : null;

    // Routed through the SECURITY DEFINER bootstrap function (migration 0006).
    // Direct table access is impossible here by design: no RLS identity exists
    // yet, so every policy denies. On first login the function also links the
    // subject to the imported employee row by work email.
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
