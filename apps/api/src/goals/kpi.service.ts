import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, RequestContext } from '../db/db.service';
import type { CreateGoalPeriod, CreateKpiDefinition } from './dto';

/**
 * The KPI definition library and goal period lifecycle.
 *
 * Versioning rule (architecture.md principle 1): a published definition is
 * never edited. Changing a KPI creates a new version and retires the old one,
 * so goals authored against v1 keep meaning what they meant.
 */
@Injectable()
export class KpiService {
  constructor(private readonly db: DbService) {}

  async listDefinitions(ctx: RequestContext, includeRetired = false) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT id, code, version, name, description, category,
                measure_type::text   AS "measureType",
                direction::text      AS direction,
                unit,
                default_weight::text AS "defaultWeight",
                is_active            AS "isActive",
                published_at::text   AS "publishedAt"
           FROM kpi_definition
          WHERE ($1::boolean OR is_active)
          ORDER BY code, version DESC`,
        [includeRetired],
      );
      return res.rows;
    });
  }

  async createDefinition(ctx: RequestContext, input: CreateKpiDefinition) {
    return this.db.withContext(ctx, async (client) => {
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Requesting employee not found');

      const res = await client.query<{ id: string }>(
        `INSERT INTO kpi_definition (org_id, code, version, name, description,
                                     category, measure_type, direction, unit,
                                     default_weight, published_at)
              VALUES ($1,$2,1,$3,$4,$5,$6::kpi_measure_type,$7::kpi_direction,$8,$9,now())
           RETURNING id`,
        [orgId, input.code, input.name, input.description ?? null,
         input.category ?? null, input.measureType, input.direction,
         input.unit ?? null, input.defaultWeight ?? null],
      ).catch((err: { code?: string }) => {
        if (err.code === '23505') {
          throw new BadRequestException(
            `A KPI with code '${input.code}' already exists. Publish a new ` +
            `version instead of creating a duplicate.`);
        }
        throw err;
      });

      return { id: res.rows[0]?.id };
    });
  }

  /**
   * Publish a new version of an existing KPI.
   *
   * Retires the current version and creates the successor in one transaction --
   * the partial unique index permits only one active version per code, so a
   * non-atomic version of this would either collide or leave the KPI with no
   * active version at all.
   */
  async publishNewVersion(
    ctx: RequestContext, code: string, input: CreateKpiDefinition,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const current = await client.query<{
        id: string; org_id: string; version: number;
      }>(
        `SELECT id, org_id, version FROM kpi_definition
          WHERE code = $1 AND is_active`, [code]);
      const existing = current.rows[0];
      if (!existing) throw new NotFoundException(`No active KPI with code '${code}'`);

      const retired = await client.query(
        'UPDATE kpi_definition SET is_active = FALSE WHERE id = $1 RETURNING id',
        [existing.id]);
      if (!retired.rows[0]) {
        throw new BadRequestException('Not permitted to modify the KPI library');
      }

      const res = await client.query<{ id: string; version: number }>(
        `INSERT INTO kpi_definition (org_id, code, version, name, description,
                                     category, measure_type, direction, unit,
                                     default_weight, supersedes_id, published_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7::kpi_measure_type,$8::kpi_direction,
                      $9,$10,$11,now())
           RETURNING id, version`,
        [existing.org_id, code, existing.version + 1, input.name,
         input.description ?? null, input.category ?? null, input.measureType,
         input.direction, input.unit ?? null, input.defaultWeight ?? null,
         existing.id],
      );
      return res.rows[0];
    });
  }

  async listPeriods(ctx: RequestContext) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT id, name, period_type::text AS "periodType",
                starts_on::text AS "startsOn", ends_on::text AS "endsOn",
                state::text AS state,
                locked_at::text AS "lockedAt", closed_at::text AS "closedAt"
           FROM goal_period ORDER BY starts_on DESC`);
      return res.rows;
    });
  }

  async createPeriod(ctx: RequestContext, input: CreateGoalPeriod) {
    return this.db.withContext(ctx, async (client) => {
      const org = await client.query<{ org_id: string }>(
        'SELECT org_id FROM employee WHERE id = $1', [ctx.employeeId]);
      const orgId = org.rows[0]?.org_id;
      if (!orgId) throw new NotFoundException('Requesting employee not found');

      const res = await client.query<{ id: string }>(
        `INSERT INTO goal_period (org_id, name, period_type, starts_on, ends_on)
              VALUES ($1,$2,$3::goal_period_type,$4,$5) RETURNING id`,
        [orgId, input.name, input.periodType, input.startsOn, input.endsOn],
      );
      if (!res.rows[0]) throw new BadRequestException('Not permitted to create periods');
      return res.rows[0];
    });
  }

  /**
   * Advance the period state. Locking runs the weight-sum check in the
   * database (migration 0008); a failure returns the offending employees so HR
   * can act rather than being told only that it failed.
   */
  async setPeriodState(
    ctx: RequestContext, periodId: string, state: 'open' | 'locked' | 'closed',
  ) {
    return this.db.withContext(ctx, async (client) => {
      try {
        const res = await client.query<{ id: string; state: string }>(
          `UPDATE goal_period SET state = $2::goal_period_state
            WHERE id = $1 RETURNING id, state::text AS state`,
          [periodId, state]);
        if (!res.rows[0]) throw new NotFoundException('Goal period not found');
        return res.rows[0];
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (e.code === 'P0001' || e.code === '23514') {
          const violations = await client.query(
            `SELECT e.employee_no AS "employeeNo",
                    e.first_name || ' ' || e.last_name AS "employeeName",
                    v.total_weight::text AS "totalWeight"
               FROM app.goal_weight_violations($1) v
               JOIN employee e ON e.id = v.employee_id`,
            [periodId]);
          throw new BadRequestException({
            message: e.message ?? 'Cannot change period state',
            weightViolations: violations.rows,
          });
        }
        throw err;
      }
    });
  }

  async weightViolations(ctx: RequestContext, periodId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT e.employee_no AS "employeeNo",
                e.first_name || ' ' || e.last_name AS "employeeName",
                v.total_weight::text AS "totalWeight",
                v.goal_count::int AS "goalCount"
           FROM app.goal_weight_violations($1) v
           JOIN employee e ON e.id = v.employee_id
          ORDER BY e.last_name`,
        [periodId]);
      return res.rows;
    });
  }
}
