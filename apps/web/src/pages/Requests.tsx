import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import { Btn, Card, Dialog, EmptyState, PageHead, Section, Tag } from '../components/ds';

/**
 * Requests (§7.9, F4).
 *
 * ONE LIST, NOT TWO.
 *
 * The server returns everything you raised and everything you may decide, in
 * one query, because RLS produces exactly that union. The screen splits them
 * by whether you can act — "waiting on you" first, then "yours" — rather than
 * asking the server which kind of person you are. A `role === 'hr_admin'`
 * branch here would be the authorization boundary re-implemented in the
 * browser, which is the mistake the unit dashboard exists as a counter-example
 * to.
 *
 * The distinction between the two blocks is made from the DATA (does this row
 * have a decision I can make?), not from a claim about the user.
 */

interface Req {
  id: string;
  requestType: string;
  state: string;
  requestedById: string;
  requestedBy: string;
  subjectEmployeeId: string | null;
  subjectName: string | null;
  department: string | null;
  competency: string | null;
  reviewCycle: string | null;
  currentScore: number | null;
  proposedScore: number | null;
  rationale: string;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

interface Me { id: string }

const TYPE_LABEL: Record<string, string> = {
  extra_competency: 'Extra competency',
  special_evaluation: 'Special evaluation',
  scoring_adjustment: 'Scoring adjustment',
};

const STATE_TONE: Record<string, 'accent' | 'neutral' | 'outline' | 'solid'> = {
  submitted: 'solid',
  approved: 'accent',
  declined: 'outline',
  withdrawn: 'neutral',
  draft: 'neutral',
};

export default function Requests() {
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [deciding, setDeciding] = useState<Req | null>(null);

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/employees/me') });
  const list = useQuery({ queryKey: ['requests'], queryFn: () => api<Req[]>('/requests') });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['requests'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  if (list.error) return <ErrorNote error={list.error} />;
  if (list.isLoading || me.isLoading) return <Spinner />;

  const all = list.data ?? [];
  const myId = me.data?.id;

  // Derived from the row, not from a role: a submitted request that is not
  // mine is one I was shown because I may decide it — RLS would not have
  // returned it otherwise.
  const toDecide = all.filter((r) => r.state === 'submitted' && r.requestedById !== myId);
  const mine = all.filter((r) => r.requestedById === myId);
  const others = all.filter(
    (r) => r.requestedById !== myId && r.state !== 'submitted');

  return (
    <Section>
      <PageHead
        title="Requests"
        meta={<span style={{ fontSize: 15, opacity: 0.7 }}>
          Extra competency · special evaluation · scoring adjustment
        </span>}
      >
        <Btn variant="primary" onClick={() => setComposing(true)}>Raise a request</Btn>
      </PageHead>

      {all.length === 0 && (
        <EmptyState title="No requests">
          When a section needs something outside the standard cycle — a
          competency added, a one-off evaluation, a score revisited — it is
          asked for here, and the answer is recorded with it.
        </EmptyState>
      )}

      {toDecide.length > 0 && (
        <Card kicker="Your queue" title="Waiting on your decision" accent>
          <RequestTable rows={toDecide} onDecide={setDeciding} />
        </Card>
      )}

      {mine.length > 0 && (
        <Card kicker="Yours" title="Requests you raised">
          <RequestTable
            rows={mine}
            onWithdraw={async (r) => {
              await api(`/requests/${r.id}/withdrawal`, { method: 'PATCH' });
              refresh();
            }}
          />
        </Card>
      )}

      {others.length > 0 && (
        <Card kicker="Settled" title="Already decided">
          <RequestTable rows={others} />
        </Card>
      )}

      {/* Said on the screen, not only in the migration. People read an
          approval as the thing being done, and then nobody does it. */}
      <p className="text-muted" style={{ fontSize: 15.5 }}>
        Approving a request records the decision. The change itself is still
        made on the screen that owns it — competencies, evaluations, the review
        — so that it is audited as the change it is.
      </p>

      {composing && (
        <ComposeDialog
          onClose={() => setComposing(false)}
          onDone={() => { setComposing(false); refresh(); }}
        />
      )}
      {deciding && (
        <DecideDialog
          request={deciding}
          onClose={() => setDeciding(null)}
          onDone={() => { setDeciding(null); refresh(); }}
        />
      )}
    </Section>
  );
}

function RequestTable(
  { rows, onDecide, onWithdraw }: {
    rows: Req[];
    onDecide?: (r: Req) => void;
    onWithdraw?: (r: Req) => void | Promise<void>;
  },
) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Type</th><th>About</th><th>Asked by</th>
            <th>Reason</th><th>State</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {TYPE_LABEL[r.requestType] ?? r.requestType}
                {r.competency && <div className="text-muted">{r.competency}</div>}
                {r.proposedScore !== null && (
                  <div className="text-muted">
                    {r.currentScore ?? '—'} → {r.proposedScore}
                  </div>
                )}
              </td>
              <td>
                {r.subjectName ?? r.department ?? '—'}
                {r.reviewCycle && <div className="text-muted">{r.reviewCycle}</div>}
              </td>
              <td>{r.requestedBy}</td>
              <td style={{ maxWidth: '32ch' }}>{r.rationale}</td>
              <td>
                <Tag tone={STATE_TONE[r.state] ?? 'neutral'}>{r.state}</Tag>
                {r.decidedBy && (
                  <div className="text-muted">
                    by {r.decidedBy}
                    {r.decisionNote && <> — {r.decisionNote}</>}
                  </div>
                )}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {onDecide && <Btn onClick={() => onDecide(r)}>Decide</Btn>}
                {onWithdraw && (r.state === 'submitted' || r.state === 'draft') && (
                  <Btn onClick={() => void onWithdraw(r)}>Withdraw</Btn>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Employee { id: string; firstName: string; lastName: string }
interface Competency { id: string; name: string }

function ComposeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState('scoring_adjustment');
  const [subject, setSubject] = useState('');
  const [competency, setCompetency] = useState('');
  const [current, setCurrent] = useState('');
  const [proposed, setProposed] = useState('');
  const [rationale, setRationale] = useState('');

  // Both lists come back scoped by RLS, so the pickers can only offer people
  // and competencies the caller may already act on. That is the same gate as
  // the one on submission, which is why there is no second check here.
  const people = useQuery({
    queryKey: ['employees'], queryFn: () => api<Employee[]>('/employees'),
  });
  const comps = useQuery({
    queryKey: ['competencies'], queryFn: () => api<Competency[]>('/competencies'),
  });

  const submit = useMutation({
    mutationFn: () => api('/requests', {
      method: 'POST',
      body: {
        requestType: type,
        ...(subject ? { subjectEmployeeId: subject } : {}),
        ...(type === 'extra_competency' && competency ? { competencyId: competency } : {}),
        ...(type === 'scoring_adjustment' && current ? { currentScore: Number(current) } : {}),
        ...(type === 'scoring_adjustment' && proposed ? { proposedScore: Number(proposed) } : {}),
        rationale,
      },
    }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      title="Raise a request"
      onDismiss={onClose}
      actions={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={!rationale.trim() || submit.isPending}
            onClick={() => submit.mutate()}
          >
            Send for decision
          </Btn>
        </>
      }
    >
      {submit.error && <ErrorNote error={submit.error} />}

      <Field label="What are you asking for?">
        <select className={inputClass} value={type}
                onChange={(e) => setType(e.target.value)}>
          <option value="scoring_adjustment">A scoring adjustment</option>
          <option value="special_evaluation">A special evaluation</option>
          <option value="extra_competency">An extra competency</option>
        </select>
      </Field>

      <Field
        label="Who is it about?"
        hint={type === 'extra_competency'
          ? 'Optional — leave blank if it is for the whole unit.'
          : undefined}
      >
        <select className={inputClass} value={subject}
                onChange={(e) => setSubject(e.target.value)}>
          <option value="">
            {type === 'extra_competency' ? 'My unit' : 'Choose a person'}
          </option>
          {people.data?.map((p) => (
            <option key={p.id} value={p.id}>{p.lastName}, {p.firstName}</option>
          ))}
        </select>
      </Field>

      {type === 'extra_competency' && (
        <Field label="Which competency?">
          <select className={inputClass} value={competency}
                  onChange={(e) => setCompetency(e.target.value)}>
            <option value="">Choose a competency</option>
            {comps.data?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      )}

      {type === 'scoring_adjustment' && (
        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="Score now" hint="What the approver will be looking at.">
            <input className={inputClass} type="number" step="0.01"
                   value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Proposed">
            <input className={inputClass} type="number" step="0.01"
                   value={proposed} onChange={(e) => setProposed(e.target.value)} />
          </Field>
        </div>
      )}

      <Field
        label="Why"
        hint="Required. An approver who has to guess is one whose guess gets audited."
      >
        <textarea className={inputClass} rows={4} value={rationale}
                  onChange={(e) => setRationale(e.target.value)} />
      </Field>
    </Dialog>
  );
}

function DecideDialog(
  { request, onClose, onDone }:
  { request: Req; onClose: () => void; onDone: () => void },
) {
  const [note, setNote] = useState('');

  const answer = useMutation({
    mutationFn: (decision: 'approved' | 'declined') =>
      api(`/requests/${request.id}/decision`, {
        method: 'PATCH',
        body: { decision, ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      title={TYPE_LABEL[request.requestType] ?? 'Request'}
      onDismiss={onClose}
      actions={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          {/* Declining needs a reason; the button says so before it is pressed
              rather than after the server refuses. */}
          <Btn disabled={!note.trim() || answer.isPending}
               onClick={() => answer.mutate('declined')}>
            Decline
          </Btn>
          <Btn variant="primary" disabled={answer.isPending}
               onClick={() => answer.mutate('approved')}>
            Approve
          </Btn>
        </>
      }
    >
      {answer.error && <ErrorNote error={answer.error} />}

      <p className="card-body">
        <strong>{request.requestedBy}</strong> asks about{' '}
        <strong>{request.subjectName ?? request.department ?? 'the unit'}</strong>.
      </p>
      {request.proposedScore !== null && (
        <p className="card-body">
          Score {request.currentScore ?? '—'} → <strong>{request.proposedScore}</strong>
        </p>
      )}
      {request.competency && <p className="card-body">Competency: {request.competency}</p>}
      <p className="card-body">{request.rationale}</p>

      <Field label="Note" hint="Required to decline. Optional on an approval.">
        <textarea className={inputClass} rows={3} value={note}
                  onChange={(e) => setNote(e.target.value)} />
      </Field>

      <p className="text-muted" style={{ fontSize: 15.5 }}>
        Approving records your decision. It does not make the change — that is
        still done on the screen that owns it.
      </p>
    </Dialog>
  );
}
