import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../auth';
import { ErrorNote, Spinner } from '../../components/ui';
import { Btn, Card } from '../../components/ds';

/**
 * Loading a 201 file, without a developer and a database URL.
 *
 * The three steps are deliberately separate screens' worth of work compressed
 * into one page, in the order somebody actually does them: get a file with the
 * right columns, find out what it would do, then decide.
 *
 * THE PREVIEW IS NOT A COURTESY. An import writes people, units, positions and
 * the rank ladder in one transaction; the report below is the only chance to
 * see a mistyped supervisor or a rank that is not a number before any of that
 * lands. So Apply stays disabled until a preview has run and come back clean,
 * and any edit to the file clears the preview rather than leaving a stale one
 * next to a changed file.
 */

interface Column {
  column: string;
  required: boolean;
  note: string;
  example: string;
}

interface ImportError { row: number; employeeNo?: string; message: string }

interface Report {
  dryRun: boolean;
  totalRows: number;
  created: number;
  updated: number;
  reportingLines: number;
  errors: ImportError[];
  departmentsCreated: { code: string; name: string; unitType?: string }[];
  employmentTypesCreated: { code: string; name: string }[];
  ranksCreated: { code: string; name: string; rankNo: number }[];
  positionsRanked: number;
  unitDifferences: { code: string; name: string; field: string; stored: string; inFile: string }[];
  columnsNotImported: string[];
  missingWorkEmails: string[];
  missingSupervisors: string[];
}

export default function ImportStaff() {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Report | null>(null);
  const [applied, setApplied] = useState<Report | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const columns = useQuery({
    queryKey: ['import-columns'],
    queryFn: () => api<Column[]>('/import/columns'),
  });

  const check = useMutation({
    mutationFn: () => api<Report>('/import/employees/preview',
      { method: 'POST', body: { csv } }),
    onSuccess: setPreview,
  });

  const apply = useMutation({
    mutationFn: () => api<Report>('/import/employees',
      { method: 'POST', body: { csv } }),
    onSuccess: (r) => { setApplied(r); setPreview(null); },
  });

  async function download() {
    const text = await api<string>('/import/template', { raw: true });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = '201-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    // A preview belongs to the file it was run against. Keeping it visible
    // beside a different file is how somebody applies the one they just read
    // about rather than the one they just chose.
    setPreview(null);
    setApplied(null);
  }

  const blocked = (preview?.errors.length ?? 0) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

      <Card
        kicker="Step 1"
        title="Start from the template"
        actions={<Btn onClick={() => void download()}>Download template</Btn>}
      >
        <p className="text-muted">
          The template carries the exact column names this system reads, plus one
          example row to delete. Extra columns are ignored and reported back to
          you, so a 201 file with more in it than we use is fine to upload as it is.
        </p>
      </Card>

      <Card kicker="Step 2" title="Choose your file">
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          {fileName && <span className="text-muted">{fileName}</span>}
        </div>

        {csv && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Btn variant="primary" disabled={check.isPending}
                 onClick={() => check.mutate()}>
              {check.isPending ? 'Checking…' : 'Check the file'}
            </Btn>
          </div>
        )}
        <ErrorNote error={check.error} />
      </Card>

      {preview && (
        <Card
          kicker="Step 3"
          title={blocked ? 'Fix these before importing' : 'What this file will do'}
          accent={blocked}
          actions={!blocked && (
            <Btn variant="primary" disabled={apply.isPending}
                 onClick={() => apply.mutate()}>
              {apply.isPending ? 'Importing…' : `Import ${preview.totalRows} row(s)`}
            </Btn>
          )}
        >
          <ReportBody report={preview} />
          <ErrorNote error={apply.error} />
        </Card>
      )}

      {applied && (
        <Card kicker="Done" title="Imported">
          <ReportBody report={applied} />
        </Card>
      )}

      <Card title="What each column means">
        {columns.isLoading && <Spinner />}
        <ErrorNote error={columns.error} />
        {columns.data && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Column</th><th>Required</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {columns.data.map((c) => (
                  <tr key={c.column}>
                    <td><code>{c.column}</code></td>
                    <td>{c.required ? 'Yes' : 'Optional'}</td>
                    <td className="text-muted">{c.note || '—'}</td>
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

/**
 * The report, read the way somebody checks a file: what went wrong first, then
 * what will be created, then what was quietly ignored.
 */
function ReportBody({ report }: { report: Report }) {
  const counts: [string, number][] = [
    ['Rows read', report.totalRows],
    ['People added', report.created],
    ['People updated', report.updated],
    ['Reporting lines', report.reportingLines],
    ['Positions placed on the ladder', report.positionsRanked],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

      {report.errors.length > 0 && (
        <div>
          <strong>{report.errors.length} problem(s) — nothing was written.</strong>
          <ul>
            {report.errors.slice(0, 25).map((e, i) => (
              <li key={i}>
                {e.row > 0 && <>Line {e.row}{e.employeeNo ? ` (${e.employeeNo})` : ''}: </>}
                {e.message}
              </li>
            ))}
          </ul>
          {report.errors.length > 25 && (
            <p className="text-muted">…and {report.errors.length - 25} more.</p>
          )}
        </div>
      )}

      <dl style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
        gap: 'var(--space-3)', margin: 0,
      }}>
        {counts.map(([label, n]) => (
          <div key={label}>
            <dt className="text-muted" style={{ fontSize: '0.85em' }}>{label}</dt>
            <dd style={{ margin: 0, fontSize: '1.4rem', fontVariantNumeric: 'tabular-nums' }}>{n}</dd>
          </div>
        ))}
      </dl>

      {report.ranksCreated.length > 0 && (
        <p>
          <strong>Rank ladder:</strong>{' '}
          {report.ranksCreated
            .slice()
            .sort((a, b) => a.rankNo - b.rankNo)
            .map((r) => `${r.rankNo} ${r.name}`)
            .join(' · ')}
          {' '}— a lower number is more senior.
        </p>
      )}

      {report.departmentsCreated.length > 0 && (
        <p>
          <strong>Units to create:</strong>{' '}
          {report.departmentsCreated.map((d) => `${d.name} (${d.code})`).join(', ')}
        </p>
      )}

      {report.employmentTypesCreated.length > 0 && (
        <p>
          <strong>Employment types to create:</strong>{' '}
          {report.employmentTypesCreated.map((t) => `${t.name} (${t.code})`).join(', ')}
        </p>
      )}

      {report.unitDifferences.length > 0 && (
        <div>
          <strong>Your file describes {report.unitDifferences.length} existing unit(s)
            differently. Nothing will be changed</strong> — a staff file is not the
          authority on org structure. Correct these in Departments if the file is right.
          <ul>
            {report.unitDifferences.map((d, i) => (
              <li key={i}>{d.code}: {d.field} is {d.stored}, file says {d.inFile}</li>
            ))}
          </ul>
        </div>
      )}

      {report.missingSupervisors.length > 0 && (
        <p className="text-muted">
          No supervisor for {report.missingSupervisors.join(', ')}. Expect exactly one —
          the top of the chart. More than that means managers will not see those people.
        </p>
      )}

      {report.missingWorkEmails.length > 0 && (
        <p className="text-muted">
          No work email for {report.missingWorkEmails.join(', ')}. They cannot sign in
          until one is set — first login is matched on it.
        </p>
      )}

      {report.columnsNotImported.length > 0 && (
        <p className="text-muted">
          Columns kept in your file but not imported:{' '}
          {report.columnsNotImported.join(', ')}.
        </p>
      )}
    </div>
  );
}
