import { useState } from 'react';
import FormBuilder from './admin/FormBuilder';
import CompetencyAdmin from './admin/CompetencyAdmin';
import DevelopmentAdmin from './admin/DevelopmentAdmin';
import HelpAdmin from './admin/HelpAdmin';
import EvaluationTypes from './admin/EvaluationTypes';
import ImportStaff from './admin/ImportStaff';
import HrSettingsAdmin from './admin/HrSettingsAdmin';
import LeavePoliciesAdmin from './admin/LeavePoliciesAdmin';
import AttendancePoliciesAdmin from './admin/AttendancePoliciesAdmin';
import PayrollPoliciesAdmin from './admin/PayrollPoliciesAdmin';
import BranchesAdmin from './admin/BranchesAdmin';
import RolesAdmin from './admin/RolesAdmin';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import type { Employee } from '../types';
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
type SetupDomain = 'core' | 'attendance' | 'leaves' | 'payroll' | 'performance';

interface DomainConfig {
  id: SetupDomain;
  label: string;
  defaultTab: string;
  tabs: Array<{ id: string; label: string }>;
}

const DOMAINS: DomainConfig[] = [
  {
    id: 'core',
    label: '🏢 Core HR & Company',
    defaultTab: 'hr_settings',
    tabs: [
      { id: 'hr_settings', label: 'Company Profile & 201 Rules' },
      { id: 'branches', label: 'Branches & Regional Hubs' },
      { id: 'departments', label: 'Departments & Org Tree' },
      { id: 'types', label: 'Employment Types' },
      { id: 'positions', label: 'Positions & Rank Ladder' },
      { id: 'roles', label: 'User Roles & Access' },
      { id: 'import', label: '201 Staff Bulk Import' },
    ],
  },
  {
    id: 'attendance',
    label: '⏰ Time & Attendance',
    defaultTab: 'attendance_shifts',
    tabs: [
      { id: 'attendance_shifts', label: 'Shifts, Overtime & Biometrics' },
    ],
  },
  {
    id: 'leaves',
    label: '🏖️ Leave Policies',
    defaultTab: 'leave_types',
    tabs: [
      { id: 'leave_types', label: 'Statutory & Company Leaves' },
    ],
  },
  {
    id: 'payroll',
    label: '💰 Payroll & Compensation',
    defaultTab: 'payroll_matrices',
    tabs: [
      { id: 'payroll_matrices', label: 'Salary Matrices, Tax & Statutory' },
    ],
  },
  {
    id: 'performance',
    label: '🎯 Goals & Performance',
    defaultTab: 'evaluations',
    tabs: [
      { id: 'evaluations', label: 'Evaluation Types' },
      { id: 'forms', label: 'Review Forms & Rubrics' },
      { id: 'competencies', label: 'Competencies' },
      { id: 'development', label: 'Development Actions' },
      { id: 'help', label: 'Help Content' },
    ],
  },
];

