import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../auth';
import {
  articlesFor, articlesForRoute, fromCompany, loadArticles, type CompanyArticle,
} from '../help';
import type { HelpArticle } from '../help/schema';
import { SECTIONS } from '../help/schema';
import { renderMarkdown } from '../help/markdown';
import { Icon, Tag, paths } from './ds';
import type { TenantFeatures } from '../types';

/**
 * The help drawer.
 *
 * Three decisions, all from the brief's premise that this product is used
 * infrequently and reluctantly:
 *
 *   **It opens on what you are looking at.** Articles matching the current
 *   route come first, because someone opening help on the calibration table
 *   wants the calibration article, not a table of contents.
 *
 *   **It is filtered by role** — an employee is not offered the guide to
 *   running a review cycle. That is relevance, not secrecy: help describing a
 *   button you do not have is worse than no help.
 *
 *   **It is bundled, not fetched.** The office LAN has no internet and the API
 *   may be the thing that is broken; help that needs a working server is help
 *   that vanishes exactly when it is wanted.
 */

const ALL = loadArticles();

/**
 * A mark per section.
 *
 * Not decoration: the landing view is seven headings of similar length, and a
 * reader who has been here before is looking for the one they used last time.
 * A shape is found faster than a word is read, and it is the same shape every
 * time — which a label is not, because labels get rewritten.
 *
 * Inline, at the same stroke weight as the sidebar's, because nothing may be
 * fetched at runtime.
 */
const mark = (d: ReactNode) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const SECTION_ICONS: Record<string, ReactNode> = {
  basics: mark(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>),
  goals: mark(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>),
  reviews: mark(<><rect width="8" height="4" x="8" y="2" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>),
  growth: mark(<><path d="M7 20h10M12 20V8" /><path d="M12 8C12 5 9 3 6 4c0 3 3 5 6 4Z" /><path d="M12 10c0-3 3-5 6-4 0 3-3 5-6 4Z" /></>),
  managing: mark(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>),
  administering: mark(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>),
  reference: mark(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>),
};

const SECTION_LABELS: Record<string, string> = {
  basics: 'Getting started',
  goals: 'Goals and check-ins',
  reviews: 'Reviews',
  growth: 'Competencies and growth',
  managing: 'Managing a team',
  administering: 'Administering the system',
  reference: 'Reference',
};

function matches(article: HelpArticle, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [article.title, article.summary, article.body, ...article.keywords]
    .join(' ').toLowerCase()
    .includes(q);
}

export function HelpDrawer(
  { open, onClose, roles, features }: { open: boolean; onClose: () => void; roles: string[]; features?: TenantFeatures | undefined },
) {
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // HR-authored policy, merged with the bundled product help. A failure here is
  // deliberately silent: the drawer still opens with the product articles, which
  // is far better than help that refuses to load because the API is the thing
  // the reader is stuck on.
  const company = useQuery({
    queryKey: ['help-articles'],
    queryFn: () => api<CompanyArticle[]>('/help-articles'),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: open,
  });

  const available = useMemo(
    () => articlesFor([...ALL, ...fromCompany(company.data ?? [])], roles, features),
    [roles, features, company.data],
  );
  const contextual = useMemo(
    () => articlesForRoute(available, pathname), [available, pathname],
  );

  // Re-focus search and drop the previous screen's article each time it opens,
  // so the drawer always reflects where the reader is now.
  useEffect(() => {
    if (!open) return;
    setOpenId(null);
    setQuery('');
    searchRef.current?.focus();
  }, [open, pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const results = available.filter((a) => matches(a, query));
  const article = openId ? available.find((a) => a.id === openId) ?? null : null;
  const searching = query.trim() !== '';

  const list = (items: HelpArticle[]) => items.map((a) => (
    <button
      key={a.id}
      type="button"
      className="hr-help-item"
      onClick={() => setOpenId(a.id)}
    >
      <span style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
        {a.title}
        {a.origin === 'company' && <Tag tone="outline">company</Tag>}
      </span>
      <span className="text-muted" style={{ fontSize: 15 }}>{a.summary}</span>
    </button>
  ));

  return (
    <div className="hr-help-backdrop no-print" role="presentation"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="hr-help" role="dialog" aria-modal="true" aria-label="Help">
        <header className="hr-help-head">
          {article ? (
            <button type="button" className="btn btn-ghost" onClick={() => setOpenId(null)}>
              ← All help
            </button>
          ) : (
            <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>Help</strong>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close help">
            ✕
          </button>
        </header>

        {article ? (
          <div className="hr-help-body">
            <h3 style={{ marginTop: 0 }}>{article.title}</h3>
            {article.origin === 'company' && (
              <p className="hr-note" style={{ marginBottom: 'var(--space-3)' }}>
                Written by your HR team — this is company policy, not how the
                software behaves.
              </p>
            )}
            <p className="text-muted" style={{ fontSize: 15.5 }}>{article.summary}</p>
            {renderMarkdown(article.body)}
          </div>
        ) : (
          <div className="hr-help-body">
            <input
              ref={searchRef}
              className="input"
              type="search"
              placeholder="Search help"
              aria-label="Search help"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {searching ? (
              results.length === 0 ? (
                <p className="text-muted" style={{ marginTop: 'var(--space-4)' }}>
                  Nothing matches “{query.trim()}”. Try a different word, or ask HR —
                  not everything is written down yet.
                </p>
              ) : (
                <div className="hr-help-group">
                  <div className="card-kicker">{results.length} result(s)</div>
                  {list(results)}
                </div>
              )
            ) : (
              <>
                {contextual.length > 0 && (
                  <div className="hr-help-group">
                    <div className="card-kicker">
                      On this screen <Tag tone="accent">{contextual.length}</Tag>
                    </div>
                    {list(contextual)}
                  </div>
                )}

                {SECTIONS.map((section) => {
                  const items = available.filter((a) => a.section === section);
                  if (items.length === 0) return null;
                  return (
                    <div className="hr-help-group" key={section}>
                      <div className="card-kicker hr-help-sectionhead">
                        {SECTION_ICONS[section]}
                        {SECTION_LABELS[section] ?? section}
                      </div>
                      {list(items)}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/** The trigger, kept next to the drawer so the pair stays consistent. */
export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost" onClick={onClick}
            aria-label="Open help" title="Help">
      <Icon path={paths.help} size={16} />
      Help
    </button>
  );
}
