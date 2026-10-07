/**
 * The client's Performance Evaluation Form (revised December 2025).
 *
 * This replaces the instrument built from the 5-pager's page 3. That one had a
 * Technical/Admin split, four attendance-and-demeanour lines and different
 * performance lines; this one has three classifications, five indicators in
 * each of two parts, and a written descriptor for every rating. They are not
 * the same form, and the old one is retired rather than edited — see
 * SUPERSEDED_FORMAT_CODES and docs/decisions.md D-018.
 *
 * THE SHAPE OF THE FORM
 *
 *   Part 1  filled out by the immediate supervisor
 *     Output / Performance · Skills / Mastery · Efficiency and Productivity
 *     Teamwork and Commitment · Supervisor's Assessment
 *   Part 2  filled out by HCM or the immediate supervisor
 *     Attendance · Office Reporting · Training and Skills Enhancement
 *     Attitude and Decorum · Tenure
 *
 * Each indicator is rated 5 (best) to 1, and each rating has its own sentence:
 * "Always exceeds target" ... "Does not meet target". Those sentences are the
 * instrument. They are carried as `anchors` on each field so a supervisor sees
 * what a 4 means for THIS indicator at the moment of choosing, rather than a
 * bare number two supervisors will read differently.
 *
 * WHAT IS PRINTED ON THE FORM, AND WHAT IS NOT — READ THIS BEFORE CHANGING A NUMBER
 *
 * Printed (the PIP form's "Parameter Guide" carries them):
 *
 *                      Sales        Service       Admin
 *   Part A (Part 1)    42 - 70      36 - 60      42 - 70
 *   Part B (Part 2)    18 - 30      24 - 40      18 - 30
 *   Total                  100          100          100
 *
 * Each range is a passing floor and the part's maximum. Those are in
 * PART_MAX and PASSING_FLOOR and are the client's numbers, not ours.
 *
 * NOT printed anywhere: how many points each INDICATOR is worth. The form shows
 * five indicators per part and a 1-5 grid, and says only what the part adds up
 * to. So the per-indicator weights below are PROVISIONAL — every indicator in a
 * part is weighted equally — and WEIGHTS_ARE_PROVISIONAL says so. Equal weights
 * are the assumption that adds the least: they invent no emphasis the client did
 * not state. They are very probably wrong in detail (the old instrument gave
 * the supervisor's assessment 20 of 70), and until HCM confirms them a score
 * from this form is a good estimate and not a figure to act on.
 *
 * The floors are NOT affected by that uncertainty, and that is worth knowing:
 * every floor is exactly 60% of its part (42/70, 36/60, 18/30, 24/40), and a
 * rating scores as value / scale maximum, so an evaluator who rates every
 * indicator 3 ("Meets") lands on the floor exactly, WHATEVER the weights are.
 * The test suite asserts this. It is also why the floors can be trusted as
 * printed: they are consistent with the scoring model, which a transcription
 * error would not be.
 *
 * ONE FORM PER CLASSIFICATION, NOT ONE FORM WITH THREE COLUMNS.
 *
 * Which classification applies to a person (Sales, Service or Admin) is not
 * recorded anywhere in this system and is not stated by the forms. A single
 * three-column form therefore cannot score until somebody says which column a
 * given person is on, and picking one on their behalf would produce a plausible
 * number from the wrong allocation. Three single-column templates need no such
 * decision: each is assigned through the assignment table that already exists
 * and scores on its own. `combinedTemplate()` builds the three-column version
 * from the same data for the day the question is answered.
 */

export type Classification = 'sales' | 'service' | 'admin';

export const CLASSIFICATIONS: readonly Classification[] = ['sales', 'service', 'admin'];

export type PartKey = 'part_1' | 'part_2';

export type RatingValue = 1 | 2 | 3 | 4 | 5;

interface Indicator {
  key: string;
  label: string;
  /** What each rating means for this indicator, as printed on the form. */
  anchors: Record<RatingValue, string>;
  helpText?: string;
}

interface Part {
  key: PartKey;
  title: string;
  /** Who fills it in, as printed. */
  description: string;
  indicators: Indicator[];
}

/**
 * The instrument. Wording is the form's own, including its grammar — "Sometimes
 * exhibit exceptional efficiency", "With atleast 1 policy orientation" — because
 * a template HCM has declared official should read as the form they signed off,
 * not as an improved paraphrase of it. Filipino subtitles are on the printed
 * form and are deliberately not carried yet: they are small italic text on a
 * photograph, and a mistranscribed translation on an official form is worse than
 * none. They need HCM's own text.
 */
