// @vitest-environment jsdom
/**
 * The PIP screen, laid out as the December 2025 form.
 *
 * The API is mocked and the page is real. What this guards is the seam between
 * them: the field names this screen reads and sends (`signableParties`,
 * `acknowledgements`, `kind`, `score`, `seriesNo` …) against the ones the
 * server returns and accepts. That seam is where two halves of a feature
 * quietly stop agreeing, and type-checking cannot see it: both sides compile
 * against their own idea of the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/auth', () => ({ api: vi.fn() }));

import { api } from '../src/auth';
import Pips from '../src/pages/Pips';

afterEach(cleanup);

const plan = (over: Record<string, unknown> = {}) => ({
  id: 'p1', employeeId: 'e-ricky', employeeName: 'Ricky Report',
  supervisorName: 'Mary Manager',
  reason: 'Missed ticket-turnaround targets in three consecutive weeks',
  expectedOutcome: 'Turnaround back inside target by the plan end date',
  startsOn: '2026-03-01', endsOn: '2026-06-01', reviewCadence: 'biweekly',
  state: 'active', outcome: null, outcomeNotes: null, acknowledgedAt: null,
  seriesNo: 'PIP-2026-014', evaluatedOn: '2026-02-27', latestEvaluationOn: '2026-01-31',
  evaluationPart1Score: 38.5, evaluationPart2Score: 17, evaluationOverallScore: 55.5,
  pefReference: 'PEF-2026-014', pipReference: null,
  recordOfInfractions: 'Two late arrivals logged in January',
  targetScore: 70, initialReviewOn: '2026-04-01', finalReviewOn: '2026-05-29',
  skillsToImprove: 'Turnaround time on support tickets',
  officerResponsibility: 'Weekly coaching and a shadowing assignment',
  additionalRemarks: null,
  acknowledgements: [
    { party: 'employee', by: 'Ricky Report', at: '2026-03-02T09:30:00.000Z' },
    { party: 'reporting_officer', by: 'Mary Manager', at: '2026-03-02T10:00:00.000Z' },
  ],
  signableParties: [],
  milestoneCount: 1, milestonesMet: 0, milestonesPending: 1,
  ...over,
});

/** A plan with none of the form's later sections filled in. */
const barePlan = () => plan({
  seriesNo: null, evaluatedOn: null, latestEvaluationOn: null,
  evaluationPart1Score: null, evaluationPart2Score: null, evaluationOverallScore: null,
  pefReference: null, recordOfInfractions: null, targetScore: null,
  initialReviewOn: null, finalReviewOn: null, skillsToImprove: null,
  officerResponsibility: null, expectedOutcome: null, acknowledgements: [],
});

let pips: unknown[];
let viewer: string;
let reviews: unknown[];
const calls: { path: string; method: string; body?: unknown }[] = [];

beforeEach(() => {
  pips = [plan()];
  viewer = 'e-mary';
  reviews = [];
  calls.length = 0;
  vi.mocked(api).mockImplementation(((path: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? 'GET';
    calls.push({ path, method, body: opts?.body });
    if (method === 'GET') {
      if (path === '/pips') return Promise.resolve(pips);
      if (path === '/employees/me') return Promise.resolve({ id: viewer });
      if (path === '/employees/me/reports') {
        return Promise.resolve([{ id: 'e-ricky', firstName: 'Ricky', lastName: 'Report' }]);
      }
      if (/\/milestones$/.test(path)) return Promise.resolve([]);
      if (/\/reviews$/.test(path)) return Promise.resolve(reviews);
    }
    return Promise.resolve({});
  }) as unknown as typeof api);
});

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Pips />
  </QueryClientProvider>,
);

/** Renders the page and opens the first plan. */
const open = async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Ricky Report' }));
};

const line = (label: RegExp) => screen.getByText(label).parentElement!.textContent;

describe('the plan list', () => {
  it('shows the series number and how many of the four have signed', async () => {
    show();
    expect(await screen.findByText(/PIP-2026-014/)).toBeTruthy();
    expect(screen.getByText('2 of 4 signed')).toBeTruthy();
  });

  it('says nothing about signatures once all four are in', async () => {
    pips = [plan({
      acknowledgements: ['employee', 'reporting_officer', 'department_head', 'hcm_representative']
        .map((party) => ({ party, by: 'Someone', at: '2026-03-02T09:30:00.000Z' })),
    })];
    show();
    await screen.findByRole('button', { name: 'Ricky Report' });
    expect(screen.queryByText(/of 4 signed/)).toBeNull();
  });

  it('states who can see a plan, including the department or area head', async () => {
    show();
    expect(await screen.findByText(/department\s+or area head over their unit/)).toBeTruthy();
  });
});

