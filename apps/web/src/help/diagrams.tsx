import type { ReactNode } from 'react';

/**
 * Diagrams for the help centre.
 *
 * WHY DIAGRAMS AND NOT SCREENSHOTS.
 *
 * The obvious way to make help visual is screenshots, and it is the wrong one
 * here for three reasons. They rot — a screenshot of a screen that has since
 * gained a column is worse than no picture, because the reader trusts it. They
 * cannot be produced offline, and this application is built and shipped as a
 * bundle to a machine with no internet. And they answer the wrong question:
 * almost nobody is stuck on *where the button is*. They are stuck on **what
 * happens next and who else is involved** — which is a model, not a screen.
 *
 * So these draw the model: the states a thing moves through, and who acts at
 * each step. That is also the part that does not change when the layout does.
 *
 * WHY INLINE SVG AND NOT AN IMAGE OR A LIBRARY.
 *
 * No runtime fetch (the LAN has no internet, and the API may be the thing the
 * reader is stuck on), no build step, and — because they are React elements
 * rather than markup strings — no HTML-injection surface, which matters
 * because this renderer is pointed at HR-authored content from the database.
 * Every colour is a CSS variable, so the same drawing is legible in both
 * themes without a second copy.
 *
 * Diagrams are addressed by name from markdown: `:::diagram goal-lifecycle`.
 * A name that does not exist here fails the content test rather than rendering
 * a blank space nobody notices.
 */

const FILL_BG = 'var(--color-bg)';
const STROKE = 'var(--color-divider)';
const TEXT = 'var(--color-text)';
const MUTED = 'var(--color-neutral-600)';
const ACCENT = 'var(--color-accent-700)';
const ACCENT_SOFT = 'var(--color-accent-100)';

/** A rounded box with a label and an optional sub-label. */
function Box(
  { x, y, w = 110, h = 40, label, sub, tone = 'plain' }:
  { x: number; y: number; w?: number; h?: number; label: string; sub?: string;
    tone?: 'plain' | 'accent' | 'end' },
) {
  const fill = tone === 'accent' ? ACCENT_SOFT : FILL_BG;
  const stroke = tone === 'plain' ? STROKE : ACCENT;
  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h} rx={6}
        fill={fill} stroke={stroke}
        strokeWidth={tone === 'end' ? 1.6 : 1}
        strokeDasharray={tone === 'end' ? '4 3' : undefined}
      />
      <text
        x={x + w / 2} y={sub ? y + h / 2 - 3 : y + h / 2 + 4}
        textAnchor="middle" fill={TEXT} fontSize={12} fontWeight={500}
      >
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle"
              fill={MUTED} fontSize={10}>
          {sub}
        </text>
      )}
    </g>
  );
}

/** A left-to-right arrow with an optional label above it. */
function Arrow({ x1, y, x2, label }: { x1: number; y: number; x2: number; label?: string }) {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2 - 6} y2={y} stroke={MUTED} strokeWidth={1.2}
            markerEnd="url(#hd-arrow)" />
      {label && (
        <text x={(x1 + x2) / 2} y={y - 6} textAnchor="middle" fill={MUTED} fontSize={10}>
          {label}
        </text>
      )}
    </g>
  );
}

function Frame(
  { viewBox, title, desc, children }:
  { viewBox: string; title: string; desc: string; children: ReactNode },
) {
  return (
    <figure className="hr-help-figure">
      <svg
        viewBox={viewBox}
        // Scales to the drawer's width; the drawer is narrow and these are
        // wide, so height follows from the box rather than being fixed.
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`${title}. ${desc}`}
      >
        <defs>
          <marker id="hd-arrow" viewBox="0 0 8 8" refX="6" refY="4"
                  markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill={MUTED} />
          </marker>
        </defs>
        {children}
      </svg>
      {/* The caption is not decoration. A reader using a screen reader gets the
          aria-label; a reader who cannot parse the drawing gets this. */}
      <figcaption>{desc}</figcaption>
    </figure>
  );
}

