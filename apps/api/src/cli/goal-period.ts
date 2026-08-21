/**
 * Opens a goal period.
 *
 *   pnpm hr open-goal-period --org DEVCORE --name FY2026 \
 *     --starts 2026-01-01 --ends 2026-12-31 [--cadence monthly] [--type annual]
 *
 * HR normally does this in the console. It exists here because a scripted
 * install has no console: until a period is open nobody can create a goal, so a
 * freshly provisioned system is inert, and preflight rightly refuses to call it
 * ready.
 *
 * Idempotent. Re-running with the same name reopens a period that was locked or
 * closed but never silently moves its dates — shifting the boundaries of a
 * period that already holds goals would change what those goals were measured
 * against.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const PERIOD_TYPES = ['annual', 'semi_annual', 'quarterly', 'custom'] as const;
const CADENCES = ['weekly', 'biweekly', 'monthly', 'quarterly'] as const;

export async function openGoalPeriod(opts: {
  orgCode: string;
  name: string;
  startsOn: string;
  endsOn: string;
  periodType: string;
  cadence: string;
}): Promise<void> {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('ADMIN_DATABASE_URL must be set');

  if (!PERIOD_TYPES.includes(opts.periodType as (typeof PERIOD_TYPES)[number])) {
    throw new Error(`--type must be one of: ${PERIOD_TYPES.join(', ')}`);
  }
  if (!CADENCES.includes(opts.cadence as (typeof CADENCES)[number])) {
    throw new Error(`--cadence must be one of: ${CADENCES.join(', ')}`);
  }
  if (!(opts.endsOn > opts.startsOn)) {
    throw new Error(`--ends (${opts.endsOn}) must be after --starts (${opts.startsOn})`);
  }

  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('BEGIN');
  await c.query(`SELECT set_config('app.request_id', $1, true)`, [randomUUID()]);

  try {
    const org = (await c.query<{ id: string }>(
      'SELECT id FROM organization WHERE code = $1', [opts.orgCode])).rows[0]?.id;
    if (!org) throw new Error(`Organization '${opts.orgCode}' does not exist`);

    const existing = (await c.query<{
      id: string; state: string; starts_on: string; ends_on: string;
    }>(`SELECT id, state, starts_on::text, ends_on::text
          FROM goal_period WHERE org_id = $1 AND name = $2`,
      [org, opts.name])).rows[0];

    if (existing) {
      if (existing.starts_on !== opts.startsOn || existing.ends_on !== opts.endsOn) {
        throw new Error(
          `Goal period '${opts.name}' already exists with dates ` +
          `${existing.starts_on} to ${existing.ends_on}, which differ from the ` +
          `ones given. Refusing to move the boundaries of a period that may ` +
          `already hold goals — use a new name instead.`);
      }
      await c.query(
        `UPDATE goal_period SET state = 'open', locked_at = NULL, closed_at = NULL
          WHERE id = $1`, [existing.id]);
      await c.query('COMMIT');
      console.log(
        `Goal period '${opts.name}' was ${existing.state}; it is now open.`);
      return;
    }

    // Overlapping periods are legitimate (an annual period alongside quarterly
    // ones), so this warns rather than refuses — but two open annual periods is
    // almost always a typo, and goals would silently land in whichever the UI
    // picked first.
    const overlapping = await c.query<{ name: string }>(
      `SELECT name FROM goal_period
        WHERE org_id = $1 AND state = 'open'
          AND daterange(starts_on, ends_on, '[]')
              && daterange($2::date, $3::date, '[]')`,
      [org, opts.startsOn, opts.endsOn]);

    await c.query(
      `INSERT INTO goal_period (org_id, name, period_type, starts_on, ends_on,
                                state, checkin_cadence)
            VALUES ($1,$2,$3::goal_period_type,$4,$5,'open',$6::checkin_cadence)`,
      [org, opts.name, opts.periodType, opts.startsOn, opts.endsOn, opts.cadence]);

    await c.query('COMMIT');

    console.log(`Goal period '${opts.name}' opened for ${opts.orgCode}`);
    console.log(`  ${opts.startsOn} to ${opts.endsOn} · ${opts.periodType} · ` +
                `${opts.cadence} check-ins`);
    if (overlapping.rowCount) {
      console.log(`\n  NOTE: overlaps ${overlapping.rowCount} other open period(s): ` +
                  `${overlapping.rows.map((r) => r.name).join(', ')}`);
      console.log(`  Intentional for nested periods; otherwise close the older one.`);
    }
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await c.end();
  }
}
