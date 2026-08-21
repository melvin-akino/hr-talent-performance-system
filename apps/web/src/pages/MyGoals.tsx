import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../auth';
import type { EmployeeDashboard, Goal } from '../types';
import { Spinner } from '../components/ui';
import {
  Attainment, Btn, Card, CheckinStatus, EmptyState, GoalStateTag, Icon, PageHead,
  Section, Stat, Tag, attentionRank, paths,
} from '../components/ds';
import { usePeriod } from '../PeriodContext';

/**
 * The employee's home screen, and for most staff the only one they open.
 *
 * Two behaviours here are deliberate and were decided in design:
 *
 *   An account with no goals shows **no warnings**. The previous version put an
 *   amber "must total 100%" on an empty account, so a new joiner's first screen
 *   complained about a rule they had not had the chance to break. The weight
 *   tag only appears once at least one goal exists.
 *
 *   "Never checked in" outranks "at risk" in the attention list. A goal nobody
 *   has reported on is an absence of information, which is worse than a known
 *   problem — the old UI had no way to show it at all.
 */
export default function MyGoals() {
  const { period } = usePeriod();
  const navigate = useNavigate();

  const dashboard = useQuery({
    queryKey: ['dashboard', 'employee', period?.id],
    queryFn: () => api<EmployeeDashboard>(`/dashboards/employee/${period!.id}`),
    enabled: !!period,
  });

  const goals = useQuery({
    queryKey: ['goals', 'mine', period?.id],
    queryFn: () => api<Goal[]>(`/employees/me/goals?periodId=${period!.id}`),
    enabled: !!period,
  });

  if (!period) {
    return (
      <EmptyState title="No goal period is open">
        Goals are filed against a period, and none is open yet. Ask HR to open one.
      </EmptyState>
    );
  }
  if (dashboard.isLoading || goals.isLoading) return <Spinner />;

  const summary = dashboard.data?.summary;
  const list = goals.data ?? [];
  const isEmpty = list.length === 0;
  const totalWeight = Number(summary?.totalWeight ?? 0);

  // Sorted by urgency, never-checked-in first. The API returns what is due;
  // the ordering is ours.
  const attention = [...list]
    .filter((g) => g.state === 'active'
      && (g.latestStatus == null || g.latestStatus === 'at_risk' || g.latestStatus === 'off_track'))
    .sort((a, b) => attentionRank(a.latestStatus) - attentionRank(b.latestStatus));

  return (
    <Section>
      <PageHead title={`My goals — ${period.name}`}>
        {period.state === 'open'
          ? <Link to="/goals/new" className="btn btn-primary">
              New goal
            </Link>
          : <span className="text-muted" style={{ fontSize: 13 }}>Period is {period.state}</span>}
      </PageHead>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 'var(--space-3)',
      }}>
        <Stat kicker="Goals this period" value={summary?.totalGoals ?? 0}
              note={`${summary?.active ?? 0} active`} />
        <Stat
          kicker="Total weight"
          value={isEmpty ? '—' : `${totalWeight}%`}
          // No tag at all on an empty account: nothing has been violated yet.
          tag={isEmpty ? undefined
            : totalWeight === 100
              ? <Tag tone="accent">complete</Tag>
              : <Tag tone="outline">must total 100%</Tag>}
        />
        <Stat
          kicker="Weighted attainment"
          value={summary?.weightedAttainment
            ? `${Number(summary.weightedAttainment).toFixed(0)}%` : '—'}
          note={isEmpty ? undefined : 'across measured goals'}
        />
        <Stat kicker="Needs check-in" value={attention.length} />
      </div>

      {attention.length > 0 && (
        <Card kicker="Needs your attention" accent elevated>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
            {attention.map((g) => (
              <div key={g.id} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-divider)',
              }}>
                <Icon
                  size={16}
                  path={g.latestStatus == null ? paths.dashedCircle : paths.alertCircle}
                  stroke={g.latestStatus == null
                    ? 'var(--color-accent-700)' : 'var(--color-accent-900)'}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{g.title}</div>
                  <div style={{ fontSize: 12, opacity: 0.65 }}>
                    {g.latestStatus == null
                      ? 'Never checked in since this goal was set'
                      : `${g.latestStatus === 'off_track' ? 'Off track' : 'At risk'}${
                          g.latestCheckinAt ? ` — last check-in ${g.latestCheckinAt.slice(0, 10)}` : ''}`}
                  </div>
                </div>
                <Btn onClick={() => navigate(`/goals/${g.id}`)}>Check in</Btn>
              </div>
            ))}
          </div>
        </Card>
      )}

      {isEmpty ? (
        <EmptyState title="No goals set for this period yet">
          Your manager will help set these, or start a draft yourself. Nothing here
          is overdue — there is simply nothing yet.
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {list.map((g) => (
            <Card key={g.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-4)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="card-title" style={{ fontSize: 16 }}>{g.title}</span>
                  <GoalStateTag state={g.state} />
                  {g.kpiCode && (
                    <span style={{ fontSize: 11, opacity: 0.5 }}>
                      {g.kpiCode} v{g.kpiDefinitionVersion}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                  Weight {Number(g.weight)}% · Due {g.dueOn ?? '—'}
                </div>
              </div>

              <div style={{ width: 150, flex: 'none' }}>
                <Attainment pct={g.attainmentPct} />
              </div>

              <div style={{ width: 140, flex: 'none' }}>
                {/* Only active goals carry check-in health; a cancelled goal
                    being "never checked in" is noise, not a finding. */}
                {g.state === 'active'
                  ? <CheckinStatus status={g.latestStatus} />
                  : <span style={{ opacity: 0.4, fontSize: 12 }}>—</span>}
              </div>

              <Link to={`/goals/${g.id}`} className="btn btn-ghost btn-icon" aria-label={`Open ${g.title}`}>
                <Icon path={paths.arrowRight} size={15} />
              </Link>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}