describe('a plan opened as the form lays it out', () => {
  it('shows each section the form carries', async () => {
    await open();
    for (const heading of ['Evaluation results', 'Area of concern', 'Improvement goals', 'Action plan']) {
      expect(screen.getByRole('heading', { name: heading }), heading).toBeTruthy();
    }
    expect(line(/Series no\./)).toBe('Series no.: PIP-2026-014');
    expect(line(/Overall score/)).toBe('Overall score: 55.5');
    expect(line(/PEF reference/)).toBe('PEF reference: PEF-2026-014');
    expect(line(/Record of infractions/)).toBe(
      'Record of infractions: Two late arrivals logged in January');
    expect(line(/Target score/)).toBe('Target score: 70');
    expect(line(/Officer's responsibility/)).toBe(
      "Officer's responsibility: Weekly coaching and a shadowing assignment");
  });

  it('calls the milestones what the form calls them', async () => {
    await open();
    expect(screen.getByRole('heading', { name: 'Actions to be taken, and when' })).toBeTruthy();
  });

  it('leaves out sections whose boxes were never filled in', async () => {
    // A plan raised before the form existed has none of these. Printing empty
    // headings for them would read as missing data.
    pips = [barePlan()];
    await open();
    expect(screen.getByRole('heading', { name: 'Area of concern' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Evaluation results' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Improvement goals' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Action plan' })).toBeNull();
  });

  it('shows a review as scheduled until it has been scored', async () => {
    await open();
    expect(line(/^Initial review:/)).toBe('Initial review: scheduled 2026-04-01');
    expect(line(/^Final review:/)).toBe('Final review: scheduled 2026-05-29');
  });

  it('shows the score once the review has been recorded', async () => {
    reviews = [{
      id: 'r1', reviewDate: '2026-04-02', progressSummary: 'Walked through progress',
      statusFlag: 'on_track', employeeComment: null, reviewedBy: 'Mary Manager',
      kind: 'initial', score: 62.5,
    }];
    await open();
    await waitFor(() =>
      expect(line(/^Initial review:/)).toBe('Initial review: scheduled 2026-04-01 · scored 62.5'));
    // And the review itself is marked as the initial one, with its score.
    expect(screen.getByText('initial review · 62.5')).toBeTruthy();
  });
});

describe('signing from the screen', () => {
  it('offers the supervisor the reporting-officer line, and sends that party', async () => {
    pips = [plan({ signableParties: ['reporting_officer'], acknowledgements: [] })];
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign as reporting officer' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/pips/p1/acknowledge');
    expect(post.body).toEqual({ party: 'reporting_officer' });
  });

  it('offers the employee their own line — the one that never used to work', async () => {
    viewer = 'e-ricky';
    pips = [plan({ signableParties: ['employee'], acknowledgements: [] })];
    await open();
    expect(await screen.findByRole('button', { name: 'Sign as employee' })).toBeTruthy();
    // The single "Acknowledge receipt" button it replaced is gone.
    expect(screen.queryByRole('button', { name: /Acknowledge receipt/ })).toBeNull();
  });

  it('offers nothing to somebody the server said may sign nothing', async () => {
    pips = [plan({ signableParties: [] })];
    await open();
    await screen.findByRole('heading', { name: 'Acknowledgement' });
    expect(screen.queryByRole('button', { name: /^Sign as/ })).toBeNull();
  });

  it('shows who signed each line', async () => {
    await open();
    expect(await screen.findByText('Ricky Report · 2026-03-02')).toBeTruthy();
    expect(screen.getByText('Mary Manager · 2026-03-02')).toBeTruthy();
  });
});

describe('recording a review', () => {
  const openReviewForm = async () => {
    await open();
    return screen.findByLabelText(/^Review date/);
  };

  it('asks for a score only on an initial or final review', async () => {
    await openReviewForm();
    expect(screen.queryByLabelText(/^Score/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Review/, { selector: 'select' }), {
      target: { value: 'final' },
    });
    expect(screen.getByLabelText(/^Score/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Review/, { selector: 'select' }), {
      target: { value: 'interim' },
    });
    expect(screen.queryByLabelText(/^Score/)).toBeNull();
  });

  it('sends the kind and the score', async () => {
    await openReviewForm();
    fireEvent.change(screen.getByLabelText(/^Review/, { selector: 'select' }), {
      target: { value: 'final' },
    });
    fireEvent.change(screen.getByLabelText(/^Score/), { target: { value: '66' } });
    fireEvent.change(screen.getByLabelText(/^Progress summary/), {
      target: { value: 'Final walk-through against the plan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record review' }));

    await waitFor(() => expect(calls.some((c) => c.path === '/pips/p1/reviews' && c.method === 'POST')).toBe(true));
    const body = calls.find((c) => c.path === '/pips/p1/reviews' && c.method === 'POST')!.body;
    expect(body).toMatchObject({ kind: 'final', score: 66 });
  });

  it('sends no score for an ordinary review', async () => {
    await openReviewForm();
    fireEvent.change(screen.getByLabelText(/^Progress summary/), {
      target: { value: 'Quick check-in this week' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record review' }));

    await waitFor(() => expect(calls.some((c) => c.path === '/pips/p1/reviews' && c.method === 'POST')).toBe(true));
    const body = JSON.parse(JSON.stringify(
      calls.find((c) => c.path === '/pips/p1/reviews' && c.method === 'POST')!.body));
    expect(body.kind).toBe('interim');
    expect(body).not.toHaveProperty('score');
  });
});

describe('raising a plan', () => {
  const fillRequired = async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New PIP' }));
    // The options arrive from the API after the form renders; choosing before they
    // exist selects nothing, and a required select left empty blocks the submit.
    await screen.findByRole('option', { name: 'Ricky Report' });
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e-ricky' } });
    fireEvent.change(screen.getByLabelText(/^Area of concern/), {
      target: { value: 'Missed ticket-turnaround targets in three consecutive weeks' },
    });
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Close five tickets a week' },
    });
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-04-15' } });
  };

  const submitted = () => {
    const call = calls.find((c) => c.path === '/pips' && c.method === 'POST');
    // What actually travels: undefined keys do not survive JSON.
    return call ? JSON.parse(JSON.stringify(call.body)) : null;
  };

  it('carries every section of the form', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New PIP' }));
    for (const label of [
      /^Area of concern/, /^Record of infraction/, /^Series no\./, /^Date of evaluation/,
      /^Date of latest evaluation/, /^PEF reference/, /^Score — part 1/, /^Score — part 2/,
      /^Overall score/, /^PIP reference/, /^Target score/, /^Initial review date/,
      /^Final review date/, /^Skills \/ behaviour to improve/, /^Officer's responsibility/,
      /^Expected outcome/, /^Additional remarks/,
    ]) {
      expect(screen.getByLabelText(label), String(label)).toBeTruthy();
    }
  });

  it('sends only the boxes that were filled in', async () => {
    // Absent on the form is absent in the record: a blank box must not become an
    // empty string, or a zero that reads as a real score.
    await fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Create as draft' }));

    await waitFor(() => expect(submitted()).not.toBeNull());
    const body = submitted();
    expect(body.employeeId).toBe('e-ricky');
    expect(body.milestones).toHaveLength(1);
    for (const key of ['seriesNo', 'targetScore', 'evaluationPart1Score', 'pefReference',
      'skillsToImprove', 'initialReviewOn']) {
      expect(body, key).not.toHaveProperty(key);
    }
  });

  it('sends what was typed, with the scores as numbers', async () => {
    await fillRequired();
    fireEvent.change(screen.getByLabelText(/^Series no\./), { target: { value: 'PIP-2026-099' } });
    fireEvent.change(screen.getByLabelText(/^Target score/), { target: { value: '70' } });
    fireEvent.change(screen.getByLabelText(/^Score — part 1/), { target: { value: '38.5' } });
    fireEvent.change(screen.getByLabelText(/^Initial review date/), { target: { value: '2026-04-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create as draft' }));

    await waitFor(() => expect(submitted()).not.toBeNull());
    expect(submitted()).toMatchObject({
      seriesNo: 'PIP-2026-099', targetScore: 70, evaluationPart1Score: 38.5,
      initialReviewOn: '2026-04-01',
    });
  });
});
