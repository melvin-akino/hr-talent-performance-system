/**
 * Validates the bundled help content.
 *
 * Help is read by someone who is already stuck. An article that never surfaces
 * because a route was mistyped, or that offers a manager instruction to an
 * employee who has no such button, fails at exactly the moment it was needed —
 * and nothing about it looks broken from the outside. So the contract is
 * checked here, where a mistake is a red build instead of a support ticket.
 */
import { describe, expect, it } from 'vitest';
import {
  articlesFor, articlesForRoute, loadArticles, parseFrontmatter, toArticle,
} from '../src/help';
import { APP_ROUTES, AUDIENCES, SECTIONS } from '../src/help/schema';
import { renderToStaticMarkup } from 'react-dom/server';
import { DIAGRAMS, DIAGRAM_IDS } from '../src/help/diagrams';

const articles = loadArticles();

describe('the content loads at all', () => {
  it('finds the bundled articles', () => {
    expect(articles.length).toBeGreaterThanOrEqual(14);
  });

  it('gives every article a body of real length', () => {
    for (const a of articles) {
      // A stub article is worse than a missing one: it occupies the slot where
      // the reader expected an answer.
      expect(a.body.length, `${a.id} is too short to be useful`).toBeGreaterThan(400);
    }
  });
});

describe('identifiers and metadata', () => {
  it('has unique ids', () => {
    const ids = articles.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses kebab-case ids, because they appear in deep links', () => {
    for (const a of articles) expect(a.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('has a one-sentence summary for every article', () => {
    for (const a of articles) {
      expect(a.summary.length, `${a.id} summary`).toBeGreaterThan(20);
      expect(a.summary.length, `${a.id} summary is too long for a list row`)
        .toBeLessThan(160);
    }
  });

  it('uses only known sections and audiences', () => {
    for (const a of articles) {
      expect(SECTIONS).toContain(a.section);
      for (const aud of a.audience) expect(AUDIENCES).toContain(aud);
    }
  });

  it('does not mix "everyone" with a specific role', () => {
    // Both would be contradictory: either the article is universal or it is not.
    for (const a of articles) {
      if (a.audience.includes('everyone')) expect(a.audience).toHaveLength(1);
    }
  });

  it('orders articles uniquely within a section', () => {
    const bySection = new Map<string, number[]>();
    for (const a of articles) {
      bySection.set(a.section, [...(bySection.get(a.section) ?? []), a.order]);
    }
    for (const [section, orders] of bySection) {
      expect(new Set(orders).size, `${section} has duplicate order values`)
        .toBe(orders.length);
    }
  });
});

describe('routes', () => {
  it('only references routes the application actually serves', () => {
    // A typo here means the article silently never appears in context.
    for (const a of articles) {
      for (const route of a.routes) {
        expect(APP_ROUTES, `${a.id} references unknown route ${route}`).toContain(route);
      }
    }
  });

  it('offers contextual help on the screens that most need it', () => {
    for (const path of ['/', '/reviews', '/team', '/pips', '/analytics', '/development']) {
      expect(articlesForRoute(articles, path).length,
        `no help offered on ${path}`).toBeGreaterThan(0);
    }
  });

  it('matches parameterised routes against real values', () => {
    const onGoal = articlesForRoute(articles, '/goals/8f14e45f').map((a) => a.id);
    expect(onGoal).toContain('check-ins');
  });

  it('does not match a route prefix against an unrelated path', () => {
    expect(articlesForRoute(articles, '/teams-archive').map((a) => a.id))
      .not.toContain('managing-goals');
  });

  it('treats "/" as the dashboard only, not as a prefix of everything', () => {
    const everywhere = articles.filter((a) => a.routes.includes('/'));
    const onPips = articlesForRoute(articles, '/pips');
    for (const a of everywhere) {
      if (!a.routes.some((r) => r !== '/' && r.startsWith('/pips'))) {
        expect(onPips.map((x) => x.id)).not.toContain(a.id);
      }
    }
  });
});

describe('audience filtering', () => {
  it('shows a plain employee the basics but not the admin guides', () => {
    const visible = articlesFor(articles, ['employee']).map((a) => a.id);

    expect(visible).toContain('writing-goals');
    expect(visible).toContain('your-review');
    expect(visible).toContain('your-privacy');

    // Not secrecy — an employee has no cycle to run and no such screen.
    expect(visible).not.toContain('running-a-cycle');
    expect(visible).not.toContain('managing-people');
    expect(visible).not.toContain('pips');
  });

  it('shows a manager the managing section', () => {
    const visible = articlesFor(articles, ['employee', 'manager']).map((a) => a.id);
    expect(visible).toContain('managing-goals');
    expect(visible).toContain('managing-reviews');
    expect(visible).toContain('pips');
    expect(visible).not.toContain('configuring-the-system');
  });

  it('shows an HR admin everything', () => {
    const visible = articlesFor(articles, ['employee', 'manager', 'hr_admin']);
    expect(visible).toHaveLength(articles.length);
  });

  it('leaves no role without content', () => {
    // Reachability, not tagging: universal articles are marked "everyone"
    // rather than listing every role, so what matters is that a holder of each
    // role is actually offered something.
    for (const role of AUDIENCES.filter((a) => a !== 'everyone')) {
      expect(articlesFor(articles, [role]).length,
        `nothing reaches ${role}`).toBeGreaterThan(0);
    }
  });

  it('gives each privileged role something beyond the universal articles', () => {
    const universal = articlesFor(articles, []).length;
    for (const role of ['manager', 'hr_admin'] as const) {
      expect(articlesFor(articles, [role]).length,
        `${role} sees only the general articles`).toBeGreaterThan(universal);
    }
  });
});

describe('content promises the product actually keeps', () => {
  const all = articles.map((a) => a.body).join('\n').toLowerCase();

  it('never tells anyone to enter statutory or personal data', () => {
    // D-009: these fields do not exist. Help that implies otherwise would send
    // people looking for a screen that cannot exist, and would misrepresent the
    // privacy guarantee the same help makes elsewhere.
    for (const phrase of [
      'enter your tin', 'enter your sss', 'upload your contract',
      'your salary is', 'add your address', 'enter your birthdate',
    ]) {
      expect(all, `help suggests entering forbidden data: "${phrase}"`)
        .not.toContain(phrase);
    }
  });

  it('states plainly what the system does not do', () => {
    const overview = articles.find((a) => a.id === 'what-this-is')!.body.toLowerCase();
    for (const term of ['payroll', 'timekeeping', 'leave']) {
      expect(overview).toContain(term);
    }
  });

  it('warns that a PIP is not legal due process', () => {
    // Getting this wrong exposes the customer to an illegal-dismissal claim,
    // so the warning must survive any future edit of that article.
    const pip = articles.find((a) => a.id === 'pips')!.body.toLowerCase();
    expect(pip).toContain('twin-notice');
    expect(pip).toContain('hr');
  });

  it('explains that sign-off cannot be undone wherever it is discussed', () => {
    for (const id of ['your-review', 'managing-reviews', 'running-a-cycle']) {
      const body = articles.find((a) => a.id === id)!.body.toLowerCase();
      expect(body, `${id} does not mention finality`).toMatch(/final|cannot be undone|irreversible/);
    }
  });
});

describe('frontmatter parsing', () => {
  it('rejects a file with no frontmatter', () => {
    expect(() => toArticle('# Just a heading', 'x.md')).toThrow(/missing frontmatter/);
  });

  it('rejects an unknown section', () => {
    expect(() => toArticle(
      ['---', 'id: x', 'title: X', 'summary: A summary long enough to pass',
       'section: nonsense', 'audience: [everyone]', 'routes: []', 'keywords: []',
       'order: 1', '---', 'Body.'].join('\n'), 'x.md'))
      .toThrow(/unknown section/);
  });

  it('rejects an unknown audience', () => {
    expect(() => toArticle(
      ['---', 'id: x', 'title: X', 'summary: A summary long enough to pass',
       'section: basics', 'audience: [wizard]', 'routes: []', 'keywords: []',
       'order: 1', '---', 'Body.'].join('\n'), 'x.md'))
      .toThrow(/unknown audience/);
  });

  it('rejects an empty body', () => {
    expect(() => toArticle(
      ['---', 'id: x', 'title: X', 'summary: A summary long enough to pass',
       'section: basics', 'audience: [everyone]', 'routes: []', 'keywords: []',
       'order: 1', '---', ''].join('\n'), 'x.md'))
      .toThrow(/no body/);
  });

  it('parses inline arrays and strips quotes', () => {
    const { fields } = parseFrontmatter(
      ['---', 'routes: ["/team", "/pips"]', 'keywords: []', '---', 'Body.'].join('\n'),
      'x.md');
    expect(fields.routes).toEqual(['/team', '/pips']);
    expect(fields.keywords).toEqual([]);
  });

  it('tolerates CRLF, because content gets edited on Windows', () => {
    const { fields, body } = parseFrontmatter(
      '---\r\nid: x\r\nroutes: []\r\n---\r\nBody text.', 'x.md');
    expect(fields.id).toBe('x');
    expect(body).toBe('Body text.');
  });
});

/**
 * The visual blocks.
 *
 * These fail the same way a mistyped route does — silently, and only for the
 * reader. A `:::diagram` naming a drawing that does not exist renders a
 * placeholder nobody reports, because a reader has no idea a picture was meant
 * to be there. So the names are checked here, against the registry itself,
 * which is the same discipline APP_ROUTES already applies to routes.
 */
describe('diagrams, steps and callouts', () => {
  const blocks = (body: string) =>
    // `\s` includes newlines, so `:::\s*(\w…)` happily matched the closing
    // fence and then the first word of the paragraph after it, and reported
    // ":::That" as an unknown block. The renderer is safe from this because it
    // matches line by line; this scan is not.
    [...body.matchAll(/^:::[^\S\r\n]*(\w[\w-]*)[^\S\r\n]*(.*)$/gm)]
      .map((m) => ({ kind: m[1]!, arg: (m[2] ?? '').trim() }));

  it('only names diagrams that exist', () => {
    for (const a of articles) {
      for (const b of blocks(a.body)) {
        if (b.kind !== 'diagram') continue;
        expect(DIAGRAM_IDS, `${a.id} draws unknown diagram "${b.arg}"`)
          .toContain(b.arg);
      }
    }
  });

  it('only uses block kinds the renderer understands', () => {
    const known = ['diagram', 'steps', 'note', 'tip', 'warning'];
    for (const a of articles) {
      for (const b of blocks(a.body)) {
        expect(known, `${a.id} uses unknown block ":::${b.kind}"`).toContain(b.kind);
      }
    }
  });

  it('closes every block it opens', () => {
    // An unclosed :::steps swallows the rest of the article. The renderer
    // reaches the end of the lines and stops, so the article simply ends early
    // — which looks like a short article, not like a bug.
    for (const a of articles) {
      const fences = a.body.split(/\r?\n/).filter((l) => l.trim().startsWith(':::'));
      const opens = fences.filter((l) => l.trim() !== ':::' && !/^:::\s*diagram/.test(l.trim()));
      const closes = fences.filter((l) => l.trim() === ':::');
      expect(closes.length, `${a.id} has ${opens.length} open blocks and ${closes.length} closers`)
        .toBe(opens.length);
    }
  });

  it('gives every step a title before its dash', () => {
    // The step number and the bold title are what a scanning reader lands on.
    // A step written as one long sentence renders as a numbered paragraph and
    // buys nothing over the list it replaced.
    for (const a of articles) {
      const lines = a.body.split(/\r?\n/);
      let inSteps = false;
      for (const line of lines) {
        if (/^:::\s*steps/.test(line.trim())) { inSteps = true; continue; }
        if (line.trim() === ':::') { inSteps = false; continue; }
        if (!inSteps || !/^[-*] /.test(line)) continue;
        const title = line.slice(2).split(' — ')[0]!;
        expect(title.length, `${a.id} has a step with no short title: ${line}`)
          .toBeLessThan(70);
      }
    }
  });

  it('renders every diagram without throwing', () => {
    // They are React elements built from a viewBox and a handful of numbers,
    // and a typo in one is not a type error.
    for (const id of DIAGRAM_IDS) {
      expect(() => renderToStaticMarkup(<>{DIAGRAMS[id]!()}</>), id).not.toThrow();
    }
  });

  it('gives every diagram a text alternative', () => {
    // The drawing is the point for a reader who learns visually. It must not be
    // the ONLY way to get the information: every figure carries both an
    // aria-label for a screen reader and a visible caption for anybody who
    // cannot parse the picture.
    for (const id of DIAGRAM_IDS) {
      const html = renderToStaticMarkup(<>{DIAGRAMS[id]!()}</>);
      expect(html, `${id} has no aria-label`).toContain('aria-label');
      expect(html, `${id} has no caption`).toContain('<figcaption');
    }
  });
});
