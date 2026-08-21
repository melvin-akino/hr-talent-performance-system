import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import { ErrorNote, Spinner } from '../components/ui';
import { Card, PageHead, Section, Stat, rampIndex } from '../components/ds';

interface Cycle { id: string; name: string; state: string; opensOn: string }

interface Distribution {
  scale: { min: number | null; max: number | null };
  rows: { department: string; rating: number; employeeCount: number; pctOfGroup: number }[];
}

interface Movement {
  subjectEmployeeId: string; employeeName: string; department: string;
  originalRating: number; calibratedRating: number; movement: number;
}

interface Rater {
  reviewerEmployeeId: string; reviewerName: string; reviewsSubmitted: number;
  averageRating: number; groupAverage: number; deviation: number;
}

interface NineBoxEmployee {
  subjectEmployeeId: string; employeeName: string; department: string;
  rating: number | null; performanceBand: number | null; potentialBand: number | null;
}

interface NineBox {
  employees: NineBoxEmployee[];
  grid: Record<string, NineBoxEmployee[]>;
  unplaced: { noRating: number; noPotential: number };
}

interface Progress {
  subjects: number; instances: number; submitted: number; returned: number;
  calibrated: number; signedOff: number; acknowledged: number;
}

/**
 * Cross-cycle analytics.
 *
 * Everything here is scoped by RLS, so the same screen serves a manager (their
 * subtree) and HR (the organisation) with no mode switch — and an aggregate can
 * never include someone the viewer cannot already see.
 */
export default function Analytics() {
  const [cycleId, setCycleId] = useState<string | null>(null);

  const cycles = useQuery({
    queryKey: ['review-cycles'],
    queryFn: () => api<Cycle[]>('/review-cycles'),
  });

  const active = cycleId ?? cycles.data?.[0]?.id ?? null;

  if (cycles.isLoading) return <Spinner />;
  if ((cycles.data?.length ?? 0) === 0) {
    return <p className="card-body" style={{ margin: 0 }}>No review cycles yet — nothing to analyse.</p>;
  }

  return (
    <Section>
      <PageHead title="Analytics" />
      <Card kicker="Review cycle">
        <select
          className="input" style={{ width: "auto" }}
          value={active ?? ''}
          onChange={(e) => setCycleId(e.target.value)}
        >
          {cycles.data?.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.state})</option>
          ))}
        </select>
      </Card>

      {active && (
        <>
          <ProgressPanel cycleId={active} />
          <DistributionPanel cycleId={active} />
          <NineBoxPanel cycleId={active} />
          <RaterPanel cycleId={active} />
          <MovementPanel cycleId={active} />
        </>
      )}
    </Section>
  );
}

function ProgressPanel({ cycleId }: { cycleId: string }) {
  const q = useQuery({
    queryKey: ['analytics', 'progress', cycleId],
    queryFn: () => api<Progress>(`/analytics/cycles/${cycleId}/progress`),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const p = q.data!;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--space-3)" }}>
      <Stat kicker="Employees" value={p.subjects} />
      <Stat kicker="Reviews" value={p.instances} />
      {/* Completion is stated as a fraction rather than coloured. The system
          carries status by tag and icon; "7" in amber says less than "7 of 15". */}
      <Stat kicker="Submitted" value={`${p.submitted} of ${p.instances}`} />
      <Stat kicker="Returned" value={p.returned} />
      <Stat kicker="Signed off" value={p.signedOff} />
      <Stat kicker="Acknowledged" value={p.acknowledged} />
    </div>
  );
}

