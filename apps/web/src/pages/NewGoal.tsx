import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../auth';
import type { Employee, Goal, KpiDefinition } from '../types';
import { usePeriod } from '../PeriodContext';
import { ErrorNote, Field, inputClass } from '../components/ui';
import { Btn, Card, PageHead } from '../components/ds';

interface TargetDraft {
  measureName: string;
  measureType: string;
  direction: string;
  unit: string;
  baselineValue: string;
  targetValue: string;
}

const emptyTarget = (): TargetDraft => ({
  measureName: '',
  measureType: 'numeric',
  direction: 'higher_is_better',
  unit: '',
  baselineValue: '',
  targetValue: '',
});

export default function NewGoal() {
  const { period } = usePeriod();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const reports = useQuery({
    queryKey: ['reports'],
    queryFn: () => api<Employee[]>('/employees/me/reports'),
  });
  const kpis = useQuery({
    queryKey: ['kpi-definitions'],
    queryFn: () => api<KpiDefinition[]>('/kpi-definitions'),
  });

  const [employeeId, setEmployeeId] = useState('');
  const [kpiId, setKpiId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [targets, setTargets] = useState<TargetDraft[]>([emptyTarget()]);

  const create = useMutation({
    mutationFn: () =>
      api<Goal>('/goals', {
        method: 'POST',
        body: {
          goalPeriodId: period!.id,
          employeeId: employeeId || me.data!.id,
          kpiDefinitionId: kpiId || undefined,
          title: title.trim(),
          description: description.trim() || undefined,
          weight: Number(weight),
          dueOn: dueOn || undefined,
          targets: targets.map((t) => ({
            measureName: t.measureName.trim(),
            measureType: t.measureType,
            direction: t.direction,
            unit: t.unit.trim() || undefined,
            baselineValue: t.baselineValue === '' ? undefined : Number(t.baselineValue),
            targetValue: Number(t.targetValue),
          })),
        },
      }),
    onSuccess: (goal) => {
      void qc.invalidateQueries({ queryKey: ['goals'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/goals/${goal.id}`);
    },
  });

  /**
   * Selecting a library KPI copies its defaults into the first measure. It
   * copies rather than links: the goal snapshots the definition version, and
   * the measure is the employee's own target, which is expected to differ.
   */
  const applyKpi = (id: string) => {
    setKpiId(id);
    const kpi = kpis.data?.find((k) => k.id === id);
    if (!kpi) return;
    if (!title.trim()) setTitle(kpi.name);
    if (kpi.defaultWeight && !weight) setWeight(String(Number(kpi.defaultWeight)));
    setTargets((prev) => {
      const [first, ...rest] = prev;
      return [{
        ...first!,
        measureName: first!.measureName || kpi.name,
        measureType: kpi.measureType,
        direction: kpi.direction,
        unit: kpi.unit ?? '',
      }, ...rest];
    });
  };

  if (!period) return <ErrorNote error={new Error('No goal period is open.')} />;

  const patchTarget = (i: number, patch: Partial<TargetDraft>) =>
    setTargets((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
      onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
    >
      <PageHead title="New goal" meta={
        <span style={{ fontSize: 14, opacity: 0.7 }}>{period.name}</span>
      } />

      <Card kicker="Goal details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="For" hint="Leave as yourself unless setting a goal for a report">
            <select className={inputClass} value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Myself</option>
              {reports.data?.map((r) => (
                <option key={r.id} value={r.id}>{r.firstName} {r.lastName}</option>
              ))}
            </select>
          </Field>

          <Field label="KPI from library" hint="Optional — leave blank for a free-form goal">
            <select className={inputClass} value={kpiId}
                    onChange={(e) => applyKpi(e.target.value)}>
              <option value="">— free-form —</option>
              {kpis.data?.map((k) => (
                <option key={k.id} value={k.id}>{k.code} — {k.name}</option>
              ))}
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="Title">
              <input className={inputClass} value={title} required
                     onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea rows={2} className={inputClass} value={description}
                        onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>

          <Field
            label="Weight (%)"
            hint="All of an employee's goals must total 100% before the period can be locked"
          >
            <input type="number" min="0.01" max="100" step="0.01" required
                   className={inputClass} value={weight}
                   onChange={(e) => setWeight(e.target.value)} />
          </Field>

          <Field label="Due date">
            <input type="date" className={inputClass} value={dueOn}
                   onChange={(e) => setDueOn(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card
        title="Measures"
        actions={
          <Btn type="button" onClick={() => setTargets((p) => [...p, emptyTarget()])}>
            Add measure
          </Btn>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {targets.map((t, i) => (
            <div key={i} className="grid gap-3 rounded-md border border-divider p-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Field label="Measure name">
                  <input className={inputClass} value={t.measureName} required
                         onChange={(e) => patchTarget(i, { measureName: e.target.value })} />
                </Field>
              </div>

              <Field label="Type">
                <select className={inputClass} value={t.measureType}
                        onChange={(e) => patchTarget(i, { measureType: e.target.value })}>
                  {['numeric', 'percentage', 'currency', 'ratio', 'milestone', 'boolean']
                    .map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>

              <Field
                label="Direction"
                hint={t.direction === 'lower_is_better'
                  ? 'Beating the target scores above 100%'
                  : undefined}
              >
                <select className={inputClass} value={t.direction}
                        onChange={(e) => patchTarget(i, { direction: e.target.value })}>
                  <option value="higher_is_better">Higher is better</option>
                  <option value="lower_is_better">Lower is better (cost, defects…)</option>
                </select>
              </Field>

              <Field label="Baseline" hint="Optional — enables progress-from-baseline scoring">
                <input type="number" step="any" className={inputClass} value={t.baselineValue}
                       onChange={(e) => patchTarget(i, { baselineValue: e.target.value })} />
              </Field>

              <Field label="Target">
                <input type="number" step="any" required className={inputClass}
                       value={t.targetValue}
                       onChange={(e) => patchTarget(i, { targetValue: e.target.value })} />
              </Field>

              <Field label="Unit">
                <input className={inputClass} value={t.unit} placeholder="PHP, %, count…"
                       onChange={(e) => patchTarget(i, { unit: e.target.value })} />
              </Field>

              {targets.length > 1 && (
                <div className="sm:col-span-3">
                  <Btn type="button"
                          onClick={() => setTargets((p) => p.filter((_, idx) => idx !== i))}>
                    Remove measure
                  </Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <ErrorNote error={create.error} />

      <div className="flex gap-3">
        <Btn type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create goal'}
        </Btn>
        <Btn type="button" onClick={() => navigate(-1)}>Cancel</Btn>
      </div>
    </form>
  );
}
