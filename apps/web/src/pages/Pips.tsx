import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import type { Employee } from '../types';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import { Btn, Card, CheckinStatus, PageHead, Tag } from '../components/ds';

interface Pip {
  id: string;
  employeeId: string;
  employeeName: string;
  supervisorName: string;
  reason: string;
  expectedOutcome: string | null;
  startsOn: string;
  endsOn: string;
  reviewCadence: string;
  state: 'draft' | 'active' | 'completed' | 'cancelled';
  outcome: string | null;
  outcomeNotes: string | null;
  acknowledgedAt: string | null;
  milestoneCount: number;
  milestonesMet: number;
  milestonesPending: number;
}

interface Milestone {
  id: string;
  sequence: number;
  description: string;
  successCriteria: string | null;
  dueOn: string;
  met: boolean | null;
  assessmentNotes: string | null;
  assessedBy: string | null;
}

interface PipReview {
  id: string;
  reviewDate: string;
  progressSummary: string;
  statusFlag: 'on_track' | 'at_risk' | 'off_track';
  employeeComment: string | null;
  reviewedBy: string;
}

/**
 * Performance Improvement Plans.
 *
 * This screen shows only what the viewer is permitted to see -- a PIP is
 * visible to its subject, their direct supervisor, and HR, and the database
 * enforces that. An employee reaching this page sees their own plan and
 * nothing else, which is deliberate: someone on a PIP must be able to read it.
 */
