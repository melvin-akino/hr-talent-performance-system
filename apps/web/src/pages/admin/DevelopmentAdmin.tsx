import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { ErrorNote, Field, Spinner, inputClass } from '../../components/ui';
import { Btn, Card } from '../../components/ds';

/*
 * Authoring for the things Phase 6 reads: career paths, the learning library,
 * and notification templates.
 *
 * All three were API-only. Without them an employee's "Career options" and
 * "Recommended for you" tabs are permanently empty, which reads as a broken
 * feature rather than an unconfigured one.
 */

interface Position { id: string; title: string; jobFamily: string | null }
interface Competency { id: string; name: string; category: string | null }
interface Framework { isActive: boolean; competencies: Competency[] }

interface CareerPath {
  id: string;
  fromPositionTitle: string;
  toPositionTitle: string;
  moveType: string;
  typicalMonths: number | null;
  notes: string | null;
}

interface Resource {
  id: string;
  title: string;
  description: string | null;
  resourceType: string;
  url: string | null;
  provider: string | null;
  durationMinutes: number | null;
  competencyName: string | null;
}

interface NotificationTemplate {
  id: string;
  code: string;
  version: number;
  description: string | null;
  subject: string;
  bodyText: string;
  isActive: boolean;
}

export default function DevelopmentAdmin() {
  const [view, setView] = useState<'library' | 'paths' | 'notifications'>('library');

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <nav className="seg no-print" aria-label="Development admin view">
        {([
          ['library', 'Learning library'],
          ['paths', 'Career paths'],
          ['notifications', 'Email templates'],
        ] as const).map(([key, label]) => (
          <label key={key} className="seg-opt">
            <input type="radio" name="development-admin-view" checked={view === key}
                   onChange={() => setView(key)} />
            <span>{label}</span>
          </label>
        ))}
      </nav>

      {view === 'library' && <Library />}
      {view === 'paths' && <Paths />}
      {view === 'notifications' && <Templates />}
    </div>
  );
}

