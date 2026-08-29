import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { ErrorNote, Spinner } from '../../components/ui';
import { Btn, Card, Tag } from '../../components/ds';

/**
 * The evaluation types (requirements §2).
 *
 * The client names five — probationary, annual, semi-annual, project, KPI — and
 * they are five rows of configuration here rather than five features. This
 * screen is where that becomes visible: the same five fields describe all of
 * them, and the differences between the types are values, not code.
 *
 * Nothing here schedules anything. A probationary type says its instances fall
 * at months 3 and 4 from the hire date; what fires them is C2, and C2 waits on
 * Q7. The anchor is editable precisely so that answer costs a click.
 */

type EvalType = 'probationary' | 'annual' | 'semi_annual' | 'project' | 'kpi';
type PeriodBasis = 'calendar' | 'employee_relative';
type Anchor = 'hired_on' | 'regularized_on' | 'last_promoted_on';
type Averaging = 'single' | 'mean';
type Participant = 'self' | 'supervisor' | 'dept_head' | 'peer' | 'subordinate';

interface Definition {
  id: string;
  code: string;
  name: string;
  description: string | null;
  evalType: EvalType;
  periodBasis: PeriodBasis;
  anchor: Anchor | null;
  offsetMonths: number[] | null;
  expectedInstances: number;
  averaging: Averaging;
  participants: Participant[];
  isActive: boolean;
  cyclesIssued: number;
}

const TYPE_LABEL: Record<EvalType, string> = {
  probationary: 'Probationary',
  annual: 'Annual',
  semi_annual: 'Semi-annual',
  project: 'Project / term',
  kpi: 'KPI',
};

const ANCHOR_LABEL: Record<Anchor, string> = {
  hired_on: 'date hired',
  regularized_on: 'regularisation',
  last_promoted_on: 'last promotion',
};

const PARTICIPANT_LABEL: Record<Participant, string> = {
  self: 'Self',
  supervisor: 'Supervisor',
  dept_head: 'Department Head',
  peer: 'Peer',
  subordinate: 'Subordinate',
};

/** Plain words for when a type fires, since the columns alone do not say it. */
function periodSentence(d: Definition): string {
  if (d.periodBasis === 'calendar') {
    return d.expectedInstances > 1
      ? `${d.expectedInstances} evaluations over the period, averaged`
      : 'One evaluation over the period';
  }
  const months = (d.offsetMonths ?? []).join(' and ');
  const anchor = d.anchor ? ANCHOR_LABEL[d.anchor] : 'an unset anchor';
  return `Month ${months} after ${anchor}`
    + (d.averaging === 'mean' ? ', averaged' : '');
}

export default function EvaluationTypes() {
  const qc = useQueryClient();
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const definitions = useQuery({
    queryKey: ['evaluation-definitions', showRetired],
    queryFn: () => api<Definition[]>(
      `/evaluation-definitions?includeRetired=${showRetired}`),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api(`/evaluation-definitions/${id}/active`, {
        method: 'PATCH', body: { isActive },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evaluation-definitions'] }),
  });

  if (definitions.isLoading) return <Spinner />;
  if (definitions.error) return <ErrorNote error={definitions.error} />;
  const rows = definitions.data ?? [];

  return (
    <Card
      kicker="Evaluation types"
      actions={
        <label className="flex items-center gap-1.5 text-xs t-muted no-print">
          <input type="checkbox" checked={showRetired}
                 onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired
        </label>
      }
    >
      <p className="card-body text-xs t-muted" style={{ marginTop: 0 }}>
        Each type is a configuration, not a separate process: the same fields
        describe all of them. A type that has issued cycles cannot be deleted —
        retire it instead, so the record of what those cycles meant survives.
      </p>

      {setActive.error ? <ErrorNote error={setActive.error} /> : null}

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
              <th>When it runs</th>
              <th>Taking part</th>
              <th className="text-right">Cycles</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={d.isActive ? '' : 't-faint'}>
                <td className="t-mono text-xs">{d.code}</td>
                <td>
                  {d.name}
                  {!d.isActive && <Tag>retired</Tag>}
                </td>
                <td className="text-xs t-muted">{TYPE_LABEL[d.evalType]}</td>
                <td className="text-xs t-muted">{periodSentence(d)}</td>
                <td className="text-xs t-muted">
                  {d.participants.map((p) => PARTICIPANT_LABEL[p]).join(', ')}
                </td>
                {/* The number an administrator wants before retiring one. */}
                <td className="text-right tabular-nums text-xs">
                  {d.cyclesIssued === 0
                    ? <span className="t-faint">none</span>
                    : d.cyclesIssued}
                </td>
                <td className="text-right no-print" style={{ whiteSpace: 'nowrap' }}>
                  <Btn variant="ghost"
                       onClick={() => setEditing(editing === d.id ? null : d.id)}>
                    {editing === d.id ? 'Close' : 'Edit'}
                  </Btn>
                  <Btn
                    variant="ghost"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: d.id, isActive: !d.isActive })}
                  >
                    {d.isActive ? 'Retire' : 'Restore'}
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditDefinition
          definition={rows.find((d) => d.id === editing)!}
          onDone={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ['evaluation-definitions'] });
          }}
        />
      )}
    </Card>
  );
}

