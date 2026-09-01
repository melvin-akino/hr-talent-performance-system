/**
 * The 30-point peer instrument (requirements §6.1).
 *
 * Their page 4 gives it as a fixed list, and it is fixed here too: unlike the
 * 100-point formats, which have two point columns for two kinds of job, this is
 * one instrument used by everybody who is asked to assess a colleague.
 *
 * Customer Service is worth ten because their document says so — it is double
 * every other line, which is the substantive claim the instrument makes about
 * what matters, so it is the number most worth getting right.
 */

export const PEER_TEMPLATE_TOTAL = 30;

export const PEER_TEMPLATE_CODE = 'PEER-30';

interface PeerMetric {
  key: string;
  label: string;
  points: number;
  helpText: string;
}

export const PEER_METRICS: PeerMetric[] = [
  {
    key: 'mastery',
    label: 'Mastery of the job',
    points: 5,
    helpText: 'Command of the work they are responsible for.',
  },
  {
    key: 'demeanor_remote',
    label: 'Demeanour — phone and messaging',
    points: 5,
    helpText: 'How they come across when not face to face.',
  },
  {
    key: 'demeanor_in_person',
    label: 'Demeanour — in person',
    points: 5,
    helpText: 'How they come across in person, with colleagues and clients.',
  },
  {
    key: 'customer_service',
    label: 'Customer service',
    points: 10,
    helpText: 'Care taken with the people they serve, inside or outside the company.',
  },
  {
    key: 'promptness',
    label: 'Promptness',
    points: 5,
    helpText: 'Responding and delivering when they said they would.',
  },
];

/**
 * The instrument as a form schema ready to publish.
 *
 * Every line is required, for the same reason the 100-point formats are: a
 * 30-point instrument with an optional line is not a 30-point instrument, and
 * the total would depend on how much the reviewer felt like answering.
 */
export function peerTemplate() {
  return {
    scoring: { maxPoints: PEER_TEMPLATE_TOTAL },
    sections: [
      {
        key: 'peer_assessment',
        title: 'Peer assessment',
        description:
          'Your answers are averaged with those of other colleagues. Please '
          + 'answer only for behaviour you have seen yourself.',
        fields: PEER_METRICS.map((m) => ({
          key: m.key,
          label: m.label,
          type: 'rating' as const,
          required: true,
          points: m.points,
          helpText: m.helpText,
        })),
      },
    ],
  };
}
