import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import type {
  BatchOpenRow, EvaluationDetail, EvaluationOpenOutcome, EvaluationState,
  EvaluationSummary, TaskNature,
} from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import { Btn, Card, EmptyState, PageHead, Stat, Tag } from '../components/ds';

/**
 * Scoring people against the scorecards they were loaded onto.
 *
 * The second half of the client's request. An evaluation snapshots its lines
 * when it is opened, so this screen is editing a frozen copy — a scorecard
 * corrected next month will not move a total already given here.
 *
 * Two states this UI takes care to keep apart:
 *
 *   - a line not yet assessed, versus a line assessed at zero. The first is
 *     unfinished work, the second is a judgement. The count of the former is
 *     what an evaluator is actually tracking, so it is shown rather than the
 *     percentage complete.
 *   - a draft, which the subject cannot see at all, versus a submitted
 *     evaluation, which they can. The banner says which, because an evaluator
 *     needs to know when their notes stop being private.
 */

const NATURE_LABEL: Record<TaskNature, string> = {
  administrative: 'Administrative',
  field: 'Field',
  technical: 'Technical',
};

const points = (v: string | number | null) => {
  if (v === null) return '—';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

function EvaluationStateTag({ state }: { state: EvaluationState }) {
  switch (state) {
    case 'draft': return <Tag tone="outline">Draft — private</Tag>;
    case 'submitted': return <Tag tone="solid">Submitted</Tag>;
    case 'acknowledged': return <Tag tone="accent">Acknowledged</Tag>;
    default: return <Tag>{state}</Tag>;
  }
}

/** Why a person in a batch did or did not get an evaluation, in plain words. */
const OUTCOME_LABEL: Record<EvaluationOpenOutcome, string> = {
  opened: 'Opened',
  already_open: 'Already open',
  // The common one during the load, and not a failure — but it is the number
  // that says the load is unfinished, so it is never hidden.
  no_scorecard: 'On no scorecard',
  empty_scorecard: 'Scorecard has no tasks yet',
  not_permitted: 'Not yours to evaluate',
};

function currentQuarter(): { start: string; end: string } {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    start: iso(new Date(Date.UTC(now.getFullYear(), q * 3, 1))),
    end: iso(new Date(Date.UTC(now.getFullYear(), q * 3 + 3, 0))),
  };
}

