-- 0025_analytics.sql
-- Phase 7: cross-cycle analytics — distribution, calibration movement, rater
-- comparison, nine-box, and trend.
--
-- Every function here is deliberately NOT security definer. They read through
-- the caller's RLS, so a manager's "distribution" covers their subtree and HR's
-- covers the organisation, from the same SQL. That also means aggregates cannot
-- leak: a row you may not read simply is not in the aggregate.
--
-- Compensation remains out of scope (D-007).

BEGIN;

-- ---------------------------------------------------------------------------
-- Potential — the missing nine-box axis
-- ---------------------------------------------------------------------------
-- Performance is already recorded (review rating, goal attainment). Potential
-- is a separate judgement made during calibration, and without it a "nine-box"
-- is really just a ranked list. Kept deliberately coarse: three bands. A finer
-- scale invites false precision about something nobody can measure.

ALTER TABLE review_summary
  ADD COLUMN potential_rating SMALLINT
    CHECK (potential_rating IS NULL OR potential_rating BETWEEN 1 AND 3),
  ADD COLUMN potential_notes TEXT;

COMMENT ON COLUMN review_summary.potential_rating IS
  'Calibration judgement: 1 = well placed, 2 = growth, 3 = high potential. '
  'Nine-box needs an axis that performance data cannot supply.';

-- Potential is set during calibration and frozen at sign-off, exactly like the
-- ratings beside it. Extends the existing signoff guard rather than adding a
-- second, separately-drifting one.
CREATE OR REPLACE FUNCTION app.review_summary_signoff() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_off_at IS NOT NULL THEN
    IF NEW.overall_rating IS DISTINCT FROM OLD.overall_rating
       OR NEW.calibrated_rating IS DISTINCT FROM OLD.calibrated_rating
       OR NEW.goal_attainment_pct IS DISTINCT FROM OLD.goal_attainment_pct
       OR NEW.potential_rating IS DISTINCT FROM OLD.potential_rating THEN
      RAISE EXCEPTION 'This review has been signed off and its ratings are final'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.signed_off_at IS NOT NULL AND NEW.released_at IS NULL THEN
    NEW.released_at := NEW.signed_off_at;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Rating scale range for a cycle
-- ---------------------------------------------------------------------------
-- Bands have to be expressed against the scale actually in use, not a hardcoded
-- 1-5. A cycle can run several forms, so take the widest range across them.

CREATE FUNCTION app.cycle_rating_range(p_cycle_id UUID)
RETURNS TABLE (min_value NUMERIC, max_value NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT MIN(p.value), MAX(p.value)
    FROM review_instance ri
    JOIN form_version fv ON fv.id = ri.form_version_id
    JOIN rating_scale_point p ON p.rating_scale_id = fv.rating_scale_id
   WHERE ri.review_cycle_id = p_cycle_id;
$$;

-- ---------------------------------------------------------------------------
-- Distribution
-- ---------------------------------------------------------------------------

/*
 * How ratings are spread for a cycle. The number HR actually acts on is not the
 * average — it is the shape. A department where 90% score "exceeds" is not a
 * high-performing department, it is an uncalibrated one.
 */
CREATE FUNCTION app.rating_distribution(p_cycle_id UUID)
RETURNS TABLE (
  department TEXT,
  rating NUMERIC,
  employee_count BIGINT,
  pct_of_group NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH scored AS (
    SELECT COALESCE(d.name, '(no department)') AS department,
           COALESCE(s.calibrated_rating, s.overall_rating) AS rating
      FROM review_summary s
      JOIN employee e ON e.id = s.subject_employee_id
      LEFT JOIN employment em
        ON em.employee_id = e.id AND em.effective_to IS NULL
      LEFT JOIN department d ON d.id = em.department_id
     WHERE s.review_cycle_id = p_cycle_id
       AND COALESCE(s.calibrated_rating, s.overall_rating) IS NOT NULL
  )
  SELECT department, rating, COUNT(*),
         ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY department), 1)
    FROM scored
   GROUP BY department, rating
   ORDER BY department, rating;
$$;

/*
 * What calibration actually changed.
 *
 * Worth its own view because the interesting number is movement, not the final
 * distribution: if calibration moved nobody, it was a meeting rather than a
 * moderation.
 */