function Library() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const resources = useQuery({
    queryKey: ['learning-resources'],
    queryFn: () => api<Resource[]>('/learning-resources'),
  });
  const frameworks = useQuery({
    queryKey: ['competency-frameworks'],
    queryFn: () => api<Framework[]>('/competency-frameworks'),
  });

  const [form, setForm] = useState({
    title: '', description: '', resourceType: 'course', url: '',
    provider: '', durationMinutes: '', competencyId: '',
  });

  const create = useMutation({
    mutationFn: () =>
      api('/learning-resources', {
        method: 'POST',
        body: {
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          resourceType: form.resourceType,
          url: form.url.trim() || undefined,
          provider: form.provider.trim() || undefined,
          durationMinutes: form.durationMinutes
            ? Number(form.durationMinutes) : undefined,
          competencyId: form.competencyId || undefined,
        },
      }),
    onSuccess: () => {
      setAdding(false);
      setForm({ title: '', description: '', resourceType: 'course', url: '',
                provider: '', durationMinutes: '', competencyId: '' });
      void qc.invalidateQueries({ queryKey: ['learning-resources'] });
    },
  });

  if (resources.isLoading) return <Spinner />;
  const competencies = frameworks.data?.find((f) => f.isActive)?.competencies ?? [];

  return (
    <Card
      title="Learning library"
      actions={<Btn variant="primary" onClick={() => setAdding((v) => !v)}>
        Add resource
      </Btn>}
    >
      <p className="mb-3 text-xs t-muted">
        Linking a resource to a competency is what makes it show up as a
        recommendation for people with a gap there. Unlinked resources are still
        assignable, just never suggested.
      </p>

      {adding && (
        <form className="mb-4 grid gap-4 border-b border-divider pb-4 sm:grid-cols-3"
              onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="sm:col-span-2">
            <Field label="Title">
              <input className={inputClass} required value={form.title}
                     onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
          </div>
          <Field label="Type">
            <select className={inputClass} value={form.resourceType}
                    onChange={(e) => setForm({ ...form, resourceType: e.target.value })}>
              {['course', 'document', 'video', 'book', 'workshop', 'link', 'mentoring']
                .map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Link" hint="Optional">
              <input type="url" className={inputClass} value={form.url}
                     placeholder="https://…"
                     onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </Field>
          </div>
          <Field label="Builds which competency" hint="Drives recommendations">
            <select className={inputClass} value={form.competencyId}
                    onChange={(e) => setForm({ ...form, competencyId: e.target.value })}>
              <option value="">— none —</option>
              {competencies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Provider">
            <input className={inputClass} value={form.provider}
                   onChange={(e) => setForm({ ...form, provider: e.target.value })} />
          </Field>
          <Field label="Duration (minutes)">
            <input type="number" min="1" className={inputClass} value={form.durationMinutes}
                   onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Description">
              <textarea rows={2} className={inputClass} value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-3 flex gap-3">
            <Btn type="submit" variant="primary" disabled={create.isPending}>Add</Btn>
            <Btn type="button" onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
          {create.error ? (
            <div className="sm:col-span-3"><ErrorNote error={create.error} /></div>
          ) : null}
        </form>
      )}

      {resources.data?.length === 0 ? (
        <p className="card-body" style={{ margin: 0 }}>Nothing in the library yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Type</th>
              <th>Competency</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {resources.data?.map((r) => (
              <tr key={r.id}>
                <td >
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer noopener"
                       className="font-medium text-muted hover:underline">{r.title}</a>
                  ) : <span className="font-medium">{r.title}</span>}
                  {r.provider && (
                    <p className="text-xs t-muted">{r.provider}</p>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-xs">{r.resourceType}</td>
                <td className="py-2.5 pr-4 text-xs">
                  {r.competencyName ?? (
                    <span className="text-muted">not linked — never recommended</span>
                  )}
                </td>
                <td className="py-2.5 text-xs t-muted">
                  {r.durationMinutes ? `${r.durationMinutes} min` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Paths() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const paths = useQuery({
    queryKey: ['career-paths'],
    queryFn: () => api<CareerPath[]>('/career-paths'),
  });
  const positions = useQuery({
    queryKey: ['positions'],
    queryFn: () => api<Position[]>('/positions'),
  });

  const [form, setForm] = useState({
    fromPositionId: '', toPositionId: '', moveType: 'promotion',
    typicalMonths: '', notes: '',
  });

  const create = useMutation({
    mutationFn: () =>
      api('/career-paths', {
        method: 'POST',
        body: {
          fromPositionId: form.fromPositionId,
          toPositionId: form.toPositionId,
          moveType: form.moveType,
          typicalMonths: form.typicalMonths ? Number(form.typicalMonths) : undefined,
          notes: form.notes.trim() || undefined,
        },
      }),
    onSuccess: () => {
      setAdding(false);
      setForm({ fromPositionId: '', toPositionId: '', moveType: 'promotion',
                typicalMonths: '', notes: '' });
      void qc.invalidateQueries({ queryKey: ['career-paths'] });
    },
  });

  if (paths.isLoading) return <Spinner />;

  return (
    <Card
      title="Career paths"
      actions={<Btn variant="primary" onClick={() => setAdding((v) => !v)}>
        Add path
      </Btn>}
    >
      <p className="mb-3 text-xs t-muted">
        Paths are directional and can branch — a role may be reachable from
        several others, and lateral moves are as real as promotions.
      </p>

      {adding && (
        <form className="mb-4 grid gap-4 border-b border-divider pb-4 sm:grid-cols-4"
              onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="From">
            <select className={inputClass} required value={form.fromPositionId}
                    onChange={(e) => setForm({ ...form, fromPositionId: e.target.value })}>
              <option value="">Select…</option>
              {positions.data?.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </Field>
          <Field label="To">
            <select className={inputClass} required value={form.toPositionId}
                    onChange={(e) => setForm({ ...form, toPositionId: e.target.value })}>
              <option value="">Select…</option>
              {positions.data?.filter((p) => p.id !== form.fromPositionId).map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </Field>
          <Field label="Move type">
            <select className={inputClass} value={form.moveType}
                    onChange={(e) => setForm({ ...form, moveType: e.target.value })}>
              <option value="promotion">Promotion</option>
              <option value="lateral">Lateral</option>
              <option value="specialisation">Specialisation</option>
            </select>
          </Field>
          <Field label="Typical months" hint="Optional, indicative only">
            <input type="number" min="1" className={inputClass} value={form.typicalMonths}
                   onChange={(e) => setForm({ ...form, typicalMonths: e.target.value })} />
          </Field>
          <div className="sm:col-span-4 flex gap-3">
            <Btn type="submit" variant="primary" disabled={create.isPending}>Add</Btn>
            <Btn type="button" onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
          {create.error ? (
            <div className="sm:col-span-4"><ErrorNote error={create.error} /></div>
          ) : null}
        </form>
      )}

      {paths.data?.length === 0 ? (
        <p className="card-body" style={{ margin: 0 }}>
          No career paths defined. Everyone's "Career options" tab is empty until
          there is at least one.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Move</th>
              <th>Typical time</th>
            </tr>
          </thead>
          <tbody>
            {paths.data?.map((p) => (
              <tr key={p.id}>
                <td >{p.fromPositionTitle}</td>
                <td className="py-2.5 pr-4 font-medium">{p.toPositionTitle}</td>
                <td className="py-2.5 pr-4 text-xs">{p.moveType}</td>
                <td className="py-2.5 text-xs t-muted">
                  {p.typicalMonths ? `~${p.typicalMonths} months` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Templates() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);

  const templates = useQuery({
    queryKey: ['notification-templates'],
    queryFn: () => api<NotificationTemplate[]>('/notifications/templates'),
  });

  const save = useMutation({
    mutationFn: (t: { code: string; subject: string; bodyText: string;
                      description?: string }) =>
      api('/notifications/templates', { method: 'POST', body: t }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['notification-templates'] });
    },
  });

  if (templates.isLoading) return <Spinner />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {editing && (
        <Card kicker={`Edit ${editing.code}`}>
          <p className="mb-3 text-xs t-muted">
            Saving publishes a new version and retires the current one. Placeholders
            look like <code className="panel-tint px-1">{'{{employeeName}}'}</code>;
            unknown ones are left visible in the email rather than blanked, so a
            mistake is obvious rather than silent.
          </p>
          <form style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate({
                    code: editing.code,
                    subject: editing.subject,
                    bodyText: editing.bodyText,
                    description: editing.description ?? undefined,
                  });
                }}>
            <Field label="Subject">
              <input className={inputClass} required value={editing.subject}
                     onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
            </Field>
            <Field label="Body">
              <textarea rows={10} className={`${inputClass} t-mono text-xs`}
                        required value={editing.bodyText}
                        onChange={(e) => setEditing({ ...editing, bodyText: e.target.value })} />
            </Field>
            <div className="flex gap-3">
              <Btn type="submit" variant="primary" disabled={save.isPending}>
                Publish new version
              </Btn>
              <Btn type="button" onClick={() => setEditing(null)}>Cancel</Btn>
            </div>
            <ErrorNote error={save.error} />
          </form>
        </Card>
      )}

      <Card kicker="Email templates">
        <table className="table">
          <thead>
            <tr>
              <th>Notification</th>
              <th>Subject</th>
              <th>Version</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.data?.filter((t) => t.isActive).map((t) => (
              <tr key={t.id}>
                <td >
                  <span className="t-mono text-xs">{t.code}</span>
                  {t.description && (
                    <p className="text-xs t-muted">{t.description}</p>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-xs">{t.subject}</td>
                <td className="py-2.5 pr-4 text-xs tabular-nums">v{t.version}</td>
                <td className="py-2.5 text-right no-print">
                  <Btn onClick={() => setEditing(t)}>Edit</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
