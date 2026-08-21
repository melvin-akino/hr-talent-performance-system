import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import {
  Attainment, Btn, canSignOff, Card, Dialog, EmptyState, Icon, PageHead, paths, Section, Stat, Tag,
} from '../components/ds';

interface Cycle {
  id: string;
  name: string;
  state: 'draft' | 'open' | 'calibration' | 'closed';
  opensOn: string;
  closesOn: string;
  goalPeriodId: string | null;
  phases: { phaseType: string; opensOn: string; closesOn: string }[];
}

interface Summary {
  id: string;
  subjectEmployeeId: string;
  subjectName: string;
  department: string | null;
  overallRating: string | null;
  calibratedRating: string | null;
  goalAttainmentPct: string | null;
  releasedAt: string | null;
  signedOffAt: string | null;
  acknowledgedAt: string | null;
  potentialRating: number | null;
  instanceCount: number;
  submittedCount: number;
}

const CYCLE_STATES = ['draft', 'open', 'calibration', 'closed'] as const;
const POTENTIAL = [
  { value: 1, label: 'Well placed' },
  { value: 2, label: 'Growth' },
  { value: 3, label: 'High potential' },
];

/**
 * HR's review-cycle console: launch, track completion, calibrate, sign off.
 *
 * The densest screen in the product. Three rules from the design are enforced
 * here and are not cosmetic:
 *
 *   **Sign-off is gated** on every review for that person being submitted, and
 *   **locks the row** once done — the calibrated input and potential dropdown
 *   go read-only and there is no un-sign-off path, because the rating has been
 *   released to the employee by then.
 *
 *   **It asks first.** An irreversible action that fires on a single click is a
 *   trap on a table with eight rows of identical buttons.
 *
 *   **Movement is shown inline** — an arrow beside the calibrated rating, only
 *   when it differs from the overall — so a separate column is unnecessary.
 */
