import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';

export const createFeedback = z.object({
  subjectEmployeeId: z.string().uuid(),
  visibility: z.enum(['employee_only', 'employee_and_supervisor', 'supervisor_only']),
  kind: z.enum(['praise', 'coaching', 'concern', 'request', 'general']).default('general'),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  goalId: z.string().uuid().optional(),
});

export const replyToFeedback = z.object({
  body: z.string().trim().min(1).max(8000),
});

/**
 * Continuous feedback across the three channels from the meeting notes.
 *
 * Visibility is decided by app.can_see_feedback() in migration 0019, not here.
 * The one rule this service adds is the notification side effect, enqueued in
 * the SAME transaction as the message — so a rolled-back reply cannot email
 * anyone, and a successful one cannot silently fail to.
 *
 * Note what is NOT notified: a supervisor_only thread never notifies the
 * subject. Emailing "you have new feedback" about something they are not
 * permitted to read would leak its existence and be worse than silence.
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly db: DbService) {}

  /*
   * Names come from app.display_name(), NOT from joining `employee`.
   *
   * Joining would inner-join against employee RLS: when a peer writes feedback
   * about you, the thread is visible but the author's employee row is not, and
   * the row disappears entirely. That bug shipped past every test and was only
   * caught by using the app. See migration 0022.
   */
  private static readonly THREAD_SELECT = `
    SELECT t.id,
           t.subject_employee_id  AS "subjectEmployeeId",
           app.display_name(t.subject_employee_id) AS "subjectName",
           t.created_by           AS "authorId",
           app.display_name(t.created_by)          AS "authorName",
           t.visibility::text     AS visibility,
           t.kind::text           AS kind,
           t.title,
           t.goal_id              AS "goalId",
           t.is_closed            AS "isClosed",
           t.created_at::text     AS "createdAt",
           (SELECT count(*)::int FROM feedback_message m
             WHERE m.feedback_thread_id = t.id)          AS "messageCount",
           (SELECT max(m.created_at)::text FROM feedback_message m
             WHERE m.feedback_thread_id = t.id)          AS "lastMessageAt"
      FROM feedback_thread t`;

  async create(ctx: RequestContext, input: z.infer<typeof createFeedback>) {
    return this.db.withContext(ctx, async (client) => {
      if (input.subjectEmployeeId === ctx.employeeId) {
        throw new BadRequestException(
          'Feedback about yourself is a note, not feedback. Use a goal check-in.');
      }

      const emp = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [input.subjectEmployeeId]);
      const orgId = emp.rows[0]?.org_id;
      // RLS hides employees the caller may not see, so this doubles as an
      // authorization check without confirming whether the person exists.
      if (!orgId) throw new NotFoundException('Employee not found');

      const thread = await client.query<{ id: string }>(
        `INSERT INTO feedback_thread (org_id, subject_employee_id, created_by,
                                      visibility, kind, title, goal_id)
              VALUES ($1,$2,$3,$4::feedback_visibility,$5::feedback_kind,$6,$7)
           RETURNING id`,
        [orgId, input.subjectEmployeeId, ctx.employeeId, input.visibility,
         input.kind, input.title, input.goalId ?? null]);

      const threadId = thread.rows[0]?.id;
      if (!threadId) throw new ForbiddenException('Not permitted to give feedback');

      await client.query(
        `INSERT INTO feedback_message (feedback_thread_id, author_employee_id,
                                       body, created_by)
              VALUES ($1,$2,$3,$2)`,
        [threadId, ctx.employeeId, input.body]);

      await this.notifyParticipants(client, threadId, ctx.employeeId, input.title);
      return { id: threadId };
    });
  }

  async reply(
    ctx: RequestContext, threadId: string, input: z.infer<typeof replyToFeedback>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      // The WITH CHECK covers both authorship and "thread still open", and a
      // failed WITH CHECK RAISES rather than returning zero rows — so this must
      // be caught, or replying to a closed thread surfaces as a 500.
      const res = await client.query<{ id: string }>(
        `INSERT INTO feedback_message (feedback_thread_id, author_employee_id,
                                       body, created_by)
              VALUES ($1,$2,$3,$2) RETURNING id`,
        [threadId, ctx.employeeId, input.body],
      ).catch((err: { code?: string }) => {
        if (err.code === '42501') {
          throw new ForbiddenException(
            'Cannot reply: the thread is closed, or not visible to you');
        }
        throw err;
      });
      if (!res.rows[0]) {
        throw new ForbiddenException(
          'Cannot reply: the thread is closed, or not visible to you');
      }

      const title = await client.query<{ title: string }>(
        'SELECT title FROM feedback_thread WHERE id = $1', [threadId]);
      await this.notifyParticipants(client, threadId, ctx.employeeId,
                                    title.rows[0]?.title ?? 'Feedback');
      return { id: res.rows[0].id };
    });
  }

  /**
   * Notifies the people who can actually READ the thread, excluding whoever
   * just wrote. Deliberately mirrors the visibility rules rather than notifying
   * "the subject and the author": on a supervisor_only thread the subject must
   * not even learn it exists.
   */
  private async notifyParticipants(
    client: import('pg').PoolClient, threadId: string, actorId: string, title: string,
  ): Promise<void> {
    const thread = await client.query<{
      subject_employee_id: string; created_by: string; visibility: string;
    }>(`SELECT subject_employee_id, created_by, visibility::text AS visibility
          FROM feedback_thread WHERE id = $1`, [threadId]);
    const t = thread.rows[0];
    if (!t) return;

    const recipients = new Set<string>();
    if (t.visibility !== 'supervisor_only') recipients.add(t.subject_employee_id);
    recipients.add(t.created_by);

    if (t.visibility !== 'employee_only') {
      const sup = await client.query<{ id: string }>(
        `SELECT supervisor_employee_id AS id FROM reporting_line
          WHERE employee_id = $1 AND line_type = 'primary'
            AND effective_from <= CURRENT_DATE
            AND (effective_to IS NULL OR CURRENT_DATE < effective_to)`,
        [t.subject_employee_id]);
      if (sup.rows[0]) recipients.add(sup.rows[0].id);
    }

    recipients.delete(actorId);

    for (const recipient of recipients) {
      await client.query(
        `SELECT app.enqueue_notification($1, 'feedback.received', $2::jsonb, $3)`,
        [recipient,
         JSON.stringify({ threadId, title }),
         // One notification per thread per recipient until it is delivered, so
         // a burst of replies does not become a burst of emails.
         `feedback:${threadId}:${recipient}`]);
    }
  }

  /** Threads about me, plus threads I wrote. RLS decides what is returned. */
  async list(ctx: RequestContext, opts: { subjectEmployeeId?: string } = {}) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `${FeedbackService.THREAD_SELECT}
          WHERE ($1::uuid IS NULL OR t.subject_employee_id = $1)
          ORDER BY COALESCE(
            (SELECT max(m.created_at) FROM feedback_message m
              WHERE m.feedback_thread_id = t.id), t.created_at) DESC`,
        [opts.subjectEmployeeId ?? null]);
      return res.rows;
    });
  }

  async byId(ctx: RequestContext, threadId: string) {
    return this.db.withContext(ctx, async (client) => {
      const thread = await client.query(
        `${FeedbackService.THREAD_SELECT} WHERE t.id = $1`, [threadId]);
      if (!thread.rows[0]) throw new NotFoundException('Feedback thread not found');

      const messages = await client.query(
        `SELECT m.id, m.body, m.created_at::text AS "createdAt",
                m.author_employee_id AS "authorId",
                app.display_name(m.author_employee_id) AS "authorName"
           FROM feedback_message m
          WHERE m.feedback_thread_id = $1
          ORDER BY m.created_at`, [threadId]);

      return { ...thread.rows[0], messages: messages.rows };
    });
  }

  async close(ctx: RequestContext, threadId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `UPDATE feedback_thread SET is_closed = TRUE WHERE id = $1 RETURNING id`,
        [threadId]);
      if (!res.rows[0]) {
        throw new ForbiddenException('Only the author can close a feedback thread');
      }
      return { id: threadId, closed: true };
    });
  }
}
