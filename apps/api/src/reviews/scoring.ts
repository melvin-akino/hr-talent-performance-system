import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Point-weighted scoring for review forms.
 *
 * The client's evaluation is not a set of opinions — it is arithmetic. Their
 * default template (5-pager, page 3) allocates a fixed number of points to each
 * line, and the same instrument carries DIFFERENT allocations depending on the
 * employee's classification:
 *
 *                       Technical / Ops / Field      Admin
 *   Mastery                        10                  10
 *   Efficiency                     15                  10
 *   Productivity                   15                  10
 *   Team Cooperation               10                  10
 *   Supervisor's Assessment        20                  20
 *   Attendance                     10                  10
 *   Related seminars / training     5                  10
 *   Tenure                          5                  10
 *   Policy Compliance              10                  10
 *                                 ---                 ---
 *                                 100                 100
 *
 * Two point columns, one list of metrics. That shape is why points may be a map
 * keyed by classification rather than a single number, and why a template
 * declares the total it must add up to: a mistyped 15 that should have been 10
 * is invisible by inspection and produces a quietly wrong score for everyone
 * evaluated on that form, for as long as it takes someone to add up a column by
 * hand.
 *
 * Validation therefore runs at authoring time, not at scoring time. A form that
 * cannot produce a correct score should never be publishable.
 */

/**
 * Field types whose answers can carry points.
 *
 * `goal_review` and `competency_review` are excluded deliberately: neither
 * stores its answer in `form_response` — goal results come from the goal module
 * and competency ratings are written to `competency_assessment` so they feed the
 * gap report. Points on those would be silently unscoreable.
 *
 * `text` and `textarea` are excluded because there is nothing to compute from.
 * A commentary box is evidence for a score, not a score.
 *
 * `number` and `select` were listed here when points were introduced, before
 * anything computed a score. That was premature: neither has a defined
 * conversion. A number needs a target to be a proportion of, and a select needs
 * a value per option, and the client has specified neither. Allowing points on
 * them meant a form could validate and then score as zero — the exact silent
 * wrongness the validation exists to prevent. They come back when there is a
 * rule to implement rather than a shape to guess at.
 */
export const SCOREABLE_FIELD_TYPES = ['rating', 'boolean'] as const;

/**
 * Points for one field: the same for everybody, or one value per classification.
 *
 * Zero is allowed — a line that exists on one variant of the form and not the
 * other is real, and writing 0 says so explicitly. Negative is not.
 */
export const fieldPoints = z.union([
  z.number().nonnegative(),
  z.record(z.string().trim().min(1), z.number().nonnegative()),
]);

export const scoringConfig = z.object({
  /** What every classification's points must add up to. */
  maxPoints: z.number().positive(),
  /**
   * The classifications this form is scored for. Optional: when omitted it is
   * inferred from the keys the fields actually use, which is right for a form
   * with a single point column.
   */
  classifications: z.array(z.string().trim().min(1)).min(1).optional(),
});

export type FieldPoints = z.infer<typeof fieldPoints>;
export type ScoringConfig = z.infer<typeof scoringConfig>;

interface ScoredField {
  key: string;
  type: string;
  points?: FieldPoints | undefined;
}

interface ScoredSchema {
  sections: { fields: ScoredField[] }[];
  scoring?: ScoringConfig | undefined;
}

/** Points for one field under one classification. */
export function pointsFor(points: FieldPoints | undefined, classification: string): number {
  if (points === undefined) return 0;
  if (typeof points === 'number') return points;
  return points[classification] ?? 0;
}

/**
 * Which classifications a schema is scored for.
 *
 * Declared wins; otherwise the union of every key any field uses. A form whose
 * fields all carry plain numbers has no classifications at all, and is scored
 * once — represented here by a single unnamed bucket so the totals check has
 * something to iterate.
 */
export function classificationsOf(schema: ScoredSchema): string[] {
  if (schema.scoring?.classifications?.length) return [...schema.scoring.classifications];

  const found = new Set<string>();
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (field.points && typeof field.points === 'object') {
        for (const key of Object.keys(field.points)) found.add(key);
      }
    }
  }
  return found.size > 0 ? [...found].sort() : [DEFAULT_CLASSIFICATION];
}

/** The bucket used when a form has one point column and no named variants. */
export const DEFAULT_CLASSIFICATION = 'default';

/** Total points a classification can earn on this form. */
export function totalFor(schema: ScoredSchema, classification: string): number {
  let total = 0;
  for (const section of schema.sections) {
    for (const field of section.fields) {
      total += pointsFor(field.points, classification);
    }
  }
  return total;
}

/**
 * Refuses a form that cannot produce a correct score.
 *
 * Every failure here is one that is invisible on the screen and wrong in the
 * data: a column that does not add up, a classification that half the fields
 * have never heard of, points attached to an answer nobody stores.
 */
