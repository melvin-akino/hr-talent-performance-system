import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../auth';
import { ErrorNote, Spinner, Field, inputClass } from '../components/ui';
import { Btn, Card, EmptyState, PageHead, Section, Tag } from '../components/ds';

/**
 * The report builder (§7.2, F2).
 *
 * THE FILTERS LIVE IN THE URL, not in component state.
 *
 * A report is the thing somebody sends to their boss, and a report you cannot
 * link to is one that gets re-created by hand every time — differently each
 * time, which is how two people end up quoting different numbers from "the
 * same" report. Putting the filters in the query string makes the browser's
 * back button work, makes the link shareable, and means the CSV can be built
 * from exactly the string the screen was showing.
 *
 * There is no role branch here and no permission check. The same URL returns a
 * section to a Department Head and the organisation to HCM, because the
 * function underneath runs as the caller.
 */

interface Row {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  department: string | null;
  occurredOn: string;
  kind: string;
  evalType: string | null;
  title: string;
  detail: string | null;
  result: string | null;
  refId: string;
}
interface Result { rows: Row[]; truncated: boolean; limit: number }
interface Option { value: string; label: string }
interface Options {
  departments: { id: string; code: string; name: string; unitType: string }[];
  kinds: Option[];
  evalTypes: Option[];
  pipOutcomes: string[];
}

