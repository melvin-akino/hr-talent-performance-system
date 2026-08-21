import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../auth';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import { Btn, Card, PageHead, ReviewStateTag } from '../components/ds';

interface Assignment {
  id: string;
  reviewerRole: 'self' | 'supervisor' | 'calibrator';
  state: 'not_started' | 'in_progress' | 'submitted' | 'returned';
  subjectName: string;
  cycleName: string;
  cycleState: string;
  submittedAt: string | null;
  returnedReason: string | null;
}

interface MyReview {
  id: string;
  cycleName: string;
  overallRating: string | null;
  calibratedRating: string | null;
  goalAttainmentPct: string | null;
  releasedAt: string | null;
  acknowledgedAt: string | null;
  employeeComment: string | null;
}

/**
 * The reviewer's inbox, plus the employee's own released reviews.
 *
 * "My reviews" shows only what has been RELEASED — an unreleased supervisor
 * assessment is invisible here because the database will not return it, not
 * because this page filters it out.
 */
export default function Reviews() {
  const qc = useQueryClient();
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const assigned = useQuery({
    queryKey: ['reviews', 'assigned'],
    queryFn: () => api<Assignment[]>('/reviews/assigned'),
  });
  const mine = useQuery({
    queryKey: ['reviews', 'mine'],
    queryFn: () => api<MyReview[]>('/reviews/mine'),
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) =>
      api(`/review-summaries/${id}/acknowledge`, {
        method: 'POST',
        body: { comment: comment.trim() || undefined },
      }),
    onSuccess: () => {
      setAckFor(null);
      setComment('');
      void qc.invalidateQueries({ queryKey: ['reviews', 'mine'] });
    },
  });

  if (assigned.isLoading) return <Spinner />;

  const todo = assigned.data?.filter((a) => a.state !== 'submitted') ?? [];
  const done = assigned.data?.filter((a) => a.state === 'submitted') ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PageHead title="Reviews" />

      <Card kicker={`To complete (${todo.length})`}>
        {todo.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>Nothing waiting on you.</p>
        ) : (
          <ul>
            {todo.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <Link to={`/reviews/${a.id}`} className="font-medium text-muted hover:underline">
                    {a.reviewerRole === 'self' ? 'My self review' : `Review of ${a.subjectName}`}
                  </Link>
                  <p className="text-xs t-muted">{a.cycleName}</p>
                  {a.returnedReason && (
                    <p className="text-xs text-muted">Returned: {a.returnedReason}</p>
                  )}
                </div>
                <ReviewStateTag state={a.state} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {done.length > 0 && (
        <Card kicker={`Submitted (${done.length})`}>
          <ul>
            {done.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <Link to={`/reviews/${a.id}`} className="text-sm text-muted hover:underline">
                  {a.reviewerRole === 'self' ? 'My self review' : `Review of ${a.subjectName}`}
                </Link>
                <span className="text-xs t-muted">
                  {a.submittedAt?.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card kicker="My reviews">
        <p className="mb-3 text-xs t-muted">
          Reviews about you appear here once they have been signed off and released.
        </p>
        {mine.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No released reviews yet.</p>
        ) : (
          <ul>
            {mine.data?.map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{m.cycleName}</p>
                    <p className="text-xs t-muted">
                      Rating {m.calibratedRating ?? m.overallRating ?? '—'}
                      {m.goalAttainmentPct &&
                        ` · goal attainment ${Number(m.goalAttainmentPct).toFixed(1)}%`}
                      {m.releasedAt && ` · released ${m.releasedAt.slice(0, 10)}`}
                    </p>
                  </div>
                  {m.acknowledgedAt ? (
                    <span className="text-xs text-muted">
                      acknowledged {m.acknowledgedAt.slice(0, 10)}
                    </span>
                  ) : (
                    <Btn onClick={() => setAckFor(ackFor === m.id ? null : m.id)}>
                      Acknowledge
                    </Btn>
                  )}
                </div>

                {m.employeeComment && (
                  <p className="mt-2 text-sm t-muted italic">
                    Your comment: {m.employeeComment}
                  </p>
                )}

                {ackFor === m.id && (
                  <form
                    className="mt-3 space-y-3 rounded-md border border-divider p-3"
                    onSubmit={(e) => { e.preventDefault(); acknowledge.mutate(m.id); }}
                  >
                    <Field
                      label="Your comment (optional)"
                      hint="Acknowledging records that you have seen this review. It does not mean you agree with it."
                    >
                      <textarea rows={3} className={inputClass} value={comment}
                                onChange={(e) => setComment(e.target.value)} />
                    </Field>
                    <div className="flex gap-2">
                      <Btn type="submit" variant="primary" disabled={acknowledge.isPending}>
                        Confirm acknowledgement
                      </Btn>
                      <Btn type="button" onClick={() => setAckFor(null)}>Cancel</Btn>
                    </div>
                    <ErrorNote error={acknowledge.error} />
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