export function assertScoringValid(schema: ScoredSchema): void {
  const scored = schema.sections.flatMap((s) => s.fields).filter((f) => f.points !== undefined);

  if (scored.length === 0) {
    // A form with no points is legitimate — that is every form built before
    // this existed — but then it must not claim a total either.
    if (schema.scoring) {
      throw new BadRequestException(
        'This form declares a scoring total but no field carries points. '
        + 'Either give the scored fields their points, or remove the scoring block.');
    }
    return;
  }

  if (!schema.scoring) {
    throw new BadRequestException(
      `Field '${scored[0]!.key}' carries points, but the form does not say what they `
      + 'add up to. Add a scoring block with maxPoints so the total can be checked.');
  }

  for (const field of scored) {
    if (!(SCOREABLE_FIELD_TYPES as readonly string[]).includes(field.type)) {
      throw new BadRequestException(
        `Field '${field.key}' is a '${field.type}' and cannot carry points. `
        + `Scoreable types are: ${SCOREABLE_FIELD_TYPES.join(', ')}.`);
    }
  }

  const classifications = classificationsOf(schema);

  // A field that names classifications must name all of them. Omitting one is
  // indistinguishable from scoring it zero, and the two mean different things:
  // one is an oversight, the other is a deliberate blank on that variant.
  for (const field of scored) {
    const map = field.points;
    if (typeof map !== 'object') continue;
    const missing = classifications.filter((c) => !(c in map));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Field '${field.key}' gives no points for ${missing.join(', ')}. `
        + 'Write 0 if that is deliberate, so it cannot be mistaken for an omission.');
    }
    const unknown = Object.keys(map).filter((c) => !classifications.includes(c));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Field '${field.key}' gives points for ${unknown.join(', ')}, which this form `
        + 'does not score for. Add it to the scoring block or remove the value.');
    }
  }

  const wrong = classifications
    .map((c) => ({ classification: c, total: totalFor(schema, c) }))
    .filter((r) => r.total !== schema.scoring!.maxPoints);

  if (wrong.length > 0) {
    const detail = wrong
      .map((r) => `${r.classification} totals ${r.total}`)
      .join('; ');
    throw new BadRequestException(
      `This form must total ${schema.scoring.maxPoints} points, but ${detail}. `
      + 'A form that does not add up produces a wrong score for everyone evaluated '
      + 'on it, so it cannot be published.');
  }
}


/**
 * One field's contribution to a score.
 *
 * `earned` is what the answer was worth; `available` is what it could have been
 * worth. Both are kept so a score can be explained line by line rather than
 * presented as a number the reader must trust.
 */
export interface ScoreLine {
  key: string;
  earned: number;
  available: number;
}

export interface ScoreResult {
  earned: number;
  available: number;
  classification: string;
  lines: ScoreLine[];
}

/**
 * What a rating is worth: its position on the scale, times the line's points.
 *
 * A 4 out of 5 on a 10-point line earns 8. The scale minimum matters — a 1-5
 * scale scores 1 as a fifth, not as zero, because the bottom of the scale is
 * still an answer. Using (value / max) rather than ((value - min) / (max - min))
 * is deliberate and matches how the client's own sheet reads: their columns are
 * "10 pts" against "1 2 3 4 5", and a 1 there is worth 2, not nothing.
 */
export function ratingFraction(value: number, scaleMax: number): number {
  if (!(scaleMax > 0)) return 0;
  const clamped = Math.max(0, Math.min(value, scaleMax));
  return clamped / scaleMax;
}

/**
 * Scores a set of answers against the schema they were given under.
 *
 * Unanswered scored fields earn nothing but still count towards `available`:
 * a review with half the lines blank is not a perfect score on the half that
 * was filled in.
 */
export function scoreResponses(
  schema: ScoredSchema,
  responses: Map<string, unknown>,
  classification: string,
  scaleMax: number,
): ScoreResult {
  const lines: ScoreLine[] = [];
  let earned = 0;
  let available = 0;

  for (const section of schema.sections) {
    for (const field of section.fields) {
      const points = pointsFor(field.points, classification);
      if (points === 0) continue;

      available += points;
      const answer = responses.get(field.key);
      let got = 0;

      if (field.type === 'rating' && typeof answer === 'number') {
        got = ratingFraction(answer, scaleMax) * points;
      } else if (field.type === 'boolean' && answer === true) {
        got = points;
      }

      // Two decimals: a 1-5 rating on a 15-point line lands on thirds, and
      // carrying the full float into the database makes two identical reviews
      // differ in the sixteenth decimal place.
      got = Math.round(got * 100) / 100;
      earned += got;
      lines.push({ key: field.key, earned: got, available: points });
    }
  }

  return {
    earned: Math.round(earned * 100) / 100,
    available,
    classification,
    lines,
  };
}
