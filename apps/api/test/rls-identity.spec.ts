import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

/**
 * Guards the single most dangerous failure mode in the design (decisions.md
 * D-003): RLS identity leaking between requests that share a pooled connection.
 *
 * If `SET` were used instead of `SET LOCAL`, the GUC would persist on the
 * connection after the request ends. The next request handed that same
 * connection would inherit the previous user's identity and read their data --
 * with no error, no log line, and no failing business-logic test.
 *
 * The pool is deliberately sized to 1 so every query is forced onto the same
 * physical connection, which is exactly the condition that would expose a leak.
 */
describe('RLS identity is transaction-scoped', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
    await pool.query(`
      CREATE SCHEMA app;
      CREATE FUNCTION app.current_employee_id() RETURNS UUID
        LANGUAGE sql STABLE AS $$
          SELECT NULLIF(current_setting('app.current_employee_id', true), '')::uuid;
        $$;
    `);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  const ALICE = '11111111-1111-1111-1111-111111111111';

  it('does not leak identity to the next user of the same connection', async () => {
    // Request 1 -- sets identity inside a transaction, as DbService does.
    const first = await pool.connect();
    await first.query('BEGIN');
    await first.query(`SELECT set_config('app.current_employee_id', $1, true)`, [ALICE]);
    const inside = await first.query<{ id: string | null }>(
      'SELECT app.current_employee_id() AS id');
    expect(inside.rows[0].id).toBe(ALICE);
    await first.query('COMMIT');
    first.release();

    // Request 2 -- same physical connection (pool max = 1), no identity set.
    const second = await pool.connect();
    const after = await second.query<{ id: string | null }>(
      'SELECT app.current_employee_id() AS id');
    second.release();

    expect(after.rows[0].id).toBeNull();
  });

  it('clears identity after a rollback as well as a commit', async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_employee_id', $1, true)`, [ALICE]);
    await client.query('ROLLBACK');
    const after = await client.query<{ id: string | null }>(
      'SELECT app.current_employee_id() AS id');
    client.release();
    expect(after.rows[0].id).toBeNull();
  });

  it('demonstrates the leak that SET LOCAL prevents', async () => {
    // Session-scoped SET -- the wrong way. Kept as an executable illustration
    // so the reason for `true` in set_config is not lost to a future edit.
    const client = await pool.connect();
    await client.query(`SELECT set_config('app.current_employee_id', $1, false)`, [ALICE]);
    client.release();

    const next = await pool.connect();
    const leaked = await next.query<{ id: string | null }>(
      'SELECT app.current_employee_id() AS id');
    next.release();

    expect(leaked.rows[0].id).toBe(ALICE); // <-- the bug, reproduced
    await pool.query(`SELECT set_config('app.current_employee_id', '', false)`);
  });
});
