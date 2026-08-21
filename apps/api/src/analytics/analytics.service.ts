import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DbService, RequestContext } from '../db/db.service';

export const setPotential = z.object({
  potentialRating: z.number().int().min(1).max(3),
  potentialNotes: z.string().trim().max(2000).optional(),
});

/**
 * Cross-cycle analytics.
 *
 * Every query runs under the caller's RLS, which is what makes one set of SQL
 * serve a manager (their subtree) and HR (the organisation) without a branch —
 * and means an aggregate can never include a row the caller may not read.
 *
 * Compensation analytics are deliberately absent (D-007).
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DbService) {}

  /** Rating spread per department. The shape matters more than the average. */
  async distribution(ctx: RequestContext, cycleId: string) {
    return this.db.withContext(ctx, async (client) => {
      const rows = await client.query(
        `SELECT department,
                rating::float8      AS rating,
                employee_count::int AS "employeeCount",
                pct_of_group::float8 AS "pctOfGroup"
           FROM app.rating_distribution($1)`, [cycleId]);

      const range = await client.query<{ min_value: string; max_value: string }>(
        'SELECT * FROM app.cycle_rating_range($1)', [cycleId]);

      return {
        scale: {
          min: range.rows[0]?.min_value ? Number(range.rows[0].min_value) : null,
          max: range.rows[0]?.max_value ? Number(range.rows[0].max_value) : null,
        },
        rows: rows.rows,
      };
    });
  }

  /**
   * What calibration moved. If this comes back empty, calibration was a meeting
   * rather than a moderation — which is worth knowing.
   */
  async calibrationMovement(ctx: RequestContext, cycleId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT subject_employee_id AS "subjectEmployeeId",
                employee_name       AS "employeeName",
                department,
                original_rating::float8   AS "originalRating",
                calibrated_rating::float8 AS "calibratedRating",
                movement::float8          AS movement
           FROM app.calibration_movement($1)`, [cycleId]);
      return res.rows;
    });
  }

  /** Per-reviewer averages against the group. Surfaces rater bias. */
  async raterComparison(ctx: RequestContext, cycleId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT reviewer_employee_id AS "reviewerEmployeeId",
                reviewer_name        AS "reviewerName",
                reviews_submitted::int AS "reviewsSubmitted",
                average_rating::float8 AS "averageRating",
                group_average::float8  AS "groupAverage",
                deviation::float8      AS deviation
           FROM app.rater_comparison($1)`, [cycleId]);
      return res.rows;
    });
  }

  /**
   * Nine-box. Returns the raw placements plus a 3×3 tally, because the grid is
   * the whole point and computing it client-side invites two implementations.
   */
  async nineBox(ctx: RequestContext, cycleId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{
        subjectEmployeeId: string; employeeName: string; department: string;
        rating: number | null; performanceBand: number | null;
        potentialBand: number | null;
      }>(
        `SELECT subject_employee_id AS "subjectEmployeeId",
                employee_name       AS "employeeName",
                department,
                rating::float8      AS rating,
                performance_band    AS "performanceBand",
                potential_band      AS "potentialBand"
           FROM app.nine_box($1)`, [cycleId]);

      // Employees missing either axis are counted separately rather than
      // dropped: a shrinking population is how a grid quietly lies.
      const placed = res.rows.filter(
        (r) => r.performanceBand !== null && r.potentialBand !== null);
      const grid: Record<string, typeof placed> = {};
      for (const r of placed) {
        const key = `${r.performanceBand}-${r.potentialBand}`;
        (grid[key] ??= []).push(r);
      }

      return {
        employees: res.rows,
        grid,
        unplaced: {
          noRating: res.rows.filter((r) => r.performanceBand === null).length,
          noPotential: res.rows.filter(
            (r) => r.performanceBand !== null && r.potentialBand === null).length,
        },
      };
    });
  }

  async trend(ctx: RequestContext, employeeId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT review_cycle_id AS "reviewCycleId",
                cycle_name      AS "cycleName",
                opens_on::text  AS "opensOn",
                rating::float8  AS rating,
                goal_attainment_pct::float8 AS "goalAttainmentPct",
                potential_rating AS "potentialRating"
           FROM app.performance_trend($1)`, [employeeId]);
      return res.rows;
    });
  }

  /** Completion funnel — what is actually blocking a cycle close. */
  async progress(ctx: RequestContext, cycleId: string) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query(
        `SELECT subjects::int, instances::int, submitted::int, returned::int,
                calibrated::int, signed_off::int AS "signedOff",
                acknowledged::int
           FROM app.cycle_progress($1)`, [cycleId]);
      return res.rows[0];
    });
  }

  /**
   * Records the potential judgement made during calibration.
   *
   * Deliberately a separate call from `calibrate`: potential is a different
   * conversation from performance, and bundling them encourages deriving one
   * from the other — which would make the nine-box a diagonal line.
   */
  async setPotential(
    ctx: RequestContext, summaryId: string, input: z.infer<typeof setPotential>,
  ) {
    return this.db.withContext(ctx, async (client) => {
      const res = await client.query<{ id: string }>(
        `UPDATE review_summary
            SET potential_rating = $2,
                potential_notes = COALESCE($3, potential_notes)
          WHERE id = $1 RETURNING id`,
        [summaryId, input.potentialRating, input.potentialNotes ?? null],
      ).catch((err: { code?: string; message?: string }) => {
        if (err.code === 'P0001' || err.code === '23514') {
          throw new BadRequestException(err.message ?? 'Not allowed');
        }
        throw err;
      });
      if (!res.rows[0]) throw new NotFoundException('Review summary not found');
      return { id: summaryId };
    });
  }
}
