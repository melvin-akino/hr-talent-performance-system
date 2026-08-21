import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../auth';
import type { Employee } from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import { Btn, Card, PageHead, Stat, Tag } from '../components/ds';

interface Gap {
  competencyId: string;
  code: string;
  name: string;
  category: string | null;
  requiredLevel: number;
  assessedLevel: number | null;
  gap: number | null;
  weight: string | null;
  assessedOn: string | null;
}

interface GapReport {
  competencies: Gap[];
  summary: { mapped: number; notAssessed: number; meetingOrAbove: number; below: number };
}

interface FamilyGap {
  code: string;
  name: string;
  category: string | null;
  requiredLevel: number;
  peopleMapped: number;
  notAssessed: number;
  below: number;
  meeting: number;
  averageAssessed: string | null;
}

/**
 * Competency gaps — mine, my team's, and by job family.
 *
 * "Not assessed" is kept visually distinct from "below required" throughout.
 * They look similar on a dashboard and mean completely different things: one is
 * a development finding about a person, the other is a process failure by the
 * organisation. Merging them would quietly blame employees for HR's backlog.
 */
export default function Competencies() {
  const [tab, setTab] = useState<'me' | 'team' | 'family'>('me');

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PageHead title="Competencies" />

      <nav className="seg no-print" aria-label="Competency view">
        {([['me', 'My competencies'], ['team', 'My team'], ['family', 'By job family']] as const)
          .map(([key, label]) => (
            <label key={key} className="seg-opt">
              <input type="radio" name="competency-view" checked={tab === key}
                     onChange={() => setTab(key)} />
              <span>{label}</span>
            </label>
          ))}
      </nav>

      {tab === 'me' && <MyGaps />}
      {tab === 'team' && <TeamGaps />}
      {tab === 'family' && <FamilyGaps />}
    </div>
  );
}

interface Assessment {
  competencyId: string;
  assessedLevel: number;
  assessedOn: string | null;
  assessedBy: string | null;
  notes: string | null;
}

/**
 * The gap table.
 *
 * Three states, and they must look like three states: **met**, **below
 * required**, and **not assessed**. The last is an absence of information, not a
 * bad score, and conflating it with "below" tells someone they are failing at
 * something nobody has looked at.
 *
 * The assessor and their note are shown where they exist. A level with no
 * attribution is not discussable — "who says I am a 2?" is the first question
 * anyone asks, and the design's open question about assessment source resolves
 * to this: there is exactly one assessor per assessment. The system has no
 * self/manager/360 concept, so the screen does not imply one.
 */
