import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../auth';
import { usePeriod } from '../PeriodContext';
import { ErrorNote, Spinner } from '../components/ui';
import { Card, CheckinStatus, PageHead, Stat } from '../components/ds';

interface OverdueGoal {
  goalId: string;
  title: string;
  employeeName: string;
  cadence: string;
  lastCheckinOn: string | null;
  lastStatus: string | null;
  daysSinceCheckin: number;
  nextCheckinDue: string | null;
}

interface Escalation {
  goalId: string;
  title: string;
  employeeName: string;
  consecutiveBad: number;
  status: 'on_track' | 'at_risk' | 'off_track';
  lastCheckinOn: string;
  hasActivePip: boolean;
}

interface Compliance {
  activeGoals: number;
  overdueGoals: number;
  neverCheckedIn: number;
  offTrack: number;
  atRisk: number;
}

/**
 * Phase 2 monitoring: what is NOT being tracked, and what is trending badly.
 *
 * Everything here is scoped by RLS, so a manager sees their team and HR sees
 * the organization from the same screen without a mode switch.
 */
export default function Monitoring() {
  const { period } = usePeriod();

  const compliance = useQuery({
    queryKey: ['monitoring', 'compliance', period?.id],
    queryFn: () => api<Compliance>(`/monitoring/${period!.id}/compliance`),
    enabled: !!period,
  });
  const overdue = useQuery({
    queryKey: ['monitoring', 'overdue', period?.id],
    queryFn: () => api<OverdueGoal[]>(`/monitoring/${period!.id}/overdue`),
    enabled: !!period,
  });
  const escalations = useQuery({
    queryKey: ['monitoring', 'escalations', period?.id],
    queryFn: () => api<Escalation[]>(`/monitoring/${period!.id}/escalations`),
    enabled: !!period,
  });

  if (!period) return <p className="card-body" style={{ margin: 0 }}>No goal period available.</p>;
  if (compliance.isLoading) return <Spinner />;
  if (compliance.error) return <ErrorNote error={compliance.error} />;

  const c = compliance.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PageHead title="Monitoring" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat kicker="Active goals" value={c?.activeGoals ?? 0} />
        <Stat kicker="Overdue check-in" value={c?.overdueGoals ?? 0} />
        <Stat kicker="Never checked in" value={c?.neverCheckedIn ?? 0} />
        <Stat kicker="At risk" value={c?.atRisk ?? 0} />
        <Stat kicker="Off track" value={c?.offTrack ?? 0} />
      </div>

      <Card kicker={`Escalations — 2+ consecutive bad check-ins (${escalations.data?.length ?? 0})`}>
        <p className="mb-3 text-xs t-muted">
          A single bad check-in is noise. A run is a pattern worth a conversation.
        </p>
        {escalations.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No goals are trending badly.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Goal</th>
                <th>Employee</th>
                <th>Run</th>
                <th>Latest</th>
                <th>PIP</th>
              </tr>
            </thead>
            <tbody>
              {escalations.data?.map((e) => (
                <tr key={e.goalId}>
                  <td>
                    <Link to={`/goals/${e.goalId}`} className="font-medium text-muted hover:underline">
                      {e.title}
                    </Link>
                  </td>
                  <td>{e.employeeName}</td>
                  <td className="tabular-nums font-medium text-muted">
                    {e.consecutiveBad} in a row
                  </td>
                  <td><CheckinStatus status={e.status} /></td>
                  <td className="text-xs">
                    {e.hasActivePip
                      ? <span className="t-muted">active plan</span>
                      : <Link to="/pips" className="text-muted hover:underline">consider a PIP</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card kicker={`Overdue check-ins (${overdue.data?.length ?? 0})`}>
        {overdue.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>Every active goal is within its check-in cadence.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Goal</th>
                <th>Employee</th>
                <th>Cadence</th>
                <th>Last check-in</th>
                <th>Overdue by</th>
              </tr>
            </thead>
            <tbody>
              {overdue.data?.map((g) => (
                <tr key={g.goalId}>
                  <td>
                    <Link to={`/goals/${g.goalId}`} className="font-medium text-muted hover:underline">
                      {g.title}
                    </Link>
                  </td>
                  <td>{g.employeeName}</td>
                  <td className="text-xs">{g.cadence}</td>
                  <td className="text-xs">
                    {g.lastCheckinOn ?? <span className="text-muted">never</span>}
                  </td>
                  <td className="tabular-nums text-muted">
                    {g.daysSinceCheckin} days
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
