import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { ErrorNote, Field, inputClass } from '../../components/ui';
import { Btn, Card } from '../../components/ds';

/**
 * The three operations that act on somebody who already exists (D-016).
 *
 * They sit beside the history rather than on a form of their own, because the
 * history is what records them — you decide what happened by reading what
 * already has.
 *
 * DELIBERATELY NOT ONE DIALOG WITH A TYPE DROPDOWN. Correcting a misspelt
 * surname and recording a promotion are one word in English and opposites in
 * the data: a correction rewrites history because the old value was never true,
 * a change appends to it because the old value WAS true until a date. A single
 * form invites somebody to type a new department into the correction box, and
 * that silently re-parents every past review.
 */

interface Blocker { kind: string; detail: string }

const EVENTS = [
  ['regularization', 'Regularisation', 'They passed probation.'],
  ['promotion', 'Promotion', 'A new position at a higher rank.'],
  ['lateral_transfer', 'Transfer', 'A new position or section, same rank.'],
  ['demotion', 'Demotion', 'A lower rank.'],
  ['rehire', 'Rehire', 'Returning after separation.'],
] as const;

type Mode = null | 'change' | 'correct' | 'separate';

export default function EmploymentActions(
  { employeeId, name }: { employeeId: string; name: string },
) {
  const [mode, setMode] = useState<Mode>(null);
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['timeline', employeeId] });
    void qc.invalidateQueries({ queryKey: ['employee', employeeId] });
    setMode(null);
  };

  return (
    <Card
      kicker="Employment"
      title="Record something"
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Btn variant={mode === 'change' ? 'primary' : 'secondary'}
               onClick={() => setMode(mode === 'change' ? null : 'change')}>
            Record a change
          </Btn>
          <Btn variant={mode === 'correct' ? 'primary' : 'secondary'}
               onClick={() => setMode(mode === 'correct' ? null : 'correct')}>
            Correct a mistake
          </Btn>
          <Btn variant={mode === 'separate' ? 'primary' : 'secondary'}
               onClick={() => setMode(mode === 'separate' ? null : 'separate')}>
            End employment
          </Btn>
        </div>
      }
    >
      {mode === null && (
        <p className="text-muted">
          A <strong>change</strong> is something that happened — it keeps what was
          true before it and starts a new period from the date you give.
          A <strong>correction</strong> fixes something that was never right, and
          leaves the dates alone.
        </p>
      )}

      {mode === 'change' && <ChangeForm employeeId={employeeId} onDone={refresh} />}
      {mode === 'correct' && <CorrectForm employeeId={employeeId} onDone={refresh} />}
      {mode === 'separate' && (
        <SeparateForm employeeId={employeeId} name={name} onDone={refresh} />
      )}
    </Card>
  );
}

