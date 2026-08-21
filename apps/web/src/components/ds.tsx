import type { ReactNode, CSSProperties } from 'react';

/**
 * The Industry design system, as React.
 *
 * Every visual decision here comes from docs/design/README.md and the token
 * file. Two rules from the handoff are load-bearing and easy to break by
 * accident:
 *
 *   1. **No invented colours.** There is one steel-blue accent with a tonal
 *      ramp. Status is carried by icon + tag, never by a new hue — no green for
 *      good, no red for bad. A design that adds "just one red" loses the
 *      property that made it legible.
 *   2. **Cards are hairline-bordered, square-cornered and transparent.**
 *
 * The Industry system also specifies four "+" registration marks on the corner
 * of every card — its signature blueprint treatment. Those are **deliberately
 * omitted**: on a working screen they read as print crop marks or layout
 * guides rather than product, which is how they were reported. Everything else
 * about the treatment is kept, so the frame still looks like the system.
 * Reinstating them means restoring the `.blueprint > .corner` markup here, in
 * one place, and nowhere else.
 */

/* ── icons ────────────────────────────────────────────────────────────── */

/** Lucide outlines at stroke-width 1.5, inlined — nothing is fetched at runtime. */
export function Icon(
  { path, size = 14, stroke = 'currentColor', style }:
  { path: ReactNode; size?: number; stroke?: string; style?: CSSProperties },
) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
         style={{ flex: 'none', ...style }} aria-hidden="true">
      {path}
    </svg>
  );
}

export const paths = {
  trendUp: <><path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" /></>,
  triangleAlert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  alertCircle: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
  dashedCircle: <><path d="M10.1 2.182a10 10 0 0 1 3.8 0" /><path d="M13.9 21.818a10 10 0 0 1-3.8 0" /><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7" /><path d="M2.182 13.9a10 10 0 0 1 0-3.8" /><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69" /><path d="M21.818 10.1a10 10 0 0 1 0 3.8" /><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" /><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7" /></>,
  target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  arrowRight: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  arrowUp: <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>,
  arrowDown: <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
  check: <><path d="M20 6 9 17l-5-5" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  help: <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
};

/* ── cards ────────────────────────────────────────────────────────────── */

export function Card(
  { children, kicker, title, actions, accent, elevated, style, className = '' }: {
    children?: ReactNode;
    kicker?: string;
    title?: ReactNode;
    actions?: ReactNode;
    /** Draws the border in the accent — reserved for "this needs you". */
    accent?: boolean;
    elevated?: boolean;
    style?: CSSProperties;
    className?: string;
  },
) {
  return (
    <div
      className={`card${elevated ? ' elev-sm' : ''} ${className}`}
      style={{ ...(accent ? { borderColor: 'var(--color-accent)' } : {}), ...style }}
    >
      {(kicker || title || actions) && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {kicker && <div className="card-kicker">{kicker}</div>}
            {title && <div className="card-title">{title}</div>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 'var(--space-2)' }}>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Btn(
  { children, variant = 'secondary', ...rest }:
  { children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' }
  & React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return (
    <button type="button" {...rest} className={`btn btn-${variant}`}>
      {children}
    </button>
  );
}

export function Stat(
  { kicker, value, note, tag }:
  { kicker: string; value: ReactNode; note?: ReactNode; tag?: ReactNode },
) {
  return (
    <Card>
      <div className="card-kicker">{kicker}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 30, fontWeight: 600 }}>
          {value}
        </div>
        {tag}
      </div>
      {note && <p className="card-body" style={{ fontSize: 11, margin: 0 }}>{note}</p>}
    </Card>
  );
}

export function Tag(
  { children, tone = 'neutral', style }:
  { children: ReactNode; tone?: 'accent' | 'neutral' | 'outline' | 'solid'; style?: CSSProperties },
) {
  const solid = tone === 'solid';
  return (
    <span
      className={`tag ${solid ? '' : `tag-${tone}`}`}
      style={solid
        ? { background: 'var(--color-accent-800)', color: 'var(--color-bg)', ...style }
        : style}
    >
      {children}
    </span>
  );
}

/* ── domain-specific display ───────────────────────────────────────────── */

/**
 * The six goal states get distinct tags rather than one colour reused six ways.
 * Draft and cancelled are deliberately quiet; cancelled is quieter still.
 */
export function GoalStateTag({ state }: { state: string }) {
  switch (state) {
    case 'draft': return <Tag>Draft</Tag>;
    case 'pending_approval': return <Tag tone="outline">Pending approval</Tag>;
    case 'active': return <Tag tone="accent">Active</Tag>;
    case 'achieved': return <Tag tone="solid">Achieved</Tag>;
    case 'missed': return <Tag>Missed</Tag>;
    case 'cancelled': return <Tag style={{ opacity: 0.7 }}>Cancelled</Tag>;
    default: return null;
  }
}

/**
 * Review assignment state.
 *
 * Replaces a lookup map in which `in_progress`, `submitted` and `returned` all
 * resolved to the same two classes — three states of a review, indistinguishable
 * on the screen a reviewer uses to decide what to do next.
 *
 * `returned` is the one that needs action and carries the outline for it. A
 * submitted review is finished, so it goes solid and stops asking for attention.
 */
export function ReviewStateTag({ state }: { state: string }) {
  switch (state) {
    case 'not_started': return <Tag>Not started</Tag>;
    case 'in_progress': return <Tag tone="accent">In progress</Tag>;
    case 'submitted': return <Tag tone="solid">Submitted</Tag>;
    case 'returned': return <Tag tone="outline">Returned</Tag>;
    default: return <Tag>{state.replace(/_/g, ' ')}</Tag>;
  }
}

/**
 * Notification delivery state.
 *
 * `sent` and `failed` previously rendered identically — the two an operator is
 * actually scanning for. Extracted from the page so the distinction is testable:
 * the delivery history is empty on a fresh install, which is exactly when a
 * regression here would go unnoticed.
 */
export function DeliveryStateTag({ state }: { state: string }) {
  const label = state.replace(/_/g, ' ');
  switch (state) {
    case 'sent': return <Tag tone="accent">{label}</Tag>;
    case 'failed': return <Tag tone="outline">{label}</Tag>;
    default: return <Tag>{label}</Tag>;
  }
}

/**
 * Check-in health, including the fourth state the old UI had no way to show.
 *
 * `null` — never checked in — is the absence of information, not good news, and
 * it ranks above at-risk everywhere it is sorted. Weight is carried by the icon
 * and by bolding the two states that need action, never by a new colour.
 */
export function CheckinStatus({ status }: { status: string | null | undefined }) {
  const row = (icon: ReactNode, label: string, bold = false) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      {icon}<span style={bold ? { fontWeight: 600 } : undefined}>{label}</span>
    </span>
  );

  if (status === 'on_track') {
    return row(<Icon path={paths.trendUp} stroke="var(--color-accent-700)" />, 'On track');
  }
  if (status === 'at_risk') {
    return row(<Icon path={paths.triangleAlert} stroke="var(--color-accent-800)" />, 'At risk', true);
  }
  if (status === 'off_track') {
    return row(<Icon path={paths.alertCircle} stroke="var(--color-accent-900)" />, 'Off track', true);
  }
  return row(
    <Icon path={paths.dashedCircle} stroke="var(--color-accent-700)" />, 'Never checked in');
}

