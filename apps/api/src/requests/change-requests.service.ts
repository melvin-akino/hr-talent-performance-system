import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DbService, type RequestContext } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * The request-and-approval flow (requirements §7.9, F4).
 *
 * A Department Head asks for an extra competency, a special evaluation or a
 * scoring adjustment; somebody with authority answers. Before this the whole
 * exchange happened in chat, and the only surviving record was the change
 * itself with nobody's name on the reason for it.
 *
 * WHAT THIS SERVICE DOES NOT DO, AND IT IS THE IMPORTANT PART.
 *
 * Approving does not apply the change (D-017). No competency is added, no
 * evaluation is opened, no score is written. The request records what was
 * decided and by whom; the change is then made on the screen that owns it,
 * where it is audited as the change it is. An approval that quietly moved a
 * score would leave an audit trail in which the score changed by itself.
 *
 * Every permission question is RLS's. There is no role named in this file:
 * who may ask, about whom, and who may answer are all decided by policies on
 * change_request, so a request the caller may not raise fails as a policy
 * violation rather than as a check somebody remembered to write here.
 */

const REQUEST_TYPES = ['extra_competency', 'special_evaluation', 'scoring_adjustment'] as const;

export const createRequest = z.object({
  requestType: z.enum(REQUEST_TYPES),
  subjectEmployeeId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  reviewCycleId: z.string().uuid().optional(),
  goalPeriodId: z.string().uuid().optional(),
  competencyId: z.string().uuid().optional(),
  currentScore: z.number().optional(),
  proposedScore: z.number().optional(),
  rationale: z.string().trim().min(1).max(4000),
})
  // The shape rules are a CHECK constraint in 0048 and are restated here for
  // one reason only: to answer with a sentence instead of a constraint name.
  // The database remains the enforcement — this is the error message.
  .superRefine((v, ctx) => {
    const need = (field: keyof typeof v, why: string) => {
      if (v[field] === undefined || v[field] === null) {
        ctx.addIssue({ code: 'custom', path: [field], message: why });
      }
    };
    if (v.requestType === 'extra_competency') {
      need('competencyId', 'Say which competency you are asking to add.');
    }
    if (v.requestType === 'special_evaluation') {
      need('subjectEmployeeId', 'Say who the special evaluation is for.');
    }
    if (v.requestType === 'scoring_adjustment') {
      need('subjectEmployeeId', 'Say whose score you are asking to adjust.');
      need('proposedScore', 'Say what the score should be.');
    }
  });

export const decide = z.object({
  decision: z.enum(['approved', 'declined']),
  note: z.string().trim().max(4000).optional(),
}).superRefine((v, ctx) => {
  // Enforced by the transition trigger too. Caught here so the requester gets
  // a sentence rather than a check_violation.
  if (v.decision === 'declined' && !v.note) {
    ctx.addIssue({
      code: 'custom', path: ['note'],
      message: 'Say why it was declined — otherwise the same request comes back next week.',
    });
  }
});

export type CreateRequest = z.infer<typeof createRequest>;
export type Decide = z.infer<typeof decide>;

const SELECT = `
  SELECT cr.id,
         cr.request_type::text  AS "requestType",
         cr.state::text         AS state,
         cr.requested_by        AS "requestedById",
         app.display_name(cr.requested_by) AS "requestedBy",
         cr.subject_employee_id AS "subjectEmployeeId",
         CASE WHEN cr.subject_employee_id IS NULL THEN NULL
              ELSE app.display_name(cr.subject_employee_id) END AS "subjectName",
         d.name                 AS department,
         c.name                 AS competency,
         rc.name                AS "reviewCycle",
         cr.current_score::float8  AS "currentScore",
         cr.proposed_score::float8 AS "proposedScore",
         cr.rationale,
         cr.submitted_at        AS "submittedAt",
         CASE WHEN cr.decided_by IS NULL THEN NULL
              ELSE app.display_name(cr.decided_by) END AS "decidedBy",
         cr.decided_at          AS "decidedAt",
         cr.decision_note       AS "decisionNote",
         cr.created_at          AS "createdAt"
    FROM change_request cr
    LEFT JOIN department d  ON d.id  = cr.department_id
    LEFT JOIN competency c  ON c.id  = cr.competency_id
    LEFT JOIN review_cycle rc ON rc.id = cr.review_cycle_id`;

@Injectable()
export class ChangeRequestsService {
  constructor(private readonly db: DbService) {}

