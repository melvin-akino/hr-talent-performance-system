import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, type RequestContext } from '../db/db.service';

export interface HelpArticleRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  section: string;
  audience: string[];
  routes: string[];
  keywords: string[];
  sortOrder: number;
  body: string;
  publishedAt: string | null;
  updatedAt: string;
}

export interface HelpArticleInput {
  slug: string;
  title: string;
  summary: string;
  section: string;
  audience: string[];
  routes: string[];
  keywords: string[];
  // Optional properties admit undefined explicitly: the project runs with
  // exactOptionalPropertyTypes, so a zod-parsed body whose optional field is
  // absent does not otherwise satisfy this shape.
  sortOrder?: number | undefined;
  body: string;
  published?: boolean | undefined;
}

const SELECT = `
  SELECT id, slug, title, summary, section, audience, routes, keywords,
         sort_order AS "sortOrder", body,
         published_at::text AS "publishedAt",
         updated_at::text AS "updatedAt"
    FROM help_article`;

/**
 * Company-specific help, authored by HR.
 *
 * Separate from the articles bundled with the application, which describe the
 * product and ship with the code. This is policy — "our cycle opens in
 * November" — and HR must be able to publish it without a release.
 *
 * Everything here runs under the caller's own RLS, so tenant isolation and the
 * write permission are enforced by the database rather than by these methods.
 */
@Injectable()
export class HelpService {
  constructor(private readonly db: DbService) {}

  /**
   * Published articles, for the drawer.
   *
   * Audience is deliberately NOT filtered here. It is a relevance hint applied
   * in the interface, not an authorization boundary — help is not secret, and
   * filtering it server-side would imply otherwise and invite someone to put a
   * secret in it.
   */
  async published(ctx: RequestContext): Promise<HelpArticleRow[]> {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<HelpArticleRow>(
        `${SELECT} WHERE published_at IS NOT NULL
          ORDER BY section, sort_order, title`);
      return res.rows;
    });
  }

  /** Everything including drafts. Only HR can read a draft usefully — the list
   *  is visible tenant-wide, but nothing links to an unpublished article. */
  async all(ctx: RequestContext): Promise<HelpArticleRow[]> {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<HelpArticleRow>(
        `${SELECT} ORDER BY section, sort_order, title`);
      return res.rows;
    });
  }

  async create(ctx: RequestContext, input: HelpArticleInput): Promise<HelpArticleRow> {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<HelpArticleRow>(
        `INSERT INTO help_article
           (org_id, slug, title, summary, section, audience, routes, keywords,
            sort_order, body, published_at, created_by, updated_by)
         VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7,
                 COALESCE($8, 500), $9,
                 CASE WHEN $10 THEN now() ELSE NULL END,
                 app.current_employee_id(), app.current_employee_id())
         RETURNING id, slug, title, summary, section, audience, routes, keywords,
                   sort_order AS "sortOrder", body,
                   published_at::text AS "publishedAt",
                   updated_at::text AS "updatedAt"`,
        [input.slug, input.title, input.summary, input.section, input.audience,
         input.routes, input.keywords, input.sortOrder ?? null, input.body,
         input.published ?? false]);
      return res.rows[0]!;
    });
  }

  async update(
    ctx: RequestContext, id: string, input: Partial<HelpArticleInput>,
  ): Promise<HelpArticleRow> {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<HelpArticleRow>(
        `UPDATE help_article SET
           slug       = COALESCE($2, slug),
           title      = COALESCE($3, title),
           summary    = COALESCE($4, summary),
           section    = COALESCE($5, section),
           audience   = COALESCE($6, audience),
           routes     = COALESCE($7, routes),
           keywords   = COALESCE($8, keywords),
           sort_order = COALESCE($9, sort_order),
           body       = COALESCE($10, body),
           -- Publishing and unpublishing are both explicit. Omitting the field
           -- leaves the current state alone, so saving a draft cannot publish it
           -- by accident.
           published_at = CASE
             WHEN $11::boolean IS NULL THEN published_at
             WHEN $11::boolean THEN COALESCE(published_at, now())
             ELSE NULL
           END,
           updated_by = app.current_employee_id()
         WHERE id = $1
         RETURNING id, slug, title, summary, section, audience, routes, keywords,
                   sort_order AS "sortOrder", body,
                   published_at::text AS "publishedAt",
                   updated_at::text AS "updatedAt"`,
        [id, input.slug ?? null, input.title ?? null, input.summary ?? null,
         input.section ?? null, input.audience ?? null, input.routes ?? null,
         input.keywords ?? null, input.sortOrder ?? null, input.body ?? null,
         input.published ?? null]);

      // No row means the article does not exist, or RLS declined the write.
      // Both are "you cannot do that here" from the caller's side.
      if (!res.rows[0]) throw new NotFoundException('Help article not found');
      return res.rows[0];
    });
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.db.withContext(ctx, async (client) => {
      const res = await client.query('DELETE FROM help_article WHERE id = $1', [id]);
      if (res.rowCount === 0) throw new NotFoundException('Help article not found');
    });
  }
}
