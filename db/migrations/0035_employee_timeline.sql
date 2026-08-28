-- 0035_employee_timeline.sql
-- F1: one employee's record, in one place, in date order (requirements §7.1).
--
-- The client asks for "employee history: evaluation results and actions taken".
-- Every piece of it already exists -- reviews, task evaluations, PIPs,
-- competency assessments, and the employment events A4 added -- scattered
-- across five tables and four screens. Nobody preparing for a promotion panel
-- opens four screens; they ask what has happened to this person, and the answer
-- has to be one list.
--
-- TWO DECISIONS WORTH STATING.
--
-- 1. SECURITY INVOKER, deliberately.
--
--    Every source below is already protected: a draft task evaluation is
--    invisible to its subject (0033), an unreleased review is invisible until
--    sign-off (0014), a PIP is visible to the person on it and their line. This
--    function re-implements none of that. It runs as the caller and each source
--    filters itself, so the timeline cannot show what the underlying screen
--    would not -- and cannot drift from those rules when they change.
--
--    A SECURITY DEFINER function that "just joins the history" is exactly how a
--    consolidated view becomes the one place confidential assessment leaks.
--
-- 2. EVENTS SIT AT THE PERIOD THEY DESCRIBE, not the date the paperwork moved.
--
--    A Q1 evaluation signed in May belongs at the end of Q1: the reader is
--    asking what this person's Q1 was, not when somebody got round to it. The
--    administrative timestamps stay available on the row for anyone who needs
--    them.

BEGIN;

CREATE TYPE timeline_kind AS ENUM (
  'review',
  'task_evaluation',
  'pip',
  'competency',
  'employment_event'
);

/*
 * Formats a score for display.
 *
 * to_char with FM strips trailing zeros but leaves the decimal point behind, so
 * 32.00 renders as "32." -- which looks like a truncation bug on screen. Trim
 * the zeros, then the point.
 */
CREATE FUNCTION app.trim_score(v NUMERIC) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v IS NULL THEN NULL
              ELSE rtrim(rtrim(to_char(v, 'FM9999990.00'), '0'), '.') END;
$$;

/*
 * One employee's history.
 *
 * `result` is text on purpose. A review's 4.2 out of 5, a task evaluation's
 * 32/37 and a PIP's "met" are not one scale and must not be made to look like
 * one; the caller renders what it is given. `sort_at` breaks ties within a day
 * so a hire and its first evaluation do not shuffle between page loads.
 */
CREATE FUNCTION app.employee_timeline(
  p_employee UUID,
  p_from     DATE DEFAULT NULL,
  p_to       DATE DEFAULT NULL
) RETURNS TABLE (
  occurred_on  DATE,
  kind         timeline_kind,
  title        TEXT,
  detail       TEXT,
  result       TEXT,
  ref_id       UUID,
  sort_at      TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  WITH events AS (
    -- Reviews. review_summary carries the outcome; its RLS keeps an unreleased
    -- one away from the subject, which is the behaviour this must inherit
    -- rather than restate.
    SELECT c.closes_on AS occurred_on,
           'review'::timeline_kind AS kind,
           c.name AS title,
           CASE WHEN s.signed_off_at IS NOT NULL THEN 'Signed off'
                WHEN s.released_at IS NOT NULL THEN 'Released'
                ELSE 'In progress' END AS detail,
           app.trim_score(COALESCE(s.calibrated_rating, s.overall_rating)) AS result,
           s.id AS ref_id,
           COALESCE(s.signed_off_at, s.released_at, s.created_at) AS sort_at
      FROM review_summary s
      JOIN review_cycle c ON c.id = s.review_cycle_id
     WHERE s.subject_employee_id = p_employee

    UNION ALL

    -- Task evaluations (T2). A draft is invisible to the subject; that is
    -- scorecard_evaluation's own policy doing the work.
    SELECT e.period_end,
           'task_evaluation'::timeline_kind,
           sc.name,
           CASE e.state
                WHEN 'draft' THEN 'Draft'
                WHEN 'submitted' THEN 'Submitted'
                ELSE 'Acknowledged' END,
           CASE WHEN e.awarded_points IS NULL THEN NULL
                ELSE app.trim_score(e.awarded_points) || ' / '
                     || app.trim_score(e.target_points) END,
           e.id,
           COALESCE(e.submitted_at, e.created_at)
      FROM scorecard_evaluation e
      JOIN scorecard sc ON sc.id = e.scorecard_id
     WHERE e.employee_id = p_employee

    UNION ALL

    -- Performance Improvement Plans. Dated at the START: a PIP is an action
    -- taken on a date, and its outcome is carried in the same row rather than
    -- split into a second event nobody would connect to the first.
    SELECT p.starts_on,
           'pip'::timeline_kind,
           'Performance Improvement Plan',
           CASE WHEN p.closed_at IS NOT NULL
                THEN 'Closed ' || p.ends_on::text
                ELSE 'Open until ' || p.ends_on::text END,
           NULLIF(p.outcome::text, ''),
           p.id,
           p.created_at
      FROM pip_plan p
     WHERE p.employee_id = p_employee

    UNION ALL

    -- Competency assessments, one row per assessment, named by the competency.
    SELECT a.assessed_on,
           'competency'::timeline_kind,
           comp.name,
           'Assessed by ' || app.display_name(a.assessed_by),
           'Level ' || a.assessed_level::text,
           a.id,
           a.created_at
      FROM competency_assessment a
      JOIN competency comp ON comp.id = a.competency_id
     WHERE a.subject_employee_id = p_employee

    UNION ALL

    -- What actually happened to them: hired, regularised, promoted, moved
    -- (0029). These are the "actions taken" half of the client's sentence, and
    -- the reason a reader can see that a promotion followed two strong reviews.
    SELECT em.effective_from,
           'employment_event'::timeline_kind,
           initcap(replace(em.event_type::text, '_', ' ')),
           COALESCE(pos.title, 'Position not recorded')
             || COALESCE(' — ' || d.name, ''),
           NULLIF(em.change_reason, ''),
           em.id,
           em.created_at
      FROM employment em
      LEFT JOIN position pos ON pos.id = em.position_id
      LEFT JOIN department d ON d.id = em.department_id
     WHERE em.employee_id = p_employee
  )
  SELECT occurred_on, kind, title, detail, result, ref_id, sort_at
    FROM events
   WHERE (p_from IS NULL OR occurred_on >= p_from)
     AND (p_to IS NULL OR occurred_on <= p_to)
   ORDER BY occurred_on DESC, sort_at DESC;
$$;

COMMENT ON FUNCTION app.employee_timeline IS
  'One employee''s history across reviews, task evaluations, PIPs, competency '
  'assessments and employment events. SECURITY INVOKER: every source filters '
  'itself under the caller''s identity, so the timeline can never show what the '
  'underlying screen would not.';

COMMIT;
