import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../auth';
import { ErrorNote, Spinner } from '../components/ui';
import { Btn, Card, DeliveryStateTag, PageHead, Stat } from '../components/ds';

type Mode = 'immediate' | 'digest' | 'off';

interface Preferences {
  defaultMode: Mode;
  overrides: { templateCode: string; mode: Mode }[];
}

interface Notification {
  id: string;
  templateCode: string;
  state: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface Template {
  code: string;
  description: string | null;
  isActive: boolean;
}

interface QueueHealth {
  counts: {
    pending: number; heldForDigest: number; sending: number;
    sent: number; failed: number; retrying: number; oldestPending: string | null;
  };
  failures: { templateCode: string; lastError: string | null; count: number }[];
}

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'immediate', label: 'Immediately', hint: 'Email as it happens' },
  { value: 'digest', label: 'Digest', hint: 'Batched into a periodic summary' },
  { value: 'off', label: 'Off', hint: 'No email; still visible in the app' },
];

export default function Notifications() {
  const qc = useQueryClient();

  const prefs = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api<Preferences>('/notifications/preferences'),
  });
  const history = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/notifications'),
  });
  const templates = useQuery({
    queryKey: ['notification-templates'],
    queryFn: () => api<Template[]>('/notifications/templates'),
  });
  // HR-only; a plain employee gets an empty result rather than an error.
  const health = useQuery({
    queryKey: ['queue-health'],
    queryFn: () => api<QueueHealth>('/notifications/queue-health'),
    retry: false,
  });

  const setPref = useMutation({
    mutationFn: (input: { templateCode?: string; mode: Mode }) =>
      api('/notifications/preferences', { method: 'PUT', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });

  if (prefs.isLoading) return <Spinner />;

  const modeFor = (code: string): Mode =>
    prefs.data?.overrides.find((o) => o.templateCode === code)?.mode
    ?? prefs.data?.defaultMode
    ?? 'immediate';

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PageHead title="Notifications" />

      <Card kicker="Email preferences">
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium">Default for everything</p>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              // The selected mode had no styling of its own — you could not see
              // which delivery mode was in effect, on the one control whose
              // whole purpose is to show that.
              <Btn
                key={m.value}
                title={m.hint}
                variant={prefs.data?.defaultMode === m.value ? 'primary' : 'secondary'}
                aria-pressed={prefs.data?.defaultMode === m.value}
                onClick={() => setPref.mutate({ mode: m.value })}
              >
                {m.label}
              </Btn>
            ))}
          </div>
          <p className="mt-2 text-xs t-muted">
            Turning email off never hides anything: everything stays visible in the
            app and in your history below.
          </p>
        </div>

        {(templates.data?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Notification</th>
                  <th>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {templates.data?.filter((t) => t.isActive && t.code !== 'digest')
                  .map((t) => (
                    <tr key={t.code}>
                      <td>
                        <span className="t-mono text-xs">{t.code}</span>
                        {t.description && (
                          <p className="text-xs t-muted">{t.description}</p>
                        )}
                      </td>
                      <td>
                        <select
                          className="input-sm"
                          value={modeFor(t.code)}
                          onChange={(e) => setPref.mutate({
                            templateCode: t.code, mode: e.target.value as Mode })}
                        >
                          {MODES.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorNote error={setPref.error} />
      </Card>

      {health.data && (
        <Card kicker="Delivery queue">
          <p className="mb-3 text-xs t-muted">
            On-premise there is no provider dashboard, so a stuck queue has to be
            visible here.
          </p>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat kicker="Pending" value={health.data.counts.pending} />
            <Stat kicker="Retrying" value={health.data.counts.retrying} />
            <Stat kicker="Held for digest" value={health.data.counts.heldForDigest} />
            <Stat kicker="Sent" value={health.data.counts.sent} />
            <Stat kicker="Failed" value={health.data.counts.failed} note="gave up after 6 tries" />
          </div>

          {health.data.failures.length > 0 && (
            <table className="table" style={{ marginTop: 'var(--space-4)' }}>
              <thead>
                <tr>
                  <th>Notification</th>
                  <th>Count</th>
                  <th>Last error</th>
                </tr>
              </thead>
              <tbody>
                {health.data.failures.map((f, i) => (
                  <tr key={i}>
                    <td className="t-mono text-xs">{f.templateCode}</td>
                    <td className="tabular-nums">{f.count}</td>
                    <td className="py-2 text-xs text-muted">{f.lastError ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card kicker="My notification history">
        {history.data?.length === 0 ? (
          <p className="card-body" style={{ margin: 0 }}>Nothing yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Notification</th>
                <th>State</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.map((n) => (
                <tr key={n.id}>
                  <td className="t-mono text-xs">{n.templateCode}</td>
                  <td>
                    <DeliveryStateTag state={n.state} />
                    {n.attempts > 1 && (
                      <span className="ml-2 text-xs t-muted">
                        {n.attempts} attempts
                      </span>
                    )}
                    {n.lastError && (
                      <p className="mt-1 text-xs t-muted" style={{ maxWidth: '48ch' }}>
                        {n.lastError}
                      </p>
                    )}
                  </td>
                  <td className="py-2 text-xs t-muted">
                    {(n.sentAt ?? n.createdAt).slice(0, 16).replace('T', ' ')}
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
