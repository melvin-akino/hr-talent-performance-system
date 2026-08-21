import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import { Bar, Btn, Card, EmptyState, PageHead, Stat, Tag } from '../components/ds';

interface Plan {
  id: string;
  employeeId: string;
  employeeName: string;
  title: string;
  objective: string | null;
  targetPositionTitle: string | null;
  startsOn: string;
  targetDate: string | null;
  state: 'draft' | 'active' | 'completed' | 'cancelled';
  actionCount: number;
  actionsCompleted: number;
  actions?: Action[];
}

interface Action {
  id: string;
  sequence: number;
  description: string;
  competencyName: string | null;
  targetLevel: number | null;
  learningResourceTitle: string | null;
  learningResourceUrl: string | null;
  targetDate: string | null;
  status: 'not_started' | 'in_progress' | 'completed' | 'deferred' | 'cancelled';
  completedOn: string | null;
}

interface Assignment {
  id: string;
  title: string;
  resourceType: string;
  url: string | null;
  durationMinutes: number | null;
  competencyName: string | null;
  assignedBy: string | null;
  dueOn: string | null;
  state: 'assigned' | 'in_progress' | 'completed' | 'waived';
  completedOn: string | null;
}

interface Recommendation {
  competencyId: string;
  competencyName: string;
  requiredLevel: number;
  assessedLevel: number | null;
  gap: number | null;
  resourceId: string;
  resourceTitle: string;
  resourceType: string;
  alreadyAssigned: boolean;
}

interface CareerOption {
  toPositionId: string;
  toPositionTitle: string;
  moveType: string;
  typicalMonths: number | null;
  requirementsTotal: number;
  requirementsMet: number;
  requirementsUnassessed: number;
}

/**
 * Development: plans, assigned learning, and career options.
 *
 * The recommendations tab is the point of the phase — it joins Phase 4's gap
 * report to the library, so "you are below the bar here" comes with something
 * concrete to do about it.
 */
export default function Development() {
  const [tab, setTab] = useState<'plan' | 'learning' | 'career'>('plan');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PageHead title="Development" />

      <nav className="seg no-print" aria-label="Development view">
        {([
          ['plan', 'My development plan'],
          ['learning', 'My learning'],
          ['career', 'Career options'],
        ] as const).map(([key, label]) => (
          <label key={key} className="seg-opt">
            <input type="radio" name="development-view" checked={tab === key}
                   onChange={() => setTab(key)} />
            <span>{label}</span>
          </label>
        ))}
      </nav>

      {tab === 'plan' && <Plans />}
      {tab === 'learning' && <Learning />}
      {tab === 'career' && <Career />}
    </div>
  );
}

/**
 * Lifecycle words carry their own state; the palette does not help here.
 *
 * `completed` and `active` get the accent because they are the states someone is
 * working toward; `deferred` and `cancelled` recede rather than turning red —
 * a deferred action is a scheduling decision, not a failure.
 */
function StateTag({ state }: { state: string }) {
  const tone: 'accent' | 'neutral' | 'outline' =
    state === 'completed' || state === 'active' ? 'accent'
      : state === 'deferred' || state === 'cancelled' || state === 'waived' ? 'neutral'
        : 'outline';
  return (
    <Tag tone={tone} style={state === 'deferred' || state === 'cancelled' || state === 'waived'
      ? { opacity: 0.6 } : undefined}>
      {state.replace(/_/g, ' ')}
    </Tag>
  );
}

const ACTION_STATES = ['not_started', 'in_progress', 'completed', 'deferred', 'cancelled'];

