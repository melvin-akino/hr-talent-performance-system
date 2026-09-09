import { Client } from 'pg';

/**
 * Runs the deadline scan once and reports what it enqueued.
 *
 * The API worker already does this hourly, so this command is not how the
 * reminders normally go out. It exists for two situations the worker cannot
 * cover:
 *
 *   * an installation that runs the API without SMTP configured, where the
 *     worker declines to start at all — the scan should still be runnable from
 *     cron once a relay is available;
 *   * an operator who wants to know, right now, whether a quiet week means
 *     nothing is overdue or the scan is broken. Those look identical from the
 *     outside, and this prints the difference.
 *
 * Safe to run repeatedly and safe to run alongside the worker: every reminder
 * dedupes on the milestone it is about (migration 0043), so a second run in the
 * same hour sends nothing.
 */
export async function sendReminders(opts: {
  asOf?: string; daysAhead?: number; dryRun?: boolean;
} = {}): Promise<void> {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('ADMIN_DATABASE_URL must be set');

  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    const res = await c.query<{ template_code: string; enqueued: string }>(
      'SELECT * FROM app.enqueue_due_reminders($1::date, $2)',
      [opts.asOf ?? null, opts.daysAhead ?? 7]);

    const total = res.rows.reduce((sum, r) => sum + Number(r.enqueued), 0);

    console.log(`\n${opts.dryRun ? 'DRY RUN — nothing was queued' : 'Reminder scan'}`);
    console.log(`  as of        ${opts.asOf ?? 'today'}`);
    console.log(`  due within   ${opts.daysAhead ?? 7} days\n`);

    for (const row of res.rows) {
      const n = Number(row.enqueued);
      // Every template is listed, including the zeroes. A scan that found
      // nothing and a scan that never looked at a category print differently,
      // which is the whole reason this command exists.
      console.log(`  ${n === 0 ? ' ' : '→'} ${row.template_code.padEnd(26)}${n}`);
    }

    console.log(`\n  ${total} reminder(s) ${opts.dryRun ? 'would be' : ''} queued.`);
    if (total === 0) {
      console.log('  Nothing is overdue, or everyone has already been reminded '
        + 'about it — reminders send once per milestone, not once per scan.');
    }

    if (opts.dryRun) {
      await c.query('ROLLBACK');
    } else {
      await c.query('COMMIT');
    }
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await c.end();
  }
}
