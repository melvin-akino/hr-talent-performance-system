/**
 * A rating whose every value carries its own sentence.
 *
 * The client's evaluation form is a rubric, not a scale. "Output / Performance"
 * is not rated 1-5 in the abstract: the supervisor chooses which of five
 * sentences describes the person — "Always exceeds target" down to "Does not
 * meet target" — and those sentences are what make two supervisors' ratings
 * comparable. The org-wide scale cannot carry them, because it labels a 4 once
 * for every indicator, so each field brings its own (`anchors`, keyed by the
 * rating's value).
 *
 * Laid out as a vertical list, best first, because that is how the printed form
 * reads — a row you choose, with its number beside it — and because the
 * sentences are far too long to sit side by side on a narrow screen as the
 * scale-wide buttons do.
 *
 * A value with no anchor falls back to the scale's own label, so a form may
 * anchor some indicators and not others, and an organisation whose scale is not
 * 1-5 degrades to the plain scale rather than showing a blank row.
 */

export interface RatingPoint { value: number; label: string; description: string | null }

export function AnchoredRating(
  { name, points, anchors, value, readOnly, onChange }: {
    /** Accessible name for the group — the indicator's label. */
    name: string;
    points: RatingPoint[];
    anchors: Record<string, string>;
    value: unknown;
    readOnly: boolean;
    onChange: (v: number) => void;
  },
) {
  // Best first, as printed. Sorted here rather than trusted to arrive that way:
  // the scale's own order is whatever its author entered.
  const ordered = [...points].sort((a, b) => b.value - a.value);

  return (
    <div className="hr-anchors" role="radiogroup" aria-label={name}>
      {ordered.map((p) => {
        const isOn = value === p.value;
        return (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={isOn}
            disabled={readOnly}
            className={`hr-anchor${isOn ? ' is-on' : ''}`}
            onClick={() => onChange(p.value)}
          >
            <span className="hr-anchor-value">{p.value}</span>
            <span>{anchors[String(p.value)] ?? p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