function GapTable({ report, assessments }: {
  report: GapReport;
  assessments?: Assessment[];
}) {
  if (report.competencies.length === 0) {
    return (
      <p className="card-body" style={{ margin: 0 }}>
        No competencies are mapped to this position yet. HR maps requirements per
        position — until then there is nothing to measure against.
      </p>
    );
  }

  // Latest assessment per competency. The API returns them newest first.
  const latest = new Map<string, Assessment>();
  for (const a of assessments ?? []) {
    if (!latest.has(a.competencyId)) latest.set(a.competencyId, a);
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Competency</th>
            <th>Required</th>
            <th>Assessed</th>
            <th>Standing</th>
            <th>Assessed by</th>
          </tr>
        </thead>
        <tbody>
          {report.competencies.map((c) => {
            const a = latest.get(c.competencyId);
            return (
              <tr key={c.competencyId}>
                <td>
                  <div style={{ fontWeight: 500 }}>{c.name}</div>
                  {c.category && (
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{c.category}</div>
                  )}
                  {/* The assessor's note is the reasoning behind the level. It is
                      the most useful thing on the row and was previously not
                      shown at all. */}
                  {a?.notes && (
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                      “{a.notes}”
                    </div>
                  )}
                </td>
                <td className="tabular-nums">{c.requiredLevel}</td>
                <td className="tabular-nums">
                  {c.assessedLevel ?? <span style={{ opacity: 0.4 }}>—</span>}
                </td>
                <td>
                  {c.gap === null
                    ? <Tag>not assessed</Tag>
                    : c.gap < 0
                      ? <Tag tone="outline">below required</Tag>
                      : c.gap === 0
                        ? <Tag tone="accent">met</Tag>
                        : <Tag tone="accent">+{c.gap} above</Tag>}
                </td>
                <td style={{ fontSize: 12 }}>
                  {a?.assessedBy
                    ? <>{a.assessedBy}<div style={{ opacity: 0.6 }}>{c.assessedOn}</div></>
                    : <span style={{ opacity: 0.4 }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ s }: { s: GapReport['summary'] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <Stat kicker="Mapped" value={s.mapped} />
      <Stat kicker="Meeting or above" value={s.meetingOrAbove} />
      <Stat kicker="Below required" value={s.below} />
      <Stat kicker="Not assessed" value={s.notAssessed} note="coverage gap" />
    </div>
  );
}

function MyGaps() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const q = useQuery({
    queryKey: ['competency-gaps', 'me'],
    queryFn: () => api<GapReport>('/employees/me/competency-gaps'),
  });
  // Attribution comes from the assessment history rather than the gap function,
  // which returns the latest level but not who set it.
  const assessments = useQuery({
    queryKey: ['competency-assessments', me.data?.id],
    queryFn: () => api<Assessment[]>(`/employees/${me.data!.id}/competency-assessments`),
    enabled: !!me.data?.id,
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <p className="card-body" style={{ margin: 0 }}>No gap report available.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <Summary s={q.data.summary} />
      <Card kicker="My competency profile">
        <GapTable report={q.data} assessments={assessments.data} />
      </Card>
    </div>
  );
}

function TeamGaps() {
  const reports = useQuery({
    queryKey: ['reports'],
    queryFn: () => api<Employee[]>('/employees/me/reports'),
  });
  const [selected, setSelected] = useState<string | null>(null);

  const gaps = useQuery({
    queryKey: ['competency-gaps', selected],
    queryFn: () => api<GapReport>(`/employees/${selected}/competency-gaps`),
    enabled: !!selected,
  });
  // A manager needs the attribution more than anyone: before discussing a level
  // with someone, they need to know who set it and why.
  const assessments = useQuery({
    queryKey: ['competency-assessments', selected],
    queryFn: () => api<Assessment[]>(`/employees/${selected}/competency-assessments`),
    enabled: !!selected,
  });

  if (reports.isLoading) return <Spinner />;
  if ((reports.data?.length ?? 0) === 0) {
    return <p className="card-body" style={{ margin: 0 }}>You have no direct reports.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <Card kicker="Select a team member">
        <div className="flex flex-wrap gap-2">
          {reports.data?.map((r) => (
            <Btn
              key={r.id}
              onClick={() => setSelected(r.id)}
              variant={selected === r.id ? 'primary' : 'ghost'}
              aria-pressed={selected === r.id}
            >
              {r.firstName} {r.lastName}
            </Btn>
          ))}
        </div>
      </Card>

      {selected && gaps.isLoading && <Spinner />}
      {selected && gaps.error ? <ErrorNote error={gaps.error} /> : null}
      {selected && gaps.data && (
        <>
          <Summary s={gaps.data.summary} />
          <Card kicker="Competency profile"><GapTable report={gaps.data} assessments={assessments.data} /></Card>
        </>
      )}
    </div>
  );
}

function FamilyGaps() {
  const families = useQuery({
    queryKey: ['job-families'],
    queryFn: () => api<{ jobFamily: string }[]>('/job-families'),
  });
  const [family, setFamily] = useState<string | null>(null);
  const active = family ?? families.data?.[0]?.jobFamily ?? null;

  const report = useQuery({
    queryKey: ['family-gaps', active],
    queryFn: () => api<FamilyGap[]>(
      `/job-families/${encodeURIComponent(active!)}/competency-gaps`),
    enabled: !!active,
  });

  if (families.isLoading) return <Spinner />;
  if ((families.data?.length ?? 0) === 0) {
    return <p className="card-body" style={{ margin: 0 }}>No job families are defined on positions yet.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <Card kicker="Job family">
        <div className="flex flex-wrap gap-2">
          {families.data?.map((f) => (
            <Btn
              key={f.jobFamily}
              onClick={() => setFamily(f.jobFamily)}
              variant={active === f.jobFamily ? 'primary' : 'ghost'}
              aria-pressed={active === f.jobFamily}
            >
              {f.jobFamily}
            </Btn>
          ))}
        </div>
      </Card>

      {report.isLoading && <Spinner />}
      {report.error ? <ErrorNote error={report.error} /> : null}
      {report.data && (
        <Card kicker={`Capability gaps — ${active}`}>
          <p style={{ marginTop: 0, fontSize: 12, opacity: 0.7 }}>
            Ordered by the number of people below the required level: the top row is
            where a training investment pays off most.
          </p>
          {report.data.length === 0 ? (
            <p className="card-body" style={{ margin: 0 }}>No competencies mapped for positions in this family.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Competency</th>
                    {/* MAX across positions in the family — junior and senior
                        roles carry different bars. "Below" is still counted per
                        person against their own requirement. */}
                    <th title="Highest requirement across positions in this family">
                      Highest req.
                    </th>
                    <th>People</th>
                    <th>Below</th>
                    <th>Meeting</th>
                    <th>Not assessed</th>
                    <th>Avg level</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.map((r) => (
                    <tr key={r.code}>
                      <td>
                        <span style={{ fontWeight: 500 }}>{r.name}</span>
                        {r.category && (
                          <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.55 }}>
                            {r.category}
                          </span>
                        )}
                      </td>
                      <td className="tabular-nums">{r.requiredLevel}</td>
                      <td className="tabular-nums">{r.peopleMapped}</td>
                      {/* Weight without hue: the number that should draw the eye
                          is bolder, the zero recedes. */}
                      <td className="tabular-nums"
                          style={r.below > 0 ? { fontWeight: 600 } : { opacity: 0.45 }}>
                        {r.below}
                      </td>
                      <td className="tabular-nums">{r.meeting}</td>
                      <td className="tabular-nums"
                          style={r.notAssessed > 0 ? undefined : { opacity: 0.45 }}>
                        {r.notAssessed}
                      </td>
                      <td className="tabular-nums">{r.averageAssessed ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