export default function Evaluations() {
  const [open, setOpen] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);

  const list = useQuery({
    queryKey: ['evaluations'],
    queryFn: () => api<EvaluationSummary[]>('/evaluations'),
  });

  if (list.isLoading) return <Spinner />;
  if (list.error) return <ErrorNote error={list.error} />;

  const rows = list.data ?? [];
  const drafts = rows.filter((r) => r.state === 'draft');
  const outstanding = drafts.reduce((sum, r) => sum + r.unassessed, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PageHead title="Evaluations">
        <Btn variant={batchOpen ? 'ghost' : 'primary'}
             onClick={() => setBatchOpen(!batchOpen)}>
          {batchOpen ? 'Cancel' : 'Open a period for a section'}
        </Btn>
      </PageHead>

      {batchOpen && <BatchPanel onDone={() => setBatchOpen(false)} />}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 'var(--space-3)',
      }}>
        <Stat kicker="Evaluations" value={String(rows.length)} />
        <Stat kicker="Still in draft" value={String(drafts.length)} />
        {/* Lines, not evaluations: the unit of work left to do. */}
        <Stat kicker="Lines to assess" value={String(outstanding)} />
      </div>

      <Card kicker="Evaluations">
        {rows.length === 0 ? (
          <EmptyState title="Nothing evaluated yet">
            An evaluation scores somebody against the scorecard they hold, over a
            period you choose. Open one from a person&rsquo;s scorecard.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Scorecard</th>
                  <th>Period</th>
                  <th>State</th>
                  <th className="text-right">Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.employeeName}</td>
                    <td className="text-xs t-muted">{r.scorecardName}</td>
                    <td className="text-xs t-muted tabular-nums">
                      {r.periodStart} – {r.periodEnd}
                    </td>
                    <td>
                      <EvaluationStateTag state={r.state} />
                      {r.state === 'draft' && r.unassessed > 0 && (
                        <span className="text-xs t-faint" style={{ marginLeft: 6 }}>
                          {r.unassessed} left
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {r.awardedPoints === null
                        ? <span className="t-faint">—</span>
                        : `${points(r.awardedPoints)} / ${points(r.targetPoints)}`}
                    </td>
                    <td className="text-right no-print">
                      <Btn variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? 'Hide' : 'Open'}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && <EvaluationPanel id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function EvaluationPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});

  const detail = useQuery({
    queryKey: ['evaluation', id],
    queryFn: () => api<EvaluationDetail>(`/evaluations/${id}`),
  });

  const refresh = () => {
    setEdits({});
    void qc.invalidateQueries({ queryKey: ['evaluation', id] });
    void qc.invalidateQueries({ queryKey: ['evaluations'] });
  };

  const save = useMutation({
    mutationFn: (lines: Record<string, { pointsAwarded: number | null }>) =>
      api(`/evaluations/${id}/scores`, { method: 'POST', body: { lines } }),
    onSuccess: refresh,
  });

  const submit = useMutation({
    mutationFn: () => api(`/evaluations/${id}/submit`, { method: 'POST' }),
    onSuccess: refresh,
  });

  if (detail.isLoading) return <Spinner />;
  if (detail.error) return <ErrorNote error={detail.error} />;
  const d = detail.data;
  if (!d) return null;

  const isDraft = d.state === 'draft';
  const unassessed = d.lines.filter(
    (l) => (edits[l.id] ?? l.pointsAwarded) === null
      || (edits[l.id] ?? l.pointsAwarded) === '').length;

  // The running total counts unsaved edits, so an evaluator can see where a
  // score is heading before committing to it.
  const running = d.lines.reduce((sum, l) => {
    const raw = edits[l.id] ?? l.pointsAwarded;
    const n = raw === null || raw === '' ? 0 : Number(raw);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const dirty = Object.keys(edits).length > 0;

  return (
    <Card
      kicker={`${d.employeeName} — ${d.scorecardName}`}
      actions={
        <>
          {isDraft && dirty && (
            <Btn
              variant="secondary"
              disabled={save.isPending}
              onClick={() => save.mutate(Object.fromEntries(
                Object.entries(edits).map(([lineId, v]) => [
                  lineId, { pointsAwarded: v === '' ? null : Number(v) },
                ])))}
            >
              Save scores
            </Btn>
          )}
          {isDraft && (
            <Btn
              variant="primary"
              disabled={unassessed > 0 || dirty || submit.isPending}
              onClick={() => submit.mutate()}
            >
              Submit
            </Btn>
          )}
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
        </>
      }
    >
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column',
                                          gap: 'var(--space-4)' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 'var(--space-3)',
        }}>
          <Stat
            kicker={isDraft ? 'Running total' : 'Score'}
            value={`${points(isDraft ? running : d.awardedPoints)} / ${points(d.targetPoints)}`}
            tag={<EvaluationStateTag state={d.state} />}
          />
          <Stat kicker="Period" value={<span className="text-xs tabular-nums">
            {d.periodStart} – {d.periodEnd}
          </span>} />
          <Stat kicker="Evaluator" value={<span className="text-xs">{d.evaluatorName}</span>} />
        </div>

        <p className="text-xs t-muted" style={{ margin: 0 }}>
          {isDraft
            ? `This is a draft. ${d.employeeName} cannot see it, or anything written `
              + 'here, until it is submitted — after which the scores are fixed.'
            : `Submitted. ${d.employeeName} can read this, and the scores are fixed; `
              + 'a correction has to be a new evaluation so the change stays visible.'}
        </p>

        {save.error ? <ErrorNote error={save.error} /> : null}
        {submit.error ? <ErrorNote error={submit.error} /> : null}

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '2.5rem' }} className="text-right">#</th>
                <th>Task</th>
                <th>Nature</th>
                <th>How it is counted</th>
                <th className="text-right">Available</th>
                <th className="text-right" style={{ width: '7rem' }}>Earned</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => {
                const value = edits[l.id] ?? (l.pointsAwarded ?? '');
                return (
                  <tr key={l.id}>
                    <td className="text-right tabular-nums text-xs t-faint">{l.sequence}</td>
                    <td>{l.indicatorName}</td>
                    <td className="text-xs t-muted">{NATURE_LABEL[l.nature]}</td>
                    <td className="text-xs t-muted">{l.criteria ?? '—'}</td>
                    <td className="text-right tabular-nums">{points(l.pointsAvailable)}</td>
                    <td className="text-right">
                      {isDraft ? (
                        <input
                          className="input tabular-nums"
                          style={{ textAlign: 'right', maxWidth: '5.5rem' }}
                          type="number"
                          min={0}
                          max={Number(l.pointsAvailable)}
                          step="0.5"
                          value={value}
                          // An empty box means unassessed and is left empty --
                          // defaulting it to 0 would quietly turn unfinished
                          // work into a judgement of nothing earned.
                          placeholder="—"
                          onChange={(e) => setEdits(
                            { ...edits, [l.id]: e.target.value })}
                        />
                      ) : (
                        <span className="tabular-nums">{points(l.pointsAwarded)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right text-xs t-muted">
                  {isDraft && unassessed > 0
                    ? `${unassessed} line${unassessed === 1 ? '' : 's'} still to assess`
                    : 'Total'}
                </td>
                <td className="text-right tabular-nums">{points(d.targetPoints)}</td>
                <td className="text-right tabular-nums">
                  {points(isDraft ? running : d.awardedPoints)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Card>
  );
}

/**
 * Opening a period for a whole section.
 *
 * The dry run is not optional. Twenty evaluations is twenty rows of consequence,
 * and the outcome that matters most is not an error — it is a person skipped for
 * having no scorecard, which looks like nothing at all until the incentive run.
 * So the preview runs first, every person in scope is listed with a reason, and
 * only then is there something to confirm.
 */
function BatchPanel({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [departmentId, setDepartmentId] = useState('');
  const [period, setPeriod] = useState(currentQuarter);
  const [preview, setPreview] = useState<BatchOpenRow[] | null>(null);

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api<{ id: string; name: string; isCurrent: boolean }[]>('/departments'),
  });

  const body = () => ({
    departmentId,
    periodStart: period.start,
    periodEnd: period.end,
  });

  const dryRun = useMutation({
    mutationFn: () =>
      api<BatchOpenRow[]>('/evaluations/department-preview', {
        method: 'POST', body: body(),
      }),
    onSuccess: setPreview,
  });

  const run = useMutation({
    mutationFn: () =>
      api<BatchOpenRow[]>('/evaluations/department', { method: 'POST', body: body() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['evaluations'] });
      onDone();
    },
  });

  // Any change to the inputs invalidates the preview: confirming a list that no
  // longer describes what would happen is the whole failure this guards against.
  const change = (fn: () => void) => { setPreview(null); fn(); };

  const counts = (preview ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});
  const willOpen = counts.opened ?? 0;

  return (
    <Card kicker="Open a period for a section">
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column',
                                          gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap',
                      alignItems: 'flex-end' }}>
          <label className="text-xs" style={{ display: 'flex', flexDirection: 'column',
                                              gap: 'var(--space-1)', flex: '1 1 16rem' }}>
            Section
            <select className="input" value={departmentId}
                    onChange={(e) => change(() => setDepartmentId(e.target.value))}>
              <option value="">Choose a section…</option>
              {(departments.data ?? [])
                .filter((d) => d.isCurrent)
                .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="text-xs" style={{ display: 'flex', flexDirection: 'column',
                                              gap: 'var(--space-1)' }}>
            Period from
            <input className="input" type="date" value={period.start}
                   onChange={(e) => change(
                     () => setPeriod({ ...period, start: e.target.value }))} />
          </label>
          <label className="text-xs" style={{ display: 'flex', flexDirection: 'column',
                                              gap: 'var(--space-1)' }}>
            to
            <input className="input" type="date" value={period.end}
                   onChange={(e) => change(
                     () => setPeriod({ ...period, end: e.target.value }))} />
          </label>
          <Btn variant="secondary" disabled={!departmentId || dryRun.isPending}
               onClick={() => dryRun.mutate()}>
            {preview ? 'Check again' : 'Check what this would do'}
          </Btn>
        </div>

        <p className="text-xs t-muted" style={{ margin: 0 }}>
          Each evaluation goes to the person&rsquo;s own supervisor, not to you.
          Sub-sections are included. Running it again later is safe — anyone
          already open is left alone.
        </p>

        {dryRun.error ? <ErrorNote error={dryRun.error} /> : null}
        {run.error ? <ErrorNote error={run.error} /> : null}

        {preview && (
          preview.length === 0 ? (
            <p className="text-xs t-muted" style={{ margin: 0 }}>
              Nobody is in that section for this period.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr><th>Person</th><th>What would happen</th></tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.employeeId}
                          className={r.outcome === 'opened' ? '' : 't-faint'}>
                        <td>{r.employeeName}</td>
                        <td className="text-xs">{OUTCOME_LABEL[r.outcome]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-2)',
                            alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="text-xs t-muted">
                  {willOpen} of {preview.length} would be opened
                  {counts.no_scorecard
                    ? `; ${counts.no_scorecard} on no scorecard yet` : ''}
                  {counts.already_open ? `; ${counts.already_open} already open` : ''}
                  {counts.not_permitted
                    ? `; ${counts.not_permitted} not yours to evaluate` : ''}
                </span>
                <span style={{ marginLeft: 'auto' }}>
                  <Btn variant="primary" disabled={willOpen === 0 || run.isPending}
                       onClick={() => run.mutate()}>
                    {willOpen === 0
                      ? 'Nothing to open'
                      : `Open ${willOpen} evaluation${willOpen === 1 ? '' : 's'}`}
                  </Btn>
                </span>
              </div>
            </>
          )
        )}
      </div>
    </Card>
  );
}