export const DIAGRAMS: Record<string, () => ReactNode> = {
  /** Where a target goes between being written and counting. */
  'goal-lifecycle': () => (
    <Frame
      viewBox="0 0 560 120"
      title="The life of a target"
      desc="You write it, your supervisor approves it, and — where HCM approval is switched on for the period — HCM releases it before it counts."
    >
      <Box x={0} y={20} label="Draft" sub="you write it" />
      <Arrow x1={110} y={40} x2={150} label="submit" />
      <Box x={150} y={20} label="Awaiting" sub="your supervisor" tone="accent" />
      <Arrow x1={260} y={40} x2={300} label="approve" />
      <Box x={300} y={20} label="With HCM" sub="if switched on" tone="accent" />
      <Arrow x1={410} y={40} x2={450} label="release" />
      <Box x={450} y={20} w={100} label="Active" sub="it counts now" />
      {/* The way back, which is the half people are surprised by. */}
      <path d="M350 60 L350 92 L55 92 L55 62" fill="none" stroke={MUTED}
            strokeWidth={1.2} strokeDasharray="4 3" markerEnd="url(#hd-arrow)" />
      <text x={200} y={106} fill={MUTED} fontSize={10}>
        sent back for revision — it returns to your drafts, with the reason
      </text>
    </Frame>
  ),

  /** The review chain, which is the thing most people ask about. */
  'review-chain': () => (
    <Frame
      viewBox="0 0 560 150"
      title="Who writes what in a review"
      desc="Everyone writes their own part. The cycle cannot be signed off until every part is in — which is why one unfinished review holds up a whole result."
    >
      <Box x={0} y={10} w={120} label="You" sub="self-review" />
      <Box x={0} y={60} w={120} label="Your supervisor" sub="their assessment" />
      <Box x={0} y={110} w={120} h={32} label="Peers" sub="where a panel is drawn" />

      <line x1={120} y1={30} x2={200} y2={62} stroke={MUTED} strokeWidth={1.2} />
      <line x1={120} y1={80} x2={200} y2={72} stroke={MUTED} strokeWidth={1.2} />
      <line x1={120} y1={126} x2={200} y2={82} stroke={MUTED} strokeWidth={1.2} />

      <Box x={200} y={52} w={110} label="Department" sub="Head approves" tone="accent" />
      <Arrow x1={310} y={72} x2={350} />
      <Box x={350} y={52} w={100} label="Calibration" sub="HCM moderates" tone="accent" />
      <Arrow x1={450} y={72} x2={490} />
      <Box x={490} y={52} w={66} label="Released" tone="end" />
    </Frame>
  ),

  /** Why two people running the same screen see different numbers. */
  'who-sees-what': () => (
    <Frame
      viewBox="0 0 560 160"
      title="What each person can see"
      desc="Everyone uses the same screens. What differs is how far you can see — your own record, your team, your section, or the company — and the system works that out from your role, not from which page you opened."
    >
      <circle cx={120} cy={80} r={70} fill="none" stroke={STROKE} />
      <circle cx={120} cy={80} r={52} fill="none" stroke={STROKE} />
      <circle cx={120} cy={80} r={32} fill="none" stroke={ACCENT} />
      <circle cx={120} cy={80} r={14} fill={ACCENT_SOFT} stroke={ACCENT} />

      <text x={120} y={84} textAnchor="middle" fill={TEXT} fontSize={10}>you</text>

      <text x={210} y={34} fill={TEXT} fontSize={12} fontWeight={500}>HCM</text>
      <text x={210} y={48} fill={MUTED} fontSize={10}>the whole company</text>
      <line x1={190} y1={30} x2={128} y2={14} stroke={STROKE} />

      <text x={210} y={72} fill={TEXT} fontSize={12} fontWeight={500}>Department Head</text>
      <text x={210} y={86} fill={MUTED} fontSize={10}>their section, and everything under it</text>
      <line x1={205} y1={68} x2={155} y2={46} stroke={STROKE} />

      <text x={210} y={112} fill={TEXT} fontSize={12} fontWeight={500}>Supervisor</text>
      <text x={210} y={126} fill={MUTED} fontSize={10}>the people who report to them</text>
      <line x1={205} y1={108} x2={152} y2={92} stroke={STROKE} />

      <text x={210} y={150} fill={MUTED} fontSize={10}>
        Everyone can always see their own record.
      </text>
    </Frame>
  ),

  /** The rank numbering, which reads backwards to most people. */
  'rank-ladder': () => (
    <Frame
      viewBox="0 0 560 130"
      title="How the ranks are numbered"
      desc="A LOWER number is more senior. Rank 6 sits above rank 11 — this is the group's own numbering, kept as it is rather than reversed to feel natural."
    >
      <text x={0} y={14} fill={MUTED} fontSize={11}>more senior</text>
      <text x={470} y={14} fill={MUTED} fontSize={11}>more junior</text>
      <line x1={0} y1={24} x2={556} y2={24} stroke={STROKE} />

      {[
        // Short names on purpose: at 10px these have 86px to live in, and a
        // label that overflows its box is the failure this diagram exists to
        // avoid. The full titles are in the glossary beside it.
        ['6', 'GM'], ['7', 'Regional / Area'], ['8', 'Dept Manager'],
        ['9', 'Supervisor'], ['10', 'Team Leader'], ['11', 'Associate'],
      ].map(([no, name], i) => (
        <g key={no}>
          <rect x={i * 93} y={36} width={86} height={46} rx={6}
                fill={i === 0 ? ACCENT_SOFT : FILL_BG}
                stroke={i === 0 ? ACCENT : STROKE} />
          <text x={i * 93 + 43} y={56} textAnchor="middle" fill={TEXT}
                fontSize={15} fontWeight={600}>
            {no}
          </text>
          <text x={i * 93 + 43} y={72} textAnchor="middle" fill={MUTED} fontSize={10}>
            {name}
          </text>
        </g>
      ))}

      <text x={0} y={104} fill={TEXT} fontSize={11}>
        “Two ranks up” from a Team Leader (10) means rank 8 — not rank 12.
      </text>
    </Frame>
  ),

  /** What a request is, and what approving it does NOT do. */
  'request-flow': () => (
    <Frame
      viewBox="0 0 560 140"
      title="Asking for something outside the normal cycle"
      desc="A request records a decision and who made it. Approving one does not make the change — that is still done on the screen that owns it, so it is recorded as the change it is."
    >
      <Box x={0} y={20} w={120} label="You ask" sub="with a reason" />
      <Arrow x1={120} y={40} x2={170} />
      <Box x={170} y={20} w={120} label="They decide" sub="approve or decline" tone="accent" />
      <Arrow x1={290} y={40} x2={340} />
      <Box x={340} y={20} w={120} label="Recorded" sub="who, when, why" />

      <rect x={0} y={84} width={556} height={46} rx={6}
            fill={ACCENT_SOFT} stroke={ACCENT} />
      <text x={14} y={104} fill={TEXT} fontSize={12} fontWeight={500}>
        An approval is a decision, not the change.
      </text>
      <text x={14} y={120} fill={MUTED} fontSize={11}>
        Somebody still makes the change on its own screen — that is what puts a
        name against it afterwards.
      </text>
    </Frame>
  ),
};

export const DIAGRAM_IDS = Object.keys(DIAGRAMS);
