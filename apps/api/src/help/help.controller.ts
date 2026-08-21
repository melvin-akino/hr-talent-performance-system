import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post,
  Req, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { HelpService, type HelpArticleInput } from './help.service';

/**
 * The audience and section vocabularies are duplicated from the frontend's
 * help/schema.ts and the table's CHECK constraints. Three copies is not ideal,
 * but the alternatives are worse: a shared package for two string arrays, or
 * trusting the client. The database constraint is the one that cannot be
 * bypassed; this exists so a mistake returns 400 with a useful message instead
 * of a constraint violation.
 */
const SECTIONS = ['basics', 'goals', 'reviews', 'growth', 'managing',
  'administering', 'reference'] as const;
const AUDIENCES = ['everyone', 'employee', 'manager', 'hr_admin', 'hr_partner'] as const;

const articleBody = z.object({
  slug: z.string().trim().regex(/^[a-z][a-z0-9-]*$/,
    'slug must be lower-case letters, numbers and hyphens'),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(10).max(200),
  section: z.enum(SECTIONS),
  audience: z.array(z.enum(AUDIENCES)).min(1),
  // Routes are matched as prefixes by the drawer. Anything not starting with a
  // slash would silently never match.
  routes: z.array(z.string().startsWith('/')).default([]),
  keywords: z.array(z.string().trim().min(1)).default([]),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  body: z.string().trim().min(1),
  published: z.boolean().optional(),
});

@Controller()
@UseGuards(AuthGuard)
export class HelpController {
  constructor(private readonly help: HelpService) {}

  /** What the drawer loads. Published only. */
  @Get('help-articles')
  published(@Req() req: AuthenticatedRequest) {
    return this.help.published(req.auth);
  }

  /** Authoring list, including drafts. */
  @Get('help-articles/all')
  all(@Req() req: AuthenticatedRequest) {
    return this.help.all(req.auth);
  }

  @Post('help-articles')
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.help.create(req.auth, articleBody.parse(body) as HelpArticleInput);
  }

  @Patch('help-articles/:id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.help.update(req.auth, id, articleBody.partial().parse(body) as Partial<HelpArticleInput>);
  }

  @Delete('help-articles/:id')
  @HttpCode(204)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.help.remove(req.auth, id);
  }
}
