import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../auth';
import type { Checkin, Employee, Goal } from '../types';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import {
  Bar, Btn, Card, CheckinStatus, EmptyState, GoalStateTag, PageHead, Section,
} from '../components/ds';

/**
 * Goal detail: measures, actions, and the check-in trail.
 *
 * Which actions render is decided by goal state and whether the viewer is the
 * owner. This is presentation only — the database enforces the same rules (the
 * state machine and RLS), so a hidden button is a convenience, never a control.
 * Rendering a button the server will reject is a UX bug, not a security hole.
 *
 * Two things the design insists on: a goal can carry **several measures with
 * different directions**, so the table states the direction inline rather than
 * assuming higher-is-better; and each check-in shows **period ending and logged
 * date separately**, because collapsing them misled people.
 */
export default function GoalDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<unknown>(null);

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const goal = useQuery({ queryKey: ['goal', id], queryFn: () => api<Goal>(`/goals/${id}`) });
  const checkins = useQuery({
    queryKey: ['checkins', id],
    queryFn: () => api<Checkin[]>(`/goals/${id}/checkins`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['goal', id] });
    void qc.invalidateQueries({ queryKey: ['checkins', id] });
    void qc.invalidateQueries({ queryKey: ['goals'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const action = useMutation({
    mutationFn: (input: { path: string; body?: unknown }) =>
      api(`/goals/${id}/${input.path}`, { method: 'POST', body: input.body }),
    onSuccess: () => { setActionError(null); invalidate(); },
    onError: (err) => setActionError(err),
  });

  if (goal.isLoading) return <Spinner />;
  if (goal.error) return <ErrorNote error={goal.error} />;
  if (!goal.data) return <EmptyState title="Goal not found" />;

  const g = goal.data;
  const isOwner = me.data?.id === g.employeeId;

  const meta = (label: string, value: string) => (
    <div>
      <div style={{ opacity: 0.6 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );

  return (
    <Section>
      <Link to="/" style={{ fontSize: 13, color: 'var(--color-accent-700)', textDecoration: 'none' }}>
        ← Back to My goals
      </Link>

      <Card elevated>
        {/* The goal's title IS this page's heading, so it uses PageHead inside
            the card rather than repeating the title above it. The state and
            check-in health are meta, not actions — they sit beside the title
            where they read as part of it. */}
        <PageHead title={g.title} meta={
          <>
            <GoalStateTag state={g.state} />
            {g.state === 'active' && <CheckinStatus status={g.latestStatus} />}
          </>
        } />
        {g.description && (
          <p className="card-body" style={{ maxWidth: '70ch', marginTop: 'var(--space-2)' }}>
            {g.description}
          </p>
        )}
        <div style={{
          display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-3)',
          fontSize: 13, flexWrap: 'wrap',
        }}>
          {meta('Owner', g.employeeName)}
          {meta('Weight', `${Number(g.weight)}%`)}
          {meta('Due', g.dueOn ?? '—')}
          {/* The snapshotted KPI version, not the current one. */}
          {g.kpiCode && meta('KPI', `${g.kpiCode} v${g.kpiDefinitionVersion}`)}
          {g.approvedAt && meta('Approved', g.approvedAt.slice(0, 10))}
        </div>

        <div className="no-print" style={{
          display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-3)',
        }}>
          {g.state === 'draft' && isOwner && (
            <Btn variant="primary" disabled={action.isPending}
                 onClick={() => action.mutate({ path: 'submit' })}>
              Submit for approval
            </Btn>
          )}
          {g.state === 'pending_approval' && !isOwner && (
            <Btn variant="primary" disabled={action.isPending}
                 onClick={() => action.mutate({ path: 'approve' })}>
              Approve
            </Btn>
          )}
          {g.state === 'active' && (
            <>
              <Btn disabled={action.isPending}
                   onClick={() => action.mutate({ path: 'complete', body: { outcome: 'achieved' } })}>
                Mark achieved
              </Btn>
              <Btn disabled={action.isPending}
                   onClick={() => action.mutate({ path: 'complete', body: { outcome: 'missed' } })}>
                Mark missed
              </Btn>
            </>
          )}
          {!['cancelled', 'achieved', 'missed'].includes(g.state) && (
            <Btn disabled={action.isPending}
                 onClick={() => {
                   const reason = window.prompt('Reason for cancelling this goal?');
                   if (reason?.trim()) action.mutate({ path: 'cancel', body: { reason } });
                 }}>
              Cancel goal
            </Btn>
          )}
        </div>
        {actionError
          ? <div style={{ marginTop: 'var(--space-3)' }}><ErrorNote error={actionError} /></div>
          : null}
      </Card>

      <Card kicker="Measures">
        <table className="table">
          <thead>
            <tr>
              <th>Measure</th><th>Baseline</th><th>Target</th><th>Actual</th>
              <th style={{ width: 140 }}>Attainment</th>
            </tr>
          </thead>
          <tbody>
            {(g.targets ?? []).map((t) => (
              <tr key={t.id}>
                <td>
                  {t.measureName}{' '}
                  {/* Direction stated inline — several measures on one goal can
                      disagree, and assuming higher-is-better inverts the result. */}
                  <span style={{ opacity: 0.5, fontSize: 11 }}>
                    {t.direction === 'lower_is_better' ? '↓ lower is better' : '↑ higher is better'}
                  </span>
                </td>
                <td className="tabular-nums">{t.baselineValue ?? '—'}</td>
                <td className="tabular-nums" style={{ fontWeight: 600 }}>{t.targetValue}</td>
                <td className="tabular-nums">
                  {t.actualValue ?? '—'}{' '}
                  {t.actualAsOf && (
                    <span style={{ opacity: 0.5, fontSize: 11 }}>as of {t.actualAsOf}</span>
                  )}
                </td>
                <td>
                  {t.attainmentPct == null
                    ? <span style={{ opacity: 0.5, fontSize: 12 }}>—</span>
                    : <Bar pct={Number(t.attainmentPct)}
                           tone={t.direction === 'lower_is_better' ? 'deep' : 'accent'} />}
                </td>
              </tr>
            ))}
            {(g.targets?.length ?? 0) === 0 && (
              <tr><td colSpan={5} style={{ opacity: 0.6 }}>No measures on this goal.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {g.state === 'active' && (
        <CheckinForm goalId={g.id} targets={g.targets ?? []} onDone={invalidate} />
      )}

      <Card kicker={`Check-ins (${checkins.data?.length ?? 0})`}>
        {checkins.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No check-ins recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {checkins.data?.map((c) => (
              <div key={c.id} style={{
                borderBottom: '1px solid var(--color-divider)', paddingBottom: 'var(--space-3)',
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 'var(--space-3)', fontSize: 13, flexWrap: 'wrap',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CheckinStatus status={c.statusFlag} />
                    <strong>Period ending {c.periodEnding}</strong>
                    {c.reportedValue && (
                      <span className="tabular-nums" style={{ opacity: 0.75 }}>
                        reported {c.reportedValue}
                      </span>
                    )}
                  </span>
                  {/* Logged date is shown separately from the period it covers;
                      they differ, sometimes by weeks. */}
                  <span style={{ opacity: 0.6 }}>Logged {c.createdAt.slice(0, 10)}</span>
                </div>
                {c.comment && (
                  <p style={{ fontSize: 13, margin: '6px 0 0', opacity: 0.85 }}>{c.comment}</p>
                )}
                {c.evidenceUrl && (
                  <a href={c.evidenceUrl} target="_blank" rel="noreferrer noopener"
                     style={{ fontSize: 12 }}>
                    Evidence
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </Section>
  );
}

function CheckinForm({ goalId, targets, onDone }: {
  goalId: string;
  targets: Goal['targets'];
  onDone: () => void;
}) {
  const [status, setStatus] = useState<'on_track' | 'at_risk' | 'off_track'>('on_track');
  const [targetId, setTargetId] = useState(targets?.[0]?.id ?? '');
  const [value, setValue] = useState('');
  const [comment, setComment] = useState('');
  const [periodEnding, setPeriodEnding] = useState(new Date().toISOString().slice(0, 10));
  const [updateActual, setUpdateActual] = useState(true);

  const submit = useMutation({
    mutationFn: () =>
      api(`/goals/${goalId}/checkins`, {
        method: 'POST',
        body: {
          goalTargetId: targetId || undefined,
          reportedValue: value === '' ? undefined : Number(value),
          statusFlag: status,
          comment: comment.trim() || undefined,
          periodEnding,
          updateActual: updateActual && value !== '' && !!targetId,
        },
      }),
    onSuccess: () => { setValue(''); setComment(''); onDone(); },
  });

  return (
    <Card kicker="Record a check-in" className="no-print">
      <form
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--space-3)',
        }}
        onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}
      >
        <Field label="Status">
          <select className={inputClass} value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="on_track">On track</option>
            <option value="at_risk">At risk</option>
            <option value="off_track">Off track</option>
          </select>
        </Field>

        <Field label="Period ending">
          <input type="date" className={inputClass} value={periodEnding} required
                 onChange={(e) => setPeriodEnding(e.target.value)} />
        </Field>

        {(targets?.length ?? 0) > 0 && (
          <Field label="Measure">
            <select className={inputClass} value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}>
              <option value="">— none —</option>
              {targets?.map((t) => (
                <option key={t.id} value={t.id}>{t.measureName}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Reported value" hint="Leave blank for a narrative-only check-in">
          <input type="number" step="any" className={inputClass} value={value}
                 onChange={(e) => setValue(e.target.value)} />
        </Field>

        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Comment">
            <textarea rows={3} className={inputClass} value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="What moved, what is blocked, what happens next" />
          </Field>
        </div>

        <label style={{
          gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14,
        }}>
          <input type="checkbox" checked={updateActual}
                 onChange={(e) => setUpdateActual(e.target.checked)}
                 disabled={!targetId || value === ''} />
          Also update the measure&rsquo;s actual value (recalculates attainment)
        </label>

        <div style={{
          gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        }}>
          <Btn type="submit" variant="primary" disabled={submit.isPending}>
            {submit.isPending ? 'Saving…' : 'Log check-in'}
          </Btn>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Check-ins are permanent and cannot be edited or deleted.
          </span>
        </div>

        {submit.error ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <ErrorNote error={submit.error as ApiError} />
          </div>
        ) : null}
      </form>
    </Card>
  );
}
