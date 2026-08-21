import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../auth';
import type { HrDashboard } from '../types';
import { usePeriod } from '../PeriodContext';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import { Attainment, Btn, Card, PageHead, Section, Stat } from '../components/ds';

/** HR view: coverage, weight problems, period lifecycle, export. */
export default function HrConsole() {
  const { period, periods } = usePeriod();
  const qc = useQueryClient();
  const [showNewPeriod, setShowNewPeriod] = useState(false);

  const dash = useQuery({
    queryKey: ['dashboard', 'hr', period?.id],
    queryFn: () => api<HrDashboard>(`/dashboards/hr/${period!.id}`),
    enabled: !!period,
  });

  const setState = useMutation({
    mutationFn: (state: 'open' | 'locked' | 'closed') =>
      api(`/goal-periods/${period!.id}/state`, { method: 'PATCH', body: { state } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goal-periods'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const exportCsv = async () => {
    const csv = await api<string>(`/dashboards/export/${period!.id}`, { raw: true });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `goals-${period!.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!period && !showNewPeriod) {
    // The empty state gets the heading too. A screen that says only "create the
    // first goal period" with no title reads like an error page.
    return (
      <Section>
        <PageHead title="HR console" />
        <Card kicker="No goal periods">
          <p className="card-body" style={{ margin: 0 }}>Create the first goal period to begin.</p>
          <Btn variant="primary" onClick={() => setShowNewPeriod(true)}>Create period</Btn>
        </Card>
      </Section>
    );
  }

  const d = dash.data;
  // The lock gate. Surfaced here, before HR attempts the lock, because the
  // database will reject it otherwise and mid-close is a bad time to discover
  // twelve people have unbalanced weights.
  const weightIssues = d?.weightIssues ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PageHead title="HR console" />

      {showNewPeriod && <NewPeriodForm onDone={() => setShowNewPeriod(false)} />}

      <Card
        title={`Period — ${period?.name} (${period?.state})`}
        actions={
          <div className="flex gap-2 no-print">
            <Btn onClick={() => setShowNewPeriod((v) => !v)}>New period</Btn>
            <Btn onClick={() => void exportCsv()}>Export CSV</Btn>
            {period?.state === 'draft' && (
              <Btn variant="primary" onClick={() => setState.mutate('open')}>Open</Btn>
            )}
            {period?.state === 'open' && (
              <Btn
                variant="primary"
                disabled={weightIssues.length > 0 || setState.isPending}
                title={weightIssues.length > 0
                  ? 'Resolve weight issues before locking'
                  : undefined}
                onClick={() => setState.mutate('locked')}
              >
                Lock goal set
              </Btn>
            )}
            {period?.state === 'locked' && (
              <Btn onClick={() => {
                if (window.confirm('Closing freezes actuals and check-ins permanently. Continue?')) {
                  setState.mutate('closed');
                }
              }}>
                Close period
              </Btn>
            )}
          </div>
        }
      >
        <p className="text-sm t-muted">
          {period?.state === 'open' && 'Goals can be created and edited. Weights must total 100% per employee before locking.'}
          {period?.state === 'locked' && 'The goal set is frozen. Check-ins and actuals continue to flow.'}
          {period?.state === 'closed' && 'Everything is frozen. This period is now historical record.'}
          {period?.state === 'draft' && 'Not yet open. Nobody can add goals.'}
        </p>
        {setState.error ? (
          <div className="mt-3 space-y-2">
            <ErrorNote error={setState.error} />
            <WeightViolationList error={setState.error} />
          </div>
        ) : null}
      </Card>

      {dash.isLoading ? <Spinner /> : d && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat kicker="Employees visible" value={d.coverage.employeesVisible} />
            <Stat kicker="With goals" value={d.coverage.employeesWithGoals} />
            <Stat kicker="Without goals"
              value={d.coverage.employeesWithoutGoals} note="coverage gap"
            />
            <Stat kicker="Weight issues"
              value={weightIssues.length} note="blocks period lock"
            />
          </div>

          {weightIssues.length > 0 && (
            <Card kicker="Weights that do not total 100%">
              <table className="table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Goals</th>
                    <th>Total weight</th>
                  </tr>
                </thead>
                <tbody>
                  {weightIssues.map((w) => (
                    <tr key={w.employeeId}>
                      <td>{w.employeeName}</td>
                      <td className="tabular-nums">{w.goalCount}</td>
                      <td className="py-2 tabular-nums font-medium text-muted">
                        {Number(w.totalWeight)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card kicker="Goals by state">
              <ul className="space-y-1.5">
                {d.byState.map((s) => (
                  <li key={s.state} className="flex justify-between text-sm">
                    <span className="t-muted">{s.state.replace(/_/g, ' ')}</span>
                    <span className="font-medium tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card kicker="By department">
              <table className="table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Goals</th>
                    <th>Attainment</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byDepartment.map((r) => (
                    <tr key={r.department}>
                      <td>{r.department}</td>
                      <td className="tabular-nums">{r.goalCount}</td>
                      <td><Attainment pct={r.attainment} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}

      <Card kicker="All periods">
        <ul className="text-sm">
          {periods.map((p) => (
            <li key={p.id} className="flex justify-between py-2">
              <span>{p.name}</span>
              <span className="text-xs t-muted">
                {p.startsOn} → {p.endsOn} · {p.state}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** The API returns the offending employees on a failed lock; show them. */
function WeightViolationList({ error }: { error: unknown }) {
  if (!(error instanceof ApiError)) return null;
  const detail = error.detail as
    | { weightViolations?: { employeeNo: string; employeeName: string; totalWeight: string }[] }
    | undefined;
  const rows = detail?.weightViolations ?? [];
  if (rows.length === 0) return null;
  return (
    <ul className="rounded-md hr-note px-3 py-2 text-xs text-muted">
      {rows.map((r) => (
        <li key={r.employeeNo}>
          {r.employeeName} ({r.employeeNo}) — {Number(r.totalWeight)}%
        </li>
      ))}
    </ul>
  );
}

function NewPeriodForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [periodType, setPeriodType] = useState('annual');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api('/goal-periods', {
        method: 'POST',
        body: { name: name.trim(), periodType, startsOn, endsOn },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goal-periods'] });
      onDone();
    },
  });

  return (
    <Card kicker="New goal period">
      <form className="grid gap-4 sm:grid-cols-4"
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Name">
          <input className={inputClass} value={name} required placeholder="FY2027"
                 onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Type">
          <select className={inputClass} value={periodType}
                  onChange={(e) => setPeriodType(e.target.value)}>
            <option value="annual">Annual</option>
            <option value="semi_annual">Semi-annual</option>
            <option value="quarterly">Quarterly</option>
            <option value="custom">Custom</option>
          </select>
        </Field>
        <Field label="Starts">
          <input type="date" required className={inputClass} value={startsOn}
                 onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label="Ends">
          <input type="date" required className={inputClass} value={endsOn}
                 onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
        <div className="sm:col-span-4 flex gap-3">
          <Btn type="submit" variant="primary" disabled={create.isPending}>Create</Btn>
          <Btn type="button" onClick={onDone}>Cancel</Btn>
        </div>
        {create.error ? <div className="sm:col-span-4"><ErrorNote error={create.error} /></div> : null}
      </form>
    </Card>
  );
}