  /**
   * The list, and it is deliberately one list rather than "mine" and "to
   * decide" as separate endpoints.
   *
   * RLS returns the union of what you raised and what you may decide, so the
   * screen can put the queue at the top without asking the server a second
   * question — and without the server having to decide which of the two you
   * are, which is a role branch by another name.
   */
  async list(ctx: RequestContext, state?: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `${SELECT}
          WHERE ($1::text IS NULL OR cr.state::text = $1)
          ORDER BY cr.state = 'submitted' DESC, cr.created_at DESC
          LIMIT 500`, [state ?? null]);
      return res.rows;
    });
  }

  async byId(ctx: RequestContext, id: string) {
    const rows = await this.db.withContext(ctx, async (client) => {
      const res = await client.query(`${SELECT} WHERE cr.id = $1`, [id]);
      return res.rows;
    });
    // RLS makes an unauthorised row indistinguishable from a missing one, and
    // that is correct: a 403 would confirm a request about this person exists.
    if (!rows[0]) throw new NotFoundException('Request not found');
    return rows[0];
  }

  /**
   * Raise and submit in one act.
   *
   * There is no "save as draft" over HTTP even though the state exists,
   * because a draft nobody can see is indistinguishable from having done
   * nothing — and the screen is one short form. The state is kept in the
   * database for the CLI and for a future batch path; adding a button for it
   * later costs nothing, and offering one now would have people believe they
   * had asked for something when they had not.
   */
  async create(ctx: RequestContext, body: CreateRequest) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO change_request (
           org_id, request_type, state, requested_by, subject_employee_id,
           department_id, review_cycle_id, goal_period_id, competency_id,
           current_score, proposed_score, rationale, submitted_at, created_by)
         VALUES (app.current_org_id(), $1, 'submitted', app.current_employee_id(),
                 $2, COALESCE($3, (SELECT em.department_id FROM employment em
                                    WHERE em.employee_id
                                          = COALESCE($2, app.current_employee_id())
                                      AND em.effective_to IS NULL
                                    ORDER BY em.effective_from DESC LIMIT 1)),
                 $4, $5, $6, $7, $8, $9, now(), app.current_employee_id())
         RETURNING id`,
        [
          body.requestType, body.subjectEmployeeId ?? null,
          body.departmentId ?? null, body.reviewCycleId ?? null,
          body.goalPeriodId ?? null, body.competencyId ?? null,
          body.currentScore ?? null, body.proposedScore ?? null,
          body.rationale,
        ]);

      const id = res.rows[0]!.id;
      const row = (await client.query(`${SELECT} WHERE cr.id = $1`, [id])).rows[0]!;

      // Told, not discovered. Without this the request sits in a queue nobody
      // is looking at, and the requester chases it in chat — which is the
      // situation this feature exists to replace.
      const approvers = await client.query<{ employee_id: string }>(
        'SELECT employee_id FROM app.change_request_approvers($1)', [id]);
      for (const a of approvers.rows) {
        await NotificationsService.enqueue(client, a.employee_id, 'request.submitted', {
          requestType: label(row.requestType),
          requesterName: row.requestedBy,
          subjectName: row.subjectName ?? row.department ?? 'the unit',
          rationale: row.rationale,
        }, `request.submitted:${id}:${a.employee_id}`);
      }

      return row;
    });
  }

  /**
   * The requester taking it back. Not a decline — see 0048.
   *
   * `requested_by = app.current_employee_id()` is in the WHERE clause, not
   * only in the policy. A test found why: the UPDATE policy necessarily lets
   * an approver write a submitted request (that is how a decision is
   * recorded), so without this an approver could withdraw somebody else's
   * request — which leaves no decider and no reason, and reads afterwards as
   * though the requester thought better of it. The transition trigger refuses
   * it too; this is the clause that produces a sentence instead of a 500.
   */
  async withdraw(ctx: RequestContext, id: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `UPDATE change_request SET state = 'withdrawn', updated_by = $2
          WHERE id = $1 AND state IN ('draft','submitted')
            AND requested_by = app.current_employee_id()
      RETURNING id`, [id, ctx.employeeId]);
      if (res.rowCount === 0) {
        // Not yours, or already answered. RLS cannot tell those apart from out
        // here and must not be made to — the alternative confirms the row.
        throw new BadRequestException('That request cannot be withdrawn.');
      }
      // Read back on the SAME client. Calling byId() here opened a second
      // connection outside this transaction and returned the pre-update row,
      // so the API answered 200 with the old state — the caller was told
      // nothing had happened while it had.
      return (await client.query(`${SELECT} WHERE cr.id = $1`, [id])).rows[0];
    });
  }

  /**
   * The answer.
   *
   * decided_by is set from app.current_employee_id() in the statement rather
   * than from the request body, so there is no version of this call that
   * records somebody else as the approver. The self-approval rule is a CHECK
   * constraint (0048) as well — this is the path, not the guarantee.
   */
  async decide(ctx: RequestContext, id: string, body: Decide) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ requested_by: string }>(
        `UPDATE change_request
            SET state = $2::change_request_state,
                decided_by = app.current_employee_id(),
                decided_at = now(),
                decision_note = $3,
                updated_by = app.current_employee_id()
          WHERE id = $1 AND state = 'submitted'
      RETURNING requested_by`,
        [id, body.decision, body.note ?? null]);

      if (res.rowCount === 0) {
        throw new BadRequestException(
          'That request is not awaiting a decision, or is not yours to decide.');
      }

      const row = (await client.query(`${SELECT} WHERE cr.id = $1`, [id])).rows[0]!;
      await NotificationsService.enqueue(
        client, res.rows[0]!.requested_by, 'request.decided', {
          requestType: label(row.requestType),
          subjectName: row.subjectName ?? row.department ?? 'the unit',
          decision: body.decision,
          deciderName: row.decidedBy,
          note: body.note ?? '',
        }, `request.decided:${id}`);

      return row;
    });
  }
}

/** The enum, as a person would say it. */
function label(t: string): string {
  return ({
    extra_competency: 'extra competency',
    special_evaluation: 'special evaluation',
    scoring_adjustment: 'scoring adjustment',
  } as Record<string, string>)[t] ?? t;
}