CREATE FUNCTION app.calibration_movement(p_cycle_id UUID)
RETURNS TABLE (
  subject_employee_id UUID,
  employee_name TEXT,
  department TEXT,
  original_rating NUMERIC,
  calibrated_rating NUMERIC,
  movement NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT s.subject_employee_id,
         app.display_name(s.subject_employee_id),
         COALESCE(d.name, '(no department)'),
         s.overall_rating,
         s.calibrated_rating,
         s.calibrated_rating - s.overall_rating
    FROM review_summary s
    LEFT JOIN employment em
      ON em.employee_id = s.subject_employee_id AND em.effective_to IS NULL
    LEFT JOIN department d ON d.id = em.department_id
   WHERE s.review_cycle_id = p_cycle_id
     AND s.calibrated_rating IS NOT NULL
     AND s.overall_rating IS NOT NULL
     AND s.calibrated_rating <> s.overall_rating
   ORDER BY abs(s.calibrated_rating - s.overall_rating) DESC;
$$;

/*
 * Per-reviewer averages against the group average.
 *
 * The most actionable analytic in the set: it surfaces the manager who rates
 * everyone "outstanding" and the one who rates nobody above "meets". Both
 * distort the record, and neither is visible from an individual review.
 *
 * Deliberately reports the count alongside, because an average over two people
 * is not evidence of anything.
 */
CREATE FUNCTION app.rater_comparison(p_cycle_id UUID)
RETURNS TABLE (
  reviewer_employee_id UUID,
  reviewer_name TEXT,
  reviews_submitted BIGINT,
  average_rating NUMERIC,
  group_average NUMERIC,
  deviation NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH submitted AS (
    SELECT ri.reviewer_employee_id, ri.overall_rating
      FROM review_instance ri
     WHERE ri.review_cycle_id = p_cycle_id
       AND ri.reviewer_role = 'supervisor'
       AND ri.state = 'submitted'
       AND ri.overall_rating IS NOT NULL
  ),
  overall AS (SELECT AVG(overall_rating) AS avg_all FROM submitted)
  SELECT s.reviewer_employee_id,
         app.display_name(s.reviewer_employee_id),
         COUNT(*),
         ROUND(AVG(s.overall_rating), 2),
         ROUND((SELECT avg_all FROM overall), 2),
         ROUND(AVG(s.overall_rating) - (SELECT avg_all FROM overall), 2)
    FROM submitted s
   GROUP BY s.reviewer_employee_id
   ORDER BY abs(AVG(s.overall_rating) - (SELECT avg_all FROM overall)) DESC;
$$;

-- ---------------------------------------------------------------------------
-- Nine-box
-- ---------------------------------------------------------------------------

/*
 * Performance × potential, three bands each.
 *
 * Performance bands come from the cycle's OWN rating scale, so a 1-4 scale and a
 * 1-6 scale both band correctly. Potential is the explicit calibration
 * judgement, never inferred from performance — inferring it would make the grid
 * a diagonal line and tell you nothing you did not already know.
 *
 * Employees with no potential rating are returned with a NULL box rather than
 * dropped, so the gap is visible instead of quietly shrinking the population.
 */
CREATE FUNCTION app.nine_box(p_cycle_id UUID)
RETURNS TABLE (
  subject_employee_id UUID,
  employee_name TEXT,
  department TEXT,
  rating NUMERIC,
  performance_band SMALLINT,
  potential_band SMALLINT
)
LANGUAGE sql STABLE AS $$
  WITH range AS (SELECT * FROM app.cycle_rating_range(p_cycle_id)),
  scored AS (
    SELECT s.subject_employee_id,
           COALESCE(d.name, '(no department)') AS department,
           COALESCE(s.calibrated_rating, s.overall_rating) AS rating,
           s.potential_rating
      FROM review_summary s
      LEFT JOIN employment em
        ON em.employee_id = s.subject_employee_id AND em.effective_to IS NULL
      LEFT JOIN department d ON d.id = em.department_id
     WHERE s.review_cycle_id = p_cycle_id
  )
  SELECT sc.subject_employee_id,
         app.display_name(sc.subject_employee_id),
         sc.department,
         sc.rating,
         CASE
           WHEN sc.rating IS NULL THEN NULL
           WHEN r.max_value = r.min_value THEN 2::smallint
           WHEN sc.rating <= r.min_value + (r.max_value - r.min_value) / 3.0
             THEN 1::smallint
           WHEN sc.rating <= r.min_value + 2 * (r.max_value - r.min_value) / 3.0
             THEN 2::smallint
           ELSE 3::smallint
         END,
         sc.potential_rating
    FROM scored sc CROSS JOIN range r
   ORDER BY sc.department, sc.rating DESC NULLS LAST;
$$;

-- ---------------------------------------------------------------------------
-- Trend
-- ---------------------------------------------------------------------------

/*
 * One row per cycle for an employee: rating and goal attainment over time.
 * The point of keeping every definition versioned is that this comparison is
 * honest across years.
 */
CREATE FUNCTION app.performance_trend(p_employee_id UUID)
RETURNS TABLE (
  review_cycle_id UUID,
  cycle_name TEXT,
  opens_on DATE,
  rating NUMERIC,
  goal_attainment_pct NUMERIC,
  potential_rating SMALLINT
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.name, c.opens_on,
         COALESCE(s.calibrated_rating, s.overall_rating),
         s.goal_attainment_pct,
         s.potential_rating
    FROM review_summary s
    JOIN review_cycle c ON c.id = s.review_cycle_id
   WHERE s.subject_employee_id = p_employee_id
   ORDER BY c.opens_on;
$$;

/*
 * Cycle completion funnel — what is actually blocking a close.
 */
CREATE FUNCTION app.cycle_progress(p_cycle_id UUID)
RETURNS TABLE (
  subjects BIGINT,
  instances BIGINT,
  submitted BIGINT,
  returned BIGINT,
  calibrated BIGINT,
  signed_off BIGINT,
  acknowledged BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    (SELECT COUNT(*) FROM review_summary s WHERE s.review_cycle_id = p_cycle_id),
    (SELECT COUNT(*) FROM review_instance ri WHERE ri.review_cycle_id = p_cycle_id),
    (SELECT COUNT(*) FROM review_instance ri
      WHERE ri.review_cycle_id = p_cycle_id AND ri.state = 'submitted'),
    (SELECT COUNT(*) FROM review_instance ri
      WHERE ri.review_cycle_id = p_cycle_id AND ri.state = 'returned'),
    (SELECT COUNT(*) FROM review_summary s
      WHERE s.review_cycle_id = p_cycle_id AND s.calibrated_rating IS NOT NULL),
    (SELECT COUNT(*) FROM review_summary s
      WHERE s.review_cycle_id = p_cycle_id AND s.signed_off_at IS NOT NULL),
    (SELECT COUNT(*) FROM review_summary s
      WHERE s.review_cycle_id = p_cycle_id AND s.employee_acknowledged_at IS NOT NULL);
$$;

COMMIT;
