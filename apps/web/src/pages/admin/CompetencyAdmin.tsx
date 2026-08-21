import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { ErrorNote, Field, Spinner, inputClass } from '../../components/ui';
import { Btn, Card } from '../../components/ds';

/*
 * Competency framework authoring and position mapping.
 *
 * The behavioural indicator per level is the point of the whole feature. A
 * competency with levels labelled only "1..5" leaves every assessor inventing
 * their own scale, and the gap report becomes noise. The form below therefore
 * asks for the observable behaviour, not just a label.
 *
 * Frameworks are created as DRAFTS and frozen on publish — competencies and
 * levels included. The UI states that before publishing rather than failing
 * after.
 */

interface Framework {
  id: string;
  code: string;
  version: number;
  name: string;
  description: string | null;
  isActive: boolean;
  publishedAt: string | null;
  competencies: {
    id: string; code: string; name: string; category: string | null;
    description: string | null;
    levels: { levelNo: number; label: string; behavioralIndicator: string | null }[];
  }[];
}

interface Position {
  id: string;
  title: string;
  jobFamily: string | null;
  departmentName: string | null;
}

export default function CompetencyAdmin() {
  const [view, setView] = useState<'frameworks' | 'mapping'>('frameworks');

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <nav className="seg no-print" aria-label="Competency admin view">
        {([['frameworks', 'Frameworks'], ['mapping', 'Position requirements']] as const)
          .map(([key, label]) => (
            <label key={key} className="seg-opt">
              <input type="radio" name="competency-admin-view" checked={view === key}
                     onChange={() => setView(key)} />
              <span>{label}</span>
            </label>
          ))}
      </nav>

      {view === 'frameworks' ? <Frameworks /> : <Mapping />}
    </div>
  );
}

