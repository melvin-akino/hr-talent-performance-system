import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { DbService, RequestContext } from '../db/db.service';

export const setPreference = z.object({
  /** Omit for the account-wide default. */
  templateCode: z.string().trim().min(1).max(64).optional(),
  mode: z.enum(['immediate', 'digest', 'off']),
});

/**
 * Notification preferences, history, and templates.
 *
 * Enqueueing lives in `app.enqueue_notification` (migration 0020) and is called
 * from within business transactions — see `NotificationsService.enqueue` below,
 * which exists so callers pass an existing client rather than opening their own
 * connection. That is the whole point of an outbox: the notification commits
 * with the change that caused it, or not at all.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService) {}

  /**
   * Queue a notification inside a caller-owned transaction.
   *
   * Returns null when the recipient has the notification switched off or has no
   * work email. That is a normal outcome, not a failure — callers must not treat
   * it as one.
   */
  static async enqueue(
    client: PoolClient,
    recipientEmployeeId: string,
    templateCode: string,
    payload: Record<string, unknown> = {},
    dedupeKey?: string,
  ): Promise<string | null> {
    const res = await client.query<{ id: string | null }>(
      `SELECT app.enqueue_notification($1, $2, $3::jsonb, $4) AS id`,
      [recipientEmployeeId, templateCode, JSON.stringify(payload), dedupeKey ?? null]);
    return res.rows[0]?.id ?? null;
  }

  async myPreferences(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT template_code AS "templateCode", mode::text AS mode
           FROM notification_preference
          WHERE employee_id = $1
          ORDER BY template_code NULLS FIRST`, [ctx.employeeId]);
      return {
        // Absent rows mean "immediate" — stated explicitly so the UI does not
        // have to infer it.
        defaultMode: res.rows.find((r) => r.templateCode === null)?.mode ?? 'immediate',
        overrides: res.rows.filter((r) => r.templateCode !== null),
      };
    });
  }

  async setPreference(ctx: RequestContext, input: z.infer<typeof setPreference>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Requesting employee not found');

      // The unique index is on COALESCE(template_code,'*'), which ON CONFLICT
      // cannot target directly, so update-then-insert rather than an upsert.
      const updated = await client.query(
        `UPDATE notification_preference
            SET mode = $3::notification_mode, updated_at = now(), updated_by = $1
          WHERE employee_id = $1
            AND COALESCE(template_code, '*') = COALESCE($2, '*')
      RETURNING id`,
        [ctx.employeeId, input.templateCode ?? null, input.mode]);

      if (updated.rowCount === 0) {
        const inserted = await client.query(
          `INSERT INTO notification_preference (org_id, employee_id, template_code, mode)
                VALUES ($1,$2,$3,$4::notification_mode) RETURNING id`,
          [orgId, ctx.employeeId, input.templateCode ?? null, input.mode]);
        if (!inserted.rows[0]) {
          throw new BadRequestException('Not permitted to set that preference');
        }
      }
      return { ok: true };
    });
  }

  async myNotifications(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT o.id, o.template_code AS "templateCode", o.payload,
                o.state::text AS state, o.attempts,
                o.last_error AS "lastError",
                o.created_at::text AS "createdAt",
                o.sent_at::text AS "sentAt"
           FROM notification_outbox o
          WHERE o.recipient_employee_id = $1
          ORDER BY o.created_at DESC
          LIMIT 100`, [ctx.employeeId]);
      return res.rows;
    });
  }

  /**
   * Queue health. On-prem there is no provider dashboard, so a stuck queue has
   * to be visible somewhere in the product itself.
   */
  async queueHealth(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT COUNT(*) FILTER (WHERE state = 'pending')::int         AS pending,
                COUNT(*) FILTER (WHERE state = 'held_for_digest')::int AS "heldForDigest",
                COUNT(*) FILTER (WHERE state = 'sending')::int         AS sending,
                COUNT(*) FILTER (WHERE state = 'sent')::int            AS sent,
                COUNT(*) FILTER (WHERE state = 'failed')::int          AS failed,
                COUNT(*) FILTER (WHERE state = 'pending'
                                   AND attempts > 0)::int              AS retrying,
                MIN(available_at) FILTER (WHERE state = 'pending')::text
                                                                       AS "oldestPending"
           FROM notification_outbox`);

      const failures = await client.query(
        `SELECT template_code AS "templateCode", last_error AS "lastError",
                count(*)::int AS count
           FROM notification_outbox
          WHERE state = 'failed'
          GROUP BY template_code, last_error
          ORDER BY count DESC LIMIT 10`);

      return { counts: res.rows[0], failures: failures.rows };
    });
  }

  async listTemplates(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT id, code, version, description, subject,
                body_text AS "bodyText", body_html AS "bodyHtml",
                is_active AS "isActive", published_at::text AS "publishedAt"
           FROM notification_template
          ORDER BY code, version DESC`);
      return res.rows;
    });
  }

  /**
   * Creates and publishes a new version, retiring the previous active one.
   * Atomic for the same reason as every other versioned definition here: the
   * partial unique index permits exactly one active version per code.
   */
  async createTemplate(
    ctx: RequestContext,
    input: {
      code: string;
      description?: string | undefined;
      subject: string;
      bodyText: string;
      bodyHtml?: string | undefined;
    },
  ) {
    return this.db.withContext(ctx, async (client) => {
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Requesting employee not found');

      const current = await client.query<{ version: number }>(
        `SELECT version FROM notification_template
          WHERE org_id = $1 AND code = $2 ORDER BY version DESC LIMIT 1`,
        [orgId, input.code]);
      const version = (current.rows[0]?.version ?? 0) + 1;

      await client.query(
        `UPDATE notification_template SET is_active = FALSE
          WHERE org_id = $1 AND code = $2 AND is_active`, [orgId, input.code]);

      const res = await client.query<{ id: string; version: number }>(
        `INSERT INTO notification_template (org_id, code, version, description,
                                            subject, body_text, body_html,
                                            is_active, published_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,now()) RETURNING id, version`,
        [orgId, input.code, version, input.description ?? null, input.subject,
         input.bodyText, input.bodyHtml ?? null]);

      if (!res.rows[0]) {
        throw new BadRequestException('Not permitted to manage notification templates');
      }
      return res.rows[0];
    });
  }
}