export default function Setup() {
  const [domain, setDomain] = useState<SetupDomain>('core');
  const [tab, setTab] = useState<string>('hr_settings');

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const features = me.data?.features;
  const visibleDomains = DOMAINS.filter((d) => {
    if (!features) return true;
    if (d.id === 'attendance') return !!features.feature_time_attendance;
    if (d.id === 'leaves') return !!features.feature_leave_management;
    if (d.id === 'payroll') return !!features.feature_ph_payroll;
    if (d.id === 'performance') {
      return !!(
        features.feature_performance ||
        features.feature_kpis ||
        features.feature_peer_reviews ||
        features.feature_competencies_pip
      );
    }
    return true;
  });

  const currentDomainConfig =
    visibleDomains.find((d) => d.id === domain) ?? visibleDomains[0] ?? DOMAINS[0]!;

  const handleDomainChange = (newDomain: SetupDomain) => {
    setDomain(newDomain);
    const conf = visibleDomains.find((d) => d.id === newDomain);
    if (conf) {
      setTab(conf.defaultTab);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PageHead title="HR System Administration & Configuration" />

      {/* Top Domain Switcher */}
      <nav className="seg no-print" aria-label="Setup domain" style={{ flexWrap: 'wrap' }}>
        {visibleDomains.map((d) => (
          <label key={d.id} className="seg-opt">
            <input
              type="radio"
              name="setup-domain"
              checked={domain === d.id}
              onChange={() => handleDomainChange(d.id)}
            />
            <span style={{ fontWeight: domain === d.id ? 600 : 400 }}>{d.label}</span>
          </label>
        ))}
      </nav>

      {/* Sub-tab Switcher (if domain has multiple sub-tabs) */}
      {currentDomainConfig.tabs.length > 1 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', borderBottom: '1px solid var(--color-border)', paddingBottom: '12px' }}>
          {currentDomainConfig.tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={tab === t.id ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ fontSize: '14.5px', padding: '6px 14px' }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Active Tab Content */}
      {tab === 'hr_settings' && <HrSettingsAdmin />}
      {tab === 'branches' && <BranchesAdmin />}
      {tab === 'departments' && <Departments />}
      {tab === 'types' && <EmploymentTypes />}
      {tab === 'positions' && <Positions />}
      {tab === 'roles' && <RolesAdmin />}
      {tab === 'import' && <ImportStaff />}

      {tab === 'attendance_shifts' && <AttendancePoliciesAdmin />}
      {tab === 'leave_types' && <LeavePoliciesAdmin />}
      {tab === 'payroll_matrices' && <PayrollPoliciesAdmin />}

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
            <label className="flex items-center gap-1.5" style={{ fontSize: 15 }}>
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
        <p style={{ marginTop: 0, fontSize: 15, opacity: 0.7 }}>
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
                        <td style={{ fontFamily: 'monospace', fontSize: 15 }}>{d.code}</td>
                        <td>
                          {d.name}
                          {!d.isCurrent && (
                            <span style={{ marginLeft: 8, fontSize: 15 }}>
                              closed {d.effectiveTo}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 15 }}>{d.unitType}</td>
                        <td style={{ fontSize: 15 }}>{d.parentName ?? '—'}</td>
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
               style={{ width: '7rem', fontFamily: 'monospace', fontSize: 15 }}
               value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </td>
      <td>
        <input className={inputClass} aria-label="Department name"
               value={name} onChange={(e) => setName(e.target.value)} />
      </td>
      <td>
        <select className={inputClass} aria-label="Org unit level"
                style={{ fontSize: 15 }}
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
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newEligible, setNewEligible] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');

  const q = useQuery({
    queryKey: ['employment-types'],
    queryFn: () => api<EmploymentType[]>('/employment-types'),
  });

  const create = useMutation({
    mutationFn: () =>
      api('/employment-types', {
        method: 'POST',
        body: { code: newCode.trim().toUpperCase(), name: newName.trim(), isEligibleForReview: newEligible },
      }),
    onSuccess: () => {
      setNewCode('');
      setNewName('');
      void qc.invalidateQueries({ queryKey: ['employment-types'] });
    },
  });

  const update = useMutation({
    mutationFn: (input: { id: string; code?: string; name?: string; isEligibleForReview?: boolean; isActive?: boolean }) =>
      api(`/employment-types/${input.id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: ['employment-types'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/employment-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['employment-types'] }),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;

  return (
    <Card kicker="Employment types">
      <p style={{ marginTop: 0, fontSize: 15, opacity: 0.7 }}>
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
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((t) => (
              <tr key={t.id} style={t.isActive ? undefined : { opacity: 0.55 }}>
                <td style={{ fontFamily: 'monospace', fontSize: 15 }}>
                  {editingId === t.id ? (
                    <input
                      className="input-sm"
                      style={{ width: '7rem' }}
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                    />
                  ) : (
                    t.code
                  )}
                </td>
                <td>
                  {editingId === t.id ? (
                    <input
                      className="input-sm"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  ) : (
                    t.name
                  )}
                </td>
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
                    <span style={{ fontSize: 15, opacity: 0.7 }}>
                      {t.isEligibleForReview ? 'included' : 'excluded'}
                    </span>
                  </label>
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${t.name} active`}
                    checked={t.isActive}
                    disabled={update.isPending || (t.isActive && t.headcount > 0)}
                    title={t.isActive && t.headcount > 0
                      ? `${t.headcount} employee(s) currently hold this type`
                      : undefined}
                    onChange={(e) => update.mutate({ id: t.id, isActive: e.target.checked })}
                  />
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {editingId === t.id ? (
                    <>
                      <Btn
                        variant="primary"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: t.id, code: editCode, name: editName })}
                      >
                        Save
                      </Btn>{' '}
                      <Btn variant="ghost" onClick={() => setEditingId(null)}>Cancel</Btn>
                    </>
                  ) : (
                    <>
                      <Btn
                        variant="ghost"
                        onClick={() => {
                          setEditingId(t.id);
                          setEditCode(t.code);
                          setEditName(t.name);
                        }}
                      >
                        Edit
                      </Btn>
                      {t.headcount === 0 && (
                        <Btn variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(t.id)}>
                          Delete
                        </Btn>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-divider)' }}>
        <Field label="Code">
          <input className="input" style={{ width: '8rem' }} placeholder="PROB" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name">
          <input className="input" placeholder="Probationary" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </Field>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <input type="checkbox" checked={newEligible} onChange={(e) => setNewEligible(e.target.checked)} />
          Review eligible
        </label>
        <Btn variant="primary" disabled={!newCode.trim() || !newName.trim() || create.isPending} onClick={() => create.mutate()}>
          + Add Type
        </Btn>
      </div>
      <ErrorNote error={update.error || create.error || remove.error} />
    </Card>
  );
}

function Positions() {
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState('');
  const [newRankCode, setNewRankCode] = useState('');
  const [newRankName, setNewRankName] = useState('');
  const [newRankNo, setNewRankNo] = useState('1');

  const q = useQuery({
    queryKey: ['positions'],
    queryFn: () => api<Position[]>('/positions'),
  });
  const ranks = useQuery({
    queryKey: ['ranks'],
    queryFn: () => api<Rank[]>('/ranks'),
  });

  const createRank = useMutation({
    mutationFn: () =>
      api('/ranks', {
        method: 'POST',
        body: { code: newRankCode.trim().toUpperCase(), name: newRankName.trim(), rankNo: Number(newRankNo || 1) },
      }),
    onSuccess: () => {
      setNewRankCode('');
      setNewRankName('');
      void qc.invalidateQueries({ queryKey: ['ranks'] });
    },
  });

  const deleteRank = useMutation({
    mutationFn: (id: string) => api(`/ranks/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ranks'] }),
  });

  const createPos = useMutation({
    mutationFn: () => api('/positions', { method: 'POST', body: { title: newTitle.trim() } }),
    onSuccess: () => {
      setNewTitle('');
      void qc.invalidateQueries({ queryKey: ['positions'] });
    },
  });

  const update = useMutation({
    mutationFn: (input: {
      id: string; title?: string; jobFamily: string; jobLevel: string; rankId: string | null;
    }) =>
      api(`/positions/${input.id}`, {
        method: 'PATCH',
        body: {
          title: input.title,
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

  const deletePos = useMutation({
    mutationFn: (id: string) => api(`/positions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['positions'] }),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card kicker="Rank Ladder">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Code</th><th>Rank Name</th><th>Level No.</th><th>Positions</th><th /></tr>
            </thead>
            <tbody>
              {(ranks.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td><code>{r.code}</code></td>
                  <td><strong>{r.name}</strong></td>
                  <td className="tabular-nums">{r.rankNo}</td>
                  <td className="tabular-nums">{r.positionCount}</td>
                  <td style={{ textAlign: 'right' }}>
                    {r.positionCount === 0 && (
                      <Btn variant="ghost" disabled={deleteRank.isPending} onClick={() => deleteRank.mutate(r.id)}>
                        Delete
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
          <Field label="Code"><input className="input" style={{ width: '7rem' }} placeholder="MGR" value={newRankCode} onChange={(e) => setNewRankCode(e.target.value.toUpperCase())} /></Field>
          <Field label="Name"><input className="input" placeholder="Manager" value={newRankName} onChange={(e) => setNewRankName(e.target.value)} /></Field>
          <Field label="Rank No."><input type="number" className="input" style={{ width: '5rem' }} value={newRankNo} onChange={(e) => setNewRankNo(e.target.value)} /></Field>
          <Btn variant="primary" disabled={!newRankCode.trim() || !newRankName.trim() || createRank.isPending} onClick={() => createRank.mutate()}>+ Add Rank</Btn>
        </div>
        <ErrorNote error={createRank.error || deleteRank.error} />
      </Card>

      <Card kicker="Positions">
        <p style={{ marginTop: 0, fontSize: 15, opacity: 0.7 }}>
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
                <th>Rank</th>
                <th>Job family</th>
                <th>Level</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((p) => (
                <PositionRow key={p.id} position={p} ranks={ranks.data ?? []}
                             onSave={(title, family, level, rankId) =>
                               update.mutate({ id: p.id, title, jobFamily: family, jobLevel: level, rankId })}
                             onDelete={() => deletePos.mutate(p.id)}
                             pending={update.isPending || deletePos.isPending} />
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-divider)' }}>
          <Field label="New Position Title">
            <input className="input" placeholder="e.g., Fleet Supervisor" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </Field>
          <Btn variant="primary" disabled={!newTitle.trim() || createPos.isPending} onClick={() => createPos.mutate()}>
            + Add Position
          </Btn>
        </div>
        <ErrorNote error={update.error || createPos.error || deletePos.error} />
      </Card>
    </div>
  );
}

function PositionRow({ position, ranks, onSave, onDelete, pending }: {
  position: Position;
  ranks: Rank[];
  onSave: (title: string, family: string, level: string, rankId: string | null) => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState(position.title);
  const [family, setFamily] = useState(position.jobFamily ?? '');
  const [level, setLevel] = useState(position.jobLevel ?? '');
  const dirty = title !== position.title || family !== (position.jobFamily ?? '') || level !== (position.jobLevel ?? '');

  return (
    <tr>
      <td>
        <input
          className={inputClass}
          style={{ width: '13rem', fontWeight: 500 }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (dirty && title.trim()) onSave(title.trim(), family, level, position.rankId); }}
          disabled={pending}
        />
      </td>
      <td style={{ fontSize: 15 }}>{position.departmentName ?? '—'}</td>
      <td className="tabular-nums">{position.headcount}</td>
      <td>
        <select
          className={inputClass} style={{ width: '11rem', fontSize: 15 }}
          aria-label={`Rank for ${position.title}`}
          value={position.rankId ?? ''}
          disabled={pending || ranks.length === 0}
          onChange={(e) => onSave(title.trim() || position.title, family, level, e.target.value || null)}
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
          onBlur={() => { if (dirty) onSave(title.trim() || position.title, family, level, position.rankId); }}
          disabled={pending}
        />
      </td>
      <td>
        <input
          className={inputClass} style={{ width: '6rem' }}
          aria-label={`Job level for ${position.title}`}
          value={level} placeholder="L4"
          onChange={(e) => setLevel(e.target.value)}
          onBlur={() => { if (dirty) onSave(title.trim() || position.title, family, level, position.rankId); }}
          disabled={pending}
        />
      </td>
      <td style={{ textAlign: 'right' }}>
        {position.headcount === 0 && (
          <Btn variant="ghost" disabled={pending} onClick={onDelete}>
            Delete
          </Btn>
        )}
      </td>
    </tr>
  );
}
