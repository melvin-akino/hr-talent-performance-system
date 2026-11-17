import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { SuperadminService, type CreateTenantDto } from './superadmin.service';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { SuperadminGuard } from './superadmin.guard';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

const createTenantSchema = z
  .object({
    name: z.string().min(2).optional(),
    companyName: z.string().min(2).optional(),
    code: z.string().min(2).max(10),
    slug: z.string().min(2).max(63).optional(),
    adminEmail: z.string().email(),
    adminPassword: z.string().min(6, 'Password must be at least 6 characters'),
    adminFirstName: z.string().min(1),
    adminLastName: z.string().min(1),
    planTier: z.enum(['starter', 'professional', 'enterprise']).optional(),
    maxEmployees: z.number().int().positive().optional(),
    features: z.record(z.boolean()).optional(),
  })
  .refine((d) => Boolean(d.name || d.companyName), {
    message: 'Company name is required',
    path: ['companyName'],
  });

@Controller('superadmin')
export class SuperadminController {
  constructor(private readonly superadminService: SuperadminService) {}

  @Post('auth/login')
  async login(@Body() body: unknown) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }
    return this.superadminService.login(parsed.data.email, parsed.data.password);
  }

  @Get('auth/me')
  @UseGuards(AuthGuard, SuperadminGuard)
  async me(@Req() req: AuthenticatedRequest) {
    return {
      id: req.auth.employeeId,
      isSuperAdmin: true,
    };
  }

  @Get('tenants')
  @UseGuards(AuthGuard, SuperadminGuard)
  async listTenants() {
    return this.superadminService.listTenants();
  }

  @Get('tenants/:id')
  @UseGuards(AuthGuard, SuperadminGuard)
  async getTenant(@Param('id') id: string) {
    return this.superadminService.getTenant(id);
  }

  @Post('tenants')
  @UseGuards(AuthGuard, SuperadminGuard)
  async createTenant(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = createTenantSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const companyName = parsed.data.name || parsed.data.companyName || 'Company';
    return this.superadminService.createTenant(
      { ...parsed.data, companyName } as CreateTenantDto,
      req.auth.subject,
    );
  }

  @Patch('tenants/:id/features')
  @UseGuards(AuthGuard, SuperadminGuard)
  async updateFeatures(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: AuthenticatedRequest,
  ) {
    const features = body?.features && typeof body.features === 'object' ? body.features : body;
    return this.superadminService.updateFeatures(id, features, req.auth.subject);
  }

  @Patch('tenants/:id/status')
  @UseGuards(AuthGuard, SuperadminGuard)
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!status) throw new BadRequestException('status is required');
    return this.superadminService.updateStatus(id, status, req.auth.subject);
  }

  @Patch('tenants/:id/limits')
  @UseGuards(AuthGuard, SuperadminGuard)
  async updateLimits(
    @Param('id') id: string,
    @Body() body: { maxEmployees?: number; planTier?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.superadminService.updateLimits(id, body, req.auth.subject);
  }

  @Post('tenants/:id/impersonate')
  @UseGuards(AuthGuard, SuperadminGuard)
  async impersonate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.superadminService.impersonateTenant(id, req.auth.subject);
  }
}