function Frameworks() {
  const qc = useQueryClient();
  const [building, setBuilding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const frameworks = useQuery({
    queryKey: ['competency-frameworks'],
    queryFn: () => api<Framework[]>('/competency-frameworks?includeRetired=true'),
  });

  const publish = useMutation({
    mutationFn: (id: string) =>
      api(`/competency-frameworks/${id}/publish`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['competency-frameworks'] }),
  });

  if (frameworks.isLoading) return <Spinner />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {building && (
        <FrameworkBuilder onDone={() => {
          setBuilding(false);
          void qc.invalidateQueries({ queryKey: ['competency-frameworks'] });
        }} />
      )}

      <Card
        title="Competency frameworks"
        actions={<Btn variant="primary" onClick={() => setBuilding((v) => !v)}>
          New framework
        </Btn>}
      >
        {frameworks.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No frameworks yet. Position requirements and gap reports need one.</p>
        ) : (
          <ul>
            {frameworks.data?.map((f) => (
              <li key={f.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <button className="font-medium text-muted hover:underline"
                            onClick={() => setOpenId(openId === f.id ? null : f.id)}>
                      {f.name}
                    </button>
                    <span className="ml-2 t-mono text-xs t-faint">
                      {f.code} v{f.version}
                    </span>
                    <p className="text-xs t-muted">
                      {f.competencies.length} competencies
                      {f.publishedAt ? ' · published' : ' · draft'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.isActive && (
                      <span className="rounded-full hr-note px-2 py-0.5 text-xs font-medium text-muted">
                        active
                      </span>
                    )}
                    {!f.publishedAt && (
                      <Btn variant="primary" disabled={publish.isPending
                              || f.competencies.length === 0}
                              title={f.competencies.length === 0
                                ? 'Add at least one competency first' : undefined}
                              onClick={() => {
                                if (window.confirm(
                                  'Publishing freezes this framework — competencies and ' +
                                  'levels can no longer be edited. Continue?')) {
                                  publish.mutate(f.id);
                                }
                              }}>
                        Publish
                      </Btn>
                    )}
                  </div>
                </div>

                {openId === f.id && (
                  <div className="mt-3 space-y-3 panel-tint p-4">
                    {f.competencies.map((c) => (
                      <div key={c.id}>
                        <p className="text-sm font-medium">
                          {c.name}
                          {c.category && (
                            <span className="ml-2 text-xs font-normal t-faint">
                              {c.category}
                            </span>
                          )}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {c.levels.map((l) => (
                            <li key={l.levelNo} className="text-xs t-muted">
                              <span className="font-medium">{l.levelNo}</span>{' '}
                              {l.behavioralIndicator ?? l.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorNote error={publish.error} />
      </Card>
    </div>
  );
}

interface DraftCompetency {
  code: string;
  name: string;
  category: string;
  levels: { levelNo: number; label: string; behavioralIndicator: string }[];
}

const emptyCompetency = (levelCount: number): DraftCompetency => ({
  code: '', name: '', category: 'core',
  levels: Array.from({ length: levelCount }, (_, i) => ({
    levelNo: i + 1, label: `Level ${i + 1}`, behavioralIndicator: '',
  })),
});

function FrameworkBuilder({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [levelCount, setLevelCount] = useState(5);
  const [competencies, setCompetencies] = useState<DraftCompetency[]>([emptyCompetency(5)]);

  const create = useMutation({
    mutationFn: () =>
      api('/competency-frameworks', {
        method: 'POST',
        body: {
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: description.trim() || undefined,
          competencies: competencies.map((c) => ({
            code: c.code.trim().toUpperCase(),
            name: c.name.trim(),
            category: c.category.trim() || undefined,
            levels: c.levels.map((l) => ({
              levelNo: l.levelNo,
              label: l.label.trim(),
              behavioralIndicator: l.behavioralIndicator.trim() || undefined,
            })),
          })),
        },
      }),
    onSuccess: onDone,
  });

  const patch = (i: number, p: Partial<DraftCompetency>) =>
    setCompetencies((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...p } : c)));

  const changeLevelCount = (n: number) => {
    setLevelCount(n);
    setCompetencies((prev) => prev.map((c) => ({
      ...c,
      levels: Array.from({ length: n }, (_, i) =>
        c.levels[i] ?? { levelNo: i + 1, label: `Level ${i + 1}`, behavioralIndicator: '' }),
    })));
  };

  const missingIndicators = competencies.some(
    (c) => c.levels.some((l) => !l.behavioralIndicator.trim()));

  return (
    <Card kicker="New competency framework">
      <p className="mb-4 text-xs t-muted">
        Created as a draft. Publishing freezes it — every edit after that is a new
        version, so past assessments keep their meaning.
      </p>

      <form style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Code" hint="e.g. CORE">
            <input className={inputClass} required value={code}
                   onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Name">
              <input className={inputClass} required value={name}
                     placeholder="Core Competency Framework"
                     onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field label="Levels per competency">
            <select className={inputClass} value={levelCount}
                    onChange={(e) => changeLevelCount(Number(e.target.value))}>
              {[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-4">
            <Field label="Description">
              <input className={inputClass} value={description}
                     onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </div>

        {competencies.map((c, i) => (
          <div key={i} className="rounded-md border border-divider p-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Code">
                <input className={inputClass} required value={c.code}
                       placeholder="JUDG"
                       onChange={(e) => patch(i, { code: e.target.value.toUpperCase() })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Competency">
                  <input className={inputClass} required value={c.name}
                         placeholder="Technical judgement"
                         onChange={(e) => patch(i, { name: e.target.value })} />
                </Field>
              </div>
              <Field label="Category">
                <select className={inputClass} value={c.category}
                        onChange={(e) => patch(i, { category: e.target.value })}>
                  {['core', 'leadership', 'technical', 'functional'].map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </Field>
            </div>

            <p className="mt-4 mb-2 text-sm font-medium">
              What each level looks like
              <span className="ml-2 text-xs font-normal t-muted">
                observable behaviour, not "good" or "strong"
              </span>
            </p>
            <div className="space-y-2">
              {c.levels.map((l, li) => (
                <div key={li} className="flex items-center gap-2">
                  <span className="w-6 text-center text-sm font-medium t-muted">
                    {l.levelNo}
                  </span>
                  <input
                    className="flex-1 input-sm"
                    placeholder="e.g. Weighs trade-offs across a whole system"
                    value={l.behavioralIndicator}
                    onChange={(e) => patch(i, {
                      levels: c.levels.map((x, j) => j === li
                        ? { ...x, behavioralIndicator: e.target.value } : x),
                    })}
                  />
                </div>
              ))}
            </div>

            {competencies.length > 1 && (
              <div className="mt-3">
                <Btn type="button"
                        onClick={() => setCompetencies((p) => p.filter((_, idx) => idx !== i))}>
                  Remove competency
                </Btn>
              </div>
            )}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Btn type="button"
                  onClick={() => setCompetencies((p) => [...p, emptyCompetency(levelCount)])}>
            Add competency
          </Btn>
          <Btn type="submit" variant="primary" disabled={create.isPending}>
            Save as draft
          </Btn>
          <Btn type="button" onClick={onDone}>Cancel</Btn>
        </div>

        {missingIndicators && (
          <p className="text-xs text-muted">
            Some levels have no behavioural indicator. You can still save, but
            assessors will be guessing what each level means.
          </p>
        )}
        <ErrorNote error={create.error} />
      </form>
    </Card>
  );
}

function Mapping() {
  const qc = useQueryClient();
  const [positionId, setPositionId] = useState('');

  const positions = useQuery({
    queryKey: ['positions'],
    queryFn: () => api<Position[]>('/positions'),
  });
  const frameworks = useQuery({
    queryKey: ['competency-frameworks'],
    queryFn: () => api<Framework[]>('/competency-frameworks'),
  });
  const requirements = useQuery({
    queryKey: ['position-competencies', positionId],
    queryFn: () => api<{
      competencyId: string; code: string; name: string;
      requiredLevel: number; requiredLabel: string | null;
    }[]>(`/positions/${positionId}/competencies`),
    enabled: !!positionId,
  });

  const [levels, setLevels] = useState<Record<string, number>>({});

  const save = useMutation({
    mutationFn: () =>
      api('/position-competencies', {
        method: 'POST',
        body: {
          positionId,
          requirements: Object.entries(levels)
            .filter(([, v]) => v > 0)
            .map(([competencyId, requiredLevel]) => ({ competencyId, requiredLevel })),
        },
      }),
    onSuccess: () => {
      setLevels({});
      void qc.invalidateQueries({ queryKey: ['position-competencies'] });
    },
  });

  if (positions.isLoading) return <Spinner />;

  const active = frameworks.data?.find((f) => f.isActive);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <Card kicker="Position requirements">
        <p className="mb-3 text-xs t-muted">
          The required level per position is what turns an assessment into a gap.
          Positions without requirements never appear in a gap report.
        </p>

        <Field label="Position">
          <select className={inputClass} value={positionId}
                  onChange={(e) => { setPositionId(e.target.value); setLevels({}); }}>
            <option value="">Select a position…</option>
            {positions.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}{p.jobFamily ? ` — ${p.jobFamily}` : ''}
              </option>
            ))}
          </select>
        </Field>

        {positionId && !active && (
          <p className="mt-4 rounded-md hr-note px-3 py-2 text-xs text-muted">
            No published framework yet. Publish one before mapping requirements.
          </p>
        )}

        {positionId && active && (
          <div className="mt-4">
            <table className="table">
              <thead>
                <tr>
                  <th>Competency</th>
                  <th>Current</th>
                  <th>Required level</th>
                </tr>
              </thead>
              <tbody>
                {active.competencies.map((c) => {
                  const existing = requirements.data?.find(
                    (r) => r.competencyId === c.id);
                  return (
                    <tr key={c.id}>
                      <td >
                        {c.name}
                        {c.category && (
                          <span className="ml-2 text-xs t-faint">{c.category}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-xs t-muted">
                        {existing ? `level ${existing.requiredLevel}` : 'not required'}
                      </td>
                      <td >
                        <select
                          className="input-sm"
                          value={levels[c.id] ?? existing?.requiredLevel ?? 0}
                          onChange={(e) => setLevels((p) => ({
                            ...p, [c.id]: Number(e.target.value) }))}
                        >
                          <option value={0}>not required</option>
                          {c.levels.map((l) => (
                            <option key={l.levelNo} value={l.levelNo}>
                              {l.levelNo} — {l.behavioralIndicator ?? l.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-4 flex items-center gap-3">
              <Btn variant="primary"
                      disabled={save.isPending || Object.keys(levels).length === 0}
                      onClick={() => save.mutate()}>
                Save requirements
              </Btn>
              <span className="text-xs t-muted">
                Applies to everyone currently holding this position.
              </span>
            </div>
            <ErrorNote error={save.error} />
          </div>
        )}
      </Card>
    </div>
  );
}