export const PEF_PARTS: Part[] = [
  {
    key: 'part_1',
    title: 'Part 1',
    description: 'To be filled out by immediate supervisor',
    indicators: [
      {
        key: 'output_performance',
        label: 'Output / Performance',
        anchors: {
          5: 'Always exceeds target',
          4: 'Sometimes exceeds target',
          3: 'Meets target',
          2: 'Sometimes does not meet target',
          1: 'Does not meet target',
        },
      },
      {
        key: 'skills_mastery',
        label: 'Skills / Mastery',
        anchors: {
          5: 'Always exceeds expected mastery',
          4: 'Sometimes exceeds expected mastery',
          3: 'Exhibits mastery',
          2: 'Sometimes does not exhibit mastery',
          1: 'Does not exhibit mastery',
        },
      },
      {
        key: 'efficiency_productivity',
        label: 'Efficiency and Productivity',
        anchors: {
          5: 'Always shows exceptional efficiency',
          4: 'Sometimes exhibit exceptional efficiency',
          3: 'Exhibits efficiency and productivity',
          2: 'Sometimes does not exhibit efficiency',
          1: 'Does not exhibit efficiency',
        },
      },
      {
        key: 'teamwork_commitment',
        label: 'Teamwork and Commitment',
        anchors: {
          5: 'Always work with commitment and shows pride in team output',
          4: 'Sometimes shows commitment and pride in team output',
          3: 'Works with team to achieve goals',
          2: 'Sometimes does not show commitment to work',
          1: 'Does not show commitment to work',
        },
      },
      {
        key: 'supervisor_assessment',
        label: "Supervisor's Assessment",
        anchors: {
          5: 'Is now ready to take on a bigger role',
          4: 'Will always deliver beyond what is expected of the role',
          3: 'Show professional maturity and understanding of operations',
          2: 'Can sometimes be relied upon to show professionalism and commitment',
          // Printed identically to the "Teamwork and Commitment" bottom band. It
          // reads like a copy-paste slip on the form, but it is what the form
          // says, so it is what the template says; raised with HCM, not patched.
          1: 'Does not show commitment to work',
        },
      },
    ],
  },
  {
    key: 'part_2',
    title: 'Part 2',
    description: 'To be filled out by HCM or immediate supervisor',
    indicators: [
      {
        key: 'attendance',
        label: 'Attendance',
        anchors: {
          5: '0 minute tardiness',
          4: '1-15 minutes tardiness/cut off',
          3: '16-27 minutes tardiness/cut off',
          2: '28-35 minutes tardiness/cut off',
          1: 'More than 35 minutes tardiness/cut off',
        },
      },
      {
        key: 'office_reporting',
        label: 'Office Reporting',
        // The form's header for this indicator reads "1 point for each of the
        // following", yet it lays the five items out on the same 5-4-3-2-1 grid
        // as every other indicator. Those are two different scoring rules (count
        // the items observed, or pick one tier). It is rated here as a single
        // 1-5 rating, matching the grid; the printed instruction is carried so the
        // ambiguity is visible rather than resolved by us. HCM to confirm.
        helpText: 'As printed on the form: 1 point for each of the following.',
        anchors: {
          5: 'Utilizes proper leave application/ notification procedure',
          4: 'Observe allocated AM and PM breaktime',
          3: 'Neat and Professional appearance with complete uniform',
          2: 'Observes health and security protocols',
          1: 'Workstation appears clean and in order',
        },
      },
      {
        key: 'training_skills',
        label: 'Training and Skills Enhancement',
        anchors: {
          5: 'With 2 or more job-related external trainings in the last 12 months',
          4: 'With 1 job-related external trainings in the last 12 months',
          3: 'With 1 or more job-related external trainings in the last 24 months',
          2: 'With 1 or more job-related external trainings in the last 30 months',
          1: 'With atleast 1 policy orientation/ onboarding session in the recent 4 years',
        },
      },
      {
        key: 'attitude_decorum',
        label: 'Attitude and Decorum',
        anchors: {
          5: 'No Disciplinary Action/s in the last 12 months',
          4: 'No Disciplinary Action/s in the last 10 months',
          3: 'No Disciplinary Action/s in the last 8 months',
          2: 'No Disciplinary Action/s in the last 6 months',
          1: 'No issued Disciplinary Action/s in the current quarter',
        },
      },
      {
        key: 'tenure',
        label: 'Tenure',
        anchors: {
          5: '5-6 years in current post',
          4: '3-4 years in current post',
          3: '2 years in current post',
          2: '1 year in current post',
          1: 'Less than 1 year in service',
        },
      },
    ],
  },
];

export const CLIENT_TEMPLATE_TOTAL = 100;

/**
 * What each part is worth, per classification. PRINTED on the form: the upper
 * end of each range in the PIP's Parameter Guide.
 */
export const PART_MAX: Record<Classification, Record<PartKey, number>> = {
  sales:   { part_1: 70, part_2: 30 },
  service: { part_1: 60, part_2: 40 },
  admin:   { part_1: 70, part_2: 30 },
};

/**
 * The lowest passing score of each part. PRINTED on the form: the lower end of
 * each range in the same table.
 */
export const PASSING_FLOOR: Record<Classification, Record<PartKey, number>> = {
  sales:   { part_1: 42, part_2: 18 },
  service: { part_1: 36, part_2: 24 },
  admin:   { part_1: 42, part_2: 18 },
};

/**
 * True while the per-indicator weights are our assumption rather than the
 * client's statement. The form prints what each PART is worth and not what each
 * INDICATOR is, so every indicator is currently weighted equally within its
 * part. Flip this, and replace `indicatorPoints`, when HCM supplies the weights
 * — the description published with each template follows it, so a template can
 * never go on claiming to be provisional after it stops being.
 */
