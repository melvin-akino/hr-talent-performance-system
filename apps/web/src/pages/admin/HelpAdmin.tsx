import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { ErrorNote, Field, Spinner, inputClass } from '../../components/ui';
import { Btn, Card, EmptyState, Section, Tag } from '../../components/ds';
import { renderMarkdown } from '../../help/markdown';
import { AUDIENCES, SECTIONS } from '../../help/schema';

interface CompanyArticle {
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
  publishedAt: string | null;
  updatedAt: string;
}

const SECTION_LABELS: Record<string, string> = {
  basics: 'Getting started', goals: 'Goals and check-ins', reviews: 'Reviews',
  growth: 'Competencies and growth', managing: 'Managing a team',
  administering: 'Administering the system', reference: 'Reference',
};

/**
 * HR authoring for company-specific help.
 *
 * This is for policy — "our cycle opens in November", "escalate PIPs to your HR
 * business partner first" — not for documenting the product. Product help ships
 * with the code so it cannot drift out of step with behaviour; this exists so
 * local rules do not need a release.
 *
 * Everything is a draft until published, because HR writes policy over several
 * sittings and half a sentence should not be visible to the whole company in the
 * meantime.
 */
export default function HelpAdmin() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CompanyArticle | 'new' | null>(null);

  const articles = useQuery({
    queryKey: ['help-articles', 'all'],
    queryFn: () => api<CompanyArticle[]>('/help-articles/all'),
  });

  const publish = useMutation({
    mutationFn: (input: { id: string; published: boolean }) =>
      api(`/help-articles/${input.id}`, {
        method: 'PATCH', body: { published: input.published },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['help-articles'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/help-articles/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['help-articles'] }),
  });

  if (articles.isLoading) return <Spinner />;
  if (articles.error) return <ErrorNote error={articles.error} />;

  const rows = articles.data ?? [];

  if (editing) {
    return (
      <ArticleForm
        article={editing === 'new' ? null : editing}
        onDone={() => {
          setEditing(null);
          void qc.invalidateQueries({ queryKey: ['help-articles'] });
        }}
      />
    );
  }

  return (
    <Section>
      <Card
        kicker="Company help articles"
        actions={<Btn variant="primary" onClick={() => setEditing('new')}>New article</Btn>}
      >
        <p className="card-body">
          These appear in the help drawer alongside the built-in articles, labelled
          as company policy so nobody mistakes a local rule for how the software
          works.
        </p>

        {rows.length === 0 ? (
          <EmptyState title="No company articles yet">
            The built-in help explains how the system behaves. Add an article here
            when your organisation has a rule of its own — a timetable, an
            escalation path, a local rating scale.
          </EmptyState>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th><th>Section</th><th>Audience</th>
                  <th>Screens</th><th>State</th><th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{a.title}</div>
                      <div style={{ fontSize: 12, opacity: 0.65 }}>{a.summary}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>{SECTION_LABELS[a.section] ?? a.section}</td>
                    <td style={{ fontSize: 12 }}>{a.audience.join(', ')}</td>
                    <td style={{ fontSize: 12 }}>
                      {a.routes.length ? a.routes.join(', ') : <span style={{ opacity: 0.5 }}>—</span>}
                    </td>
                    <td>
                      {a.publishedAt
                        ? <Tag tone="accent">published</Tag>
                        : <Tag>draft</Tag>}
                    </td>
                    <td className="no-print" style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                        <Btn onClick={() => setEditing(a)}>Edit</Btn>
                        <Btn
                          disabled={publish.isPending}
                          onClick={() => publish.mutate({
                            id: a.id, published: !a.publishedAt,
                          })}
                        >
                          {a.publishedAt ? 'Unpublish' : 'Publish'}
                        </Btn>
                        <Btn
                          disabled={remove.isPending}
                          onClick={() => {
                            // Deleting help is low-stakes and reversible by
                            // rewriting, but it is still a surprise if misclicked.
                            if (window.confirm(`Delete “${a.title}”?`)) remove.mutate(a.id);
                          }}
                        >
                          Delete
                        </Btn>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorNote error={publish.error ?? remove.error} />
      </Card>
    </Section>
  );
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60) || 'article';

function ArticleForm({ article, onDone }: {
  article: CompanyArticle | null;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(article?.title ?? '');
  const [slug, setSlug] = useState(article?.slug ?? '');
  const [summary, setSummary] = useState(article?.summary ?? '');
  const [section, setSection] = useState(article?.section ?? 'reference');
  const [audience, setAudience] = useState<string[]>(article?.audience ?? ['everyone']);
  const [routes, setRoutes] = useState((article?.routes ?? []).join(', '));
  const [keywords, setKeywords] = useState((article?.keywords ?? []).join(', '));
  const [body, setBody] = useState(article?.body ?? '');
  const [preview, setPreview] = useState(false);

  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        slug: slug.trim() || slugify(title),
        title: title.trim(),
        summary: summary.trim(),
        section,
        audience,
        routes: list(routes),
        keywords: list(keywords),
        body,
      };
      return article
        ? api(`/help-articles/${article.id}`, { method: 'PATCH', body: payload })
        : api('/help-articles', { method: 'POST', body: payload });
    },
    onSuccess: onDone,
  });

  const toggleAudience = (value: string) => {
    setAudience((current) => {
      // "everyone" and a specific role are contradictory; picking one clears
      // the other rather than silently producing a nonsensical combination.
      if (value === 'everyone') return ['everyone'];
      const without = current.filter((a) => a !== 'everyone');
      return without.includes(value)
        ? (without.filter((a) => a !== value).length ? without.filter((a) => a !== value) : ['everyone'])
        : [...without, value];
    });
  };

  return (
    <Section>
      <Card kicker={article ? 'Edit article' : 'New article'}>
        <form
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 'var(--space-3)',
          }}
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
        >
          <Field label="Title">
            <input className={inputClass} required value={title}
                   placeholder="Our review timetable"
                   onChange={(e) => {
                     setTitle(e.target.value);
                     // Derive the slug while it is untouched, so most authors
                     // never have to think about it.
                     if (!article && !slug) return;
                   }} />
          </Field>

          <Field label="Identifier" hint="Used in links. Leave blank to derive it from the title.">
            <input className={inputClass} value={slug}
                   placeholder={slugify(title)}
                   onChange={(e) => setSlug(e.target.value)} />
          </Field>

          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="One-line summary" hint="Shown in the help list and in search results">
              <input className={inputClass} required value={summary} maxLength={200}
                     onChange={(e) => setSummary(e.target.value)} />
            </Field>
          </div>

          <Field label="Section" hint="Where it sits in the help index">
            <select className={inputClass} value={section}
                    onChange={(e) => setSection(e.target.value)}>
              {SECTIONS.map((s) => (
                <option key={s} value={s}>{SECTION_LABELS[s] ?? s}</option>
              ))}
            </select>
          </Field>

          <Field label="Screens" hint="Comma-separated paths, e.g. /reviews, /review-admin">
            <input className={inputClass} value={routes} placeholder="/reviews"
                   onChange={(e) => setRoutes(e.target.value)} />
          </Field>

          <Field label="Search terms" hint="Comma-separated words people might search for">
            <input className={inputClass} value={keywords} placeholder="timetable, deadline"
                   onChange={(e) => setKeywords(e.target.value)} />
          </Field>

          <div style={{ gridColumn: '1 / -1' }}>
            <span className="field"><span>Who sees it</span></span>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 4 }}>
              {AUDIENCES.map((a) => (
                <label key={a} className="seg-opt" style={{
                  border: '1px solid var(--color-divider)',
                  background: audience.includes(a) ? 'var(--color-accent-100)' : 'transparent',
                }}>
                  <input type="checkbox" checked={audience.includes(a)}
                         onChange={() => toggleAudience(a)} />
                  <span>{a.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              This decides who is offered the article. It is not a security
              control — help should never contain anything confidential.
            </p>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Article" hint="Markdown: ## headings, - lists, **bold**, tables">
              <textarea className={inputClass} rows={14} required value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder={'## When the cycle runs\n\nSelf-reviews are due by **30 November**.'} />
            </Field>
          </div>

          {preview && (
            <div style={{ gridColumn: '1 / -1' }}>
              <Card kicker="Preview">{renderMarkdown(body)}</Card>
            </div>
          )}

          <div style={{
            gridColumn: '1 / -1', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap',
          }}>
            <Btn type="submit" variant="primary" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : article ? 'Save changes' : 'Create draft'}
            </Btn>
            <Btn type="button" onClick={() => setPreview((v) => !v)}>
              {preview ? 'Hide preview' : 'Preview'}
            </Btn>
            <Btn type="button" onClick={onDone}>Cancel</Btn>
            <span className="text-muted" style={{ fontSize: 12, alignSelf: 'center' }}>
              Saving does not publish. Publish from the list when it is ready.
            </span>
          </div>

          {save.error ? (
            <div style={{ gridColumn: '1 / -1' }}><ErrorNote error={save.error} /></div>
          ) : null}
        </form>
      </Card>
    </Section>
  );
}
