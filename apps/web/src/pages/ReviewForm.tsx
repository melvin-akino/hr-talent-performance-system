import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../auth';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import {
  Attainment, Bar, Btn, Card, Icon, PageHead, ReviewStateTag, Section, paths,
} from '../components/ds';

interface FormField {
  key: string;
  label: string;
  type: 'rating' | 'text' | 'textarea' | 'select' | 'multiselect'
      | 'number' | 'boolean' | 'goal_review';
  required: boolean;
  helpText?: string;
  options?: string[];
  maxLength?: number;
}

interface ReviewInstance {
  id: string;
  reviewerRole: 'self' | 'supervisor' | 'calibrator';
  state: 'not_started' | 'in_progress' | 'submitted' | 'returned';
  overallRating: string | null;
  returnedReason: string | null;
  subjectName: string;
  cycleName: string;
  schema: { sections: { key: string; title: string; description?: string; fields: FormField[] }[] };
  ratingPoints: { value: number; label: string; description: string | null }[];
  responses: Record<string, unknown>;
}

interface GoalContext {
  goals: { id: string; title: string; weight: string; attainmentPct: string | null }[];
  weightedAttainment: string | null;
}

/**
 * Fill in a review.
 *
 * Answers are frozen the moment the review is submitted -- the database
 * enforces that, and the form goes read-only to match. If a change is needed
 * afterwards the review must be explicitly returned, which is recorded.
 */
