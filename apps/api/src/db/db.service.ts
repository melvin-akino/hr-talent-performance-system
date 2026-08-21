import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { config, requireServerConfig } from '../config/config';
import { logger } from '../common/logger';

export interface RequestContext {
  /** The authenticated employee's id. Never trust a client-supplied value. */
  employeeId: string;
  /** Correlates DB mutations to the originating HTTP request in audit_log. */
  requestId: string;
}

/**
 * All database access goes through this service.
 *
 * The critical invariant (decisions.md D-003): the RLS identity GUC is set with
 * SET LOCAL inside an explicit transaction, so it is scoped to that transaction
 * and reset when it ends. A session-scoped `SET` on a pooled connection would
 * leak the previous request's identity to the next caller that happens to be
 * handed the same connection -- a cross-user data leak that no test of the
 * business logic would catch. See test/rls-identity.spec.ts.
 *
 * There is intentionally NO method to run a query outside a context. Adding one
 * would make the unsafe path the convenient one.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;
  private adminPool?: Pool;

  onModuleInit(): void {
    this.pool = new Pool({
      connectionString: requireServerConfig().DATABASE_URL,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Statement timeout guards against a runaway recursive hierarchy query
      // taking the server down at review-cycle close.
      statement_timeout: 30_000,
      application_name: 'hr-api',
    });

    this.pool.on('error', (err) => {
      // Idle client errors are emitted on the pool, not on any request. Without
      // this handler Node treats them as unhandled and terminates the process.
      logger.error({ err }, 'idle postgres client error');
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.pool?.end(), this.adminPool?.end()]);
  }

  /**
   * Runs `fn` inside a transaction with the caller's RLS identity applied.
   * Commits on success, rolls back on any throw.
   */
  async withContext<T>(
    ctx: RequestContext,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Parameterised via set_config rather than string interpolation --
      // SET LOCAL does not accept bind parameters, and interpolating a value
      // into a SET statement is an injection vector.
      await client.query(
        `SELECT set_config('app.current_employee_id', $1, true),
                set_config('app.request_id', $2, true)`,
        [ctx.employeeId, ctx.requestId],
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch((rollbackErr) => {
        logger.error({ err: rollbackErr }, 'rollback failed');
      });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Privileged path for flows that legitimately have no authenticated user:
   * the CSV importer, health checks, and IdP subject linking on first login.
   *
   * Still connects as hr_app (RLS enforced, NOBYPASSRLS) -- this is NOT an
   * escape hatch. With no identity set, `app.can_access` returns false and
   * policies deny, so callers must operate on tables/paths that do not require
   * a subject, or explicitly pass a system actor.
   */
  async withSystemContext<T>(
    requestId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.request_id', $1, true)`, [requestId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Privileged, RLS-bypassing connection for operator batch jobs that have no
   * authenticated user -- currently only the employee CSV import.
   *
   * Guarded three ways: the URL is optional and absent from the API
   * container's environment, the pool is created lazily on first use, and this
   * method throws if unconfigured. It must never be called from a request path.
   */
  async withAdminContext<T>(
    requestId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!config.ADMIN_DATABASE_URL) {
      throw new Error(
        'ADMIN_DATABASE_URL is not configured. Privileged batch operations are ' +
          'only available from the operator CLI, not the running API.',
      );
    }
    this.adminPool ??= new Pool({
      connectionString: config.ADMIN_DATABASE_URL,
      max: 2,
      application_name: 'hr-admin-cli',
    });

    const client = await this.adminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.request_id', $1, true)`, [requestId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 AS ok');
      return res.rows[0]?.ok === 1;
    } catch (err) {
      logger.error({ err }, 'health check failed');
      return false;
    }
  }
}
