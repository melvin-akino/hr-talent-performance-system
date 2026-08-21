/**
 * The redesign is only finished if it stays finished.
 *
 * Every screen moved from the old Tailwind grey vocabulary to the Industry
 * design system. Two things kept going wrong during that move and neither shows
 * up as a test failure or a type error — they only show up as a screen that
 * looks slightly wrong, which nobody notices for months:
 *
 *   1. A `text-slate-*` / `bg-slate-*` class left behind. It still renders, so
 *      it survives review, and the screen ends up half in one system and half
 *      in the other.
 *
 *   2. A conditional class expression whose branches were emptied out during a
 *      mechanical conversion, e.g. `selected ? '  ' : 'bg-white …'`. The code
 *      reads as if it styles a selected state; it renders identically either
 *      way, and the user cannot tell which item they picked.
 *
 * Both were real. This scans the source rather than the DOM because the point is
 * to catch them in files no test happens to render.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const files = sources(SRC).map((path) => ({
  path: path.slice(SRC.length + 1).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

/**
 * The ratchet, now empty — every screen has been converted.
 *
 * It stays as an empty array rather than being deleted, because it is the thing
 * that made the conversion finishable: a screen was allowed to be listed here,
 * never allowed to keep the classes silently. Nothing may be added back. The
 * helpers in `industry.css` (`t-muted`, `t-faint`, `panel-tint`, `bg-surface`,
 * `border-divider`, `input-sm`) exist precisely so nothing needs to be.
 */
const NOT_YET_CONVERTED: string[] = [];

const GREY = /(?:text|bg|border|ring|divide)-(?:slate|gray|zinc|stone)-\d|\bbg-white\b/;

describe('the old grey vocabulary is gone', () => {
  it('finds source files to scan at all', () => {
    // Without this the suite passes vacuously if the layout ever moves.
    expect(files.length).toBeGreaterThan(20);
  });

  it('uses no Tailwind grey colour classes outside the ratchet list', () => {
    const offenders = files
      .filter((f) => GREY.test(f.text))
      .map((f) => f.path)
      .filter((p) => !NOT_YET_CONVERTED.includes(p));
    expect(offenders).toEqual([]);
  });

  it('has no stale entries in the ratchet list', () => {
    // A converted screen left on the list makes the list lie about how much
    // work is left, and silently re-permits the classes if it regresses.
    const stale = NOT_YET_CONVERTED.filter((p) => {
      const file = files.find((f) => f.path === p);
      return !file || !GREY.test(file.text);
    });
    expect(stale).toEqual([]);
  });
});

describe('every route page has a heading', () => {
  /*
   * Only three of eighteen pages had one before this. The sidebar tells you where
   * you are only while it is visible — it collapses on mobile, and it does not
   * print at all, so an exported review or goal sheet had no title on it. A
   * screen whose first element is a card also gives a screen reader nothing to
   * navigate by.
   *
   * Top-level files in `src/pages` are exactly the route components; the tab
   * bodies under `src/pages/admin` render inside Setup and must NOT have their
   * own heading.
   */
  const routePages = files.filter((f) =>
    /^pages\/[^/]+\.tsx$/.test(f.path));

  it('finds the route pages', () => {
    expect(routePages.length).toBeGreaterThan(15);
  });

  it.each(routePages.map((f) => f.path))('%s renders a PageHead', (path) => {
    const file = routePages.find((f) => f.path === path)!;
    expect(file.text).toMatch(/<PageHead\b/);
  });

  it('does not put a second heading inside the Setup tabs', () => {
    const tabs = files.filter((f) => f.path.startsWith('pages/admin/'));
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.filter((f) => /<PageHead\b/.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});

describe('two states never render identically', () => {
  it('has no ternary whose string branches are blank or identical', () => {
    // Newlines allowed inside the match: every instance found in practice was a
    // ternary wrapped across three lines inside a template literal, which a
    // single-line pattern walked straight past.
    const ternary = /\?\s*'([^']*)'\s*:\s*'([^']*)'/g;
    const offenders: string[] = [];

    for (const f of files) {
      for (const [, a, b] of f.text.matchAll(ternary)) {
        // Deliberately empty on one side is fine and common: `x ? 'is-open' : ''`
        // means "no modifier". Both sides blank, or both the same, is not.
        if ((a ?? '').trim() === (b ?? '').trim()) {
          offenders.push(`${f.path}: '${a}' vs '${b}'`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('has no state lookup map whose entries all collapse to one value', () => {
    /*
     * The other shape this took, and the one that hid longest:
     *
     *     const STATE_STYLES: Record<string, string> = {
     *       not_started: 'panel-tint',
     *       in_progress: 'hr-note text-muted',
     *       submitted:   'hr-note text-muted',
     *       returned:    'hr-note text-muted',
     *     };
     *
     * Four named states, two appearances. It type-checks, it renders, and a
     * reviewer's eye slides over four lines that look different from each other
     * because the KEYS differ. Three feedback visibilities and three review
     * states shipped this way.
     *
     * A map with two or more entries that resolves to a single distinct value is
     * either a bug or a constant pretending to be a map.
     */
    const mapLiteral = /const\s+(\w+)\s*:\s*Record<[^>]*>\s*=\s*\{([^}]*)\}/g;
    const offenders: string[] = [];
    let inspected = 0;

    for (const f of files) {
      for (const [, name, body] of f.text.matchAll(mapLiteral)) {
        const values = [...(body ?? '').matchAll(/:\s*'([^']*)'/g)]
          .map((m) => (m[1] ?? '').trim());
        if (values.length < 2) continue;
        inspected += 1;
        if (new Set(values).size === 1) {
          offenders.push(`${f.path}: ${name} — ${values.length} keys, one value`);
        }
      }
    }

    // Without this the test passes by matching nothing at all — which is exactly
    // what would happen if the codebase moved to `satisfies` or a plain object
    // literal, and the regex quietly stopped finding maps.
    expect(inspected).toBeGreaterThan(3);
    expect(offenders).toEqual([]);
  });
});
