import type { ReactNode } from 'react';

/**
 * The few primitives that are not visual decisions.
 *
 * Everything that carries the look — cards, buttons, tags, stats, bars, status
 * badges — now lives in `ds.tsx`, built from the Industry tokens. This file used
 * to hold Tailwind-styled versions of all of those; they were deleted rather
 * than restyled once every screen had moved, because two component vocabularies
 * for the same job is how a redesign quietly half-reverts.
 */

export function Field({ label, hint, error, children }: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field" style={{ display: 'block' }}>
      <span>{label}</span>
      {children}
      {hint && !error && (
        <span className="text-muted" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
          {hint}
        </span>
      )}
      {/* A field error is stated in words, next to the field. The system has no
          error hue, and inventing one here would be the first crack in that. */}
      {error && (
        <span style={{ display: 'block', fontSize: 12, marginTop: 4, fontWeight: 600 }}>
          {error}
        </span>
      )}
    </label>
  );
}

/** The design system's input class, named so callers need not know it. */
export const inputClass = 'input';

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    // Bordered in the accent rather than tinted red — the palette has no red,
    // and an error is legible from its wording and position.
    <div role="alert" className="hr-note" style={{ borderColor: 'var(--color-accent)' }}>
      {message}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="text-muted" style={{ padding: 'var(--space-8) 0', textAlign: 'center' }}>
      {label}
    </p>
  );
}