export default function Pips() {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const pips = useQuery({ queryKey: ['pips'], queryFn: () => api<Pip[]>('/pips') });

  if (pips.isLoading) return <Spinner />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {/* The nav calls this "PIPs" for width; the heading spells it out, because
          the abbreviation is jargon to the employee who has just been put on
          one. */}
      <PageHead title="Performance improvement plans">
        <Btn variant="primary" onClick={() => setCreating((v) => !v)}>New PIP</Btn>
      </PageHead>

      {creating && <NewPipForm onDone={() => setCreating(false)} />}

      <Card kicker={`Plans (${pips.data?.length ?? 0})`}>
        <p className="mb-3 text-xs t-muted">
          Visible to the employee, their direct supervisor, and HR only.
        </p>
        {pips.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No plans on record.</p>
        ) : (
          <ul>
            {pips.data?.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <button
                      className="font-medium text-muted hover:underline"
                      onClick={() => setOpenId(openId === p.id ? null : p.id)}
                    >
                      {p.employeeName}
                    </button>
                    <p className="text-xs t-muted">
                      {p.startsOn} → {p.endsOn} · supervisor {p.supervisorName} ·{' '}
                      {p.milestonesMet}/{p.milestoneCount} milestones met
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!p.acknowledgedAt && p.state === 'active' && (
                      <span className="text-xs text-muted">not acknowledged</span>
                    )}
                    <span className="tag">
                      {p.state}{p.outcome ? ` · ${p.outcome}` : ''}
                    </span>
                  </div>
                </div>
                {openId === p.id && <PipDetail pip={p} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PipDetail({ pip }: { pip: Pip }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });

  const milestones = useQuery({
    queryKey: ['pip-milestones', pip.id],
    queryFn: () => api<Milestone[]>(`/pips/${pip.id}/milestones`),
  });
  const reviews = useQuery({
    queryKey: ['pip-reviews', pip.id],
    queryFn: () => api<PipReview[]>(`/pips/${pip.id}/reviews`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['pips'] });
    void qc.invalidateQueries({ queryKey: ['pip-milestones', pip.id] });
    void qc.invalidateQueries({ queryKey: ['pip-reviews', pip.id] });
  };

  const act = useMutation({
    mutationFn: (input: { path: string; body?: unknown }) =>
      api(`/pips/${pip.id}/${input.path}`, { method: 'POST', body: input.body }),
    onSuccess: invalidate,
  });

  const assess = useMutation({
    mutationFn: (input: { id: string; met: boolean }) =>
      api(`/pip-milestones/${input.id}/assess`, {
        method: 'POST', body: { met: input.met },
      }),
    onSuccess: invalidate,
  });

  const isSubject = me.data?.id === pip.employeeId;

  return (
    <div className="mt-3 space-y-4 panel-tint p-4">
      <div>
        <h3 className="text-xs font-semibold tracking-wide t-muted uppercase">Reason</h3>
        <p className="mt-1 text-sm">{pip.reason}</p>
        {pip.expectedOutcome && (
          <p className="mt-2 text-sm">
            <span className="font-medium">Expected outcome: </span>{pip.expectedOutcome}
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide t-muted uppercase">
          Milestones
        </h3>
        <ul className="space-y-2">
          {milestones.data?.map((m) => (
            <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 rounded border border-divider bg-surface px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm">{m.description}</p>
                {m.successCriteria && (
                  <p className="text-xs t-muted">Criteria: {m.successCriteria}</p>
                )}
                <p className="text-xs t-muted">
                  due {m.dueOn}
                  {m.assessedBy && ` · assessed by ${m.assessedBy}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {m.met === null ? (
                  pip.state === 'active' && !isSubject && (
                    <>
                      <Btn onClick={() => assess.mutate({ id: m.id, met: true })}>Met</Btn>
                      <Btn
                              onClick={() => assess.mutate({ id: m.id, met: false })}>
                        Not met
                      </Btn>
                    </>
                  )
                ) : (
                  // A met and a not-met milestone rendered identically here: the
                  // conversion left both branches of the class the same, so the
                  // only difference was the word. On a PIP — where the whole
                  // point is whether the milestones were met — that is the one
                  // distinction that has to be visible.
                  <Tag tone={m.met ? 'accent' : 'outline'}>
                    {m.met ? 'met' : 'not met'}
                  </Tag>
                )}
              </div>
            </li>
          ))}
        </ul>
        <ErrorNote error={assess.error} />
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide t-muted uppercase">
          Reviews
        </h3>
        {reviews.data?.length === 0 ? (
          <p className="text-sm t-muted">No reviews recorded.</p>
        ) : (
          <ol className="space-y-2">
            {reviews.data?.map((r) => (
              <li key={r.id} className="border-l-2 border-divider pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CheckinStatus status={r.statusFlag} />
                  <span className="text-xs t-muted">{r.reviewDate} · {r.reviewedBy}</span>
                </div>
                <p className="mt-1 text-sm">{r.progressSummary}</p>
                {r.employeeComment && (
                  <p className="mt-1 text-sm t-muted italic">
                    Employee: {r.employeeComment}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {pip.state === 'active' && !isSubject && (
        <PipReviewForm pipId={pip.id} onDone={invalidate} />
      )}

      <div className="flex flex-wrap gap-2 no-print">
        {pip.state === 'draft' && !isSubject && (
          <Btn variant="primary" onClick={() => act.mutate({ path: 'activate' })}>
            Activate plan
          </Btn>
        )}
        {pip.state === 'active' && isSubject && !pip.acknowledgedAt && (
          <Btn variant="primary" onClick={() => act.mutate({ path: 'acknowledge' })}>
            Acknowledge receipt
          </Btn>
        )}
        {pip.state === 'active' && !isSubject && (
          <>
            <Btn onClick={() => act.mutate({
              path: 'close', body: { outcome: 'successful' } })}>
              Close — successful
            </Btn>
            <Btn onClick={() => act.mutate({
              path: 'close', body: { outcome: 'extended' } })}>
              Close — extended
            </Btn>
            <Btn onClick={() => act.mutate({
              path: 'close', body: { outcome: 'unsuccessful' } })}>
              Close — unsuccessful
            </Btn>
          </>
        )}
      </div>
      <ErrorNote error={act.error} />
    </div>
  );
}

function PipReviewForm({ pipId, onDone }: { pipId: string; onDone: () => void }) {
  const [reviewDate, setReviewDate] = useState(new Date().toISOString().slice(0, 10));
  const [statusFlag, setStatusFlag] = useState('on_track');
  const [progressSummary, setProgressSummary] = useState('');
  const [employeeComment, setEmployeeComment] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api(`/pips/${pipId}/reviews`, {
        method: 'POST',
        body: {
          reviewDate, statusFlag, progressSummary: progressSummary.trim(),
          employeeComment: employeeComment.trim() || undefined,
        },
      }),
    onSuccess: () => { setProgressSummary(''); setEmployeeComment(''); onDone(); },
  });

  return (
    <form className="grid gap-3 rounded-md border border-divider bg-surface p-3 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Review date">
        <input type="date" required className={inputClass} value={reviewDate}
               onChange={(e) => setReviewDate(e.target.value)} />
      </Field>
      <Field label="Status">
        <select className={inputClass} value={statusFlag}
                onChange={(e) => setStatusFlag(e.target.value)}>
          <option value="on_track">On track</option>
          <option value="at_risk">At risk</option>
          <option value="off_track">Off track</option>
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Progress summary">
          <textarea rows={2} required className={inputClass} value={progressSummary}
                    onChange={(e) => setProgressSummary(e.target.value)} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Employee comment"
               hint="Record the employee's own response — a one-sided PIP record is weak evidence">
          <textarea rows={2} className={inputClass} value={employeeComment}
                    onChange={(e) => setEmployeeComment(e.target.value)} />
        </Field>
      </div>
      <div className="sm:col-span-2 flex items-center gap-3">
        <Btn type="submit" variant="primary" disabled={save.isPending}>Record review</Btn>
        <span className="text-xs t-muted">Reviews are permanent and cannot be edited.</span>
      </div>
      {save.error ? <div className="sm:col-span-2"><ErrorNote error={save.error} /></div> : null}
    </form>
  );
}

function NewPipForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const reports = useQuery({
    queryKey: ['reports'],
    queryFn: () => api<Employee[]>('/employees/me/reports'),
  });

  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState('');
  const [expectedOutcome, setExpectedOutcome] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [reviewCadence, setReviewCadence] = useState('biweekly');
  const [milestones, setMilestones] = useState([
    { description: '', successCriteria: '', dueOn: '' },
  ]);

  const create = useMutation({
    mutationFn: () =>
      api('/pips', {
        method: 'POST',
        body: {
          employeeId, reason: reason.trim(),
          expectedOutcome: expectedOutcome.trim() || undefined,
          startsOn, endsOn, reviewCadence,
          milestones: milestones.map((m) => ({
            description: m.description.trim(),
            successCriteria: m.successCriteria.trim() || undefined,
            dueOn: m.dueOn,
          })),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pips'] });
      onDone();
    },
  });

  const patch = (i: number, p: Partial<(typeof milestones)[number]>) =>
    setMilestones((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...p } : m)));

  return (
    <Card kicker="New performance improvement plan">
      <form className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Employee">
          <select className={inputClass} value={employeeId} required
                  onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select…</option>
            {reports.data?.map((r) => (
              <option key={r.id} value={r.id}>{r.firstName} {r.lastName}</option>
            ))}
          </select>
        </Field>

        <Field label="Review cadence">
          <select className={inputClass} value={reviewCadence}
                  onChange={(e) => setReviewCadence(e.target.value)}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="Reason"
            hint="Be specific and factual. This is an employment record and may be read back later."
          >
            <textarea rows={3} required minLength={10} className={inputClass} value={reason}
                      onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Expected outcome">
            <textarea rows={2} className={inputClass} value={expectedOutcome}
                      onChange={(e) => setExpectedOutcome(e.target.value)} />
          </Field>
        </div>

        <Field label="Starts">
          <input type="date" required className={inputClass} value={startsOn}
                 onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label="Ends">
          <input type="date" required className={inputClass} value={endsOn}
                 onChange={(e) => setEndsOn(e.target.value)} />
        </Field>

        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">
              Milestones <span className="text-xs font-normal t-muted">(at least one required)</span>
            </h3>
            <Btn type="button"
                    onClick={() => setMilestones((p) => [...p, { description: '', successCriteria: '', dueOn: '' }])}>
              Add milestone
            </Btn>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {milestones.map((m, i) => (
              <div key={i} className="grid gap-3 rounded-md border border-divider p-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Field label="Description">
                    <input required className={inputClass} value={m.description}
                           onChange={(e) => patch(i, { description: e.target.value })} />
                  </Field>
                </div>
                <Field label="Due">
                  <input type="date" required className={inputClass} value={m.dueOn}
                         onChange={(e) => patch(i, { dueOn: e.target.value })} />
                </Field>
                <div className="sm:col-span-3">
                  <Field label="Success criteria" hint="How will this be judged met or not met?">
                    <input className={inputClass} value={m.successCriteria}
                           onChange={(e) => patch(i, { successCriteria: e.target.value })} />
                  </Field>
                </div>
                {milestones.length > 1 && (
                  <div className="sm:col-span-3">
                    <Btn type="button"
                            onClick={() => setMilestones((p) => p.filter((_, idx) => idx !== i))}>
                      Remove
                    </Btn>
                  </div>
                )}
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
