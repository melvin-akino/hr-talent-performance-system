import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';

/**
 * What an evaluation IS, as configuration (requirements §2).
 *
 * The client's five types are five rows in one table, not five code paths. Read
 * the header of `0036_evaluation_definition.sql` for why; the short version is
 * that several of their rules are still moving, and five parallel flows means
 * five places to change each time one does.
 *
 * Nothing here schedules an evaluation. Firing one on somebody's third month is
 * C2 and waits on Q7 — this stores the answer so that when it arrives it is an
 * UPDATE rather than a rewrite.
 */

export const EVAL_TYPES = [
  'probationary', 'annual', 'semi_annual', 'project', 'kpi',
] as const;
export const PERIOD_BASES = ['calendar', 'employee_relative'] as const;
export const ANCHORS = ['hired_on', 'regularized_on', 'last_promoted_on'] as const;
export const AVERAGING = ['single', 'mean'] as const;
export const PARTICIPANTS = [
  'self', 'supervisor', 'dept_head', 'peer', 'subordinate',
] as const;

/**
 * The shape the database also enforces.
 *
 * Duplicated here on purpose, and only here: a constraint violation surfaces as
 * a 500 with a constraint name in it, which tells an HR administrator nothing.
 * The database keeps the guarantee; this layer keeps the explanation. Where the
 * two could drift, a test asserts the database still refuses what this refuses.
 */
const definitionShape = z.object({
  code: z.string().trim().min(1).max(32)
    .regex(/^[A-Z0-9_-]+$/, 'Use capitals, digits, hyphen or underscore'),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  evalType: z.enum(EVAL_TYPES),
  periodBasis: z.enum(PERIOD_BASES).default('calendar'),
  anchor: z.enum(ANCHORS).nullish(),
  offsetMonths: z.array(z.number().int().positive().max(120)).nullish(),
  expectedInstances: z.number().int().min(1).max(12).default(1),
  averaging: z.enum(AVERAGING).default('single'),
  participants: z.array(z.enum(PARTICIPANTS)).min(1),
}).superRefine((v, ctx) => {
  if (v.periodBasis === 'employee_relative') {
    if (!v.anchor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['anchor'],
        message: 'An employee-relative evaluation needs to know what its months '
               + 'are counted from.',
      });
    }
    if (!v.offsetMonths?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['offsetMonths'],
        message: 'Give at least one month offset — 3 and 4 for the probationary '
               + 'pair, for example.',
      });
    }
  } else {
    // A stray anchor on a calendar definition sits unused and unnoticed until
    // somebody flips the basis and silently inherits last year's offsets.
    if (v.anchor || v.offsetMonths?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['periodBasis'],
        message: 'A calendar evaluation has no anchor or month offsets. Set the '
               + 'basis to employee-relative, or clear them.',
      });
    }
  }

  const wantsMean = v.averaging === 'mean';
  if (wantsMean !== v.expectedInstances > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ['averaging'],
      message: wantsMean
        ? 'Averaging needs more than one instance to average.'
        : 'More than one instance needs an averaging rule, or one of them is '
          + 'silently discarded.',
    });
  }
});

export const createDefinition = definitionShape;
export const updateDefinition = definitionShape;

export const retireDefinition = z.object({ isActive: z.boolean() });

@Injectable()
export class EvaluationDefinitionsService {
  constructor(private readonly db: DbService) {}

  async list(ctx: RequestContext, includeRetired = false) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT d.id, d.code, d.name, d.description,
                d.eval_type::text AS "evalType",
                d.period_basis::text AS "periodBasis",
                d.anchor::text AS anchor,
                d.offset_months AS "offsetMonths",
                d.expected_instances AS "expectedInstances",
                d.averaging::text AS averaging,
                d.participants::text[] AS participants,
                d.is_active AS "isActive",
                -- How many cycles were issued under it. An administrator needs
                -- this before retiring one, and it is the number that explains
                -- why a definition cannot simply be deleted.
                (SELECT count(*)::int FROM review_cycle c
                  WHERE c.evaluation_definition_id = d.id) AS "cyclesIssued"
           FROM evaluation_definition d
          WHERE ($1::boolean OR d.is_active)
          ORDER BY d.is_active DESC, d.code`,
        [includeRetired]);
      return res.rows;
    });
  }

  async create(ctx: RequestContext, input: z.infer<typeof createDefinition>) {
    return this.db.withContext(ctx, async (client) => {
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Requesting employee not found');

      const res = await client.query<{ id: string }>(
        `INSERT INTO evaluation_definition (
           org_id, code, name, description, eval_type, period_basis, anchor,
           offset_months, expected_instances, averaging, participants)
         VALUES ($1,$2,$3,$4,$5::evaluation_type,$6::evaluation_period_basis,
                 $7::evaluation_anchor,$8::smallint[],$9,
                 $10::evaluation_averaging,$11::evaluation_participant[])
         RETURNING id`,
        [orgId, input.code, input.name, input.description ?? null, input.evalType,
         input.periodBasis, input.anchor ?? null,
         input.offsetMonths?.length ? input.offsetMonths : null,
         input.expectedInstances, input.averaging, input.participants])
        .catch((err: { code?: string }) => {
          if (err.code === '23505') {
            throw new BadRequestException(
              `An evaluation type with the code '${input.code}' already exists.`);
          }
          throw err;
        });

      const id = res.rows[0]?.id;
      if (!id) {
        throw new BadRequestException('Not permitted to define evaluation types');
      }
      return { id };
    });
  }

  /**
   * Edits a definition in place.
   *
   * In place, and not versioned, because the cycles that matter already carry
   * their own snapshot of the rules that decide a score (`review_cycle`, 0036).
   * A definition is therefore a template for future cycles rather than a record
   * of past ones, and editing it cannot move a result already given.
   */
  async update(ctx: RequestContext, id: string,
               input: z.infer<typeof updateDefinition>) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `UPDATE evaluation_definition
            SET code = $2, name = $3, description = $4,
                eval_type = $5::evaluation_type,
                period_basis = $6::evaluation_period_basis,
                anchor = $7::evaluation_anchor,
                offset_months = $8::smallint[],
                expected_instances = $9,
                averaging = $10::evaluation_averaging,
                participants = $11::evaluation_participant[]
          WHERE id = $1
        RETURNING id`,
        [id, input.code, input.name, input.description ?? null, input.evalType,
         input.periodBasis, input.anchor ?? null,
         input.offsetMonths?.length ? input.offsetMonths : null,
         input.expectedInstances, input.averaging, input.participants])
        .catch((err: { code?: string }) => {
          if (err.code === '23505') {
            throw new BadRequestException(
              `Another evaluation type already uses the code '${input.code}'.`);
          }
          throw err;
        });

      if (!res.rows[0]) {
        throw new NotFoundException(
          'Evaluation type not found, or not yours to edit.');
      }
      return { id: res.rows[0].id };
    });
  }

  /**
   * Retires or restores a definition.
   *
   * Retiring rather than deleting: a definition a cycle was issued under is
   * referenced by that cycle, and removing it would erase what the cycle was.
   * `is_active = FALSE` takes it out of the list of things you can start without
   * touching the history.
   */
  async setActive(ctx: RequestContext, id: string, isActive: boolean) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string; is_active: boolean }>(
        `UPDATE evaluation_definition SET is_active = $2
          WHERE id = $1 RETURNING id, is_active`, [id, isActive]);
      if (!res.rows[0]) {
        throw new NotFoundException(
          'Evaluation type not found, or not yours to edit.');
      }
      return { id: res.rows[0].id, isActive: res.rows[0].is_active };
    });
  }
}
