import { useState } from 'react';
import FormBuilder from './admin/FormBuilder';
import CompetencyAdmin from './admin/CompetencyAdmin';
import DevelopmentAdmin from './admin/DevelopmentAdmin';
import HelpAdmin from './admin/HelpAdmin';
import EvaluationTypes from './admin/EvaluationTypes';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import { Btn, Card, PageHead } from '../components/ds';

/**
 * The levels an org unit can be, in nesting order.
 *
 * Region is absent deliberately — it groups provinces across areas rather than
 * containing them, so it is an attribute rather than a level (migration 0027).
 */
const UNIT_TYPES = [
  'holdings', 'group', 'division', 'department', 'section', 'area', 'branch',
] as const;
type UnitType = typeof UNIT_TYPES[number];

interface Department {
  id: string;
  code: string;
  name: string;
  unitType: UnitType;
  parentDepartmentId: string | null;
  parentName: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isCurrent: boolean;
  headcount: number;
  childCount: number;
}

interface EmploymentType {
  id: string;
  code: string;
  name: string;
  isEligibleForReview: boolean;
  isActive: boolean;
  headcount: number;
}

interface Position {
  id: string;
  title: string;
  jobFamily: string | null;
  jobLevel: string | null;
  rankId: string | null;
  rankCode: string | null;
  rankName: string | null;
  rankNo: number | null;
  departmentName: string | null;
  headcount: number;
}

interface Rank {
  id: string;
  code: string;
  name: string;
  rankNo: number;
  positionCount: number;
}

/**
 * Reference-data administration.
 *
 * The 201 importer creates departments and employment types on the fly and
 * derives codes from names (Operations -> OPS). That guess is usually right and
 * occasionally wrong, so this screen exists to correct it. Codes are safe to
 * edit: every foreign key is on the UUID, and the code is only a human-facing
 * key used to match import rows.
 */
export default function Setup() {
  const [tab, setTab] = useState<
    'departments' | 'types' | 'positions' | 'evaluations' | 'forms'
    | 'competencies' | 'development' | 'help'
  >('departments');

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PageHead title="Setup" />

      <nav className="seg no-print" aria-label="Setup section" style={{ flexWrap: 'wrap' }}>
        {([
          ['departments', 'Departments'],
          ['types', 'Employment types'],
          ['positions', 'Positions'],
          ['evaluations', 'Evaluation types'],
          ['forms', 'Review forms'],
          ['competencies', 'Competencies'],
          ['development', 'Development'],
          ['help', 'Help content'],
        ] as const).map(([key, label]) => (
          <label key={key} className="seg-opt">
            <input type="radio" name="setup-section" checked={tab === key}
                   onChange={() => setTab(key)} />
            <span>{label}</span>
          </label>
        ))}
      </nav>

      {tab === 'departments' && <Departments />}
      {tab === 'types' && <EmploymentTypes />}
      {tab === 'positions' && <Positions />}
      {tab === 'evaluations' && <EvaluationTypes />}
      {tab === 'forms' && <FormBuilder />}
      {tab === 'competencies' && <CompetencyAdmin />}
      {tab === 'development' && <DevelopmentAdmin />}
      {tab === 'help' && <HelpAdmin />}
    </div>
  );
}

