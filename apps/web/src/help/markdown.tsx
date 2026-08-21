import { Fragment, type ReactNode } from 'react';

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
           && !/^(#{2,3} |[-*] |\d+\. |\|)/.test(lines[i]!)
           && !/^---+$/.test(lines[i]!.trim())) {
      para.push(lines[i]!.trim());
      i++;
    }
    if (para.length) push(<p>{inline(para.join(' '), `p${i}`)}</p>);
  }

  return out;
}
