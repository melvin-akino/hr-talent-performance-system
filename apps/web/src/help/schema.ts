/**
 * The help content contract.
 *
 * Content is bundled with the application rather than stored in the database:
 * it is versioned with the code it describes, reviewed in pull requests, and
 * cannot drift into describing a screen that no longer exists. HR-authored,
 * company-specific policy is a separate concern and belongs in the database
 * (planned as B5) — the distinction is that this content describes *the
 * product*, and that content describes *your company*.
 *
 * Every article carries frontmatter. It is validated by a test rather than at
 * runtime, because a broken help article should fail the build, not surface to
 * an employee who is already confused enough to have opened the help.
 */

/** Roles as they exist in `app_role`. `everyone` means no role restriction. */
export const AUDIENCES = [
  'everyone', 'employee', 'manager', 'hr_admin', 'hr_partner',
] as const;
export type Audience = (typeof AUDIENCES)[number];

export const SECTIONS = [
  'basics', 'goals', 'reviews', 'growth', 'managing', 'administering', 'reference',
] as const;
export type Section = (typeof SECTIONS)[number];

export interface HelpArticle {
  /** Stable kebab-case identifier. Used in deep links, so it must not change. */
  id: string;
  title: string;
  /** One sentence, shown in search results and section listings. */
  summary: string;
  section: Section;
  /**
   * Who this is for. An article addressed to managers is not shown to someone
   * without the role — not because it is secret, but because the help must not
   * describe an action the reader cannot take and cannot see.
   */
  audience: Audience[];
  /**
   * Routes where this article is contextually relevant, matched as prefixes.
   * `/` matches only the dashboard, never everything.
   */
  routes: string[];
  /** Extra search terms not present in the body — synonyms and PH usage. */
  keywords: string[];
  /** Sort order within a section. */
  order: number;
  /** Markdown body, frontmatter stripped. */
  body: string;
  /**
   * Where the article came from.
   *
   * `product` ships with the code and describes how the system behaves.
   * `company` was written by HR and describes this organisation's policy.
   *
   * The distinction is shown to the reader, not hidden: "your self-review is due
   * 30 November" is a local rule that HR can change, while "weights must total
   * 100%" is how the software works. Presenting them identically would let a
   * reader mistake one for the other.
   */
  origin?: 'product' | 'company';
}

/**
 * Every route the SPA serves, as declared in App.tsx.
 *
 * Duplicated here on purpose: the validation test asserts that each article's
 * `routes` appear in this list, which turns a typo in frontmatter into a failing
 * build instead of help that never surfaces on the screen it was written for.
 * When a route is added to the app, add it here too.
 */
export const APP_ROUTES = [
  '/',
  '/goals/new',
  '/goals/:id',
  '/employees/:employeeId/goals',
  '/team',
  '/reviews',
  '/reviews/:id',
  '/review-admin',
  '/analytics',
  '/competencies',
  '/setup',
  '/feedback',
  '/development',
  '/notifications',
  '/monitoring',
  '/pips',
  '/hr',
  '/kpis',
] as const;
