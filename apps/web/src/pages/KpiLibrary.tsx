import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import type { KpiDefinition } from '../types';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import { Btn, Card, PageHead } from '../components/ds';

/**
 * The KPI definition library.
 *
 * Definitions are never edited in place -- a change publishes a new version and
 * retires the old one, so goals authored against v1 keep meaning what they
 * meant. The UI reflects that: there is no edit button, only "new version".
 */
export default function KpiLibrary() {
  const qc = useQueryClient();
  const [showRetired, setShowRetired] = useState(false);
  const [form, setForm] = useState<{ mode: 'new' | 'version'; code?: string } | null>(null);

  const kpis = useQuery({
    queryKey: ['kpi-definitions', showRetired],
    queryFn: () => api<KpiDefinition[]>(`/kpi-definitions?includeRetired=${showRetired}`),
  });

  if (kpis.isLoading) return <Spinner />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PageHead title="KPI library">
        <label className="flex items-center gap-1.5 text-xs t-muted no-print">
          <input type="checkbox" checked={showRetired}
                 onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired versions
        </label>
        <Btn variant="primary" onClick={() => setForm({ mode: 'new' })}>New KPI</Btn>
      </PageHead>

      {form && (
        <KpiForm
          mode={form.mode}
          code={form.code}
          onDone={() => {
            setForm(null);
            void qc.invalidateQueries({ queryKey: ['kpi-definitions'] });
          }}
        />
      )}

      <Card kicker="Definitions">
        {kpis.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No KPI definitions yet. Goals can still be created free-form.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Direction</th>
                  <th>Version</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {kpis.data?.map((k) => (
                  <tr key={k.id} className={k.isActive ? '' : 't-faint'}>
                    <td className="t-mono text-xs">{k.code}</td>
                    <td>
                      {k.name}
                      {k.category && <span className="ml-2 text-xs t-faint">{k.category}</span>}
                    </td>
                    <td className="text-xs">{k.measureType}</td>
                    <td className="text-xs">
                      {k.direction === 'lower_is_better' ? 'lower is better' : 'higher is better'}
                    </td>
                    <td className="tabular-nums text-xs">
                      v{k.version}{!k.isActive && ' (retired)'}
                    </td>
                    <td className="text-right no-print">
                      {k.isActive && (
                        <Btn onClick={() => setForm({ mode: 'version', code: k.code })}>
                          New version
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function KpiForm({ mode, code, onDone }: {
  mode: 'new' | 'version';
  code?: string;
  onDone: () => void;
}) {
  const [fields, setFields] = useState({
    code: code ?? '',
    name: '',
    description: '',
    category: '',
    measureType: 'numeric',
    direction: 'higher_is_better',
    unit: '',
    defaultWeight: '',
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: fields.code.trim(),
        name: fields.name.trim(),
        description: fields.description.trim() || undefined,
        category: fields.category.trim() || undefined,
        measureType: fields.measureType,
        direction: fields.direction,
        unit: fields.unit.trim() || undefined,
        defaultWeight: fields.defaultWeight === '' ? undefined : Number(fields.defaultWeight),
      };
      return mode === 'version'
        ? api(`/kpi-definitions/${code}/versions`, { method: 'POST', body })
        : api('/kpi-definitions', { method: 'POST', body });
    },
    onSuccess: onDone,
  });

  const set = (patch: Partial<typeof fields>) => setFields((f) => ({ ...f, ...patch }));

  return (
    <Card kicker={mode === 'version' ? `New version of ${code}` : 'New KPI definition'}>
      <form className="grid gap-4 sm:grid-cols-3"
            onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Code" hint={mode === 'version' ? 'Fixed for a new version' : 'e.g. REV-GROWTH'}>
          <input className={inputClass} value={fields.code} required
                 readOnly={mode === 'version'}
                 onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Name">
            <input className={inputClass} value={fields.name} required
                   onChange={(e) => set({ name: e.target.value })} />
          </Field>
        </div>

        <div className="sm:col-span-3">
          <Field label="Description">
            <textarea rows={2} className={inputClass} value={fields.description}
                      onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>

        <Field label="Measure type">
          <select className={inputClass} value={fields.measureType}
                  onChange={(e) => set({ measureType: e.target.value })}>
            {['numeric', 'percentage', 'currency', 'ratio', 'milestone', 'boolean']
              .map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>

        <Field
          label="Direction"
          hint={fields.direction === 'lower_is_better'
            ? 'Attainment inverts: beating the target scores above 100%'
            : undefined}
        >
          <select className={inputClass} value={fields.direction}
                  onChange={(e) => set({ direction: e.target.value })}>
            <option value="higher_is_better">Higher is better</option>
            <option value="lower_is_better">Lower is better</option>
          </select>
        </Field>

        <Field label="Category">
          <input className={inputClass} value={fields.category}
                 placeholder="financial, customer, process, people"
                 onChange={(e) => set({ category: e.target.value })} />
        </Field>

        <Field label="Unit">
          <input className={inputClass} value={fields.unit}
                 onChange={(e) => set({ unit: e.target.value })} />
        </Field>

        <Field label="Default weight (%)">
          <input type="number" min="0.01" max="100" step="0.01" className={inputClass}
                 value={fields.defaultWeight}
                 onChange={(e) => set({ defaultWeight: e.target.value })} />
        </Field>

        <div className="sm:col-span-3 flex gap-3">
          <Btn type="submit" variant="primary" disabled={save.isPending}>
            {mode === 'version' ? 'Publish new version' : 'Create'}
          </Btn>
          <Btn type="button" onClick={onDone}>Cancel</Btn>
        </div>

        {save.error ? <div className="sm:col-span-3"><ErrorNote error={save.error} /></div> : null}
      </form>
    </Card>
  );
}
