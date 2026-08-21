import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import type { Employee } from '../types';
import { ErrorNote, Field, Spinner, inputClass } from '../components/ui';
import { Btn, Card, PageHead, Tag } from '../components/ds';

type Visibility = 'employee_only' | 'employee_and_supervisor' | 'supervisor_only';

interface Thread {
  id: string;
  subjectEmployeeId: string;
  subjectName: string;
  authorId: string;
  authorName: string;
  visibility: Visibility;
  kind: string;
  title: string;
  isClosed: boolean;
  createdAt: string;
  messageCount: number;
  lastMessageAt: string | null;
  messages?: { id: string; body: string; createdAt: string; authorName: string }[];
}

const VISIBILITY_LABEL: Record<Visibility, string> = {
  employee_only: 'Employee only',
  employee_and_supervisor: 'Employee + supervisor',
  supervisor_only: 'Supervisor only',
};

/**
 * Who can see each channel, stated in the UI rather than buried in docs.
 * People choose a channel based on what they believe about it, so the belief
 * had better be accurate.
 */
const VISIBILITY_HELP: Record<Visibility, string> = {
  employee_only:
    'Only you and the person you are writing to. Not their manager, not HR.',
  employee_and_supervisor:
    'You, the employee, their direct manager, and HR.',
  supervisor_only:
    'You, their direct manager, and HR. The employee will NOT see this or be notified about it.',
};

/**
 * All three visibilities previously rendered identically, which on this screen
 * is the worst place for it: the badge's entire job is to say who can read the
 * thread. `supervisor_only` is the one the subject cannot see, so it is the one
 * that gets the outline — a writer skimming a list needs to notice it without
 * reading the label.
 */
const VISIBILITY_TONE: Record<Visibility, 'accent' | 'neutral' | 'outline'> = {
  employee_only: 'accent',
  employee_and_supervisor: 'neutral',
  supervisor_only: 'outline',
};

