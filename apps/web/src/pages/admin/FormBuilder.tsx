import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { ErrorNote, Field, Spinner, inputClass } from '../../components/ui';
import { Btn, Card } from '../../components/ds';

/*
 * Review form authoring: rating scales, form templates, and assignment.
 *
 * Until now these were API-only — HR could not run a review cycle without a
 * developer posting JSON. This is the screen that closes that gap.
 *
 * Two rules from the backend are surfaced deliberately rather than hidden:
 *   1. A published version is IMMUTABLE. Editing means publishing a new
 *      version, and the UI says so before you publish rather than failing after.
 *   2. Field keys must be unique across the WHOLE form, not per section —
 *      responses are stored keyed by field key, so a duplicate silently
 *      overwrites another section's answer. Validated here and server-side.
 */

type FieldType =
  | 'rating' | 'text' | 'textarea' | 'select' | 'multiselect'
  | 'number' | 'boolean' | 'goal_review' | 'competency_review';

interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  helpText?: string;
  options?: string[];
}

interface FormSection {
  key: string;
  title: string;
  description?: string;
  fields: FormField[];
}

interface Template {
  id: string;
  code: string;
  name: string;
  description: string | null;
  activeVersionId: string | null;
  activeVersion: number | null;
  ratingScaleId: string | null;
  versionCount: number;
}

interface RatingScale {
  id: string;
  code: string;
  version: number;
  name: string;
  isActive: boolean;
  points: { value: number; label: string; description: string | null }[];
}

const FIELD_TYPES: { value: FieldType; label: string; note?: string }[] = [
  { value: 'rating', label: 'Rating', note: 'Uses the form\'s rating scale' },
  { value: 'textarea', label: 'Long text' },
  { value: 'text', label: 'Short text' },
  { value: 'select', label: 'Single choice' },
  { value: 'multiselect', label: 'Multiple choice' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'goal_review', label: 'Goal results', note: 'Renders their goals; stores no answer' },
  { value: 'competency_review', label: 'Competency assessment', note: 'Writes to the gap report' },
];

/** Derives a stable field key from a label so HR never has to think about keys. */
const toKey = (label: string): string =>
  label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';

