import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { DbService } from '../db/db.service';
import { config } from '../config/config';
import { logger } from '../common/logger';

interface ClaimedNotification {
  id: string;
  recipient_email: string;
  template_code: string;
  payload: Record<string, unknown>;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  attempts: number;
}

/**
 * Delivers queued notifications over SMTP.
 *
 * Runs in-process on a timer rather than as a separate service (D-005: on-prem,
 * every extra moving part is another thing to monitor and restart at 2am). It is
 * safe to run more than one instance: app.claim_notifications() uses
 * FOR UPDATE SKIP LOCKED, so workers claim disjoint sets.
 *
 * Failure handling matters more here than it would on a hosted platform. The
 * office relay will be down sometimes and there is no provider dashboard to
 * check, so every failure is retried with backoff and, after six attempts,
 * parked in 'failed' with the error text where it can be queried.
 */
@Injectable()
export class NotificationWorkerService implements OnModuleDestroy {
  private transporter?: Transporter;
  private timer?: NodeJS.Timeout;
  private digestTimer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly db: DbService) {}

  /** Started explicitly from bootstrap, so tests can drive it by hand. */
  start(): void {
    if (!config.SMTP_HOST) {
      logger.warn(
        'SMTP_HOST is not set — notifications will queue but never send. ' +
        'Set SMTP_HOST/SMTP_PORT to the office relay.');
      return;
    }
    this.timer = setInterval(() => void this.tick(), config.NOTIFY_POLL_MS);
    this.digestTimer = setInterval(() => void this.buildDigests(),
                                   config.DIGEST_INTERVAL_MS);
    // unref so a pending timer never holds the process open during shutdown.
    this.timer.unref();
    this.digestTimer.unref();
    logger.info({ pollMs: config.NOTIFY_POLL_MS }, 'notification worker started');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.digestTimer) clearInterval(this.digestTimer);
    this.transporter?.close();
  }

  private mailer(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: config.SMTP_HOST!,
      port: config.SMTP_PORT,
      // An internal relay on port 25 typically offers neither TLS nor auth.
      // Opportunistic STARTTLS when available, never a hard requirement.
      secure: config.SMTP_PORT === 465,
      ignoreTLS: config.SMTP_IGNORE_TLS,
      ...(config.SMTP_USER
        ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } }
        : {}),
      pool: true,
      maxConnections: 2,
    });
    return this.transporter;
  }

  /**
   * One delivery pass. Public so a scheduled task or a test can invoke it
   * directly instead of waiting for the timer.
   */
  async tick(limit = config.NOTIFY_BATCH): Promise<{ sent: number; failed: number }> {
    // Guard against overlapping runs: a slow relay must not let a second pass
    // start and double the load on it.
    if (this.running) return { sent: 0, failed: 0 };
    this.running = true;
    let sent = 0;
    let failed = 0;

    try {
      const claimed = await this.db.withSystemContext(randomUUID(), async (client) => {
        const res = await client.query<ClaimedNotification>(
          'SELECT * FROM app.claim_notifications($1)', [limit]);
        return res.rows;
      });

      for (const n of claimed) {
        try {
          const rendered = NotificationWorkerService.render(n);
          await this.mailer().sendMail({
            from: config.MAIL_FROM,
            to: n.recipient_email,
            subject: rendered.subject,
            text: rendered.text,
            ...(rendered.html ? { html: rendered.html } : {}),
          });
          await this.db.withSystemContext(randomUUID(), (client) =>
            client.query('SELECT app.sent_notification($1)', [n.id]));
          sent++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn({ id: n.id, attempts: n.attempts, err: message },
                      'notification delivery failed');
          await this.db.withSystemContext(randomUUID(), (client) =>
            client.query('SELECT app.fail_notification($1, $2)', [n.id, message]));
          failed++;
        }
      }
    } catch (err) {
      logger.error({ err }, 'notification worker pass failed');
    } finally {
      this.running = false;
    }

    if (sent || failed) logger.info({ sent, failed }, 'notification pass complete');
    return { sent, failed };
  }

  async buildDigests(): Promise<number> {
    return this.db.withSystemContext(randomUUID(), async (client) => {
      // Reclaim anything a crashed worker left mid-flight before batching.
      await client.query('SELECT app.requeue_stalled_notifications()');
      const res = await client.query<{ n: string }>(
        'SELECT app.build_digests() AS n');
      const count = Number(res.rows[0]?.n ?? 0);
      if (count > 0) logger.info({ digests: count }, 'digests built');
      return count;
    });
  }

  /**
   * Renders {{dotted.path}} placeholders against the payload.
   *
   * Deliberately not a template engine: these templates are authored by HR and
   * stored in the database, so anything that can execute is a code-injection
   * path. Substitution only, and unknown placeholders are left visible rather
   * than silently blanked — a mail reading "Hi {{employee.name}}" is an obvious
   * bug report, whereas "Hi ," looks like a data problem.
   */
  static render(n: {
    template_code: string;
    payload: Record<string, unknown>;
    subject: string | null;
    body_text: string | null;
    body_html: string | null;
  }): { subject: string; text: string; html?: string } {
    const resolve = (path: string): string | undefined => {
      // Own properties only. A plain index walks the prototype chain, so
      // `{{__proto__}}` resolves to Object.prototype and renders as "{}" —
      // reaching object internals instead of being left visible as the unknown
      // placeholder it is. Templates are authored by HR and stored in the
      // database; they get to read the payload and nothing else.
      const value = path.split('.').reduce<unknown>(
        (acc, key) => (acc && typeof acc === 'object'
          && Object.prototype.hasOwnProperty.call(acc, key)
          ? (acc as Record<string, unknown>)[key]
          : undefined),
        n.payload);
      if (value === null || value === undefined) return undefined;
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    };

    const fill = (s: string): string =>
      s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path: string) =>
        resolve(path) ?? match);

    // A missing template must not lose the notification. Fall back to something
    // deliverable and obviously wrong, so it surfaces as a template bug.
    if (!n.subject || !n.body_text) {
      return {
        subject: `[${n.template_code}] notification`,
        text:
          `A notification of type "${n.template_code}" was generated, but no ` +
          `active template exists for it.\n\n` +
          `Details:\n${JSON.stringify(n.payload, null, 2)}\n`,
      };
    }

    const html = n.body_html ? fill(n.body_html) : undefined;
    return {
      subject: fill(n.subject),
      text: fill(n.body_text),
      ...(html ? { html } : {}),
    };
  }
}