export default function ReviewForm() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);

  const review = useQuery({
    queryKey: ['review', id],
    queryFn: () => api<ReviewInstance>(`/reviews/${id}`),
  });
  const goals = useQuery({
    queryKey: ['review-goals', id],
    queryFn: () => api<GoalContext>(`/reviews/${id}/goals`),
  });

  useEffect(() => {
    if (review.data) setValues(review.data.responses ?? {});
  }, [review.data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/reviews/${id}`, {
        method: 'PATCH',
        body: {
          responses: values,
          overallRating: typeof values.overall === 'number' ? values.overall : undefined,
        },
      }),
    onSuccess: () => {
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['review', id] });
    },
  });

  const submit = useMutation({
    // Save first: submitting silently discards unsaved edits otherwise, and
    // the form is read-only afterwards so there is no way back.
    mutationFn: async () => {
      await api(`/reviews/${id}`, {
        method: 'PATCH',
        body: {
          responses: values,
          overallRating: typeof values.overall === 'number' ? values.overall : undefined,
        },
      });
      return api(`/reviews/${id}/submit`, { method: 'POST' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['review', id] });
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      navigate('/reviews');
    },
  });

  if (review.isLoading) return <Spinner />;
  if (review.error) return <ErrorNote error={review.error} />;
  // Not merely defensive: between a failed fetch and the retry settling,
  // isLoading is false and error is not yet set, so `data` can be undefined.
  // Dereferencing it here crashes the render and — with no boundary above —
  // blanks the entire application.
  if (!review.data) {
    return <ErrorNote error={new Error('This review is not available to you.')} />;
  }
  const r = review.data;
  const readOnly = r.state === 'submitted';

  const set = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
  };

  // Answered counts, per section and overall. The form is long and rendered
  // from a schema HR authors, so its length is unknown until it loads —
  // showing progress is what stops it reading as an undifferentiated wall.
  const answered = (f: FormField) => {
    const v = values[f.key];
    return v !== undefined && v !== null && v !== '';
  };
  const allFields = r.schema.sections.flatMap((s) => s.fields);
  const answeredCount = allFields.filter(answered).length;

  return (
    <Section>
      <PageHead
        title={r.reviewerRole === 'self' ? 'My self review' : `Review of ${r.subjectName}`}
        meta={<span style={{ fontSize: 13, opacity: 0.65 }}>{r.cycleName}</span>}
      >
        <ReviewStateTag state={r.state} />
      </PageHead>

      {/* A returned review leads with the reason. Burying it under the form is
          how someone resubmits without addressing the comment. */}
      {r.state === 'returned' && r.returnedReason && (
        <Card accent elevated style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon path={paths.triangleAlert} size={18} stroke="var(--color-accent-800)" />
          <div style={{ fontSize: 14 }}>
            <strong>Returned by your manager.</strong> {r.returnedReason}
          </div>
        </Card>
      )}

      {readOnly && (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon path={paths.check} size={18} stroke="var(--color-accent-700)" />
          <div style={{ fontSize: 14 }}>
            This review has been submitted and can no longer be edited.
          </div>
        </Card>
      )}

      {(goals.data?.goals.length ?? 0) > 0 && (
        <Card kicker="Goal results for this period">
          <table className="table">
            <thead>
              <tr><th>Goal</th><th>Weight</th><th style={{ width: 170 }}>Attainment</th></tr>
            </thead>
            <tbody>
              {goals.data?.goals.map((g) => (
                <tr key={g.id}>
                  <td>{g.title}</td>
                  <td className="tabular-nums">{Number(g.weight)}%</td>
                  <td><Attainment pct={g.attainmentPct} /></td>
                </tr>
              ))}
            </tbody>
            {goals.data?.weightedAttainment && (
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 600 }}>Weighted overall</td>
                  <td />
                  <td><Attainment pct={goals.data.weightedAttainment} /></td>
                </tr>
              </tfoot>
            )}
          </table>
        </Card>
      )}

      {!readOnly && allFields.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, opacity: 0.7 }}>
          <div style={{ flex: 1 }}>
            <Bar pct={(answeredCount / allFields.length) * 100} />
          </div>
          <span>{answeredCount} of {allFields.length} fields answered</span>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {r.schema.sections.map((section, i) => {
          const done = section.fields.filter(answered).length;
          return (
            /* Native <details>: collapsible with no script, and the count means
               length is visible before opening. First section starts open. */
            <details key={section.key} open={i === 0}>
              <summary style={{
                cursor: 'pointer', fontFamily: 'var(--font-heading)', fontWeight: 600,
                fontSize: 18, padding: 'var(--space-2) 0',
              }}>
                {section.title}{' '}
                <span style={{
                  fontSize: 12, fontWeight: 400, opacity: 0.6, fontFamily: 'var(--font-body)',
                }}>
                  {done} of {section.fields.length}
                </span>
              </summary>
              <Card>
                {section.description && (
                  <p className="card-body" style={{ marginTop: 0 }}>{section.description}</p>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {section.fields.map((f) => (
                    <FieldInput
                      key={f.key}
                      field={f}
                      value={values[f.key]}
                      ratingPoints={r.ratingPoints}
                      readOnly={readOnly}
                      onChange={(v) => set(f.key, v)}
                    />
                  ))}
                </div>
              </Card>
            </details>
          );
        })}

        {!readOnly && (
          <div style={{
            display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap',
            justifyContent: 'flex-end', borderTop: '1px solid var(--color-divider)',
            paddingTop: 'var(--space-3)',
          }}>
            <span className="text-muted" style={{ fontSize: 12, marginRight: 'auto' }}>
              Submitting locks your answers. A change afterwards requires the review
              to be returned.
            </span>
            <Btn type="button" disabled={save.isPending || !dirty}
                 onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
            </Btn>
            <Btn type="submit" variant="primary" disabled={submit.isPending}>
              {submit.isPending ? 'Submitting…' : 'Submit'}
            </Btn>
          </div>
        )}

        <ErrorNote error={submit.error ?? save.error} />
      </form>
    </Section>
  );
}

function FieldInput({ field, value, ratingPoints, readOnly, onChange }: {
  field: FormField;
  value: unknown;
  ratingPoints: { value: number; label: string; description: string | null }[];
  readOnly: boolean;
  onChange: (v: unknown) => void;
}) {
  const label = field.required ? `${field.label} *` : field.label;

  if (field.type === 'goal_review') {
    return (
      <p className="text-sm t-muted">
        Goal results are shown above and are recorded with this review.
      </p>
    );
  }

  if (field.type === 'rating') {
    // Renders whatever scale the cycle defines. Hardcoding 1–5 would break any
    // organisation using a different one, and would make a historical cycle
    // render against the wrong scale — see the API appendix.
    const selected = ratingPoints.find((p) => p.value === value);
    return (
      <Field label={label} hint={field.helpText}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ratingPoints.map((p) => {
            const isOn = value === p.value;
            return (
              <button
                key={p.value}
                type="button"
                disabled={readOnly}
                title={p.description ?? undefined}
                onClick={() => onChange(p.value)}
                className="tag"
                style={{
                  cursor: readOnly ? 'not-allowed' : 'pointer',
                  border: '1px solid var(--color-divider)',
                  background: isOn ? 'var(--color-accent)' : 'transparent',
                  color: isOn ? 'var(--color-bg)' : 'inherit',
                  borderColor: isOn ? 'var(--color-accent)' : 'var(--color-divider)',
                  opacity: readOnly && !isOn ? 0.5 : 1,
                  fontSize: 12,
                  padding: '5px 10px',
                }}
              >
                {p.value} — {p.label}
              </button>
            );
          })}
        </div>
        {/* The chosen point's description, so the scale explains itself at the
            moment of choosing rather than in a policy document. */}
        {selected?.description && (
          <p style={{ fontSize: 12, opacity: 0.65, margin: '6px 0 0' }}>
            {selected.description}
          </p>
        )}
      </Field>
    );
  }

  if (field.type === 'textarea') {
    return (
      <Field label={label} hint={field.helpText}>
        <textarea
          rows={4}
          className={inputClass}
          readOnly={readOnly}
          maxLength={field.maxLength}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }

  if (field.type === 'select') {
    return (
      <Field label={label} hint={field.helpText}>
        <select className={inputClass} disabled={readOnly}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
    );
  }

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={readOnly} checked={value === true}
               onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }

  if (field.type === 'number') {
    return (
      <Field label={label} hint={field.helpText}>
        <input type="number" step="any" className={inputClass} readOnly={readOnly}
               value={typeof value === 'number' ? value : ''}
               onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      </Field>
    );
  }

  return (
    <Field label={label} hint={field.helpText}>
      <input className={inputClass} readOnly={readOnly} maxLength={field.maxLength}
             value={typeof value === 'string' ? value : ''}
             onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