export default function Feedback() {
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const threads = useQuery({
    queryKey: ['feedback'],
    queryFn: () => api<Thread[]>('/feedback'),
  });

  if (threads.isLoading) return <Spinner />;
  if (threads.error) return <ErrorNote error={threads.error} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {/* The action lives on the page heading rather than on the first card: the
          card's title was the page's name repeated, and a heading is the one
          place a reader looks for "what can I do here". */}
      <PageHead title="Feedback">
        <Btn variant="primary" onClick={() => setComposing((v) => !v)}>
          Give feedback
        </Btn>
      </PageHead>

      {composing && (
        <Compose onDone={() => {
          setComposing(false);
          void qc.invalidateQueries({ queryKey: ['feedback'] });
        }} />
      )}

      <Card kicker={`Threads (${threads.data?.length ?? 0})`}>
        <p className="mb-3 text-xs t-muted">
          You see feedback you wrote, feedback about you, and — as a manager —
          feedback about your direct reports. Employee-only threads stay private
          between the two people involved.
        </p>

        {threads.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>No feedback yet.</p>
        ) : (
          <ul>
            {threads.data?.map((t) => (
              <li key={t.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      className="text-left font-medium text-muted hover:underline"
                      onClick={() => setOpenId(openId === t.id ? null : t.id)}
                    >
                      {t.title}
                    </button>
                    <p className="text-xs t-muted">
                      about {t.subjectName} · from {t.authorName} · {t.kind}
                      {t.messageCount > 1 && ` · ${t.messageCount} messages`}
                      {t.isClosed && ' · closed'}
                    </p>
                  </div>
                  <Tag tone={VISIBILITY_TONE[t.visibility]}>
                    {VISIBILITY_LABEL[t.visibility]}
                  </Tag>
                </div>
                {openId === t.id && <ThreadDetail threadId={t.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ThreadDetail({ threadId }: { threadId: string }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');

  const thread = useQuery({
    queryKey: ['feedback', threadId],
    queryFn: () => api<Thread>(`/feedback/${threadId}`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['feedback', threadId] });
    void qc.invalidateQueries({ queryKey: ['feedback'] });
  };

  const send = useMutation({
    mutationFn: () =>
      api(`/feedback/${threadId}/replies`, { method: 'POST', body: { body: reply } }),
    onSuccess: () => { setReply(''); invalidate(); },
  });

  const close = useMutation({
    mutationFn: () => api(`/feedback/${threadId}/close`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  if (thread.isLoading) return <Spinner />;
  if (thread.error) return <ErrorNote error={thread.error} />;
  const t = thread.data!;

  return (
    <div className="mt-3 space-y-4 panel-tint p-4">
      <p className="text-xs t-muted">{VISIBILITY_HELP[t.visibility]}</p>

      <ol style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {t.messages?.map((m) => (
          <li key={m.id} className="border-l-2 border-divider pl-3">
            <p className="text-xs t-muted">
              {m.authorName} · {m.createdAt.slice(0, 16).replace('T', ' ')}
            </p>
            <p className="mt-0.5 text-sm whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>

      {!t.isClosed && (
        <form
          className="space-y-2"
          onSubmit={(e) => { e.preventDefault(); send.mutate(); }}
        >
          <textarea
            rows={3} className={inputClass} value={reply} required
            placeholder="Reply…"
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Btn type="submit" variant="primary" disabled={send.isPending || !reply.trim()}>
              Send reply
            </Btn>
            <Btn type="button" onClick={() => close.mutate()}>
              Close thread
            </Btn>
            <span className="text-xs t-muted">
              Messages are permanent and cannot be edited.
            </span>
          </div>
          <ErrorNote error={send.error ?? close.error} />
        </form>
      )}
    </div>
  );
}

function Compose({ onDone }: { onDone: () => void }) {
  const [subjectEmployeeId, setSubject] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('employee_and_supervisor');
  const [kind, setKind] = useState('general');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  // Anyone visible to the caller can receive feedback — RLS decides that list.
  const people = useQuery({
    queryKey: ['employees', 'feedback-targets'],
    queryFn: () => api<Employee[]>('/employees?limit=200'),
  });

  const create = useMutation({
    mutationFn: () =>
      api('/feedback', {
        method: 'POST',
        body: {
          subjectEmployeeId, visibility, kind,
          title: title.trim(), body: body.trim(),
        },
      }),
    onSuccess: onDone,
  });

  return (
    <Card kicker="Give feedback">
      <form className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="About">
          <select className={inputClass} required value={subjectEmployeeId}
                  onChange={(e) => setSubject(e.target.value)}>
            <option value="">Select a person…</option>
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
            ))}
          </select>
        </Field>

        <Field label="Type">
          <select className={inputClass} value={kind}
                  onChange={(e) => setKind(e.target.value)}>
            <option value="praise">Praise</option>
            <option value="coaching">Coaching</option>
            <option value="concern">Concern</option>
            <option value="request">Request</option>
            <option value="general">General</option>
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Who can see this" hint={VISIBILITY_HELP[visibility]}>
            <select className={inputClass} value={visibility}
                    onChange={(e) => setVisibility(e.target.value as Visibility)}>
              <option value="employee_only">{VISIBILITY_LABEL.employee_only}</option>
              <option value="employee_and_supervisor">
                {VISIBILITY_LABEL.employee_and_supervisor}
              </option>
              <option value="supervisor_only">{VISIBILITY_LABEL.supervisor_only}</option>
            </select>
          </Field>
          {visibility === 'supervisor_only' && (
            <p className="mt-2 rounded-md hr-note px-3 py-2 text-xs text-muted">
              The person will not see this and will not be told it exists. Use it
              for a manager conversation, not to avoid a difficult one.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <Field label="Title">
            <input className={inputClass} required value={title} maxLength={200}
                   onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Feedback" hint="Specific and behavioural travels further than general praise.">
            <textarea rows={5} className={inputClass} required value={body}
                      onChange={(e) => setBody(e.target.value)} />
          </Field>
        </div>

        <div className="sm:col-span-2 flex gap-3">
          <Btn type="submit" variant="primary" disabled={create.isPending}>
            Send feedback
          </Btn>
          <Btn type="button" onClick={onDone}>Cancel</Btn>
        </div>
        {create.error ? <div className="sm:col-span-2"><ErrorNote error={create.error} /></div> : null}
      </form>
    </Card>
  );
}