function Plans() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const plans = useQuery({
    queryKey: ['development-plans', 'mine'],
    queryFn: () => api<Plan[]>('/employees/me/development-plans'),
  });

  if (plans.isLoading) return <Spinner />;
  if (plans.error) return <ErrorNote error={plans.error} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {creating && (
        <NewPlan onDone={() => {
          setCreating(false);
          void qc.invalidateQueries({ queryKey: ['development-plans'] });
        }} />
      )}

      {plans.data?.length === 0 && !creating ? (
        <EmptyState
          title="No development plans yet"
          action={<Btn variant="primary" onClick={() => setCreating(true)}>New plan</Btn>}
        >
          A plan is a few concrete actions with dates. Your manager can see it —
          that is deliberate: it is a growth conversation, not a disciplinary
          record.
        </EmptyState>
      ) : (
        <Card
          title="My development plans"
          actions={
            <Btn variant="primary" onClick={() => setCreating((v) => !v)}>New plan</Btn>
          }
        >
          <p style={{ marginTop: 0, fontSize: 12, opacity: 0.7 }}>
            Your manager can see these. That is deliberate — a development plan is a
            growth conversation, not a disciplinary record.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {plans.data?.map((p) => (
              <li key={p.id} style={{
                padding: 'var(--space-3) 0',
                borderTop: '1px solid var(--color-neutral-200)',
              }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <button
                      className="link-btn"
                      style={{ fontWeight: 500, textAlign: 'left' }}
                      aria-expanded={openId === p.id}
                      onClick={() => setOpenId(openId === p.id ? null : p.id)}
                    >
                      {p.title}
                    </button>
                    <p style={{ margin: '2px 0 6px', fontSize: 12, opacity: 0.7 }}>
                      {p.actionsCompleted}/{p.actionCount} actions complete
                      {p.targetPositionTitle && ` · toward ${p.targetPositionTitle}`}
                      {p.targetDate && ` · by ${p.targetDate}`}
                    </p>
                    {/* Progress is the one thing a plan owner wants at a glance,
                        and the counts alone don't give it. Guarded against the
                        zero-action plan, which would divide by nothing. */}
                    {p.actionCount > 0 && (
                      <div style={{ maxWidth: 260 }}>
                        <Bar pct={(p.actionsCompleted / p.actionCount) * 100} />
                      </div>
                    )}
                  </div>
                  <StateTag state={p.state} />
                </div>
                {openId === p.id && <PlanDetail planId={p.id} state={p.state} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function PlanDetail({ planId, state }: { planId: string; state: string }) {
  const qc = useQueryClient();
  const plan = useQuery({
    queryKey: ['development-plan', planId],
    queryFn: () => api<Plan>(`/development-plans/${planId}`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['development-plan', planId] });
    void qc.invalidateQueries({ queryKey: ['development-plans'] });
  };

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      api(`/dev-actions/${input.id}`, { method: 'PATCH', body: { status: input.status } }),
    onSuccess: invalidate,
  });

  const activate = useMutation({
    mutationFn: () =>
      api(`/development-plans/${planId}/state`, { method: 'PATCH', body: { state: 'active' } }),
    onSuccess: invalidate,
  });

  if (plan.isLoading) return <Spinner />;
  if (plan.error) return <ErrorNote error={plan.error} />;

  return (
    <div style={{
      marginTop: 'var(--space-3)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
      background: 'var(--color-neutral-100)',
      padding: 'var(--space-4)',
    }}>
      {plan.data?.objective && (
        <p style={{ margin: 0, fontSize: 14 }}>{plan.data.objective}</p>
      )}

      {(plan.data?.actions?.length ?? 0) === 0 ? (
        <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>
          This plan has no actions yet — there is nothing to track until it has at
          least one.
        </p>
      ) : (
        <ul style={{
          listStyle: 'none', margin: 0, padding: 0,
          display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
        }}>
          {plan.data?.actions?.map((a) => (
            <li key={a.id} style={{
              border: '1px solid var(--color-neutral-200)',
              background: 'var(--color-bg)',
              padding: 'var(--space-2) var(--space-3)',
            }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14 }}>{a.description}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.7 }}>
                    {a.competencyName && `${a.competencyName}`}
                    {a.targetLevel && ` → level ${a.targetLevel}`}
                    {a.targetDate && ` · due ${a.targetDate}`}
                    {a.completedOn && ` · done ${a.completedOn}`}
                  </p>
                  {a.learningResourceTitle && (
                    <p style={{ margin: '4px 0 0', fontSize: 12 }}>
                      {a.learningResourceUrl ? (
                        <a href={a.learningResourceUrl} target="_blank"
                           rel="noreferrer noopener">
                          {a.learningResourceTitle}
                        </a>
                      ) : a.learningResourceTitle}
                    </p>
                  )}
                </div>
                <label style={{ fontSize: 12 }}>
                  <span className="sr-only">Status for “{a.description}”</span>
                  <select
                    className={inputClass}
                    style={{ fontSize: 12, paddingBlock: 4 }}
                    value={a.status}
                    onChange={(e) => setStatus.mutate({ id: a.id, status: e.target.value })}
                  >
                    {ACTION_STATES.map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}

      {state === 'draft' && (
        <div>
          <Btn variant="primary" onClick={() => activate.mutate()}
               disabled={activate.isPending}>
            Start this plan
          </Btn>
        </div>
      )}
      <ErrorNote error={setStatus.error ?? activate.error} />
    </div>
  );
}

function NewPlan({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [actions, setActions] = useState([{ description: '', targetDate: '' }]);

  const recs = useQuery({
    queryKey: ['learning-recommendations'],
    queryFn: () => api<Recommendation[]>('/employees/me/learning-recommendations'),
  });

  const create = useMutation({
    mutationFn: () =>
      api('/development-plans', {
        method: 'POST',
        body: {
          title: title.trim(),
          objective: objective.trim() || undefined,
          targetDate: targetDate || undefined,
          actions: actions
            .filter((a) => a.description.trim())
            .map((a) => ({
              description: a.description.trim(),
              targetDate: a.targetDate || undefined,
            })),
        },
      }),
    onSuccess: onDone,
  });

  return (
    <Card kicker="New development plan" accent>
      {(recs.data?.length ?? 0) > 0 && (
        <div className="hr-note" style={{
          marginBottom: 'var(--space-4)', padding: 'var(--space-2) var(--space-3)',
        }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>
            Based on your competency gaps, you might work on:
          </p>
          <ul style={{ margin: '4px 0 0', paddingLeft: '1.1em', fontSize: 12 }}>
            {recs.data?.slice(0, 4).map((r) => (
              <li key={`${r.competencyId}-${r.resourceId}`}>
                {r.competencyName}
                {r.gap === null ? ' (not yet assessed)' : ` (${r.gap} below required)`}
                {' — '}{r.resourceTitle}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="sm:col-span-2">
          <Field label="Title">
            <input className={inputClass} required value={title}
                   onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Objective">
            <textarea rows={2} className={inputClass} value={objective}
                      onChange={(e) => setObjective(e.target.value)} />
          </Field>
        </div>
        <Field label="Target date">
          <input type="date" className={inputClass} value={targetDate}
                 onChange={(e) => setTargetDate(e.target.value)} />
        </Field>

        <div className="sm:col-span-2">
          <div className="flex items-center justify-between"
               style={{ marginBottom: 'var(--space-2)' }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Actions</span>
            <Btn type="button"
                 onClick={() => setActions((p) => [...p, { description: '', targetDate: '' }])}>
              Add action
            </Btn>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {actions.map((a, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={inputClass} required placeholder="What will you do?"
                  aria-label={`Action ${i + 1}`}
                  value={a.description}
                  onChange={(e) => setActions((p) =>
                    p.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))}
                />
                <input
                  type="date" className={inputClass}
                  aria-label={`Target date for action ${i + 1}`}
                  value={a.targetDate}
                  onChange={(e) => setActions((p) =>
                    p.map((x, idx) => idx === i ? { ...x, targetDate: e.target.value } : x))}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="sm:col-span-2 flex gap-3">
          <Btn type="submit" variant="primary" disabled={create.isPending}>
            Create as draft
          </Btn>
          <Btn type="button" onClick={onDone}>Cancel</Btn>
        </div>
        {create.error ? <div className="sm:col-span-2"><ErrorNote error={create.error} /></div> : null}
      </form>
    </Card>
  );
}

const ASSIGNMENT_STATES = ['assigned', 'in_progress', 'completed', 'waived'];

function Learning() {
  const qc = useQueryClient();
  const assignments = useQuery({
    queryKey: ['my-learning'],
    queryFn: () => api<Assignment[]>('/employees/me/learning'),
  });
  const recs = useQuery({
    queryKey: ['learning-recommendations'],
    queryFn: () => api<Recommendation[]>('/employees/me/learning-recommendations'),
  });

  const setState = useMutation({
    mutationFn: (input: { id: string; state: string }) =>
      api(`/learning-assignments/${input.id}/state`, {
        method: 'PATCH', body: { state: input.state },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-learning'] });
      void qc.invalidateQueries({ queryKey: ['development-plan'] });
    },
  });

  if (assignments.isLoading) return <Spinner />;
  if (assignments.error) return <ErrorNote error={assignments.error} />;

  const done = assignments.data?.filter((a) => a.state === 'completed').length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat kicker="Assigned" value={assignments.data?.length ?? 0} />
        <Stat kicker="Completed" value={done} />
        <Stat kicker="Recommended" value={recs.data?.length ?? 0}
              note="from your competency gaps" />
      </div>

      <Card kicker="My library">
        {assignments.data?.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
            Nothing assigned to you yet. Recommendations below are drawn from your
            competency gaps and need no assignment to act on.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Competency</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {assignments.data?.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.url ? (
                        <a href={a.url} target="_blank" rel="noreferrer noopener"
                           style={{ fontWeight: 500 }}>
                          {a.title}
                        </a>
                      ) : <span style={{ fontWeight: 500 }}>{a.title}</span>}
                      <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.55 }}>
                        {a.resourceType}
                        {a.durationMinutes ? ` · ${a.durationMinutes} min` : ''}
                      </span>
                      {/* Who assigned it decides who to ask about it. */}
                      {a.assignedBy && (
                        <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
                          assigned by {a.assignedBy}
                        </p>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{a.competencyName ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{a.dueOn ?? '—'}</td>
                    <td>
                      <label>
                        <span className="sr-only">Status for {a.title}</span>
                        <select
                          className={inputClass}
                          style={{ fontSize: 12, paddingBlock: 4 }}
                          value={a.state}
                          onChange={(e) => setState.mutate({ id: a.id, state: e.target.value })}
                        >
                          {ASSIGNMENT_STATES.map((s) => (
                            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorNote error={setState.error} />
      </Card>

      <Card kicker="Recommended for you">
        <p style={{ marginTop: 0, fontSize: 12, opacity: 0.7 }}>
          Matched to competencies where you are below the required level, or have
          not been assessed at all.
        </p>
        {recs.error ? <ErrorNote error={recs.error} /> : null}
        {recs.data?.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
            Nothing outstanding — every mapped competency is met.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recs.data?.map((r) => (
              <li key={`${r.competencyId}-${r.resourceId}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                  style={{
                    padding: 'var(--space-2) 0',
                    borderTop: '1px solid var(--color-neutral-200)',
                  }}>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
                    {r.resourceTitle}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
                    {r.competencyName} ·{' '}
                    {r.gap === null
                      ? 'not yet assessed'
                      : `${r.gap} below required (level ${r.requiredLevel} expected)`}
                  </p>
                </div>
                {r.alreadyAssigned && <Tag>already assigned</Tag>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Career() {
  const options = useQuery({
    queryKey: ['career-options'],
    queryFn: () => api<CareerOption[]>('/employees/me/career-options'),
  });

  if (options.isLoading) return <Spinner />;
  if (options.error) return <ErrorNote error={options.error} />;

  if (options.data?.length === 0) {
    return (
      <EmptyState title="No career paths defined yet">
        Career paths are mapped per position by HR. Until your current position has
        one, there is nothing to compare your competencies against.
      </EmptyState>
    );
  }

  return (
    <Card kicker="Where I could go next">
      <p style={{ marginTop: 0, fontSize: 12, opacity: 0.7 }}>
        Based on career paths defined for your current position, and how your
        assessed competencies compare to each role's requirements.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Move</th>
              <th>Typical time</th>
              <th>Requirements</th>
            </tr>
          </thead>
          <tbody>
            {options.data?.map((o) => (
              <tr key={o.toPositionId}>
                <td style={{ fontWeight: 500 }}>{o.toPositionTitle}</td>
                <td style={{ fontSize: 12 }}>{o.moveType.replace(/_/g, ' ')}</td>
                <td style={{ fontSize: 12 }}>
                  {o.typicalMonths ? `~${o.typicalMonths} months` : '—'}
                </td>
                {/* The counts sit in separate spans, so they need an explicit
                    separator — without one "/ 4" and "1 not assessed" render
                    as "41" and read as a single number.

                    Readiness is drawn against the TOTAL, and unassessed
                    requirements are stated rather than folded in: "3 of 4 met"
                    with one unassessed is not 75% ready, it is unknown. */}
                <td style={{ fontSize: 12, minWidth: 190 }}>
                  <div>
                    {o.requirementsMet} of {o.requirementsTotal} met
                    {o.requirementsUnassessed > 0
                      && ` · ${o.requirementsUnassessed} not assessed`}
                  </div>
                  {o.requirementsTotal > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <Bar pct={(o.requirementsMet / o.requirementsTotal) * 100} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
