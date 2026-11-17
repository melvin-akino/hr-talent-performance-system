/**
 * Loads the bundled help articles.
 *
 * Content lives as markdown beside the code it describes and is compiled in at
 * build time, so there is no runtime fetch, no database dependency, and no way
 * for the office network being down to take the help with it.
 *
 * The frontmatter parser handles the small subset this content uses — scalars
 * and inline arrays — rather than pulling in a YAML dependency for eight keys.
 * Anything it cannot parse is a validation failure, not a silent default: see
 * test/help-content.spec.ts.
 */
import {
  AUDIENCES, FEATURE_KEYS, SECTIONS,
  type Audience, type FeatureKey, type HelpArticle, type Section,
} from './schema';
import type { TenantFeatures } from '../types';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

interface RawFields { [key: string]: string | string[] }

export function parseFrontmatter(source: string, file: string): {
  fields: RawFields; body: string;
} {
  const match = FRONTMATTER.exec(source);
  if (!match) throw new Error(`${file}: missing frontmatter block`);

  const fields: RawFields = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const at = line.indexOf(':');
    if (at === -1) throw new Error(`${file}: cannot parse frontmatter line "${line}"`);

    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      fields[key] = inner === ''
        ? []
        : inner.split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''));
    } else {
      fields[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  return { fields, body: source.slice(match[0].length).trim() };
}

function str(fields: RawFields, key: string, file: string): string {
  const value = fields[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${file}: "${key}" must be a non-empty string`);
  }
  return value;
}

function list(fields: RawFields, key: string, file: string): string[] {
  const value = fields[key];
  if (!Array.isArray(value)) throw new Error(`${file}: "${key}" must be a list`);
  return value;
}

export function toArticle(source: string, file: string): HelpArticle {
  const { fields, body } = parseFrontmatter(source, file);

  const section = str(fields, 'section', file);
  if (!(SECTIONS as readonly string[]).includes(section)) {
    throw new Error(`${file}: unknown section "${section}"`);
  }

  const audience = list(fields, 'audience', file);
  for (const a of audience) {
    if (!(AUDIENCES as readonly string[]).includes(a)) {
      throw new Error(`${file}: unknown audience "${a}"`);
    }
  }

  let features: FeatureKey[] | undefined;
  if (fields['features'] !== undefined) {
    const rawFeatures = list(fields, 'features', file);
    for (const f of rawFeatures) {
      if (!(FEATURE_KEYS as readonly string[]).includes(f)) {
        throw new Error(`${file}: unknown feature "${f}"`);
      }
    }
    features = rawFeatures as FeatureKey[];
  }

  const order = Number(str(fields, 'order', file));
  if (!Number.isFinite(order)) throw new Error(`${file}: "order" must be a number`);

  if (body === '') throw new Error(`${file}: article has no body`);

  return {
    id: str(fields, 'id', file),
    title: str(fields, 'title', file),
    summary: str(fields, 'summary', file),
    section: section as Section,
    audience: audience as Audience[],
    routes: list(fields, 'routes', file),
    keywords: list(fields, 'keywords', file),
    order,
    ...(features ? { features } : {}),
    body,
    origin: 'product',
  };
}

/** Shape returned by GET /help-articles, mapped onto the bundled contract. */
export interface CompanyArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  section: string;
  audience: string[];
  routes: string[];
  keywords: string[];
  sortOrder: number;
  body: string;
}

/**
 * Turns HR-authored rows into the same shape as the bundled articles.
 *
 * Company articles sort after product ones within a section by default: the
 * product explanation is usually the context a local rule sits inside. HR can
 * override that with sortOrder.
 */
export function fromCompany(rows: CompanyArticle[]): HelpArticle[] {
  return rows.map((r) => ({
    id: `company-${r.slug}`,
    title: r.title,
    summary: r.summary,
    section: (SECTIONS as readonly string[]).includes(r.section)
      ? (r.section as Section)
      : 'reference',
    audience: r.audience.filter(
      (a): a is Audience => (AUDIENCES as readonly string[]).includes(a),
    ),
    routes: r.routes,
    keywords: r.keywords,
    order: 1000 + r.sortOrder,
    body: r.body,
    origin: 'company',
  }));
}

/** Every bundled article, sorted by section then order. */
export function loadArticles(): HelpArticle[] {
  const files = import.meta.glob('./content/*.md', {
    eager: true, query: '?raw', import: 'default',
  }) as Record<string, string>;

  return Object.entries(files)
    .map(([path, source]) => toArticle(source, path))
    .sort((a, b) =>
      SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.order - b.order);
}

/**
 * Maps a route prefix to the feature flags that enable it, so HR-authored
 * company articles (which do not store explicit feature flags in the DB) are
 * also hidden when the module they document is turned off.
 */
function routeRequiredFeatures(route: string): FeatureKey[] | null {
  if (route === '/home' || route.startsWith('/goals') || route.endsWith('/goals') ||
      route === '/monitoring' || route === '/unit' || route === '/hr' || route === '/evaluations') {
    return ['feature_performance', 'feature_kpis'];
  }
  if (route === '/kpis' || route === '/metrics') {
    return ['feature_kpis'];
  }
  if (route.startsWith('/reviews') || route === '/review-admin') {
    return ['feature_performance'];
  }
  if (route === '/competencies' || route === '/pips') {
    return ['feature_competencies_pip'];
  }
  if (route === '/development') {
    return ['feature_competencies_pip', 'feature_performance'];
  }
  if (route === '/feedback') {
    return ['feature_peer_reviews'];
  }
  if (route === '/analytics' || route === '/requests') {
    return ['feature_performance', 'feature_kpis', 'feature_peer_reviews', 'feature_competencies_pip'];
  }
  if (route === '/attendance' || route === '/kiosk') {
    return ['feature_time_attendance'];
  }
  if (route === '/leaves') {
    return ['feature_leave_management'];
  }
  if (route === '/payroll' || route === '/my-payslips') {
    return ['feature_ph_payroll'];
  }
  return null;
}

function isArticleEnabledForFeatures(article: HelpArticle, features?: TenantFeatures): boolean {
  if (!features) return true;
  if (article.features && article.features.length > 0) {
    return article.features.some((f) => !!features[f]);
  }
  // For company articles without explicit `features`, infer from routes if all
  // routes belong to feature-gated modules.
  if (article.origin === 'company' && article.routes.length > 0) {
    const reqs = article.routes.map(routeRequiredFeatures);
    if (reqs.every((r) => r !== null)) {
      return reqs.some((r) => r!.some((f) => !!features[f]));
    }
  }
  return true;
}

/**
 * Articles a holder of these roles (and tenant features) should be offered.
 *
 * Filtering is about relevance, not secrecy — help that describes an action the
 * reader cannot perform, on a screen they cannot open, is worse than no help.
 */
export function articlesFor(
  articles: HelpArticle[],
  roles: string[],
  features?: TenantFeatures,
): HelpArticle[] {
  return articles.filter((a) =>
    (a.audience.includes('everyone') || a.audience.some((r) => roles.includes(r))) &&
    isArticleEnabledForFeatures(a, features));
}

/** Articles relevant to a route, most specific match first. */
export function articlesForRoute(articles: HelpArticle[], path: string): HelpArticle[] {
  const matches = (route: string): boolean => {
    if (route === '/') return path === '/';
    // Compare segment by segment so ":id" placeholders match a real value and
    // "/goals" never matches "/goals-archive".
    const r = route.split('/').filter(Boolean);
    const p = path.split('/').filter(Boolean);
    if (p.length < r.length) return false;
    return r.every((seg, i) => seg.startsWith(':') || seg === p[i]);
  };

  return articles
    .filter((a) => a.routes.some(matches))
    .sort((a, b) => b.routes.join('').length - a.routes.join('').length);
}

export { type HelpArticle } from './schema';