export default function FormBuilder() {
  const [view, setView] = useState<'templates' | 'scales' | 'assignments'>('templates');

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <nav className="seg no-print" aria-label="Form builder view">
        {([
          // Deliberately not "Review forms" — that is the parent tab's label,
          // and two identically named tabs at different levels is disorienting.
          ['templates', 'Form templates'],
          ['scales', 'Rating scales'],
          ['assignments', 'Who gets which form'],
        ] as const).map(([key, label]) => (
          <label key={key} className="seg-opt">
            <input type="radio" name="form-builder-view" checked={view === key}
                   onChange={() => setView(key)} />
            <span>{label}</span>
          </label>
        ))}
      </nav>

      {view === 'templates' && <Templates />}
      {view === 'scales' && <Scales />}
      {view === 'assignments' && <Assignments />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rating scales
// ---------------------------------------------------------------------------

function Scales() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const scales = useQuery({
    queryKey: ['rating-scales'],
    queryFn: () => api<RatingScale[]>('/rating-scales'),
  });

  if (scales.isLoading) return <Spinner />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {creating && (
        <NewScale onDone={() => {
          setCreating(false);
          void qc.invalidateQueries({ queryKey: ['rating-scales'] });
        }} />
      )}

      <Card
        title="Rating scales"
        actions={<Btn variant="primary" onClick={() => setCreating((v) => !v)}>
          New scale
        </Btn>}
      >
        <p className="mb-3 text-xs t-muted">
          A form's rating questions all use its scale. Scales are versioned, so a
          past review keeps the labels it was written under.
        </p>
        {scales.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No rating scales yet. A review form needs one.</p>
        ) : (
          <ul>
            {scales.data?.map((s) => (
              <li key={s.id} className="py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-2 t-mono text-xs t-faint">
                      {s.code} v{s.version}
                    </span>
                  </div>
                  {!s.isActive && <span className="text-xs t-faint">retired</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {s.points.map((p) => (
                    <span key={p.value}
                          className="panel-tint px-2 py-1 text-xs">
                      {p.value} — {p.label}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NewScale({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [points, setPoints] = useState([
    { value: 1, label: '' }, { value: 2, label: '' }, { value: 3, label: '' },
  ]);

  const create = useMutation({
    mutationFn: () =>
      api('/rating-scales', {
        method: 'POST',
        body: {
          code: code.trim().toUpperCase(), name: name.trim(),
          points: points.filter((p) => p.label.trim())
            .map((p) => ({ value: p.value, label: p.label.trim() })),
        },
      }),
    onSuccess: onDone,
  });

  return (
    <Card kicker="New rating scale">
      <form className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Code" hint="e.g. STD">
          <input className={inputClass} required value={code}
                 onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name">
          <input className={inputClass} required value={name}
                 placeholder="Standard 1–5"
                 onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">
              Points <span className="text-xs font-normal t-muted">(at least two)</span>
            </span>
            <Btn type="button"
                    onClick={() => setPoints((p) => [...p, { value: p.length + 1, label: '' }])}>
              Add point
            </Btn>
          </div>
          <div className="space-y-2">
            {points.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number" step="0.1"
                  className="w-20 input-sm"
                  value={p.value}
                  onChange={(e) => setPoints((prev) => prev.map((x, idx) =>
                    idx === i ? { ...x, value: Number(e.target.value) } : x))}
                />
                <input
                  className="flex-1 input-sm"
                  placeholder="Label, e.g. Meets expectations"
                  value={p.label}
                  onChange={(e) => setPoints((prev) => prev.map((x, idx) =>
                    idx === i ? { ...x, label: e.target.value } : x))}
                />
                {points.length > 2 && (
                  <button type="button" className="text-xs text-muted"
                          onClick={() => setPoints((prev) => prev.filter((_, idx) => idx !== i))}>
                    remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="sm:col-span-2 flex gap-3">
          <Btn type="submit" variant="primary" disabled={create.isPending}>Create</Btn>
          <Btn type="button" onClick={onDone}>Cancel</Btn>
        </div>
        {create.error ? <div className="sm:col-span-2"><ErrorNote error={create.error} /></div> : null}
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function Templates() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ template?: Template } | null>(null);

  const templates = useQuery({
    queryKey: ['form-templates'],
    queryFn: () => api<Template[]>('/form-templates'),
  });

  if (templates.isLoading) return <Spinner />;

  if (editing) {
    return (
      <TemplateEditor
        template={editing.template}
        onDone={() => {
          setEditing(null);
          void qc.invalidateQueries({ queryKey: ['form-templates'] });
        }}
      />
    );
  }

  return (
    <Card
      title="Review forms"
      actions={<Btn variant="primary" onClick={() => setEditing({})}>New form</Btn>}
    >
      {templates.data?.length === 0 ? (
        <p className="card-body" style={{ margin: 0 }}>No review forms yet. A review cycle cannot run without one.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Active version</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.data?.map((t) => (
              <tr key={t.id}>
                <td className="py-2.5 pr-4 t-mono text-xs">{t.code}</td>
                <td >
                  {t.name}
                  {t.description && (
                    <p className="text-xs t-muted">{t.description}</p>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-xs">
                  {t.activeVersion ? `v${t.activeVersion}` : '—'}
                  <span className="ml-2 t-faint">
                    ({t.versionCount} total)
                  </span>
                </td>
                <td className="py-2.5 text-right no-print">
                  <Btn onClick={() => setEditing({ template: t })}>
                    New version
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function TemplateEditor({ template, onDone }: {
  template?: Template;
  onDone: () => void;
}) {
  const isNewVersion = !!template;

  const [code, setCode] = useState(template?.code ?? '');
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [ratingScaleId, setRatingScaleId] = useState(template?.ratingScaleId ?? '');
  const [sections, setSections] = useState<FormSection[]>([
    {
      key: 'overall', title: 'Overall assessment',
      fields: [
        { key: 'overall', label: 'Overall rating', type: 'rating', required: true },
        { key: 'strengths', label: 'Strengths', type: 'textarea', required: true },
      ],
    },
  ]);

  const scales = useQuery({
    queryKey: ['rating-scales'],
    queryFn: () => api<RatingScale[]>('/rating-scales'),
  });

  // Load the current version's schema so a new version starts from what exists
  // rather than from a blank page.
  const currentVersion = useQuery({
    queryKey: ['form-version', template?.activeVersionId],
    queryFn: () => api<{ schema: { sections: FormSection[] } }>(
      `/form-versions/${template!.activeVersionId}`),
    enabled: !!template?.activeVersionId,
  });

  const loaded = useState(false);
  if (currentVersion.data && !loaded[0]) {
    loaded[1](true);
    if (currentVersion.data.schema?.sections?.length) {
      setSections(currentVersion.data.schema.sections);
    }
  }

  // Duplicate keys silently overwrite answers, so surface them before publish.
  const allKeys = sections.flatMap((s) => s.fields.map((f) => f.key));
  const duplicates = allKeys.filter((k, i) => allKeys.indexOf(k) !== i);

  const save = useMutation({
    mutationFn: () => {
      const body = { schema: { sections }, ratingScaleId: ratingScaleId || undefined };
      return isNewVersion
        ? api(`/form-templates/${template!.id}/versions`, { method: 'POST', body })
        : api('/form-templates', {
            method: 'POST',
            body: {
              code: code.trim().toUpperCase(), name: name.trim(),
              description: description.trim() || undefined,
              ...body,
            },
          });
    },
    onSuccess: onDone,
  });

  const patchSection = (i: number, patch: Partial<FormSection>) =>
    setSections((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const patchField = (si: number, fi: number, patch: Partial<FormField>) =>
    setSections((p) => p.map((s, idx) => idx === si
      ? { ...s, fields: s.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f)) }
      : s));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <Card kicker={isNewVersion ? `New version of ${template!.code}` : 'New review form'}>
        {isNewVersion && (
          <p className="mb-4 rounded-md hr-note px-3 py-2 text-xs text-muted">
            Published forms cannot be edited. Saving creates <strong>version{' '}
            {(template!.activeVersion ?? 0) + 1}</strong> and retires the current one.
            Reviews already answered keep rendering the version they were written
            against.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code" hint={isNewVersion ? 'Fixed for a new version' : 'e.g. STD'}>
            <input className={inputClass} required value={code} readOnly={isNewVersion}
                   onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Name">
            <input className={inputClass} required value={name} readOnly={isNewVersion}
                   onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Rating scale" hint="Used by every rating question">
            <select className={inputClass} value={ratingScaleId}
                    onChange={(e) => setRatingScaleId(e.target.value)}>
              <option value="">— none —</option>
              {scales.data?.filter((s) => s.isActive).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          {!isNewVersion && (
            <div className="sm:col-span-3">
              <Field label="Description">
                <input className={inputClass} value={description}
                       onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      </Card>

      {sections.map((section, si) => (
        <Card
          key={si}
          title={
            <input
              className="input-sm font-semibold"
              value={section.title}
              onChange={(e) => patchSection(si, {
                title: e.target.value, key: toKey(e.target.value) })}
            />
          }
          actions={
            <div className="flex gap-2">
              <Btn onClick={() => patchSection(si, {
                fields: [...section.fields, {
                  key: `field_${section.fields.length + 1}`,
                  label: '', type: 'textarea', required: false,
                }],
              })}>
                Add question
              </Btn>
              {sections.length > 1 && (
                <Btn
                        onClick={() => setSections((p) => p.filter((_, i) => i !== si))}>
                  Remove section
                </Btn>
              )}
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {section.fields.map((field, fi) => (
              <div key={fi} className="grid gap-3 rounded-md border border-divider p-3 sm:grid-cols-12">
                <div className="sm:col-span-5">
                  <Field label="Question">
                    <input
                      className={inputClass} value={field.label}
                      placeholder="What are you asking?"
                      onChange={(e) => patchField(si, fi, {
                        label: e.target.value,
                        // Keys derive from labels so HR never types one, but an
                        // already-answered form's keys must not shift, which is
                        // why editing publishes a new version.
                        key: toKey(e.target.value),
                      })}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-3">
                  <Field label="Type">
                    <select className={inputClass} value={field.type}
                            onChange={(e) => patchField(si, fi, {
                              type: e.target.value as FieldType })}>
                      {FIELD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="sm:col-span-2 flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={field.required}
                           onChange={(e) => patchField(si, fi, { required: e.target.checked })} />
                    Required
                  </label>
                </div>
                <div className="sm:col-span-2 flex items-end justify-end pb-1">
                  <button type="button" className="text-xs text-muted"
                          onClick={() => patchSection(si, {
                            fields: section.fields.filter((_, j) => j !== fi) })}>
                    remove
                  </button>
                </div>

                {(field.type === 'select' || field.type === 'multiselect') && (
                  <div className="sm:col-span-12">
                    <Field label="Choices" hint="One per line">
                      <textarea rows={3} className={inputClass}
                                value={(field.options ?? []).join('\n')}
                                onChange={(e) => patchField(si, fi, {
                                  options: e.target.value.split('\n').filter(Boolean) })} />
                    </Field>
                  </div>
                )}

                {FIELD_TYPES.find((t) => t.value === field.type)?.note && (
                  <p className="sm:col-span-12 text-xs t-muted">
                    {FIELD_TYPES.find((t) => t.value === field.type)!.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Btn onClick={() => setSections((p) => [...p, {
          key: `section_${p.length + 1}`, title: 'New section', fields: [],
        }])}>
          Add section
        </Btn>
        <Btn
          variant="primary"
          disabled={save.isPending || duplicates.length > 0
                    || sections.some((s) => s.fields.some((f) => !f.label.trim()))}
          onClick={() => save.mutate()}
        >
          {isNewVersion ? 'Publish new version' : 'Create and publish'}
        </Btn>
        <Btn onClick={onDone}>Cancel</Btn>
      </div>

      {duplicates.length > 0 && (
        <ErrorNote error={new Error(
          `Two questions produce the same key (${[...new Set(duplicates)].join(', ')}). ` +
          `Answers are stored by key, so one would overwrite the other. Reword one.`)} />
      )}
      <ErrorNote error={save.error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

function Assignments() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const assignments = useQuery({
    queryKey: ['form-assignments'],
    queryFn: () => api<{
      id: string; templateCode: string; templateName: string;
      employmentType: string | null; role: string | null;
    }[]>('/form-assignments'),
  });
  const templates = useQuery({
    queryKey: ['form-templates'],
    queryFn: () => api<Template[]>('/form-templates'),
  });
  const types = useQuery({
    queryKey: ['employment-types'],
    queryFn: () => api<{ id: string; code: string; name: string }[]>('/employment-types'),
  });
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api<{ id: string; code: string; name: string }[]>('/roles'),
  });

  const [formTemplateId, setTemplate] = useState('');
  const [employmentTypeId, setType] = useState('');
  const [appRoleId, setRole] = useState('');

  const assign = useMutation({
    mutationFn: () =>
      api('/form-assignments', {
        method: 'POST',
        body: {
          formTemplateId,
          employmentTypeId: employmentTypeId || undefined,
          appRoleId: appRoleId || undefined,
        },
      }),
    onSuccess: () => {
      setAdding(false);
      void qc.invalidateQueries({ queryKey: ['form-assignments'] });
    },
  });

  if (assignments.isLoading) return <Spinner />;

  const hasDefault = assignments.data?.some(
    (a) => !a.employmentType && !a.role);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <Card
        title="Who gets which form"
        actions={<Btn variant="primary" onClick={() => setAdding((v) => !v)}>
          Add assignment
        </Btn>}
      >
        <p className="mb-3 text-xs t-muted">
          Most specific wins: employment type + role beats either alone, which
          beats the organisation default.
        </p>

        {!hasDefault && (
          <p className="mb-3 rounded-md hr-note px-3 py-2 text-xs text-muted">
            No organisation default is set. Anyone not matched by a rule below has
            no form, and review generation will skip them.
          </p>
        )}

        {assignments.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No assignments yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employment type</th>
                <th>Role</th>
                <th>Form</th>
              </tr>
            </thead>
            <tbody>
              {assignments.data?.map((a) => (
                <tr key={a.id}>
                  <td className="py-2.5 pr-4 text-xs">
                    {a.employmentType ?? <span className="t-faint">any</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-xs">
                    {a.role ?? <span className="t-faint">any</span>}
                  </td>
                  <td >
                    {a.templateName}
                    <span className="ml-2 t-mono text-xs t-faint">
                      {a.templateCode}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {adding && (
          <form className="mt-4 grid gap-4 border-t border-divider pt-4 sm:grid-cols-3"
                onSubmit={(e) => { e.preventDefault(); assign.mutate(); }}>
            <Field label="Form">
              <select className={inputClass} required value={formTemplateId}
                      onChange={(e) => setTemplate(e.target.value)}>
                <option value="">Select…</option>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Employment type" hint="Leave blank for any">
              <select className={inputClass} value={employmentTypeId}
                      onChange={(e) => setType(e.target.value)}>
                <option value="">any</option>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Role" hint="Leave blank for any">
              <select className={inputClass} value={appRoleId}
                      onChange={(e) => setRole(e.target.value)}>
                <option value="">any</option>
                {roles.data?.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-3 flex gap-3">
              <Btn type="submit" variant="primary" disabled={assign.isPending}>
                Assign
              </Btn>
              <Btn type="button" onClick={() => setAdding(false)}>Cancel</Btn>
            </div>
            {assign.error ? (
              <div className="sm:col-span-3"><ErrorNote error={assign.error} /></div>
            ) : null}
          </form>
        )}
      </Card>
    </div>
  );
}