/**
 * Whether a review summary may be signed off.
 *
 * Sign-off finalises a rating and releases it to the employee, and there is no
 * un-sign-off path — so the gate is worth stating once, in a function, rather
 * than re-deriving inline on a table row. Both conditions matter: every review
 * must be in, and a summary with **no** reviews generated is not "complete",
 * it is empty. `submittedCount === instanceCount` alone would be true for both.
 */
export function canSignOff(
  s: { instanceCount: number; submittedCount: number; signedOffAt?: string | null },
): boolean {
  if (s.signedOffAt) return false;
  return s.instanceCount > 0 && s.submittedCount === s.instanceCount;
}

/**
 * Which step of a tonal ramp a rating falls on, banded against the scale the
 * cycle actually used.
 *
 * A cycle on a six-point scale, or one starting at 0, must still shade from
 * lightest to darkest across its own range. Hardcoding 1–5 would mis-colour any
 * historical cycle that used something else.
 */
export function rampIndex(
  rating: number, min: number, max: number, steps: number,
): number {
  if (steps <= 1) return 0;
  if (max === min) return steps - 1;
  const step = Math.round(((rating - min) / (max - min)) * (steps - 1));
  return Math.max(0, Math.min(steps - 1, step));
}

/** Ranking used wherever attention lists are sorted. Lower sorts first. */
export function attentionRank(status: string | null | undefined): number {
  if (status == null) return 0;          // never checked in — most urgent
  if (status === 'off_track') return 1;
  if (status === 'at_risk') return 2;
  return 3;
}

export function Bar({ pct, tone = 'accent' }: { pct: number; tone?: 'accent' | 'deep' }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div style={{
      height: 6, background: 'var(--color-neutral-200)',
      borderRadius: 3, overflow: 'hidden',
    }}>
      <div style={{
        height: '100%', width: `${width}%`,
        background: tone === 'deep' ? 'var(--color-accent-900)' : 'var(--color-accent)',
      }} />
    </div>
  );
}

export function Attainment({ pct }: { pct: string | number | null | undefined }) {
  if (pct == null || pct === '') {
    return <div style={{ fontSize: 12, opacity: 0.5 }}>Not yet measured</div>;
  }
  const value = Number(pct);
  return (
    <>
      <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>
        {value.toFixed(0)}% attained
      </div>
      <Bar pct={value} />
    </>
  );
}

/**
 * Empty states say what is true, and say nothing is wrong.
 *
 * The old dashboard showed an amber "must total 100%" on an account with no
 * goals — a warning about a rule the reader had not had the chance to break.
 */
export function EmptyState(
  { icon, title, children, action }:
  { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode },
) {
  return (
    <Card style={{
      alignItems: 'center', textAlign: 'center',
      padding: 'var(--space-8) var(--space-4)', gap: 'var(--space-3)',
    }}>
      {icon ?? <Icon path={paths.target} size={30} style={{ opacity: 0.5 }} />}
      <div className="card-title">{title}</div>
      {children && <p className="card-body" style={{ maxWidth: '40ch' }}>{children}</p>}
      {action}
    </Card>
  );
}

export function Dialog(
  { title, children, actions, onDismiss }:
  { title: string; children: ReactNode; actions: ReactNode; onDismiss: () => void },
) {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

/** Section heading with optional right-aligned controls. */
/**
 * The page heading. Every route renders one — a screen with no heading gives no
 * indication of where you are once the sidebar is collapsed or the page printed.
 *
 * `meta` sits beside the title (the cycle name, the goal's state); `children`
 * are actions and align right. Both slots existed as hand-rolled flex rows on
 * GoalDetail and ReviewForm before they were folded in here.
 */
export function PageHead(
  { title, meta, children }:
  { title: string; meta?: ReactNode; children?: ReactNode },
) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap',
    }}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      {meta}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>{children}</div>
    </div>
  );
}

export function Section({ children }: { children: ReactNode }) {
  return (
    <section style={{
      display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
    }}>
      {children}
    </section>
  );
}
