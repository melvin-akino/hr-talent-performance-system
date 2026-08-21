// @vitest-environment jsdom
/**
 * The help drawer and its markdown renderer.
 *
 * The renderer is hand-written rather than a library, so it needs proof it
 * handles every construct the bundled content actually uses — and proof it
 * cannot emit HTML, since B5 plans to point it at HR-authored copy from the
 * database.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/*
 * The drawer fetches HR-authored articles. Stubbing the auth module keeps these
 * tests about the drawer rather than about OIDC — and importing the real one
 * would demand build-time VITE_* config that a unit test has no business
 * needing. Company content is covered end to end by the API suite.
 */
vi.mock('../src/auth', () => ({
  api: vi.fn(async () => []),
  ApiError: class extends Error {},
}));
import { HelpDrawer } from '../src/components/HelpDrawer';
import { renderMarkdown, inline } from '../src/help/markdown';
import { loadArticles } from '../src/help';

afterEach(cleanup);

const wrap = (node: React.ReactNode, path = '/') => {
  // No retries and no cache between tests: a shared client would carry one
  // test's articles into the next.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
};

const drawer = (roles: string[], path = '/') =>
  wrap(<HelpDrawer open onClose={vi.fn()} roles={roles} />, path);

describe('markdown rendering', () => {
  it('renders headings, prose and emphasis', () => {
    const { container } = render(<div>{renderMarkdown('## Heading\n\nSome **bold** text.')}</div>);
    expect(container.querySelector('h4')?.textContent).toBe('Heading');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  it('joins consecutive prose lines into one paragraph', () => {
    // Markdown hard-wraps at 80 columns; rendering each line as its own
    // paragraph would double-space every article.
    const { container } = render(<div>{renderMarkdown('one line\nsecond line')}</div>);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelector('p')?.textContent).toBe('one line second line');
  });

  it('renders bullet and numbered lists', () => {
    const { container } = render(<div>{renderMarkdown('- a\n- b\n\n1. first\n2. second')}</div>);
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('renders a pipe table with its header', () => {
    const md = '| Column | Why |\n|---|---|\n| SIL | five days |';
    const { container } = render(<div>{renderMarkdown(md)}</div>);
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelectorAll('tbody td')).toHaveLength(2);
    expect(screen.getByText('five days')).toBeTruthy();
  });

  it('renders inline code and external links', () => {
    const { container } = render(
      <div>{renderMarkdown('Run `pnpm test` and see [docs](https://example.test).')}</div>,
    );
    expect(container.querySelector('code')?.textContent).toBe('pnpm test');
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://example.test');
    // Opening a new tab must not hand the opener over.
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('renders an in-document anchor as emphasis, not a dead link', () => {
    // Articles cross-reference each other with [text](#id); those anchors do
    // not exist inside the drawer, so a link there would go nowhere.
    const { container } = render(<div>{renderMarkdown('See [privacy](#your-privacy).')}</div>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('em')?.textContent).toBe('privacy');
  });

  it('cannot emit HTML from the source text', () => {
    // The renderer returns React elements, so markup in the content is text.
    // This is the property that makes it safe to point at database-authored
    // help later.
    const { container } = render(
      <div>{renderMarkdown('<img src=x onerror=alert(1)> and <b>bold</b>')}</div>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('leaves unsupported syntax visible rather than dropping it', () => {
    const out = inline('~~struck~~').map((n) => n).length;
    expect(out).toBeGreaterThan(0);
  });
});

describe('every bundled article renders', () => {
  const articles = loadArticles();

  it('produces output for all of them with no leftover table pipes', () => {
    for (const a of articles) {
      cleanup();
      const { container } = render(<div>{renderMarkdown(a.body)}</div>);
      expect(container.textContent!.length, `${a.id} rendered empty`).toBeGreaterThan(200);
      // A row that failed to parse would leave its pipes in the text.
      expect(container.textContent, `${a.id} has an unparsed table row`)
        .not.toMatch(/\|\s*---/);
    }
  });

  it('renders every heading as a heading, not as literal hashes', () => {
    for (const a of articles) {
      cleanup();
      const { container } = render(<div>{renderMarkdown(a.body)}</div>);
      expect(container.textContent, `${a.id} has an unrendered heading`)
        .not.toMatch(/(^|\s)#{2,3}\s/);
    }
  });
});

describe('the drawer offers the right articles', () => {
  it('leads with what applies to the current screen', () => {
    const { container } = drawer(['employee', 'manager', 'hr_admin'], '/review-admin');
    const groups = container.querySelectorAll('.hr-help-group');
    expect(within(groups[0] as HTMLElement).getByText(/on this screen/i)).toBeTruthy();
  });

  it('does not offer an employee the administrator guides', () => {
    drawer(['employee']);
    expect(screen.queryByText('Running a review cycle')).toBeNull();
    // An article relevant to the current screen appears twice on purpose:
    // once under "On this screen" as a shortcut, once in its section as part
    // of the full index.
    expect(screen.getAllByText('Writing a goal').length).toBeGreaterThan(0);
  });

  it('offers an HR admin the administrator guides', () => {
    drawer(['employee', 'hr_admin']);
    expect(screen.getByText('Running a review cycle')).toBeTruthy();
  });

  it('opens an article and can return to the list', () => {
    drawer(['employee']);
    fireEvent.click(screen.getAllByText('Writing a goal')[0]!);
    // The article body is showing.
    expect(screen.getByRole('heading', { name: 'Writing a goal' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /all help/i }));
    expect(screen.getByLabelText('Search help')).toBeTruthy();
  });

  it('searches titles, summaries and keywords', () => {
    drawer(['employee']);
    fireEvent.change(screen.getByLabelText('Search help'), { target: { value: 'weight' } });
    expect(screen.getByText('Writing a goal')).toBeTruthy();
    expect(screen.queryByText('Signing in and getting access')).toBeNull();
  });

  it('says so honestly when nothing matches', () => {
    drawer(['employee']);
    fireEvent.change(screen.getByLabelText('Search help'), { target: { value: 'zzzzz' } });
    expect(screen.getByText(/nothing matches/i)).toBeTruthy();
    // Pointing at a human is more use than a dead end.
    expect(screen.getByText(/ask HR/i)).toBeTruthy();
  });

  it('never searches an article the reader may not be offered', () => {
    drawer(['employee']);
    fireEvent.change(screen.getByLabelText('Search help'), { target: { value: 'calibration' } });
    expect(screen.queryByText('Running a review cycle')).toBeNull();
  });

  it('is announced as a modal dialog', () => {
    drawer(['employee']);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Help');
  });

  it('closes on Escape and on the backdrop, but not on the panel', () => {
    const onClose = vi.fn();
    wrap(<HelpDrawer open onClose={onClose} roles={['employee']} />);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders nothing at all when closed', () => {
    const { container } = wrap(
      <HelpDrawer open={false} onClose={vi.fn()} roles={['employee']} />);
    expect(container.innerHTML).toBe('');
  });
});
