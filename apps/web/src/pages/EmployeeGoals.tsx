import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../auth';
import type { Employee, Goal } from '../types';
import { usePeriod } from '../PeriodContext';
import { ErrorNote, Spinner } from '../components/ui';
import {
  Attainment, Card, CheckinStatus, GoalStateTag, PageHead, Section, Tag,
} from '../components/ds';

/**
 * One employee's goals, as seen by a manager or HR.
 *
 * If the viewer is not permitted to see this person, the API returns 404 rather
 * than 403 -- a 403 would confirm the record exists. The error surface here
 * inherits that behaviour deliberately.
 */
export default function EmployeeGoals() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { period } = usePeriod();

  const employee = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api<Employee>(`/employees/${employeeId}`),
  });

  const goals = useQuery({
    queryKey: ['goals', employeeId, period?.id],
    queryFn: () => api<Goal[]>(`/employees/${employeeId}/goals?periodId=${period!.id}`),
    enabled: !!period,
  });

  if (employee.error) return <ErrorNote error={employee.error} />;
  if (employee.isLoading || goals.isLoading) return <Spinner />;

  const totalWeight = (goals.data ?? [])
    .filter((g) => g.state !== 'cancelled' && g.state !== 'draft')
    .reduce((sum, g) => sum + Number(g.weight), 0);

  return (
    <Section>
      <PageHead
        title={`${employee.data?.firstName ?? ''} ${employee.data?.lastName ?? ''}`.trim()
          || 'Employee goals'}
        meta={period && <span style={{ fontSize: 14, opacity: 0.7 }}>{period.name}</span>}
      >
        {/* Weights that do not total 100% block approval, so the two cases must
            not read the same. Settled is quiet text; anything else is a tag that
            says what is wrong with it. */}
        {totalWeight === 100
          ? <span className="text-xs t-muted">total weight 100%</span>
          : <Tag tone="outline">total weight {totalWeight}% — must be 100%</Tag>}
      </PageHead>

      <Card kicker="Goals">
      {goals.data?.length === 0 ? (
        <p className="card-body" style={{ margin: 0 }}>No goals for this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Goal</th>
                <th>Weight</th>
                <th>State</th>
                <th>Status</th>
                <th>Attainment</th>
              </tr>
            </thead>
            <tbody>
              {goals.data?.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link to={`/goals/${g.id}`} className="font-medium text-muted hover:underline">
                      {g.title}
                    </Link>
                  </td>
                  <td className="tabular-nums">{Number(g.weight)}%</td>
                  <td><GoalStateTag state={g.state} /></td>
                  <td><CheckinStatus status={g.latestStatus} /></td>
                  <td><Attainment pct={g.attainmentPct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </Card>
    </Section>
  );
}