export const WEIGHTS_ARE_PROVISIONAL = true;

/** Points one indicator is worth in a part, for a classification. */
export function indicatorPoints(classification: Classification, part: PartKey): number {
  const indicators = PEF_PARTS.find((p) => p.key === part)!.indicators.length;
  return PART_MAX[classification][part] / indicators;
}

/** What each format is called and coded when seeded. */
export const CLIENT_FORMATS: {
  classification: Classification; code: string; name: string; description: string;
}[] = CLASSIFICATIONS.map((classification) => {
  const label = { sales: 'Sales', service: 'Service', admin: 'Admin' }[classification];
  const max = PART_MAX[classification];
  return {
    classification,
    code: `GGC-PEF-${classification.toUpperCase()}`,
    name: `Performance Evaluation — ${label} — 100 points`,
    description:
      `The client's Performance Evaluation Form (revised December 2025) for `
      + `${label} roles: Part 1 ${max.part_1} points, Part 2 ${max.part_2}. `
      + (WEIGHTS_ARE_PROVISIONAL
        ? 'PROVISIONAL: the form prints what each part is worth but not what each '
          + 'indicator is worth, so indicators are weighted equally within their part '
          + 'until HCM confirms. Treat scores from this form as estimates.'
        : 'Points per indicator confirmed by HCM.'),
  };
});

/**
 * The 5-pager's two formats. Retired, not deleted: an organisation provisioned
 * before this form arrived has them published, and a form version is immutable
 * once published and may be referenced by instances.
 */
export const SUPERSEDED_FORMAT_CODES = ['GGC-TOF', 'GGC-ADMIN'] as const;

const RECOMMENDATION_MAX = 2000;
const REMARKS_MAX = 1000;

/** A field as it is written into a published form version. */
interface TemplateField {
  key: string;
  label: string;
  type: 'rating' | 'textarea';
  required: boolean;
  points?: number | Record<string, number>;
  anchors?: Record<string, string>;
  helpText?: string;
  maxLength?: number;
}

/**
 * The form's field list for one part, shared by both builders below so the two
 * can never disagree about which fields exist or what they are called.
 */
function partFields(
  part: Part,
  pointsOf: (indicator: Indicator) => number | Record<string, number>,
): TemplateField[] {
  const fields: TemplateField[] = part.indicators.flatMap((indicator): TemplateField[] => [
    {
      key: indicator.key,
      label: indicator.label,
      type: 'rating',
      // Every indicator is required. A 100-point instrument with an optional
      // line is not a 100-point instrument: the total would depend on how much
      // the evaluator felt like filling in.
      required: true,
      points: pointsOf(indicator),
      anchors: { ...indicator.anchors },
      ...(indicator.helpText ? { helpText: indicator.helpText } : {}),
    },
    // Every indicator has a remarks box on the printed form. Optional and
    // unscored — it is the evidence for a rating, which is what makes a 1 or a
    // 5 defensible later.
    {
      key: `${indicator.key}_remarks`,
      label: `${indicator.label} — remarks`,
      type: 'textarea',
      required: false,
      maxLength: REMARKS_MAX,
    },
  ]);

  if (part.key === 'part_1') {
    fields.push({
      key: 'recommendation',
      label: 'Recommendation',
      type: 'textarea',
      required: false,
      maxLength: RECOMMENDATION_MAX,
    });
  }
  return fields;
}

/**
 * One format, as a form schema ready to publish.
 *
 * Single-column: every field carries a plain number, so the form scores on its
 * own with no classification needing to be chosen first.
 */
export function formatTemplate(classification: Classification) {
  return {
    scoring: {
      maxPoints: CLIENT_TEMPLATE_TOTAL,
      passing: { ...PASSING_FLOOR[classification] },
    },
    sections: PEF_PARTS.map((part) => ({
      key: part.key,
      title: part.title,
      description: part.description,
      fields: partFields(part, () => indicatorPoints(classification, part.key)),
    })),
  };
}

/**
 * All three classifications on one form, for the day it is decided how a
 * person's classification is recorded. Not seeded — it exists so that answer
 * costs a line of code rather than a re-transcription of the form.
 */
export function combinedTemplate() {
  return {
    scoring: {
      maxPoints: CLIENT_TEMPLATE_TOTAL,
      classifications: [...CLASSIFICATIONS],
      passing: Object.fromEntries(
        (['part_1', 'part_2'] as const).map((part) => [
          part,
          Object.fromEntries(CLASSIFICATIONS.map((c) => [c, PASSING_FLOOR[c][part]])),
        ])),
    },
    sections: PEF_PARTS.map((part) => ({
      key: part.key,
      title: part.title,
      description: part.description,
      fields: partFields(part, () => Object.fromEntries(
        CLASSIFICATIONS.map((c) => [c, indicatorPoints(c, part.key)]))),
    })),
  };
}

/** Points a part is worth for one classification — the 70/30 and 60/40 splits. */
export function sectionTotal(part: PartKey, classification: Classification): number {
  return PART_MAX[classification][part];
}