const KIND_TONE: Record<string, 'accent' | 'neutral' | 'outline'> = {
  review: 'accent',
  task_evaluation: 'accent',
  pip: 'outline',
  competency: 'neutral',
  employment_event: 'neutral',
};

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const [pending, setPending] = useState(() => Object.fromEntries(params));

  const options = useQuery({
    queryKey: ['report-options'],
    queryFn: () => api<Options>('/reports/evaluations/options'),
  });

  // The query string is the input to the report, verbatim. Anything the screen
  // sends, the CSV endpoint receives identically — so the file can never be a
  // different report from the table above it.
  const qs = params.toString();

  const report = useQuery({
    queryKey: ['report', qs],
    queryFn: () => api<Result>(`/reports/evaluations${qs ? `?${qs}` : ''}`),
  });

  const set = (k: string, v: string) =>
    setPending((p) => ({ ...p, [k]: v }));

  const apply = () => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(pending)) if (v) next.set(k, v);
    setParams(next);
  };

  const clear = () => { setPending({}); setParams(new URLSearchParams()); };

  const exportCsv = async () => {
    const csv = await api<string>(
      `/reports/evaluations.csv${qs ? `?${qs}` : ''}`, { raw: true });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'evaluation-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Grouping is presentation only — the rows arrive ordered by person, so this
  // walks them once rather than sorting again and possibly differently.
  const grouped = useMemo(() => {
    const out: { employeeId: string; name: string; no: string; dept: string | null; rows: Row[] }[] = [];
    for (const r of report.data?.rows ?? []) {
      const last = out[out.length - 1];
      if (last && last.employeeId === r.employeeId) last.rows.push(r);
      else out.push({
        employeeId: r.employeeId, name: r.employeeName, no: r.employeeNo,
        dept: r.department, rows: [r],
      });
    }
    return out;
  }, [report.data]);

  const filteringByEvalType = !!pending['evalTypes'];

  return (
    <Section>
      <PageHead
        title="Reports"
        meta={<span style={{ fontSize: 14, opacity: 0.7 }}>
          Evaluation history, filtered
        </span>}
      >
        <Btn onClick={() => void exportCsv()} disabled={!report.data?.rows.length}>
          Export CSV
        </Btn>
      </PageHead>

      <Card kicker="Filters" title="What do you want to see?">
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        }}>
          <Field label="Name or employee no.">
            <input
              className={inputClass}
              value={pending['name'] ?? ''}
              placeholder="e.g. Dimalanta, or HCM-001"
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>

          <Field label="From">
            <input type="date" className={inputClass}
                   value={pending['from'] ?? ''}
                   onChange={(e) => set('from', e.target.value)} />
          </Field>

          <Field label="To">
            <input type="date" className={inputClass}
                   value={pending['to'] ?? ''}
                   onChange={(e) => set('to', e.target.value)} />
          </Field>

          <Field label="Unit" hint="Includes everything under it.">
            <select className={inputClass}
                    value={pending['departmentId'] ?? ''}
                    onChange={(e) => set('departmentId', e.target.value)}>
              <option value="">All units</option>
              {options.data?.departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Source">
            <select className={inputClass}
                    value={pending['kinds'] ?? ''}
                    onChange={(e) => set('kinds', e.target.value)}>
              <option value="">Everything</option>
              {options.data?.kinds.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Evaluation type"
            hint={filteringByEvalType
              ? 'Reviews only — see the note below.'
              : 'Type I–V, from the evaluation definition.'}
          >
            <select className={inputClass}
                    value={pending['evalTypes'] ?? ''}
                    onChange={(e) => set('evalTypes', e.target.value)}>
              <option value="">Any type</option>
              {options.data?.evalTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Result" hint="A PIP outcome, or an exact score.">
            <input
              className={inputClass}
              list="report-results"
              value={pending['results'] ?? ''}
              placeholder="e.g. successful"
              onChange={(e) => set('results', e.target.value)}
            />
            <datalist id="report-results">
              {options.data?.pipOutcomes.map((o) => <option key={o} value={o} />)}
            </datalist>
          </Field>
        </div>

        {/* Stated, not discovered. Filtering by evaluation type necessarily
            excludes PIPs and task evaluations, because those are not run from
            an evaluation definition and have no type. Without this line the
            report simply looks empty and the reader concludes the data is
            missing. */}
        {filteringByEvalType && (
          <p className="text-muted" style={{ fontSize: 13, marginTop: 10 }}>
            Evaluation type comes from the review's definition, so this filter
            returns reviews only — improvement plans, task evaluations and
            competency assessments have no type and are left out.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Btn variant="primary" onClick={apply}>Run report</Btn>
          <Btn onClick={clear}>Clear</Btn>
        </div>
      </Card>

      {report.error && <ErrorNote error={report.error} />}
      {report.isLoading && <Spinner />}

      {report.data && grouped.length === 0 && (
        <EmptyState title="Nothing matches those filters">
          Widen the dates, or clear a filter. An empty report means no events
          you can see fall inside it — not that nothing happened.
        </EmptyState>
      )}

      {report.data?.truncated && (
        <Card kicker="Cut short" title={`Showing the first ${report.data.limit}`} accent>
          <p className="card-body" style={{ margin: 0 }}>
            There are more matching events than this. Narrow the dates or the
            unit before drawing a conclusion from what is on screen — the CSV
            export carries more, and is also capped.
          </p>
        </Card>
      )}

      {grouped.map((g) => (
        <Card
          key={g.employeeId}
          kicker={g.dept ?? 'No unit recorded'}
          title={g.name}
          actions={
            <Link to={`/employees/${g.employeeId}/history`}>
              Full history
            </Link>
          }
        >
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th><th>Source</th><th>What</th>
                  <th>State</th><th>Result</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.refId}>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.occurredOn}</td>
                    <td>
                      <Tag tone={KIND_TONE[r.kind] ?? 'neutral'}>
                        {r.kind.replace(/_/g, ' ')}
                      </Tag>
                    </td>
                    <td>
                      {r.title}
                      {r.evalType && (
                        <span className="text-muted"> · {r.evalType.replace(/_/g, ' ')}</span>
                      )}
                    </td>
                    <td className="text-muted">{r.detail}</td>
                    {/* Left as text. A review's 4.2, a task evaluation's
                        32 / 37 and a PIP's "successful" share no scale, and a
                        column that lines them up invites a comparison nobody
                        made. */}
                    <td>{r.result ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {grouped.length > 0 && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          {grouped.length} {grouped.length === 1 ? 'person' : 'people'},{' '}
          {report.data?.rows.length} events. Everything here is scoped to what
          you may see.
        </p>
      )}
    </Section>
  );
}