function Departments() {
  const qc = useQueryClient();
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['departments', showClosed],
    queryFn: () => api<Department[]>(`/departments?includeClosed=${showClosed}`),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['departments'] });

  const save = useMutation({
    mutationFn: (input: { id: string; code: string; name: string; unitType: string }) =>
      api(`/departments/${input.id}`, {
        method: 'PATCH',
        body: { code: input.code, name: input.name, unitType: input.unitType },
      }),
    onSuccess: () => { setEditing(null); invalidate(); },
  });

  const close = useMutation({
    mutationFn: (id: string) =>
      api(`/departments/${id}/close`, {
        method: 'POST',
        body: { effectiveTo: new Date().toISOString().slice(0, 10) },
      }),
    onSuccess: invalidate,
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {creating && <NewDepartment departments={q.data ?? []}
                                  onDone={() => { setCreating(false); invalidate(); }} />}

      <Card
        title="Departments"
        actions={
          <div className="flex items-center gap-3 no-print">
            <label className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={showClosed}
                     onChange={(e) => setShowClosed(e.target.checked)} />
              Show closed
            </label>
            <Btn variant="primary" onClick={() => setCreating((v) => !v)}>
              New department
            </Btn>
          </div>
        }
      >
        <p style={{ marginTop: 0, fontSize: 12, opacity: 0.7 }}>
          Codes are what the 201 import matches on. Editing one is safe — records
          link by internal id, not by code.
        </p>

        {q.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No departments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Level</th>
                  <th>Parent</th>
                  <th>Headcount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((d) => (
                  // A closed department is history, not an error — it recedes
                  // rather than being coloured.
                  <tr key={d.id} style={d.isCurrent ? undefined : { opacity: 0.55 }}>
                    {editing === d.id ? (
                      <EditRow department={d} onCancel={() => setEditing(null)}
                               onSave={(code, name, unitType) =>
                                 save.mutate({ id: d.id, code, name, unitType })}
                               pending={save.isPending} />
                    ) : (
                      <>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.code}</td>
                        <td>
                          {d.name}
                          {!d.isCurrent && (
                            <span style={{ marginLeft: 8, fontSize: 12 }}>
                              closed {d.effectiveTo}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 12 }}>{d.unitType}</td>
                        <td style={{ fontSize: 12 }}>{d.parentName ?? '—'}</td>
                        <td className="tabular-nums">{d.headcount}</td>
                        <td className="no-print" style={{ textAlign: 'right' }}>
                          {d.isCurrent && (
                            <div className="flex justify-end gap-2">
                              <Btn onClick={() => setEditing(d.id)}>Edit</Btn>
                              <Btn
                                // A populated department cannot be closed —
                                // the database refuses it. Disabling the button
                                // explains why before the click.
                                disabled={d.headcount > 0 || d.childCount > 0}
                                title={
                                  d.headcount > 0
                                    ? `${d.headcount} employee(s) still assigned`
                                    : d.childCount > 0
                                      ? `${d.childCount} sub-department(s)`
                                      : undefined
                                }
                                onClick={() => {
                                  if (window.confirm(`Close ${d.name}?`)) close.mutate(d.id);
                                }}
                              >
                                Close
                              </Btn>
                            </div>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorNote error={save.error ?? close.error} />
      </Card>
    </div>
  );
}

function EditRow({ department, onSave, onCancel, pending }: {
  department: Department;
  onSave: (code: string, name: string, unitType: UnitType) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [code, setCode] = useState(department.code);
  const [name, setName] = useState(department.name);
  const [unitType, setUnitType] = useState<UnitType>(department.unitType);
  return (
    <>
      <td>
        <input className={inputClass} aria-label="Department code"
               style={{ width: '7rem', fontFamily: 'monospace', fontSize: 12 }}
               value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </td>
      <td>
        <input className={inputClass} aria-label="Department name"
               value={name} onChange={(e) => setName(e.target.value)} />
      </td>
      <td>
        <select className={inputClass} aria-label="Org unit level"
                style={{ fontSize: 12 }}
                value={unitType}
                onChange={(e) => setUnitType(e.target.value as UnitType)}>
          {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="tabular-nums">{department.headcount}</td>
      <td style={{ textAlign: 'right' }}>
        <div className="flex justify-end gap-2">
          <Btn variant="primary" disabled={pending}
               onClick={() => onSave(code, name, unitType)}>
            Save
          </Btn>
          <Btn onClick={onCancel}>Cancel</Btn>
        </div>
      </td>
    </>
  );
}

function NewDepartment({ departments, onDone }: {
  departments: Department[];
  onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [unitType, setUnitType] = useState<UnitType>('department');
  const [parentDepartmentId, setParent] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api('/departments', {
        method: 'POST',
        body: {
          code: code.trim().toUpperCase(),
          name: name.trim(),
          unitType,
          parentDepartmentId: parentDepartmentId || null,
        },
      }),
    onSuccess: onDone,
  });

  return (
    <Card kicker="New department">
      <form className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Code" hint="Used by the 201 import, e.g. OPS">
          <input className={inputClass} required value={code}
                 onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name">
          <input className={inputClass} required value={name}
                 onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Level" hint="What this unit is — a branch, an area, a section">
          <select className={inputClass} value={unitType}
                  onChange={(e) => setUnitType(e.target.value as UnitType)}>
            {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Parent unit" hint="Optional — scopes HR partner access">
          <select className={inputClass} value={parentDepartmentId}
                  onChange={(e) => setParent(e.target.value)}>
            <option value="">— none (top level) —</option>
            {departments.filter((d) => d.isCurrent).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2 flex gap-3">
          <Btn type="submit" variant="primary" disabled={create.isPending}>Create</Btn>
          <Btn type="button" onClick={onDone}>Cancel</Btn>
        </div>
        {create.error ? <div className="sm:col-span-2"><ErrorNote error={create.error} /></div> : null}
      </form>
    </Card>
  );
}

function EmploymentTypes() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['employment-types'],
    queryFn: () => api<EmploymentType[]>('/employment-types'),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; isEligibleForReview?: boolean; isActive?: boolean }) =>
      api(`/employment-types/${input.id}`, { method: 'PATCH', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['employment-types'] }),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;

  return (
    <Card kicker="Employment types">
      <p style={{ marginTop: 0, fontSize: 12, opacity: 0.7 }}>
        <strong>Review eligible</strong> decides who a review cycle picks up. Types
        the 201 import created default to eligible, except consultants and interns.
      </p>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Headcount</th>
              <th>Review eligible</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((t) => (
              <tr key={t.id} style={t.isActive ? undefined : { opacity: 0.55 }}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.code}</td>
                <td>{t.name}</td>
                <td className="tabular-nums">{t.headcount}</td>
                <td>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={t.isEligibleForReview}
                      disabled={update.isPending}
                      onChange={(e) => update.mutate({
                        id: t.id, isEligibleForReview: e.target.checked })}
                    />
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      {t.isEligibleForReview ? 'included' : 'excluded'}
                    </span>
                  </label>
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${t.name} active`}
                    checked={t.isActive}
                    // Deactivating a type people still hold is refused by the
                    // database; disable rather than surface a raw error.
                    disabled={update.isPending || (t.isActive && t.headcount > 0)}
                    title={t.isActive && t.headcount > 0
                      ? `${t.headcount} employee(s) currently hold this type`
                      : undefined}
                    onChange={(e) => update.mutate({ id: t.id, isActive: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorNote error={update.error} />
    </Card>
  );
}

function Positions() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['positions'],
    queryFn: () => api<Position[]>('/positions'),
  });
  // The ladder is small and changes rarely; loading it here keeps the row
  // component free of its own request per row.
  const ranks = useQuery({
    queryKey: ['ranks'],
    queryFn: () => api<Rank[]>('/ranks'),
  });

  const update = useMutation({
    mutationFn: (input: {
      id: string; jobFamily: string; jobLevel: string; rankId: string | null;
    }) =>
      api(`/positions/${input.id}`, {
        method: 'PATCH',
        body: {
          jobFamily: input.jobFamily || null,
          jobLevel: input.jobLevel || null,
          rankId: input.rankId,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['positions'] });
      void qc.invalidateQueries({ queryKey: ['job-families'] });
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;

  return (
    <Card kicker="Positions">
      <p style={{ marginTop: 0, fontSize: 12, opacity: 0.7 }}>
        Job family groups positions for the competency gap report; a blank family
        means those positions are absent from it. <strong>Rank</strong> is the
        ladder — it is what "one rank above" means when evaluators are chosen, so
        an unranked position cannot take part in those rules.
      </p>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Department</th>
              <th>Headcount</th>
              <th>Job family</th>
              <th>Rank</th>
              <th>Level</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((p) => (
              <PositionRow key={p.id} position={p} ranks={ranks.data ?? []}
                           onSave={(family, level, rankId) =>
                             update.mutate({ id: p.id, jobFamily: family, jobLevel: level, rankId })}
                           pending={update.isPending} />
            ))}
          </tbody>
        </table>
      </div>
      <ErrorNote error={update.error} />
    </Card>
  );
}

function PositionRow({ position, ranks, onSave, pending }: {
  position: Position;
  ranks: Rank[];
  onSave: (family: string, level: string, rankId: string | null) => void;
  pending: boolean;
}) {
  const [family, setFamily] = useState(position.jobFamily ?? '');
  const [level, setLevel] = useState(position.jobLevel ?? '');
  const dirty = family !== (position.jobFamily ?? '') || level !== (position.jobLevel ?? '');

  return (
    <tr>
      <td style={{ fontWeight: 500 }}>{position.title}</td>
      <td style={{ fontSize: 12 }}>{position.departmentName ?? '—'}</td>
      <td className="tabular-nums">{position.headcount}</td>
      <td>
        {/* Saves on change rather than on blur: it is one choice from a short
            list, so there is nothing to finish typing. */}
        <select
          className={inputClass} style={{ width: '11rem', fontSize: 12 }}
          aria-label={`Rank for ${position.title}`}
          value={position.rankId ?? ''}
          disabled={pending || ranks.length === 0}
          onChange={(e) => onSave(family, level, e.target.value || null)}
        >
          <option value="">— unranked —</option>
          {ranks.map((r) => (
            <option key={r.id} value={r.id}>{r.code} · {r.name}</option>
          ))}
        </select>
      </td>
      <td>
        <input
          className={inputClass} style={{ width: '11rem' }}
          aria-label={`Job family for ${position.title}`}
          value={family} placeholder="e.g. Engineering"
          onChange={(e) => setFamily(e.target.value)}
          onBlur={() => { if (dirty) onSave(family, level, position.rankId); }}
          disabled={pending}
        />
      </td>
      <td>
        <input
          className={inputClass} style={{ width: '6rem' }}
          aria-label={`Job level for ${position.title}`}
          value={level} placeholder="L4"
          onChange={(e) => setLevel(e.target.value)}
          onBlur={() => { if (dirty) onSave(family, level, position.rankId); }}
          disabled={pending}
        />
      </td>
    </tr>
  );
}
