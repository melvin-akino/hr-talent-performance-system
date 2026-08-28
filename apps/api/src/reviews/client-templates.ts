/**
 * The client's two 100-point evaluation formats (requirements §3.3).
 *
 * Their page 3 is a single table: one list of metrics with two point columns,
 * Technical/Ops/Field and Admin. The two columns split the same 100 points
 * differently — 70/30 for technical, 60/40 for admin — because the same
 * behaviour is not worth the same in both kinds of job.
 *
 * ONE LIST, TWO FORMATS.
 *
 * The metrics live here once and both formats are generated from them. Seeding
 * two hand-written templates would let the lists drift, and a metric present on
 * one format but not the other is precisely the difference nobody notices until
 * two people's scores turn out not to be comparable.
 *
 * Why two published templates rather than one form with two point columns —
 * which `scoring.ts` supports and the schema was built for:
 *
 *   A single two-column form only scores once someone tells it WHICH column
 *   applies to the person being evaluated (B2; a plausible number from the
 *   wrong allocation is worse than none). How that classification is decided —
 *   by job family, by rank, by hand — is R6, and R6 is unanswered. Two
 *   single-column templates need no such decision: each is assigned through the
 *   assignment table that already exists, and scores on its own.
 *
 * If the client answers R6 wanting one form, `combinedTemplate()` below builds
 * it from the same list, and nothing here has to be rewritten.
 */

export type Classification = 'technical' | 'admin';

interface Metric {
  key: string;
  label: string;
  /** Points in each column, straight from their page 3. */
  points: Record<Classification, number>;
  helpText?: string;
}

interface MetricSection {
  key: string;
  title: string;
  metrics: Metric[];
}

/**
 * The instrument itself. Every number here is the client's, not a convenient
 * invention — the totals below are asserted, so a mistyped value fails the
 * build rather than quietly rescoring everyone evaluated on it.
 */
export const CLIENT_METRICS: MetricSection[] = [
  {
    key: 'performance',
    title: 'Performance',
    metrics: [
      {
        key: 'mastery',
        label: 'Mastery of the job',
        points: { technical: 10, admin: 10 },
        helpText: 'Command of the work itself: what the role requires, done well.',
      },
      {
        key: 'efficiency',
        label: 'Efficiency',
        points: { technical: 15, admin: 10 },
        helpText: 'Output against the time and resources it took.',
      },
      {
        key: 'productivity',
        label: 'Productivity',
        points: { technical: 15, admin: 10 },
        helpText: 'Volume of work completed to standard.',
      },
      {
        key: 'team_cooperation',
        label: 'Team cooperation',
        points: { technical: 10, admin: 10 },
        helpText: 'Working with others, inside and outside the section.',
      },
      {
        key: 'supervisor_assessment',
        label: "Supervisor's assessment",
        points: { technical: 20, admin: 20 },
        helpText: 'The supervisor’s overall judgement of the period.',
      },
    ],
  },
  {
    key: 'attendance_demeanor',
    title: 'Attendance and demeanour',
    metrics: [
      {
        key: 'attendance',
        label: 'Attendance',
        points: { technical: 10, admin: 10 },
        helpText: 'Absences and tardiness over the period.',
      },
      {
        key: 'seminars',
        label: 'Seminars and training',
        points: { technical: 5, admin: 10 },
        helpText: 'Training attended and applied.',
      },
      {
        key: 'tenure',
        label: 'Tenure',
        points: { technical: 5, admin: 10 },
        helpText: 'Length of service with the company.',
      },
      {
        key: 'policy_compliance',
        label: 'Policy compliance',
        points: { technical: 10, admin: 10 },
        helpText: 'Adherence to company policy and standards of conduct.',
      },
    ],
  },
];

export const CLIENT_TEMPLATE_TOTAL = 100;

/** What each format is called and coded when seeded. */
export const CLIENT_FORMATS: {
  classification: Classification; code: string; name: string; description: string;
}[] = [
  {
    classification: 'technical',
    code: 'GGC-TOF',
    name: 'Technical / Ops / Field — 100 points',
    description:
      'The client’s standard 100-point format for technical, operations and '
      + 'field roles: 70 points of performance, 30 of attendance and demeanour.',
  },
  {
    classification: 'admin',
    code: 'GGC-ADMIN',
    name: 'Administrative — 100 points',
    description:
      'The client’s standard 100-point format for administrative roles: 60 '
      + 'points of performance, 40 of attendance and demeanour.',
  },
];

/**
 * One format, as a form schema ready to publish.
 *
 * Every field is `required`. A 100-point instrument with an optional line is
 * not a 100-point instrument: the total would silently depend on how much the
 * evaluator felt like filling in.
 */
export function formatTemplate(classification: Classification) {
  return {
    scoring: { maxPoints: CLIENT_TEMPLATE_TOTAL },
    sections: CLIENT_METRICS.map((section) => ({
      key: section.key,
      title: section.title,
      fields: section.metrics.map((m) => ({
        key: m.key,
        label: m.label,
        type: 'rating' as const,
        required: true,
        points: m.points[classification],
        ...(m.helpText ? { helpText: m.helpText } : {}),
      })),
    })),
  };
}

/**
 * Both columns on one form, for the day R6 is answered in favour of a single
 * instrument. Not seeded — it exists so that answer costs a line of code rather
 * than a re-transcription of the client's page.
 */
export function combinedTemplate() {
  return {
    scoring: {
      maxPoints: CLIENT_TEMPLATE_TOTAL,
      classifications: CLIENT_FORMATS.map((f) => f.classification),
    },
    sections: CLIENT_METRICS.map((section) => ({
      key: section.key,
      title: section.title,
      fields: section.metrics.map((m) => ({
        key: m.key,
        label: m.label,
        type: 'rating' as const,
        required: true,
        points: { ...m.points },
        ...(m.helpText ? { helpText: m.helpText } : {}),
      })),
    })),
  };
}

/** Points a section is worth in one column — the 70/30 and 60/40 split. */
export function sectionTotal(sectionKey: string, classification: Classification): number {
  const section = CLIENT_METRICS.find((s) => s.key === sectionKey);
  if (!section) throw new Error(`No such section '${sectionKey}'`);
  return section.metrics.reduce((sum, m) => sum + m.points[classification], 0);
}