function DistributionPanel({ cycleId }: { cycleId: string }) {
  const q = useQuery({
    queryKey: ['analytics', 'distribution', cycleId],
    queryFn: () => api<Distribution>(`/analytics/cycles/${cycleId}/distribution`),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  if ((q.data?.rows.length ?? 0) === 0) {
    return <Card kicker="Rating distribution"><p className="card-body" style={{ margin: 0 }}>No ratings recorded yet.</p></Card>;
  }

  const departments = [...new Set(q.data!.rows.map((r) => r.department))];
  const ratings = [...new Set(q.data!.rows.map((r) => r.rating))].sort((a, b) => a - b);

  /**
   * Steps of the accent ramp, not new hues. The scale is banded against the
   * cycle's own min/max, so a cycle using a six-point scale still reads
   * correctly — hardcoding 1–5 would mis-colour historical cycles.
   */
  const ramp = ['var(--color-accent-200)', 'var(--color-accent-300)',
    'var(--color-accent-500)', 'var(--color-accent-700)', 'var(--color-accent-900)'];
  const min = q.data!.scale.min ?? Math.min(...ratings);
  const max = q.data!.scale.max ?? Math.max(...ratings);
  const shade = (rating: number) => ramp[rampIndex(rating, min, max, ramp.length)];

  return (
    <Card kicker="Rating distribution by department">
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        marginTop: 'var(--space-2)',
      }}>
        {departments.map((dept) => {
          const cells = ratings.map((rating) => ({
            rating,
            row: q.data!.rows.find((r) => r.department === dept && r.rating === rating),
          })).filter((c) => (c.row?.pctOfGroup ?? 0) > 0);

          return (
            <div key={dept} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{ width: 120, fontSize: 13, flex: 'none' }}>{dept}</div>
              {/* One stacked bar per department: proportions are directly
                  comparable across rows, which separate bars per rating are not. */}
              <div style={{
                flex: 1, display: 'flex', height: 22, borderRadius: 2, overflow: 'hidden',
                background: 'var(--color-neutral-200)',
              }}>
                {cells.map(({ rating, row }) => (
                  <div
                    key={rating}
                    title={`${rating}: ${row!.employeeCount} employee(s), ${row!.pctOfGroup}%`}
                    style={{
                      height: '100%', width: `${row!.pctOfGroup}%`, background: shade(rating),
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{
        display: 'flex', gap: 14, marginTop: 'var(--space-3)',
        fontSize: 11, opacity: 0.7, flexWrap: 'wrap',
      }}>
        {ratings.map((rating) => (
          <span key={rating}>
            <span style={{
              display: 'inline-block', width: 10, height: 10,
              background: shade(rating), marginRight: 4,
            }} />
            {rating}
          </span>
        ))}
      </div>
    </Card>
  );
}

const PERF_LABEL = ['', 'Below', 'Meets', 'Exceeds'];
const POT_LABEL = ['', 'Well placed', 'Growth', 'High potential'];

function NineBoxPanel({ cycleId }: { cycleId: string }) {
  const q = useQuery({
    queryKey: ['analytics', 'nine-box', cycleId],
    queryFn: () => api<NineBox>(`/analytics/cycles/${cycleId}/nine-box`),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const data = q.data!;

  return (
    <Card kicker="Nine-box">
      <div className="overflow-x-auto">
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, 92px) auto', gap: 4, fontSize: 11, marginTop: 8,
        }}>
          {[3, 2, 1].map((pot) => (
            <Fragment key={pot}>
              <div style={{
                writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                textAlign: 'center', opacity: 0.6, alignSelf: 'stretch',
              }}>
                {POT_LABEL[pot]}
              </div>
              {[1, 2, 3].map((perf) => {
                const people = data.grid[`${perf}-${pot}`] ?? [];
                /*
                 * Density, not hue. The grid used to tint cells green and red,
                 * which both invents colours the system does not have and turns
                 * a box into a verdict — the fastest way to make a nine-box
                 * useless is to let people read their cell as a grade. Depth of
                 * the accent shows where the population sits; the reading is
                 * left to the person doing the talent conversation.
                 */
                const occupied = people.length > 0;
                return (
                  <div key={perf} className="hr-cell" style={{
                    padding: 6, display: 'flex', flexDirection: 'column', gap: 3,
                    overflow: 'hidden',
                    background: occupied
                      ? `color-mix(in srgb, var(--color-accent) ${Math.min(6 + people.length * 6, 26)}%, transparent)`
                      : 'transparent',
                  }}>
                    <span className="tabular-nums" style={{ fontWeight: 600, opacity: 0.7 }}>
                      {people.length}
                    </span>
                    {people.slice(0, 4).map((p) => (
                      <span key={p.subjectEmployeeId} style={{ fontSize: 11 }}>
                        {p.employeeName}
                      </span>
                    ))}
                    {people.length > 4 && (
                      <span style={{ fontSize: 11, opacity: 0.5 }}>
                        +{people.length - 4} more
                      </span>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
          <div />
          {[1, 2, 3].map((perf) => (
            <div key={perf} style={{ textAlign: 'center', opacity: 0.6, paddingTop: 4 }}>
              {PERF_LABEL[perf]}
            </div>
          ))}
        </div>
      </div>

      {(data.unplaced.noRating > 0 || data.unplaced.noPotential > 0) && (
        /* Called out, never hidden: a grid that silently shrinks is how a
           nine-box misleads. Stated as fact rather than dressed as a warning. */
        <Card accent style={{ marginTop: 'var(--space-3)' }}>
          <p className="card-body" style={{ margin: 0 }}>
            <strong>Not shown on the grid:</strong> {data.unplaced.noRating} with no
            rating, {data.unplaced.noPotential} with no potential recorded. They are
            counted here rather than dropped.
          </p>
        </Card>
      )}
    </Card>
  );
}

function RaterPanel({ cycleId }: { cycleId: string }) {
  const q = useQuery({
    queryKey: ['analytics', 'raters', cycleId],
    queryFn: () => api<Rater[]>(`/analytics/cycles/${cycleId}/rater-comparison`),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  if ((q.data?.length ?? 0) === 0) {
    return <Card kicker="Rater comparison"><p className="card-body" style={{ margin: 0 }}>No submitted reviews yet.</p></Card>;
  }

  return (
    <Card kicker="Rater comparison">
      {/* Every table needs its own scroller, not just the ones that overflow
          today: this one fits at 390px by 16px, and the next column added takes
          it over. Without it the overflow is unreachable rather than scrollable —
          the page body does not scroll, so the content is simply gone. */}
      <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Reviewer</th>
            <th>Reviews</th>
            <th>Their average</th>
            <th>vs group</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.map((r) => (
            <tr key={r.reviewerEmployeeId}>
              <td className="pr-4">{r.reviewerName}</td>
              <td className={`tabular-nums ${r.reviewsSubmitted < 3 ? 't-faint' : ''}`}>
                {r.reviewsSubmitted}
              </td>
              <td className="tabular-nums">{r.averageRating}</td>
              <td className="tabular-nums">
                <span style={{
                  opacity: Math.abs(r.deviation) < 0.3 ? 0.5 : 1,
                  fontWeight: Math.abs(r.deviation) < 0.3 ? 400 : 600,
                }}>
                  {r.deviation > 0 ? '+' : ''}{r.deviation}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Card>
  );
}

function MovementPanel({ cycleId }: { cycleId: string }) {
  const q = useQuery({
    queryKey: ['analytics', 'movement', cycleId],
    queryFn: () => api<Movement[]>(`/analytics/cycles/${cycleId}/calibration-movement`),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;

  return (
    <Card kicker="What calibration changed">
      {(q.data?.length ?? 0) === 0 ? (
        <p className="card-body" style={{ margin: 0 }}>
          Calibration moved nobody. Worth knowing — it means the session was a
          review of ratings rather than a moderation of them.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Original</th>
              <th>Calibrated</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((m) => (
              <tr key={m.subjectEmployeeId}>
                <td className="pr-4">{m.employeeName}</td>
                <td className="text-xs t-muted">{m.department}</td>
                <td className="tabular-nums t-muted">{m.originalRating}</td>
                <td className="tabular-nums font-medium">{m.calibratedRating}</td>
                <td className="tabular-nums" style={{ fontWeight: 600 }}>
                  {m.movement > 0 ? '↑ +' : '↓ '}{m.movement}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </Card>
  );
}

/** Recorded during calibration, alongside the rating. */
export function PotentialPicker({ summaryId, current, disabled }: {
  summaryId: string; current: number | null; disabled?: boolean;
}) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (potentialRating: number) =>
      api(`/analytics/review-summaries/${summaryId}/potential`, {
        method: 'POST', body: { potentialRating },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['review-summaries'] }),
  });

  return (
    <select
      className="input-sm text-xs"
      value={current ?? 0}
      disabled={disabled || set.isPending}
      onChange={(e) => set.mutate(Number(e.target.value))}
    >
      <option value={0}>—</option>
      {[1, 2, 3].map((n) => (
        <option key={n} value={n}>{POT_LABEL[n]}</option>
      ))}
    </select>
  );
}
