import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard';

@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.auth?.isSuperAdmin) {
      throw new ForbiddenException('Access restricted to Platform Superadministrators');
    }
    return true;
  }
}
