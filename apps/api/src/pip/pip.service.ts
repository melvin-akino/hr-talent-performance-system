import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A score on the form's 100-point scale. */
const score = z.number().min(0, 'A score cannot be negative').max(100, 'A score is out of 100');
const longText = z.string().trim().max(4000);

/**
 * Creating a PIP, on the December 2025 form.
 *
 * Every field the form added is OPTIONAL. Making the new sections mandatory would
 * change what it takes to raise a plan for every organisation at once, and the
 * form itself does not mark any of them required. The one rule that was already
 * there still holds: a plan cannot be activated without a milestone.
 *
 * What maps where is set out in migration 0049. In short: "area of concern" is
 * `reason`, and "action/s to be taken" with its "timeline" is the milestone list
 * — a step and the date it is due, which is that pair of boxes in structured form.
 */
export const createPip = z.object({
  employeeId: z.string().uuid(),
  goalPeriodId: z.string().uuid().optional(),
  reason: z.string().trim().min(10, 'State the performance concern in full'),
  expectedOutcome: z.string().trim().optional(),
  startsOn: date,
  endsOn: date,
  reviewCadence: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly']).default('biweekly'),
  milestones: z.array(z.object({
    description: z.string().trim().min(1),
    successCriteria: z.string().trim().optional(),
    dueOn: date,
  })).min(1, 'A PIP requires at least one measurable milestone'),

  // Document control and the evaluation that triggered the plan.
  seriesNo: z.string().trim().min(1).max(60).optional(),
  evaluatedOn: date.optional(),
  latestEvaluationOn: date.optional(),
  evaluationPart1Score: score.optional(),
  evaluationPart2Score: score.optional(),
  evaluationOverallScore: score.optional(),
  pefReference: z.string().trim().max(120).optional(),
  pipReference: z.string().trim().max(120).optional(),
  recordOfInfractions: longText.optional(),

  // Improvement goals and the review schedule.
  targetScore: score.optional(),
  initialReviewOn: date.optional(),
  finalReviewOn: date.optional(),

  // Action plan.
  skillsToImprove: longText.optional(),
  officerResponsibility: longText.optional(),
  additionalRemarks: longText.optional(),
}).refine(
  (v) => !v.initialReviewOn || !v.finalReviewOn || v.initialReviewOn <= v.finalReviewOn,
  { message: 'The initial review cannot fall after the final review', path: ['initialReviewOn'] },
);

/** The four lines the form is signed on. */
export const PIP_PARTIES = [
  'employee', 'reporting_officer', 'department_head', 'hcm_representative',
] as const;
export type PipParty = (typeof PIP_PARTIES)[number];

const PARTY_LABEL: Record<PipParty, string> = {
  employee: 'the employee',
  reporting_officer: 'the reporting officer',
  department_head: 'the department manager / area head',
  hcm_representative: 'the HCM representative',
};

/** Defaults to the employee, so the original acknowledge call keeps working. */
export const acknowledgePip = z.object({
  party: z.enum(PIP_PARTIES).default('employee'),
});

export const assessMilestone = z.object({
  met: z.boolean(),
  assessmentNotes: z.string().trim().optional(),
});

export const createPipReview = z.object({
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  progressSummary: z.string().trim().min(1),
  statusFlag: z.enum(['on_track', 'at_risk', 'off_track']),
  employeeComment: z.string().trim().optional(),
  // The form's Review Schedule names an initial and a final review, each with a
  // score. Everything else is an interim conversation, as before.
  kind: z.enum(['interim', 'initial', 'final']).default('interim'),
  score: z.number().min(0).max(100).optional(),
}).refine((v) => v.kind === 'interim' || v.score !== undefined, {
  message: 'An initial or final review records a score',
  path: ['score'],
});

export const closePip = z.object({
  outcome: z.enum(['successful', 'extended', 'unsuccessful', 'withdrawn']),
  outcomeNotes: z.string().trim().optional(),
});

