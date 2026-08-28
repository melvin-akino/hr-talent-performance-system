import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../auth';
import type { Employee, TimelineEvent, TimelineKind } from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import { Card, EmptyState, Icon, PageHead, Section, Tag, paths } from '../components/ds';

/**
 * One employee's history, in one place (requirements §7.1).
 *
 * Everything shown here already existed, spread across four screens. Nobody
 * preparing for a promotion panel opens four screens — they ask what has
 * happened to this person, and the answer has to read as one story.
 *
 * The list is deliberately not a table. A table invites the eye to compare down
 * a column, and these rows are not comparable: a review's 4.2 out of 5 and a
 * task evaluation's 32 out of 37 share no scale. Each row states its own
 * result in its own terms, and the kind is carried by an icon and a word.
 */

const KIND_LABEL: Record<TimelineKind, string> = {
  review: 'Review',
  task_evaluation: 'Task evaluation',
  pip: 'Improvement plan',
  competency: 'Competency',
  employment_event: 'Employment',
};

/** Icon per kind. Status is never carried by colour alone. */
const KIND_ICON: Record<TimelineKind, keyof typeof paths> = {
  review: 'clipboard',
  task_evaluation: 'target',
  pip: 'lifeBuoy',
  competency: 'layers',
  employment_event: 'briefcase',
};

export default function EmployeeHistory() {
  const { employeeId } = useParams<{ employeeId: string }>();

  const employee = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api<Employee>(`/employees/${employeeId}`),
  });

  const timeline = useQuery({
    queryKey: ['timeline', employeeId],
    queryFn: () => api<TimelineEvent[]>(`/employees/${employeeId}/timeline`),
  });

  if (employee.error) return <ErrorNote error={employee.error} />;
  if (timeline.error) return <ErrorNote error={timeline.error} />;
  if (employee.isLoading || timeline.isLoading) return <Spinner />;

  const events = timeline.data ?? [];
  const name = `${employee.data?.firstName ?? ''} ${employee.data?.lastName ?? ''}`.trim();

  // Grouped by year, because that is how anyone reads a career: "what happened
  // in 2026", not "the fourteenth most recent thing".
  const years = [...new Set(events.map((e) => e.occurredOn.slice(0, 4)))];

  return (
    <Section>
      <PageHead
        title={name || 'Employee history'}
        meta={<span style={{ fontSize: 14, opacity: 0.7 }}>
          {events.length} {events.length === 1 ? 'entry' : 'entries'}
        </span>}
      >
        <Link className="btn btn-ghost" to={`/employees/${employeeId}/goals`}>Goals</Link>
      </PageHead>

      {events.length === 0 ? (
        <EmptyState title="Nothing recorded yet">
          Reviews, task evaluations, improvement plans, competency assessments and
          employment changes all appear here as they happen.
          {/* Not phrased as "no history": a viewer who cannot see this person's
              assessment would read that as a claim about the person rather than
              about their own access. */}
        </EmptyState>
      ) : (
        years.map((year) => (
          <Card key={year} kicker={year}>
            <ul style={{
              margin: 0, padding: 0, listStyle: 'none',
              display: 'flex', flexDirection: 'column',
            }}>
              {events.filter((e) => e.occurredOn.startsWith(year)).map((e) => (
                <li
                  key={e.refId + e.kind}
                  style={{
                    display: 'flex', gap: 'var(--space-3)',
                    padding: 'var(--space-3) 0',
                    borderTop: '1px solid var(--color-border)',
                    alignItems: 'flex-start',
                  }}
                >
                  <Icon path={paths[KIND_ICON[e.kind]]} size={18}
                        style={{ opacity: 0.7, flexShrink: 0, marginTop: 2 }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 'var(--space-2)',
                                  alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong>{e.title}</strong>
                      <Tag>{KIND_LABEL[e.kind]}</Tag>
                    </div>
                    {e.detail && (
                      <div className="text-xs t-muted" style={{ marginTop: 2 }}>
                        {e.detail}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {/* The result as the source stated it. No normalising: the
                        scales genuinely differ and pretending otherwise would
                        imply comparisons nobody made. */}
                    {e.result && <div className="tabular-nums">{e.result}</div>}
                    <div className="text-xs t-faint tabular-nums">{e.occurredOn}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </Section>
  );
}
