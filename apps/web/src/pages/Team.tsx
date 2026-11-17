import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../auth';
import type { Employee, ManagerDashboard, EmployeeSummary } from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import {
  Attainment, Btn, Card, CheckinStatus, EmptyState, Icon, PageHead, Section, Tag,
  attentionRank, paths,
} from '../components/ds';
import { usePeriod } from '../PeriodContext';

/**
 * Manager view:
 * 1. Direct reports roster with positions, branches, and quick 201 links.
 * 2. Approvals, goal risk, and attainment roll-up for the period (when KPI/Performance is enabled).
 */
export default function Team() {
  const [activeTab, setActiveTab] = useState<'roster' | 'goals'>('roster');
  const { period } = usePeriod();
  const qc = useQueryClient();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Employee>('/employees/me'),
  });
  const hasGoals = me.data?.features
    ? !!(me.data.features.feature_performance || me.data.features.feature_kpis)
    : true;

  const reports = useQuery({
    queryKey: ['employees', 'me', 'reports'],
    queryFn: () => api<EmployeeSummary[]>('/employees/me/reports'),
  });

  const dash = useQuery({
    queryKey: ['dashboard', 'manager', period?.id],
    queryFn: () => api<ManagerDashboard>(`/dashboards/manager/${period!.id}`),
    enabled: hasGoals && !!period,
  });

  const approve = useMutation({
    mutationFn: (goalId: string) => api(`/goals/${goalId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });

  const isLoading = reports.isLoading || (hasGoals && !!period && dash.isLoading);
  if (isLoading) return <Spinner />;

  const myReports = reports.data || [];
  const d = dash.data;
  const pendingApprovalsCount = d?.pendingApproval?.length || 0;
  const atRisk = d?.atRisk ? [...d.atRisk].sort((a, b) => attentionRank(a.status) - attentionRank(b.status)) : [];
  const effectiveTab = hasGoals ? activeTab : 'roster';

  return (
    <Section>
      <PageHead title="My Team & Direct Reports">
        <Btn
          variant={effectiveTab === 'roster' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('roster')}
        >
          Team Directory ({myReports.length})
        </Btn>
        {hasGoals && (
          <Btn
            variant={effectiveTab === 'goals' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('goals')}
          >
            Goal Approvals & Risk {pendingApprovalsCount > 0 ? `(${pendingApprovalsCount})` : ''}
          </Btn>
        )}
      </PageHead>

      {/* Summary KPI Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <Card>
          <div className="card-kicker">DIRECT REPORTS</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-accent)' }}>
            {myReports.length}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
            Team members reporting to you
          </div>
        </Card>
        {hasGoals && (
          <>
            <Card accent={pendingApprovalsCount > 0}>
              <div className="card-kicker">PENDING APPROVALS</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: pendingApprovalsCount > 0 ? 'var(--color-warning, #d97706)' : 'inherit' }}>
                {pendingApprovalsCount}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
                Goals needing review
              </div>
            </Card>
            <Card accent={atRisk.length > 0}>
              <div className="card-kicker">AT RISK / OFF TRACK</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: atRisk.length > 0 ? 'var(--color-error, #dc2626)' : 'inherit' }}>
                {atRisk.length}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
                Objectives flagged for attention
              </div>
            </Card>
          </>
        )}
      </div>

      {effectiveTab === 'roster' ? (
        /* Team Members Directory View */
        myReports.length === 0 ? (
          <EmptyState
            title="No direct reports assigned"
          />
        ) : (
          <Card kicker="Direct Reports Roster">
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-divider)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px' }}>Employee</th>
                    <th style={{ padding: '10px 12px' }}>Role / Position</th>
                    <th style={{ padding: '10px 12px' }}>Department</th>
                    <th style={{ padding: '10px 12px' }}>Branch</th>
                    <th style={{ padding: '10px 12px' }}>Hired On</th>
                    <th style={{ padding: '10px 12px' }}>Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {myReports.map((emp) => (
                    <tr key={emp.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--color-accent)' }}>
                          {emp.firstName} {emp.lastName}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)' }}>
                          {emp.employeeNo} &bull; {emp.workEmail || 'No email'}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontWeight: 500 }}>{emp.positionTitle || 'Staff Member'}</span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <Tag tone="outline">{emp.departmentName || 'General'}</Tag>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: '0.9rem' }}>{emp.branchName || 'Main / HQ'}</span>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                        {emp.hiredOn ? new Date(emp.hiredOn).toLocaleDateString('en-PH') : '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <Tag tone={emp.status === 'active' ? 'accent' : 'neutral'}>
                          {emp.status}
                        </Tag>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          {hasGoals && (
                            <Link
                              to={`/employees/${emp.id}/goals`}
                              className="btn btn-secondary btn-sm"
                              title="View Goals & Objectives"
                            >
                              Goals
                            </Link>
                          )}
                          <Link
                            to={`/employees/${emp.id}/history`}
                            className="btn btn-secondary btn-sm"
                            title="View 201 File, Timeline & History"
                          >
                            201 File
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : (
        /* Goals & Approvals Tab */
        <>
          {!period ? (
            <EmptyState title="No active goal period available" />
          ) : !d ? (
            <EmptyState title="No goal data found for period" />
          ) : (
            <>
              <Card
                kicker="Awaiting my approval"
                accent={d.pendingApproval.length > 0}
                elevated={d.pendingApproval.length > 0}
                style={{ marginBottom: 'var(--space-4)' }}
              >
                {d.pendingApproval.length === 0 ? (
                  <p className="card-body" style={{ margin: 0 }}>
                    Nothing waiting on you.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
                    {d.pendingApproval.map((g) => (
                      <div
                        key={g.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-3)',
                          flexWrap: 'wrap',
                          padding: 'var(--space-2) 0',
                          borderBottom: '1px solid var(--color-divider)',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 500 }}>{g.title}</div>
                          <div style={{ fontSize: 15, opacity: 0.65 }}>
                            {g.employeeName} &bull; weight {Number(g.weight)}%
                          </div>
                        </div>
                        <Link to={`/goals/${g.id}`} className="btn btn-secondary">
                          Review
                        </Link>
                        <Btn
                          variant="primary"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate(g.id)}
                        >
                          Approve
                        </Btn>
                      </div>
                    ))}
                  </div>
                )}
                <ErrorNote error={approve.error} />
              </Card>

              <Card kicker="Needs attention" style={{ marginBottom: 'var(--space-4)' }}>
                {atRisk.length === 0 ? (
                  <p className="card-body" style={{ margin: 0 }}>
                    No goals flagged at risk or off track.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
                    {atRisk.map((g) => (
                      <div
                        key={g.id}
                        style={{
                          padding: 'var(--space-2) 0',
                          borderBottom: '1px solid var(--color-divider)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-3)',
                            flexWrap: 'wrap',
                          }}
                        >
                          <CheckinStatus status={g.status} />
                          <Link to={`/goals/${g.id}`} style={{ fontSize: 15, fontWeight: 500 }}>
                            {g.title}
                          </Link>
                          <span style={{ fontSize: 15, opacity: 0.65 }}>
                            {g.employeeName}
                            {g.asOf ? ` &bull; as of ${g.asOf}` : ''}
                          </span>
                        </div>
                        {g.comment && (
                          <p style={{ fontSize: 15.5, margin: '4px 0 0', opacity: 0.85 }}>{g.comment}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card kicker="Team roll-up">
                {d.team.length === 0 ? (
                  <p className="card-body" style={{ margin: 0 }}>
                    No team goals in this period.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Goals</th>
                          <th>Weight</th>
                          <th style={{ width: 170 }}>Attainment</th>
                          <th>Flags</th>
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
                                {t.goalCount > 0 && weight !== 100 && (
                                  <Tag tone="outline">not 100%</Tag>
                                )}
                              </td>
                              <td>
                                <Attainment pct={t.attainment} />
                              </td>
                              <td style={{ fontSize: 15 }}>
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
                                <Link
                                  to={`/employees/${t.employeeId}/history`}
                                  className="btn btn-ghost btn-icon"
                                  aria-label={`Open ${t.employeeName}'s history`}
                                >
                                  <Icon path={paths.clock} size={15} />
                                </Link>
                                <Link
                                  to={`/employees/${t.employeeId}/goals`}
                                  className="btn btn-ghost btn-icon"
                                  aria-label={`Open ${t.employeeName}'s goals`}
                                >
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
            </>
          )}
        </>
      )}
    </Section>
  );
}
