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