/**
 * Performance Improvement Plans.
 *
 * PIP visibility is narrower than goals -- employee, DIRECT supervisor, HR --
 * and that is enforced by RLS (migration 0011), not here. The service adds the
 * orchestration RLS cannot express, and translates database invariants into
 * usable errors.
 */
@Injectable()
export class PipService {
  constructor(private readonly db: DbService) {}

  private static readonly PLAN_SELECT = `
    SELECT p.id,
           p.employee_id                        AS "employeeId",
           e.first_name || ' ' || e.last_name   AS "employeeName",
           p.supervisor_id                      AS "supervisorId",
           app.display_name(p.supervisor_id)     AS "supervisorName",
           p.reason,
           p.expected_outcome                   AS "expectedOutcome",
           p.starts_on::text                    AS "startsOn",
           p.ends_on::text                      AS "endsOn",
           p.review_cadence::text               AS "reviewCadence",
           p.state::text                        AS state,
           p.outcome::text                      AS outcome,
           p.outcome_notes                      AS "outcomeNotes",
           p.closed_at::text                    AS "closedAt",

           p.series_no                          AS "seriesNo",
           p.evaluated_on::text                 AS "evaluatedOn",
           p.latest_evaluation_on::text         AS "latestEvaluationOn",
           p.evaluation_part1_score::float8     AS "evaluationPart1Score",
           p.evaluation_part2_score::float8     AS "evaluationPart2Score",
           p.evaluation_overall_score::float8   AS "evaluationOverallScore",
           p.pef_reference                      AS "pefReference",
           p.pip_reference                      AS "pipReference",
           p.record_of_infractions              AS "recordOfInfractions",
           p.target_score::float8               AS "targetScore",
           p.initial_review_on::text            AS "initialReviewOn",
           p.final_review_on::text              AS "finalReviewOn",
           p.skills_to_improve                  AS "skillsToImprove",
           p.officer_responsibility             AS "officerResponsibility",
           p.additional_remarks                 AS "additionalRemarks",

           -- The employee's own signature, from the table that holds all four.
           -- The old column was never writable by the employee (see 0049).
           (SELECT a.acknowledged_at::text FROM pip_acknowledgement a
             WHERE a.pip_plan_id = p.id AND a.party = 'employee')
                                                AS "acknowledgedAt",
           COALESCE((SELECT json_agg(json_build_object(
                        'party', a.party::text,
                        'by',    app.display_name(a.acknowledged_by),
                        'at',    a.acknowledged_at::text)
                      ORDER BY a.acknowledged_at)
                       FROM pip_acknowledgement a WHERE a.pip_plan_id = p.id),
                    '[]'::json)                 AS acknowledgements,
           -- What THIS caller may sign right now, from the same function the
           -- INSERT policy uses, so the buttons offered and the signatures the
           -- database accepts cannot disagree.
           COALESCE((SELECT json_agg(s.party::text ORDER BY s.party)
                       FROM app.pip_signable_parties(p.id) s),
                    '[]'::json)                 AS "signableParties",
           (SELECT count(*)::int FROM pip_milestone m WHERE m.pip_plan_id = p.id)
                                                AS "milestoneCount",
           (SELECT count(*)::int FROM pip_milestone m
             WHERE m.pip_plan_id = p.id AND m.met IS TRUE) AS "milestonesMet",
           (SELECT count(*)::int FROM pip_milestone m
             WHERE m.pip_plan_id = p.id AND m.met IS NULL) AS "milestonesPending"
      FROM pip_plan p
      -- The SUBJECT is joined: seeing a plan implies seeing whose plan it is.
      -- The SUPERVISOR is not — an employee cannot read their own manager's
      -- employee row, so an inner join here made a person's own PIP vanish.
      JOIN employee e ON e.id = p.employee_id`;

