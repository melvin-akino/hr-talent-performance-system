import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../auth';
import { usePeriod } from '../PeriodContext';
import { ErrorNote, Spinner } from '../components/ui';
import { Card, EmptyState, PageHead, Section } from '../components/ds';

/**
 * The unit view — Department Head, Area Head, Regional Head, GM (§7.3, F3).
 *
 * ONE SCREEN FOR ALL FOUR, and there is no role anywhere in this file.
 *
 * A DH sees their section and an Area Head sees their area because RLS answers
 * differently for each of them, not because this component asks who they are.
 * A `role === 'dept_head'` branch here would be the authorization boundary
 * re-implemented in the browser, where it can be read by anyone and enforced by
 * nobody.
 *
 * The page answers two questions in the order a unit head actually asks them:
 * what is waiting for ME, then how is my part of the organisation doing. The
 * queue comes first because it is the only part they can act on today.
 */

interface Unit {
  id: string; code: string; name: string; unitType: string;
  headcount: number; withGoals: number; attainment: string | null;
}
interface Progress {
  department: string; cycle: string;
  total: number; submitted: number; returned: number; outstanding: number;
}
interface Waiting {
  id: string; subjectName: string; asRole: string; state: string;
  cycle: string; closesOn: string;
}
interface Blocking {
  subjectName: string; cycle: string; outstanding: number; roles: string;
}
interface UnitDash {
  units: Unit[];
  reviewProgress: Progress[];
  waitingOnYou: Waiting[];
  blockingSignOff: Blocking[];
}

const ROLE_LABEL: Record<string, string> = {
  self: 'your own review',
  supervisor: 'as supervisor',
  dept_head: 'as Department Head',
  calibrator: 'as calibrator',
  peer: 'as a peer',
  subordinate: 'as a subordinate',
};

export default function UnitDashboard() {
  const { period } = usePeriod();

  const dash = useQuery({
    queryKey: ['unit-dashboard', period?.id],
    queryFn: () => api<UnitDash>(`/dashboards/unit/${period!.id}`),
    enabled: !!period,
  });

  if (!period) return <Spinner label="Waiting for a goal period…" />;
  if (dash.error) return <ErrorNote error={dash.error} />;
  if (dash.isLoading) return <Spinner />;

  const d = dash.data;
  if (!d) return null;

  // No unit means the endpoint declined rather than failed — see the comment on
  // dashboard.service.ts#unit. Saying so beats four empty tables.
  if (d.units.length === 0 && d.waitingOnYou.length === 0) {
    return (
      <Section>
        <PageHead title="My unit" />
        <EmptyState title="Nothing assigned to a unit for you">
          This view reports on a section, area or region. It appears once you
          hold people beyond yourself — a Department Head sees their section, an
          Area Head their area.
        </EmptyState>
      </Section>
    );
  }

  return (
    <Section>
      <PageHead
        title="My unit"
        meta={<span style={{ fontSize: 14, opacity: 0.7 }}>{period.name}</span>}
      />

      <Card
        kicker="Your queue"
        title="Waiting for you"
        accent={d.waitingOnYou.length > 0}
      >
        {d.waitingOnYou.length === 0 ? (
          <p className="text-muted">Nothing outstanding. Your own reviews are done.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Person</th><th>Your part</th><th>State</th><th>Cycle closes</th></tr>
              </thead>
              <tbody>
                {d.waitingOnYou.map((w) => (
                  <tr key={w.id}>
                    <td>{w.subjectName}</td>
                    <td>{ROLE_LABEL[w.asRole] ?? w.asRole}</td>
                    <td>{w.state.replace(/_/g, ' ')}</td>
                    <td>{w.closesOn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card kicker="Targets" title="Coverage by unit">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Unit</th><th>People</th><th>With targets</th><th>Attainment</th>
              </tr>
            </thead>
            <tbody>
              {d.units.map((u) => (
                <tr key={u.id}>
                  <td>{u.name} <span className="text-muted">({u.code})</span></td>
                  <td>{u.headcount}</td>
                  <td>
                    {u.withGoals}
                    {/* The gap is the point of this column, so it is stated
                        rather than left to subtraction. */}
                    {u.withGoals < u.headcount && (
                      <span className="text-muted">
                        {' '}— {u.headcount - u.withGoals} without
                      </span>
                    )}
                  </td>
                  <td>{u.attainment ? `${u.attainment}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {d.reviewProgress.length > 0 && (
        <Card kicker="Cycles" title="Where each cycle has reached">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Unit</th><th>Cycle</th><th>Submitted</th>
                  <th>Returned</th><th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {d.reviewProgress.map((p, i) => (
                  <tr key={i}>
                    <td>{p.department}</td>
                    <td>{p.cycle}</td>
                    <td>{p.submitted} of {p.total}</td>
                    <td>{p.returned || '—'}</td>
                    <td>{p.outstanding || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {d.blockingSignOff.length > 0 && (
        <Card kicker="Blocked" title="Why these cannot be signed off yet">
          <p className="text-muted">
            Sign-off waits for every reviewer, so one unfinished part holds up the
            whole result. These are the people it is holding up, and who it is
            waiting on.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Person</th><th>Cycle</th><th>Outstanding</th><th>Waiting on</th></tr>
              </thead>
              <tbody>
                {d.blockingSignOff.map((b, i) => (
                  <tr key={i}>
                    <td>{b.subjectName}</td>
                    <td>{b.cycle}</td>
                    <td>{b.outstanding}</td>
                    <td>{b.roles.split(', ').map((r) => ROLE_LABEL[r] ?? r).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-muted" style={{ fontSize: 13 }}>
        Every figure here is scoped to what you may see. <Link to="/team">Team</Link>{' '}
        shows the people reporting to you directly.
      </p>
    </Section>
  );
}
