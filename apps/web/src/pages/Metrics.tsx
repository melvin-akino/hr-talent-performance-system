import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import type {
  ScorecardDetail, ScorecardSummary, TaskIndicator, TaskNature,
} from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import { Btn, Card, EmptyState, PageHead, Stat, Tag } from '../components/ds';

/**
 * Task metrics — the scorecards staff are measured on.
 *
 * This screen LOADS metrics; it does not evaluate anybody. That separation is
 * the client's own: they asked to get everyone's tasks into the system first
 * and score against them later, which is also the order that lets HCM check the
 * numbers before anything counts.
 *
 * The lines matter more than the totals here. A scorecard repeats the same
 * indicator whenever the acceptance criterion differs — "Claims Processing"
 * three times, for accident, maternity and sickness — so the criterion is shown
 * on every row rather than tucked behind the indicator name.
 */

const NATURE_LABEL: Record<TaskNature, string> = {
  administrative: 'Administrative',
  field: 'Field',
  technical: 'Technical',
};

const points = (v: string | number) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

export default function Metrics() {
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<'scorecards' | 'catalogue'>('scorecards');

  const cards = useQuery({
    queryKey: ['scorecards'],
    queryFn: () => api<ScorecardSummary[]>('/scorecards'),
  });

  if (cards.isLoading) return <Spinner />;
  if (cards.error) return <ErrorNote error={cards.error} />;

  const list = cards.data ?? [];
  const loaded = list.filter((c) => c.lineCount > 0).length;
  const assigned = list.reduce((sum, c) => sum + c.holders, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PageHead title="Task metrics">
        <Btn
          variant={tab === 'scorecards' ? 'primary' : 'ghost'}
          onClick={() => setTab('scorecards')}
        >
          Scorecards
        </Btn>
        <Btn
          variant={tab === 'catalogue' ? 'primary' : 'ghost'}
          onClick={() => setTab('catalogue')}
        >
          Catalogue
        </Btn>
      </PageHead>

      {tab === 'scorecards' ? (
        <>
          <div style={{ display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: 'var(--space-3)' }}>
            <Stat kicker="Scorecards" value={String(list.length)} />
            {/* An empty scorecard is a real state during loading, and the
                number HCM works down while filling them in. */}
            <Stat kicker="With lines loaded" value={`${loaded} of ${list.length}`} />
            <Stat kicker="Staff assigned" value={String(assigned)} />
          </div>

          <Card kicker="Scorecards">
            {list.length === 0 ? (
              <EmptyState title="No scorecards yet">
                A scorecard is a set of tasks with points against each one. Load one
                per role, then assign the staff who hold that role.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Scorecard</th>
                      <th>Section</th>
                      <th className="text-right">Lines</th>
                      <th className="text-right">Target</th>
                      <th className="text-right">Staff</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id} className={c.isActive ? '' : 't-faint'}>
                        <td>{c.name}</td>
                        <td className="text-xs t-muted">{c.departmentName ?? '—'}</td>
                        <td className="text-right tabular-nums text-xs">{c.lineCount}</td>
                        <td className="text-right tabular-nums">{points(c.targetPoints)}</td>
                        <td className="text-right tabular-nums text-xs">{c.holders}</td>
                        <td className="text-right no-print">
                          <Btn
                            variant="ghost"
                            onClick={() => setOpen(open === c.id ? null : c.id)}
                          >
                            {open === c.id ? 'Hide' : 'Open'}
                          </Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {open && <ScorecardPanel id={open} onClose={() => setOpen(null)} />}
        </>
      ) : (
        <Catalogue />
      )}
    </div>
  );
}

/**
 * Default period: the current calendar quarter.
 *
 * Not the fiscal year, and not "since they were assigned" -- the client's own
 * scorecards are written in per-month and per-cutoff units, so a quarter is the
 * shortest window their criteria actually make sense over. It is only a default;
 * the evaluator can set any period.
 */
function currentQuarter(): { start: string; end: string } {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  const start = new Date(Date.UTC(now.getFullYear(), q * 3, 1));
  const end = new Date(Date.UTC(now.getFullYear(), q * 3 + 3, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

function ScorecardPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [period, setPeriod] = useState(currentQuarter);

  const openEvaluation = useMutation({
    mutationFn: (employeeId: string) =>
      api<{ id: string }>('/evaluations', {
        method: 'POST',
        body: { employeeId, periodStart: period.start, periodEnd: period.end },
      }),
    onSuccess: () => {
      setEvaluating(null);
      navigate('/evaluations');
    },
  });

  const detail = useQuery({
    queryKey: ['scorecard', id],
    queryFn: () => api<ScorecardDetail>(`/scorecards/${id}`),
  });

  if (detail.isLoading) return <Spinner />;
  if (detail.error) return <ErrorNote error={detail.error} />;
  const d = detail.data;
  if (!d) return null;

  const current = d.holders.filter((h) => h.effectiveTo === null);

  return (
    <Card
      kicker={d.name}
      actions={<Btn variant="ghost" onClick={onClose}>Close</Btn>}
    >
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column',
                                          gap: 'var(--space-4)' }}>
        <div style={{ display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: 'var(--space-3)' }}>
          <Stat kicker="Target" value={points(d.targetPoints)} />
          <Stat kicker="Lines" value={String(d.items.length)} />
          <Stat kicker="Assigned now" value={String(current.length)} />
        </div>

        {d.items.length === 0 ? (
          <EmptyState title="No lines yet">
            Add the tasks this role is measured on, with the points each is worth.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '2.5rem' }} className="text-right">#</th>
                  <th>Task</th>
                  <th>Nature</th>
                  <th>How it is counted</th>
                  <th className="text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((line) => (
                  <tr key={line.id}>
                    <td className="text-right tabular-nums text-xs t-faint">{line.sequence}</td>
                    <td>{line.indicatorName}</td>
                    <td className="text-xs t-muted">{NATURE_LABEL[line.nature]}</td>
                    {/* The criterion is what distinguishes two lines carrying
                        the same task name, so it is never abbreviated away. */}
                    <td className="text-xs t-muted">{line.criteria ?? '—'}</td>
                    <td className="text-right tabular-nums">{points(line.points)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="text-right text-xs t-muted">Target</td>
                  <td className="text-right tabular-nums">{points(d.targetPoints)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div>
          <div className="text-xs t-muted" style={{ marginBottom: 'var(--space-2)' }}>
            Measured on this scorecard
          </div>
          {d.holders.length === 0 ? (
            <p className="text-xs t-muted" style={{ margin: 0 }}>
              Nobody is assigned yet. The scorecard is defined but counts for no one.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none',
                         display: 'flex', flexDirection: 'column',
                         gap: 'var(--space-2)' }}>
              {d.holders.map((h) => (
                <li key={h.id} className="text-xs"
                    style={{ display: 'flex', gap: 'var(--space-2)',
                             alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{h.name}</span>
                  <span className="t-faint">
                    from {h.effectiveFrom}
                    {h.effectiveTo ? ` until ${h.effectiveTo}` : ''}
                  </span>
                  {h.effectiveTo && <Tag>past</Tag>}
                  {/* Only for someone currently on the card. Evaluating against
                      a scorecard they have already left is a different act, and
                      goes through the period, not this button. */}
                  {!h.effectiveTo && (
                    <span className="no-print" style={{ marginLeft: 'auto' }}>
                      <Btn variant="ghost"
                           onClick={() => setEvaluating(
                             evaluating === h.employeeId ? null : h.employeeId)}>
                        {evaluating === h.employeeId ? 'Cancel' : 'Evaluate'}
                      </Btn>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {evaluating && (
            <div className="no-print" style={{
              display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap',
              alignItems: 'flex-end', marginTop: 'var(--space-3)',
            }}>
              <label className="text-xs" style={{ display: 'flex',
                                                  flexDirection: 'column',
                                                  gap: 'var(--space-1)' }}>
                Period from
                <input className="input" type="date" value={period.start}
                       onChange={(e) => setPeriod({ ...period, start: e.target.value })} />
              </label>
              <label className="text-xs" style={{ display: 'flex',
                                                  flexDirection: 'column',
                                                  gap: 'var(--space-1)' }}>
                to
                <input className="input" type="date" value={period.end}
                       onChange={(e) => setPeriod({ ...period, end: e.target.value })} />
              </label>
              <Btn variant="primary"
                   disabled={openEvaluation.isPending}
                   onClick={() => openEvaluation.mutate(evaluating)}>
                Open evaluation
              </Btn>
              {openEvaluation.error ? <ErrorNote error={openEvaluation.error} /> : null}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Catalogue() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<{ name: string; nature: TaskNature } | null>(null);

  const indicators = useQuery({
    queryKey: ['task-indicators'],
    queryFn: () => api<TaskIndicator[]>('/task-indicators'),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; nature: TaskNature }) =>
      api('/task-indicators', { method: 'POST', body }),
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['task-indicators'] });
    },
  });

  if (indicators.isLoading) return <Spinner />;
  if (indicators.error) return <ErrorNote error={indicators.error} />;
  const list = indicators.data ?? [];

  return (
    <Card
      kicker="Task catalogue"
      actions={
        <Btn
          variant="primary"
          onClick={() => setDraft({ name: '', nature: 'administrative' })}
        >
          New task
        </Btn>
      }
    >
      <p className="card-body text-xs t-muted" style={{ marginTop: 0 }}>
        One name per piece of work, shared across every scorecard. Two names for
        the same task would make any comparison between sections meaningless.
      </p>

      {draft && (
        <div className="card-body" style={{ display: 'flex', gap: 'var(--space-2)',
                                            flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="text-xs" style={{ display: 'flex', flexDirection: 'column',
                                              gap: 'var(--space-1)', flex: '1 1 16rem' }}>
            Task name
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="text-xs" style={{ display: 'flex', flexDirection: 'column',
                                              gap: 'var(--space-1)' }}>
            Nature
            <select
              className="input"
              value={draft.nature}
              onChange={(e) => setDraft({ ...draft, nature: e.target.value as TaskNature })}
            >
              <option value="administrative">Administrative (1 point)</option>
              <option value="field">Field (1.5 points)</option>
              <option value="technical">Technical (2 points)</option>
            </select>
          </label>
          <Btn
            variant="primary"
            disabled={!draft.name.trim() || create.isPending}
            onClick={() => create.mutate({ name: draft.name.trim(), nature: draft.nature })}
          >
            Add
          </Btn>
          <Btn variant="ghost" onClick={() => setDraft(null)}>Cancel</Btn>
          {create.error ? <ErrorNote error={create.error} /> : null}
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState title="The catalogue is empty">
          Add the tasks your sections perform, then group them into scorecards.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Nature</th>
                <th className="text-right">Default points</th>
                <th className="text-right">Used on</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} className={t.isActive ? '' : 't-faint'}>
                  <td>{t.name}</td>
                  <td className="text-xs t-muted">{NATURE_LABEL[t.nature]}</td>
                  <td className="text-right tabular-nums">{points(t.defaultPoints)}</td>
                  {/* Nothing here is deleted casually: this count is how you
                      see what a rename would move before you move it. */}
                  <td className="text-right tabular-nums text-xs">
                    {t.usedInLines === 0
                      ? <span className="t-faint">unused</span>
                      : `${t.usedInLines} line${t.usedInLines === 1 ? '' : 's'}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