function ChangeForm(
  { employeeId, onDone }: { employeeId: string; onDone: () => void },
) {
  const [event, setEvent] = useState<typeof EVENTS[number][0]>('regularization');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api<{ id: string; name: string }[]>('/departments'),
  });
  const positions = useQuery({
    queryKey: ['positions'],
    queryFn: () => api<{ id: string; title: string }[]>('/positions'),
  });

  const save = useMutation({
    mutationFn: () => api(`/employees/${employeeId}/employment-events`, {
      method: 'POST',
      body: {
        event,
        effectiveFrom,
        reason,
        // Omitted rather than sent empty: the server carries forward anything
        // not restated, so a promotion that changes only the position must not
        // blank the department.
        ...(departmentId ? { departmentId } : {}),
        ...(positionId ? { positionId } : {}),
        ...(event === 'regularization' ? { status: 'regular' } : {}),
      },
    }),
    onSuccess: onDone,
  });

  const chosen = EVENTS.find(([k]) => k === event);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Field label="What happened">
        <select className={inputClass} value={event}
                onChange={(e) => setEvent(e.target.value as typeof event)}>
          {EVENTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </Field>
      {chosen && <p className="text-muted">{chosen[2]}</p>}

      <Field label="Effective from"
             hint="The date it took effect. A date in the past is fine — the period it lands in is split.">
        <input className={inputClass} type="date" value={effectiveFrom}
               onChange={(e) => setEffectiveFrom(e.target.value)} />
      </Field>

      <Field label="New section" hint="Leave empty to keep them where they are.">
        <select className={inputClass} value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">— unchanged —</option>
          {(departments.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </Field>

      <Field label="New position" hint="Leave empty to keep their current one.">
        <select className={inputClass} value={positionId}
                onChange={(e) => setPositionId(e.target.value)}>
          <option value="">— unchanged —</option>
          {(positions.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      </Field>

      <Field label="Reason" hint="Required. This is what makes the change defensible later.">
        <input className={inputClass} value={reason}
               onChange={(e) => setReason(e.target.value)}
               placeholder="Passed probation" />
      </Field>

      <ErrorNote error={save.error} />
      <div>
        <Btn variant="primary"
             disabled={!effectiveFrom || !reason.trim() || save.isPending}
             onClick={() => save.mutate()}>
          {save.isPending ? 'Recording…' : 'Record this change'}
        </Btn>
      </div>
    </div>
  );
}

function CorrectForm(
  { employeeId, onDone }: { employeeId: string; onDone: () => void },
) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => api(`/employees/${employeeId}`, {
      method: 'PATCH',
      // Only what was actually typed. Sending untouched fields as empty strings
      // would blank them.
      body: Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v.trim() !== '')),
    }),
    onSuccess: onDone,
  });

  const dirty = Object.values(fields).some((v) => v.trim() !== '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p className="text-muted">
        For something that was never right — a misspelt name, a mistyped hire
        date. It changes the record and leaves every date and period alone.
        To record a transfer or a promotion, use <strong>Record a change</strong>.
      </p>

      <Field label="Employee number">
        <input className={inputClass} value={fields.employeeNo ?? ''}
               onChange={set('employeeNo')} placeholder="unchanged" />
      </Field>
      <Field label="First name">
        <input className={inputClass} value={fields.firstName ?? ''}
               onChange={set('firstName')} placeholder="unchanged" />
      </Field>
      <Field label="Last name">
        <input className={inputClass} value={fields.lastName ?? ''}
               onChange={set('lastName')} placeholder="unchanged" />
      </Field>
      <Field label="Work email"
             hint="Sign-in is matched on this the first time. Changing it after they have signed in does not move their account.">
        <input className={inputClass} type="email" value={fields.workEmail ?? ''}
               onChange={set('workEmail')} placeholder="unchanged" />
      </Field>
      <Field label="Date hired">
        <input className={inputClass} type="date" value={fields.hiredOn ?? ''}
               onChange={set('hiredOn')} />
      </Field>

      <ErrorNote error={save.error} />
      <div>
        <Btn variant="primary" disabled={!dirty || save.isPending}
             onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save correction'}
        </Btn>
      </div>
    </div>
  );
}

function SeparateForm(
  { employeeId, name, onDone }:
  { employeeId: string; name: string; onDone: () => void },
) {
  const [separatedOn, setSeparatedOn] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  // Read before acting. The server refuses without acknowledgement anyway, but
  // being told what you are about to orphan beats being refused and guessing.
  const blockers = useQuery({
    queryKey: ['separation-blockers', employeeId],
    queryFn: () => api<Blocker[]>(`/employees/${employeeId}/separation-blockers`),
  });

  const save = useMutation({
    mutationFn: () => api(`/employees/${employeeId}/separation`, {
      method: 'POST',
      body: { separatedOn, reason, acknowledgeBlockers: acknowledged },
    }),
    onSuccess: onDone,
  });

  const found = blockers.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p className="text-muted">
        This closes {name || 'their'} employment. Nothing is deleted — their
        reviews, goals and history stay, because a past decision still has to be
        answerable.
      </p>

      {found.length > 0 && (
        <div>
          <strong>This would leave work unfinished:</strong>
          <ul>
            {found.map((b, i) => (
              <li key={i}>
                {b.kind === 'open_review' ? 'Unsubmitted review' : 'Running PIP'}
                {' — '}{b.detail}
              </li>
            ))}
          </ul>
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input type="checkbox" checked={acknowledged}
                   onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>Separate anyway — I have read the above</span>
          </label>
        </div>
      )}

      <Field label="Last day" hint="Their final day of employment.">
        <input className={inputClass} type="date" value={separatedOn}
               onChange={(e) => setSeparatedOn(e.target.value)} />
      </Field>
      <Field label="Reason">
        <input className={inputClass} value={reason}
               onChange={(e) => setReason(e.target.value)}
               placeholder="Resigned" />
      </Field>

      <ErrorNote error={save.error} />
      <div>
        <Btn variant="primary"
             disabled={!separatedOn || !reason.trim() || save.isPending
                       || (found.length > 0 && !acknowledged)}
             onClick={() => save.mutate()}>
          {save.isPending ? 'Recording…' : 'End employment'}
        </Btn>
      </div>
    </div>
  );
}
