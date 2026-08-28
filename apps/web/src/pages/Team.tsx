import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../auth';
import type { ManagerDashboard } from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import {
  Attainment, Btn, Card, CheckinStatus, EmptyState, Icon, PageHead, Section, Tag,
  attentionRank, paths,
} from '../components/ds';
import { usePeriod } from '../PeriodContext';

/**
 * Manager view: approvals first, then risk, then the roll-up.
 *
 * The ordering is the point. An unapproved goal contributes nothing to
 * attainment no matter how much work went into it, so the manager's own queue
 * comes before anything they might merely observe — and it is given weight
 * rather than being a number in a table cell.
 */
export default function Team() {
  const { period } = usePeriod();
  const qc = useQueryClient();

  const dash = useQuery({
    queryKey: ['dashboard', 'manager', period?.id],
    queryFn: () => api<ManagerDashboard>(`/dashboards/manager/${period!.id}`),
    enabled: !!period,
  });

  const approve = useMutation({
    mutationFn: (goalId: string) => api(`/goals/${goalId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });

  if (!period) return <EmptyState title="No goal period available" />;
  if (dash.isLoading) return <Spinner />;
  if (dash.error) return <ErrorNote error={dash.error} />;

  const d = dash.data!;
  // Never-checked-in first, as everywhere else attention is ranked.
  const atRisk = [...d.atRisk].sort((a, b) => attentionRank(a.status) - attentionRank(b.status));

  return (
    <Section>
      <PageHead title={`Team — ${period.name}`} />

      <Card
        kicker="Awaiting my approval"
        accent={d.pendingApproval.length > 0}
        elevated={d.pendingApproval.length > 0}
      >
        {d.pendingApproval.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>
            Nothing waiting on you.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
            {d.pendingApproval.map((g) => (
              <div key={g.id} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap',
                padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-divider)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{g.title}</div>
                  <div style={{ fontSize: 12, opacity: 0.65 }}>
                    {g.employeeName} · weight {Number(g.weight)}%
                  </div>
                </div>
                <Link to={`/goals/${g.id}`} className="btn btn-secondary">
                  Review
                </Link>
                <Btn variant="primary" disabled={approve.isPending}
                     onClick={() => approve.mutate(g.id)}>
                  Approve
                </Btn>
              </div>
            ))}
          </div>
        )}
        <ErrorNote error={approve.error} />
      </Card>

      <Card kicker="Needs attention">
        {atRisk.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>
            No goals flagged at risk or off track.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
            {atRisk.map((g) => (
              <div key={g.id} style={{
                padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-divider)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap',
                }}>
                  <CheckinStatus status={g.status} />
                  <Link to={`/goals/${g.id}`} style={{ fontSize: 14, fontWeight: 500 }}>
                    {g.title}
                  </Link>
                  <span style={{ fontSize: 12, opacity: 0.65 }}>
                    {g.employeeName}{g.asOf ? ` · as of ${g.asOf}` : ''}
                  </span>
                </div>
                {g.comment && (
                  <p style={{ fontSize: 13, margin: '4px 0 0', opacity: 0.85 }}>{g.comment}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card kicker="Team roll-up">
        {d.team.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No team goals in this period.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th><th>Goals</th><th>Weight</th>
                  <th style={{ width: 170 }}>Attainment</th><th>Flags</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.team.map((t) => {
                  const weight = Number(t.totalWeight);
                  return (
                    <tr key={t.employeeId}>
                      <td>
                        <Link to={`/employees/${t.employeeId}/goals`} style={{ fontWeight: 500 }}>
                          {t.employeeName}
                        </Link>
                      </td>
                      <td className="tabular-nums">{t.goalCount}</td>
                      <td className="tabular-nums">
                        {weight}%{' '}
                        {/* An outline tag, not a colour — the system carries
                            status by tag and icon, never by a new hue. */}
                        {t.goalCount > 0 && weight !== 100 && (
                          <Tag tone="outline">not 100%</Tag>
                        )}
                      </td>
                      <td><Attainment pct={t.attainment} /></td>
                      <td style={{ fontSize: 12 }}>
                        <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {t.offTrack > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Icon path={paths.alertCircle} stroke="var(--color-accent-900)" />
                              {t.offTrack} off track
                            </span>
                          )}
                          {t.atRisk > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Icon path={paths.triangleAlert} stroke="var(--color-accent-800)" />
                              {t.atRisk} at risk
                            </span>
                          )}
                          {t.awaitingApproval > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Icon path={paths.inbox} stroke="var(--color-accent-700)" />
                              {t.awaitingApproval} to approve
                            </span>
                          )}
                          {t.offTrack === 0 && t.atRisk === 0 && t.awaitingApproval === 0 && (
                            <span style={{ opacity: 0.4 }}>—</span>
                          )}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {/* History first: a supervisor opening somebody's row is
                            usually asking what has happened to them, not what
                            they are working on this quarter. */}
                        <Link to={`/employees/${t.employeeId}/history`}
                              className="btn btn-ghost btn-icon"
                              aria-label={`Open ${t.employeeName}'s history`}>
                          <Icon path={paths.clock} size={15} />
                        </Link>
                        <Link to={`/employees/${t.employeeId}/goals`} className="btn btn-ghost btn-icon"
                              aria-label={`Open ${t.employeeName}'s goals`}>
                          <Icon path={paths.arrowRight} size={15} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Section>
  );
}
