import { Fragment, type ReactNode } from 'react';
import { DIAGRAMS } from './diagrams';

/**
 * A markdown renderer for exactly the subset the bundled help uses.
 *
 * Deliberately not a library, and deliberately not `dangerouslySetInnerHTML`:
 * it returns React elements, so there is no HTML-injection surface at all. The
 * content is compile-time and reviewed, but a renderer that can emit arbitrary
 * HTML is the kind of thing that later gets pointed at HR-authored copy from
 * the database (planned as B5) and quietly becomes a problem.
 *
 * Supported, because that is what the content contains: `##`/`###` headings,
 * paragraphs, `-` and `1.` lists, pipe tables, `---` rules, and inline
 * `**bold**`, `` `code` `` and `[links](…)`.
 *
 * Anything unsupported renders as literal text rather than disappearing —
 * visible wrong beats silently missing, and the content test catches it.
 *
 * THREE VISUAL BLOCKS, ADDED BECAUSE PROSE WAS DOING WORK IT IS BAD AT.
 *
 *   `:::diagram goal-lifecycle`  — a named drawing from ./diagrams.
 *   `:::steps` … `:::`           — a numbered sequence rendered as a strip.
 *   `:::note|tip|warning` … `:::` — a callout.
 *
 * They are markers in the markdown rather than HTML, for the same reason this
 * renderer returns elements rather than setting innerHTML: the day this is
 * pointed at HR-authored content from the database, nothing in the content can
 * become markup. An unknown diagram name or callout kind renders as a visible
 * placeholder AND fails the content test — silently missing is the failure
 * mode worth engineering against, because nobody reports a picture they never
 * knew was meant to be there.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

/** Bold, inline code and links inside a line of prose. */
export function inline(text: string, keyPrefix = ''): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;

    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} style={{
          fontSize: '0.9em',
          background: 'color-mix(in srgb, var(--color-text) 7%, transparent)',
          padding: '1px 4px',
        }}>
          {part.slice(1, -1)}
        </code>
      );
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      // In-document anchors point at other articles; they are not navigable
      // from the drawer, so they render as plain emphasis rather than a link
      // that goes nowhere.
      if (href!.startsWith('#')) return <em key={key}>{label}</em>;
      return (
        <a key={key} href={href} target="_blank" rel="noreferrer noopener">{label}</a>
      );
    }

    return <Fragment key={key}>{part}</Fragment>;
  });
}

function tableRow(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

const isTableDivider = (line: string) => /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

export function renderMarkdown(body: string): ReactNode[] {
  const lines = body.split(/\r?\n/);
  const out: ReactNode[] = [];
  let i = 0;

  const push = (node: ReactNode) => out.push(<Fragment key={out.length}>{node}</Fragment>);

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') { i++; continue; }

    if (line.startsWith('### ')) {
      push(<h5 style={{ marginTop: 'var(--space-4)' }}>{inline(line.slice(4), `h${i}`)}</h5>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      push(<h4 style={{ marginTop: 'var(--space-6)' }}>{inline(line.slice(3), `h${i}`)}</h4>);
      i++; continue;
    }

    if (/^---+$/.test(line.trim())) {
      push(<hr className="hr" />);
      i++; continue;
    }

    // ::: blocks. Matched before everything else that starts a line, because a
    // ':::' left unclosed would otherwise be swallowed into a paragraph and
    // the block would vanish.
    const fence = /^:::\s*(\w[\w-]*)\s*(.*)$/.exec(line.trim());
    if (fence) {
      const [, kind, arg] = fence;

      if (kind === 'diagram') {
        const name = arg!.trim();
        const draw = DIAGRAMS[name];
        push(draw
          ? draw()
          // Visible, not blank. A diagram that silently does not render is one
          // nobody reports, because the reader has no idea it was meant to be
          // there.
          : <p className="hr-help-missing">[missing diagram: {name}]</p>);
        i++; continue;
      }

      const inner: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== ':::') { inner.push(lines[i]!); i++; }
      i++; // the closing fence

      if (kind === 'steps') {
        // Each step is "Title — the rest", split on the first em dash. The
        // title is what the eye lands on when scanning, which is the whole
        // reason this is not a numbered list.
        const steps = inner
          .filter((l) => /^[-*] /.test(l))
          .map((l) => {
            const text = l.slice(2);
            const at = text.indexOf(' — ');
            return at === -1
              ? { title: text, detail: '' }
              : { title: text.slice(0, at), detail: text.slice(at + 3) };
          });
        push(
          <ol className="hr-help-steps">
            {steps.map((s, n) => (
              <li key={n}>
                <span className="hr-help-step-no" aria-hidden="true">{n + 1}</span>
                <span>
                  <strong>{inline(s.title, `st${n}`)}</strong>
                  {/* The dash is put back. Dropping it ran the title into the
                      detail — "You raise it choosing the type" — which reads
                      as a typo rather than as two parts of a step. */}
                  {s.detail && (
                    <span className="text-muted"> — {inline(s.detail, `sd${n}`)}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>,
        );
        continue;
      }

      if (kind === 'note' || kind === 'tip' || kind === 'warning') {
        push(
          <aside className={`hr-help-callout is-${kind}`}>
            <span className="hr-help-callout-kind">{kind}</span>
            <div>{renderMarkdown(inner.join('\n'))}</div>
          </aside>,
        );
        continue;
      }

      push(<p className="hr-help-missing">[unknown block: {kind}]</p>);
      continue;
    }

    // Table: a header row followed by a divider.
    if (line.startsWith('|') && isTableDivider(lines[i + 1] ?? '')) {
      const head = tableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) {
        rows.push(tableRow(lines[i]!));
        i++;
      }
      push(
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>{head.map((c, n) => <th key={n}>{inline(c, `th${n}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n}>{r.map((c, m) => <td key={m}>{inline(c, `td${n}-${m}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i]!)) {
        items.push(lines[i]!.slice(2));
        i++;
      }
      push(
        <ul style={{ margin: '0 0 var(--space-3)', paddingLeft: 18 }}>
          {items.map((t, n) => <li key={n}>{inline(t, `li${n}`)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+\.\s/, ''));
        i++;
      }
      push(
        <ol style={{ margin: '0 0 var(--space-3)', paddingLeft: 18 }}>
          {items.map((t, n) => <li key={n}>{inline(t, `ol${n}`)}</li>)}
        </ol>,
      );
      continue;
    }

    // Paragraph: consecutive prose lines joined, as markdown does.
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== ''
           && !/^(#{2,3} |[-*] |\d+\. |\||:::)/.test(lines[i]!)
           && !/^---+$/.test(lines[i]!.trim())) {
      para.push(lines[i]!.trim());
      i++;
    }
    if (para.length) push(<p>{inline(para.join(' '), `p${i}`)}</p>);
  }

  return out;
}