function EditDefinition({ definition, onDone }: {
  definition: Definition; onDone: () => void;
}) {
  const [d, setD] = useState<Definition>(definition);

  const save = useMutation({
    mutationFn: () => api(`/evaluation-definitions/${d.id}`, {
      method: 'PATCH',
      body: {
        code: d.code,
        name: d.name,
        description: d.description ?? undefined,
        evalType: d.evalType,
        periodBasis: d.periodBasis,
        anchor: d.periodBasis === 'employee_relative' ? d.anchor : null,
        offsetMonths: d.periodBasis === 'employee_relative' ? d.offsetMonths : null,
        expectedInstances: d.expectedInstances,
        averaging: d.averaging,
        participants: d.participants,
      },
    }),
    onSuccess: onDone,
  });

  const field = { display: 'flex', flexDirection: 'column' as const,
                  gap: 'var(--space-1)', fontSize: 12 };

  const toggle = (p: Participant) => setD({
    ...d,
    participants: d.participants.includes(p)
      ? d.participants.filter((x) => x !== p)
      : [...d.participants, p],
  });

  return (
    <div className="card-body" style={{ display: 'flex', flexDirection: 'column',
                                        gap: 'var(--space-3)' }}>
      <div style={{ display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                    gap: 'var(--space-3)' }}>
        <label style={field}>
          Name
          <input className="input" value={d.name}
                 onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>

        <label style={field}>
          Period basis
          <select
            className="input"
            value={d.periodBasis}
            onChange={(e) => {
              const periodBasis = e.target.value as PeriodBasis;
              // Clearing the anchor and offsets when switching to calendar is
              // not tidiness — the database refuses a calendar type that still
              // carries them, precisely so a stale offset cannot come back to
              // life when somebody switches the basis again.
              setD(periodBasis === 'calendar'
                ? { ...d, periodBasis, anchor: null, offsetMonths: null }
                : {
                  ...d, periodBasis,
                  anchor: d.anchor ?? 'hired_on',
                  offsetMonths: d.offsetMonths ?? [3, 4],
                });
            }}
          >
            <option value="calendar">Calendar — same dates for everyone</option>
            <option value="employee_relative">
              Employee-relative — dates from their own record
            </option>
          </select>
        </label>

        {d.periodBasis === 'employee_relative' && (
          <>
            <label style={field}>
              Counted from
              <select className="input" value={d.anchor ?? 'hired_on'}
                      onChange={(e) => setD({ ...d, anchor: e.target.value as Anchor })}>
                <option value="hired_on">Date hired</option>
                <option value="regularized_on">Regularisation</option>
                <option value="last_promoted_on">Last promotion</option>
              </select>
            </label>
            <label style={field}>
              Months
              <input
                className="input"
                value={(d.offsetMonths ?? []).join(', ')}
                placeholder="3, 4"
                onChange={(e) => setD({
                  ...d,
                  offsetMonths: e.target.value.split(',')
                    .map((v) => Number(v.trim()))
                    .filter((n) => Number.isFinite(n) && n > 0),
                })}
              />
            </label>
          </>
        )}

        <label style={field}>
          Evaluations per result
          <input className="input tabular-nums" type="number" min={1} max={12}
                 value={d.expectedInstances}
                 onChange={(e) => {
                   const expectedInstances = Number(e.target.value);
                   // Kept in step with the averaging rule, which the database
                   // also enforces: averaging one evaluation is meaningless,
                   // and not averaging two silently discards one of them.
                   setD({
                     ...d, expectedInstances,
                     averaging: expectedInstances > 1 ? 'mean' : 'single',
                   });
                 }} />
        </label>

        <label style={field}>
          Combining
          <input className="input" readOnly
                 value={d.averaging === 'mean' ? 'Averaged' : 'Single result'} />
        </label>
      </div>

      <div>
        <div className="text-xs t-muted" style={{ marginBottom: 'var(--space-2)' }}>
          Taking part
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {(Object.keys(PARTICIPANT_LABEL) as Participant[]).map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={d.participants.includes(p)}
                     onChange={() => toggle(p)} />
              {PARTICIPANT_LABEL[p]}
            </label>
          ))}
        </div>
      </div>

      {save.error ? <ErrorNote error={save.error} /> : null}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Btn variant="primary"
             disabled={save.isPending || d.participants.length === 0}
             onClick={() => save.mutate()}>
          Save
        </Btn>
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
        {definition.cyclesIssued > 0 && (
          <span className="text-xs t-muted" style={{ alignSelf: 'center' }}>
            {definition.cyclesIssued} cycle{definition.cyclesIssued === 1 ? '' : 's'}
            {' '}already issued — they keep the rules they were opened under.
          </span>
        )}
      </div>
    </div>
  );
}