export default function ReviewAdmin() {
  const qc = useQueryClient();
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<Summary | null>(null);

  const cycles = useQuery({
    queryKey: ['review-cycles'],
    queryFn: () => api<Cycle[]>('/review-cycles'),
  });

  const active = cycles.data?.find((c) => c.id === cycleId) ?? cycles.data?.[0] ?? null;

  const summaries = useQuery({
    queryKey: ['review-summaries', active?.id],
    queryFn: () => api<Summary[]>(`/review-cycles/${active!.id}/summaries`),
    enabled: !!active,
  });

  const generate = useMutation({
    mutationFn: () => api(`/review-cycles/${active!.id}/generate`, { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['review-summaries'] }),
  });

  const setState = useMutation({
    mutationFn: (state: string) =>
      api(`/review-cycles/${active!.id}/state`, { method: 'PATCH', body: { state } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['review-cycles'] }),
  });

  const signOff = useMutation({
    mutationFn: (id: string) => api(`/review-summaries/${id}/signoff`, { method: 'POST' }),
    onSuccess: () => {
      setConfirming(null);
      void qc.invalidateQueries({ queryKey: ['review-summaries'] });
    },
  });

  const calibrate = useMutation({
    mutationFn: (input: { id: string; rating: number }) =>
      api(`/review-summaries/${input.id}/calibrate`, {
        method: 'POST', body: { calibratedRating: input.rating },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['review-summaries'] }),
  });

  const setPotential = useMutation({
    mutationFn: (input: { id: string; potential: number | null }) =>
      // Lives under /analytics — potential is recorded during calibration but
      // owned by the analytics module, since the nine-box is what consumes it.
      api(`/analytics/review-summaries/${input.id}/potential`, {
        method: 'POST', body: { potentialRating: input.potential },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['review-summaries'] }),
  });

  if (cycles.isLoading) return <Spinner />;

  const rows = summaries.data ?? [];
  const complete = rows.filter((s) => canSignOff(s) || !!s.signedOffAt);
  const signed = rows.filter((s) => s.signedOffAt);
  const calibrated = rows.filter((s) => s.calibratedRating != null);

  return (
    <Section>
      {/* Was a hand-rolled h2 + flex row, which is precisely what PageHead is.
          Folded in so the heading treatment stays consistent when it changes. */}
      <PageHead
        title="Review cycles"
        meta={active && (
          <>
            <span style={{ fontSize: 14, opacity: 0.7 }}>{active.name}</span>
            {/* The state machine is one-way; showing all four with the current
                one filled makes that visible without a legend. */}
            <div style={{ display: 'flex', gap: 4 }}>
              {CYCLE_STATES.map((s) => (
                s === active.state
                  ? <Tag key={s} tone="solid">{s}</Tag>
                  : <Tag key={s} style={{ opacity: 0.5 }}>{s}</Tag>
              ))}
            </div>
          </>
        )}
      >
        <div className="no-print" style={{
          display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap',
        }}>
          <Btn onClick={() => setCreating((v) => !v)}>New cycle</Btn>
          {active && (
            <>
              <Btn onClick={() => generate.mutate()} disabled={generate.isPending}>
                Generate reviews
              </Btn>
              {active.state === 'draft' && (
                <Btn variant="primary" onClick={() => setState.mutate('open')}>Open</Btn>
              )}
              {active.state === 'open' && (
                <Btn variant="primary" onClick={() => setState.mutate('calibration')}>
                  Move to calibration
                </Btn>
              )}
              {active.state === 'calibration' && (
                <Btn onClick={() => {
                  if (window.confirm('Close this cycle? No further edits will be possible.')) {
                    setState.mutate('closed');
                  }
                }}>Advance to closed</Btn>
              )}
            </>
          )}
        </div>
      </PageHead>

      {creating && <NewCycleForm onDone={() => setCreating(false)} />}

      {cycles.data?.length === 0 ? (
        <EmptyState title="No review cycles yet">
          A cycle defines the review season: who is reviewed, against which form,
          and by when. Create one to begin.
        </EmptyState>
      ) : (
        <Card kicker="Cycle">
          <select className={inputClass} value={active?.id ?? ''}
                  onChange={(e) => setCycleId(e.target.value)} aria-label="Review cycle">
            {cycles.data?.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.state})</option>
            ))}
          </select>
          {generate.data ? (
            <p className="card-body" style={{ margin: '8px 0 0' }}>
              Generated {(generate.data as { created: number }).created} review(s).
              {((generate.data as { skipped: unknown[] }).skipped?.length ?? 0) > 0 && (
                <> {(generate.data as { skipped: unknown[] }).skipped.length} employee(s)
                  skipped — check form assignments and reporting lines.</>
              )}
            </p>
          ) : null}
          <ErrorNote error={generate.error ?? setState.error} />
        </Card>
      )}

      {active && (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 'var(--space-3)',
          }}>
            <Stat kicker="Subjects" value={rows.length} />
            <Stat kicker="All reviews in" value={`${complete.length} of ${rows.length}`} />
            <Stat kicker="Calibrated" value={`${calibrated.length} of ${rows.length}`} />
            <Stat kicker="Signed off" value={`${signed.length} of ${rows.length}`} />
          </div>

          <Card kicker="Calibration &amp; sign-off">
            {rows.length === 0 ? (
              <p className="card-body" style={{ margin: 0 }}>
                No reviews generated for this cycle yet.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th><th>Progress</th><th style={{ width: 150 }}>Attainment</th>
                      <th>Overall</th><th>Calibrated</th><th>Potential</th>
                      <th className="no-print">Sign-off</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const ready = canSignOff(s);
                      const locked = !!s.signedOffAt;
                      const overall = s.overallRating == null ? null : Number(s.overallRating);
                      const cal = s.calibratedRating == null ? null : Number(s.calibratedRating);
                      const moved = overall != null && cal != null && cal !== overall;

                      return (
                        <tr key={s.id}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{s.subjectName}</div>
                            {s.department && (
                              <div style={{ fontSize: 12, opacity: 0.6 }}>{s.department}</div>
                            )}
                          </td>
                          <td style={{ fontSize: 13 }}>
                            {s.submittedCount}/{s.instanceCount} submitted
                          </td>
                          <td>
                            {/* "not measured" is a real data state — the cycle
                                may not be linked to a goal period — and is shown
                                plainly rather than hidden behind a zero. */}
                            {s.goalAttainmentPct == null
                              ? <span style={{ opacity: 0.5, fontSize: 12 }}>not measured</span>
                              : <Attainment pct={s.goalAttainmentPct} />}
                          </td>
                          <td className="tabular-nums">{overall?.toFixed(1) ?? '—'}</td>
                          <td>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {locked ? (
                                <span className="tabular-nums">{cal?.toFixed(1) ?? '—'}</span>
                              ) : (
                                <input
                                  className="input" type="number" step="0.1"
                                  style={{ width: 64 }}
                                  defaultValue={s.calibratedRating ?? ''}
                                  aria-label={`Calibrated rating for ${s.subjectName}`}
                                  onBlur={(e) => {
                                    if (e.target.value !== '') {
                                      calibrate.mutate({ id: s.id, rating: Number(e.target.value) });
                                    }
                                  }}
                                />
                              )}
                              {/* Movement shown inline, only when it differs. */}
                              {moved && (
                                <Icon
                                  size={13}
                                  path={cal! > overall! ? paths.arrowUp : paths.arrowDown}
                                  stroke={cal! > overall!
                                    ? 'var(--color-accent-700)' : 'var(--color-accent-900)'}
                                />
                              )}
                            </span>
                          </td>
                          <td>
                            <select
                              className="input" style={{ width: 130 }}
                              disabled={locked}
                              value={s.potentialRating ?? ''}
                              aria-label={`Potential for ${s.subjectName}`}
                              onChange={(e) => setPotential.mutate({
                                id: s.id,
                                potential: e.target.value === '' ? null : Number(e.target.value),
                              })}
                            >
                              <option value="">—</option>
                              {POTENTIAL.map((p) => (
                                <option key={p.value} value={p.value}>{p.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="no-print">
                            {locked ? (
                              <Tag tone="solid">
                                Signed off{s.acknowledgedAt ? ' · ack' : ''}
                              </Tag>
                            ) : (
                              <Btn
                                variant={ready ? 'primary' : 'secondary'}
                                disabled={!ready || signOff.isPending}
                                title={ready ? undefined : 'All reviews must be submitted first'}
                                onClick={() => setConfirming(s)}
                              >
                                Sign off
                              </Btn>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <ErrorNote error={signOff.error ?? calibrate.error ?? setPotential.error} />
          </Card>
        </>
      )}

      {confirming && (
        <Dialog
          title={`Sign off ${confirming.subjectName}?`}
          onDismiss={() => setConfirming(null)}
          actions={
            <>
              <Btn onClick={() => setConfirming(null)}>Cancel</Btn>
              <Btn variant="primary" disabled={signOff.isPending}
                   onClick={() => signOff.mutate(confirming.id)}>
                {signOff.isPending ? 'Signing off…' : 'Sign off'}
              </Btn>
            </>
          }
        >
          This finalises the rating of{' '}
          <strong>
            {confirming.calibratedRating ?? confirming.overallRating ?? '—'}
          </strong>{' '}
          and releases the review to {confirming.subjectName}.{' '}
          <strong>It cannot be undone.</strong>
        </Dialog>
      )}
    </Section>
  );
}

function NewCycleForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [opensOn, setOpensOn] = useState('');
  const [closesOn, setClosesOn] = useState('');
  const [goalPeriodId, setGoalPeriodId] = useState('');

  const periods = useQuery({
    queryKey: ['goal-periods'],
    queryFn: () => api<{ id: string; name: string }[]>('/goal-periods'),
  });

  const create = useMutation({
    mutationFn: () =>
      api('/review-cycles', {
        method: 'POST',
        body: {
          name: name.trim(),
          goalPeriodId: goalPeriodId || undefined,
          opensOn, closesOn,
          // Default four-phase sequence from the meeting notes. Dates span the
          // cycle; HR can refine them later.
          phases: [
            { phaseType: 'self', opensOn, closesOn },
            { phaseType: 'supervisor', opensOn, closesOn },
            { phaseType: 'calibration', opensOn, closesOn },
            { phaseType: 'signoff', opensOn, closesOn },
          ],
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['review-cycles'] });
      onDone();
    },
  });

  return (
    <Card kicker="New review cycle">
      <form
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--space-3)',
        }}
        onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
      >
        <Field label="Name">
          <input className={inputClass} required value={name} placeholder="FY2026 Annual Review"
                 onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Goal period" hint="Links goal attainment into each review">
          <select className={inputClass} value={goalPeriodId}
                  onChange={(e) => setGoalPeriodId(e.target.value)}>
            <option value="">— none —</option>
            {periods.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Opens">
          <input type="date" required className={inputClass} value={opensOn}
                 onChange={(e) => setOpensOn(e.target.value)} />
        </Field>
        <Field label="Closes">
          <input type="date" required className={inputClass} value={closesOn}
                 onChange={(e) => setClosesOn(e.target.value)} />
        </Field>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 'var(--space-2)' }}>
          <Btn type="submit" variant="primary" disabled={create.isPending}>Create</Btn>
          <Btn type="button" onClick={onDone}>Cancel</Btn>
        </div>
        {create.error ? (
          <div style={{ gridColumn: '1 / -1' }}><ErrorNote error={create.error} /></div>
        ) : null}
      </form>
    </Card>
  );
}
