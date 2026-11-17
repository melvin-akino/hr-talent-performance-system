import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedRequest } from '../../auth/auth.guard';
import { DbService } from '../../db/db.service';

export const REQUIRE_FEATURE_KEY = 'require_feature';
export const RequireFeature = (feature: string) => SetMetadata(REQUIRE_FEATURE_KEY, feature);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<string>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeature) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.auth?.isSuperAdmin) return true;

    const employeeId = req.auth?.employeeId;
    if (!employeeId) return false;

    // Resolve tenant feature enablement
    const isEnabled = await this.db.withSystemContext(randomUUID(), async (client) => {
      let orgId = req.auth?.orgId;
      if (!orgId) {
        await client.query(`SELECT set_config('app.is_superadmin', 'true', true)`);
        const empRes = await client.query<{ org_id: string }>(
          'SELECT org_id FROM employee WHERE id = $1',
          [employeeId],
        );
        orgId = empRes.rows[0]?.org_id;
      }
      if (!orgId) return false;

      const featRes = await client.query<{ is_enabled: boolean }>(
        'SELECT app.is_feature_enabled($1, $2) AS is_enabled',
        [orgId, requiredFeature],
      );
      return featRes.rows[0]?.is_enabled ?? false;
    });

    if (!isEnabled) {
      throw new ForbiddenException(
        `The module feature '${requiredFeature}' is not licensed or activated for your organization. Please contact your administrator.`,
      );
    }

    return true;
  }
}