  async create(ctx: RequestContext, input: z.infer<typeof createPip>) {
    // The plan is read back AFTER this transaction commits, not inside it. Every
    // withContext is its own connection and its own transaction, so a read from
    // inside would be a second connection that cannot see the row this one has
    // just inserted. That is what POST /pips did: it created the plan and then
    // answered 404 "PIP not found", so the screen reported a failure for a plan
    // that existed, and a second click made a duplicate. Nothing exercised the
    // route over HTTP, so nothing noticed.
    const createdId = await this.db.withContext(ctx, async (client) => {
      if (input.employeeId === ctx.employeeId) {
        throw new BadRequestException('You cannot initiate a PIP for yourself');
      }

      const emp = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [input.employeeId]);
      const orgId = emp.rows[0]?.org_id;
      // RLS hides employees the caller may not see, so this doubles as an
      // authorization check without disclosing whether the person exists.
      if (!orgId) throw new NotFoundException('Employee not found');

      const inserted = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO pip_plan (org_id, employee_id, initiated_by, supervisor_id,
                               goal_period_id, reason, expected_outcome,
                               starts_on, ends_on, review_cadence,
                               series_no, evaluated_on, latest_evaluation_on,
                               evaluation_part1_score, evaluation_part2_score,
                               evaluation_overall_score, pef_reference,
                               pip_reference, record_of_infractions, target_score,
                               initial_review_on, final_review_on,
                               skills_to_improve, officer_responsibility,
                               additional_remarks)
              VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9::checkin_cadence,
                      $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           RETURNING id`,
        [orgId, input.employeeId, ctx.employeeId, input.goalPeriodId ?? null,
         input.reason, input.expectedOutcome ?? null, input.startsOn,
         input.endsOn, input.reviewCadence,
         input.seriesNo ?? null, input.evaluatedOn ?? null,
         input.latestEvaluationOn ?? null,
         input.evaluationPart1Score ?? null, input.evaluationPart2Score ?? null,
         input.evaluationOverallScore ?? null, input.pefReference ?? null,
         input.pipReference ?? null, input.recordOfInfractions ?? null,
         input.targetScore ?? null, input.initialReviewOn ?? null,
         input.finalReviewOn ?? null, input.skillsToImprove ?? null,
         input.officerResponsibility ?? null, input.additionalRemarks ?? null]));

      const planId = inserted.rows[0]?.id;
      if (!planId) {
        throw new ForbiddenException('Not permitted to initiate a PIP for this employee');
      }

      let sequence = 1;
      for (const m of input.milestones) {
        await this.wrap(() => client.query(
          `INSERT INTO pip_milestone (pip_plan_id, sequence, description,
                                      success_criteria, due_on)
                VALUES ($1,$2,$3,$4,$5)`,
          [planId, sequence++, m.description, m.successCriteria ?? null, m.dueOn]));
      }

      return planId;
    });
    return this.requirePlan(ctx, createdId);
  }

  async list(
    ctx: RequestContext,
    // `| undefined` required by exactOptionalPropertyTypes: these come from
    // query params, where absent is genuinely undefined rather than missing.
    opts: { employeeId?: string | undefined; state?: string | undefined } = {},
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `${PipService.PLAN_SELECT}
          WHERE ($1::uuid IS NULL OR p.employee_id = $1)
            AND ($2::text IS NULL OR p.state::text = $2)
          ORDER BY p.starts_on DESC`,
        [opts.employeeId ?? null, opts.state ?? null]);
      return res.rows;
    });
  }

  async byId(ctx: RequestContext, planId: string) {
    return this.requirePlan(ctx, planId);
  }

  /** Activate a draft. The database refuses if it has no milestones. */
  async activate(ctx: RequestContext, planId: string) {
    await this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{
        id: string; employee_id: string; starts_on: string; ends_on: string;
      }>(
        `UPDATE pip_plan SET state = 'active' WHERE id = $1
      RETURNING id, employee_id, starts_on::text AS starts_on,
                ends_on::text AS ends_on`, [planId]));
      const plan = res.rows[0];
      if (!plan) throw new NotFoundException('PIP not found');

      // The subject is told when the plan becomes ACTIVE, not when it is
      // drafted: a draft may still be reworded or abandoned, and notifying on
      // a draft would be both alarming and premature.
      await NotificationsService.enqueue(client, plan.employee_id, 'pip.created', {
        startsOn: plan.starts_on,
        endsOn: plan.ends_on,
      }, `pip-active:${planId}`);
    });
    return this.requirePlan(ctx, planId);
  }

  /**
   * Signs the plan, as one of the four parties the form is signed by.
   *
   * WHO MAY SIGN AS WHOM IS NOT DECIDED HERE. It is decided by the INSERT policy
   * on pip_acknowledgement, from app.pip_signable_parties(), and the screen asks
   * the same function which buttons to offer — so this method adds nothing to
   * that rule and cannot drift from it. What it adds is a sentence: the database
   * says "row-level security", which tells the person who just tried to sign
   * nothing about why.
   *
   * This replaces an UPDATE of pip_plan.acknowledged_at, which the employee
   * could never perform: they hold only `pip:read` on themselves, so the update
   * policy filtered their own row out and the service told the one person
   * entitled to acknowledge a plan that they were not. Nothing tested it.
   */
  async acknowledge(ctx: RequestContext, planId: string, party: PipParty = 'employee') {
    await this.db.withContext(ctx, async (client) => {
      // Three different answers, and the order matters. A plan the caller cannot
      // see is a 404 — a refusal would confirm it exists. A line already signed
      // is "already signed". Only then does the database decide whether THIS
      // caller may sign it, and refuse if not.
      //
      // The middle check is not redundant with the unique constraint: the INSERT
      // policy reads app.pip_signable_parties(), which already excludes a signed
      // line, so a second signature is stopped by RLS first and would otherwise
      // be reported as "you may not sign" — true, and quite the wrong thing to
      // tell somebody who already did.
      const visible = await client.query('SELECT 1 FROM pip_plan WHERE id = $1', [planId]);
      if (!visible.rows[0]) throw new NotFoundException('PIP not found');

      const already = await client.query(
        `SELECT 1 FROM pip_acknowledgement
          WHERE pip_plan_id = $1 AND party = $2::pip_party`, [planId, party]);
      if (already.rows[0]) {
        throw new BadRequestException(
          `This plan has already been signed as ${PARTY_LABEL[party]}`);
      }

      const res = await client.query<{ id: string }>(
        `INSERT INTO pip_acknowledgement
                (org_id, pip_plan_id, party, acknowledged_by, created_by)
         SELECT p.org_id, p.id, $2::pip_party, $3, $3
           FROM pip_plan p WHERE p.id = $1
       RETURNING id`,
        [planId, party, ctx.employeeId],
      ).catch((err: { code?: string; message?: string }) => {
        if (err.code === '23505') {
          throw new BadRequestException(
            `This plan has already been signed as ${PARTY_LABEL[party]}`);
        }
        if (err.code === '42501' || /row-level security/i.test(err.message ?? '')) {
          throw new ForbiddenException(
            `You cannot sign this plan as ${PARTY_LABEL[party]}. It must be active, `
            + 'and you must hold that part on this plan.');
        }
        throw err;
      });
      if (!res.rows[0]) throw new NotFoundException('PIP not found');
    });
    return this.requirePlan(ctx, planId);
  }

  async assessMilestone(
    ctx: RequestContext, milestoneId: string, input: z.infer<typeof assessMilestone>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ pip_plan_id: string }>(
        `UPDATE pip_milestone
            SET met = $2, assessed_by = $3, assessed_at = now(),
                assessment_notes = COALESCE($4, assessment_notes)
          WHERE id = $1
      RETURNING pip_plan_id`,
        [milestoneId, input.met, ctx.employeeId, input.assessmentNotes ?? null]));
      if (!res.rows[0]) throw new NotFoundException('Milestone not found');
      return { pipPlanId: res.rows[0].pip_plan_id };
    });
  }

  async addReview(
    ctx: RequestContext, planId: string, input: z.infer<typeof createPipReview>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query<{ id: string }>(
        `INSERT INTO pip_review (pip_plan_id, reviewed_by, review_date,
                                 progress_summary, status_flag, employee_comment,
                                 kind, score, created_by)
              VALUES ($1,$2,$3,$4,$5::checkin_status,$6,
                      $7::pip_review_kind,$8,$2)
           RETURNING id`,
        [planId, ctx.employeeId, input.reviewDate, input.progressSummary,
         input.statusFlag, input.employeeComment ?? null,
         input.kind, input.score ?? null]));
      if (!res.rows[0]) {
        throw new ForbiddenException('Not permitted to record a review on this PIP');
      }
      return res.rows[0];
    });
  }

  async reviews(ctx: RequestContext, planId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT r.id, r.review_date::text AS "reviewDate",
                r.progress_summary AS "progressSummary",
                r.status_flag::text AS "statusFlag",
                r.employee_comment  AS "employeeComment",
                r.kind::text        AS kind,
                r.score::float8     AS score,
                r.created_at::text  AS "createdAt",
                app.display_name(r.reviewed_by) AS "reviewedBy"
           FROM pip_review r
          WHERE r.pip_plan_id = $1
          ORDER BY r.review_date DESC`, [planId]);
      return res.rows;
    });
  }

  async milestones(ctx: RequestContext, planId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT m.id, m.sequence, m.description,
                m.success_criteria AS "successCriteria",
                m.due_on::text     AS "dueOn",
                m.met,
                m.assessment_notes AS "assessmentNotes",
                m.assessed_at::text AS "assessedAt",
                e.first_name || ' ' || e.last_name AS "assessedBy"
           FROM pip_milestone m
           LEFT JOIN employee e ON e.id = m.assessed_by
          WHERE m.pip_plan_id = $1
          ORDER BY m.sequence`, [planId]);
      return res.rows;
    });
  }

  async close(ctx: RequestContext, planId: string, input: z.infer<typeof closePip>) {
    await this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query(
        `UPDATE pip_plan
            SET state = 'completed', outcome = $2::pip_outcome, outcome_notes = $3
          WHERE id = $1
      RETURNING id`,
        [planId, input.outcome, input.outcomeNotes ?? null]));
      if (!res.rows[0]) throw new NotFoundException('PIP not found');
    });
    return this.requirePlan(ctx, planId);
  }

  async cancel(ctx: RequestContext, planId: string, reason: string) {
    await this.db.withContext(ctx, async (client) => {
      const res = await this.wrap(() => client.query(
        `UPDATE pip_plan SET state = 'cancelled', outcome_notes = $2
          WHERE id = $1 RETURNING id`, [planId, reason]));
      if (!res.rows[0]) throw new NotFoundException('PIP not found');
    });
    return this.requirePlan(ctx, planId);
  }

  private async requirePlan(ctx: RequestContext, planId: string) {
    const rows = await this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `${PipService.PLAN_SELECT} WHERE p.id = $1`, [planId]);
      return res.rows;
    });
    if (!rows[0]) throw new NotFoundException('PIP not found');
    return rows[0];
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; message?: string; constraint?: string };
      if (e.code === '23514' || e.code === 'P0001' || e.code === '23P01') {
        throw new BadRequestException(e.message ?? 'Constraint violated');
      }
      // The two uniqueness rules a person can run into from the form: reusing a
      // series number, and recording a second initial or final review.
      if (e.code === '23505' && e.constraint === 'pip_plan_series_uq') {
        throw new BadRequestException('That series number is already in use');
      }
      if (e.code === '23505' && e.constraint === 'pip_review_one_initial_final') {
        throw new BadRequestException(
          'This plan already has that review. An initial or final review is recorded once, '
          + 'and reviews cannot be edited.');
      }
      throw err;
    }
  }
}
