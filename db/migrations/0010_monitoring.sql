-- 0010_monitoring.sql
-- Phase 2, part 1: check-in cadence, overdue tracking, trend, and escalation.
--
-- Phase 1 recorded check-ins. This makes the ABSENCE of one visible, which is
-- the half that actually drives behaviour -- an unmonitored KPI is indistinct
-- from no KPI at all.

BEGIN;

CREATE TYPE checkin_cadence AS ENUM
  ('none', 'weekly', 'biweekly', 'monthly', 'quarterly');

-- Default cadence for the period; individual goals may override.
ALTER TABLE goal_period
  ADD COLUMN checkin_cadence checkin_cadence NOT NULL DEFAULT 'monthly';

ALTER TABLE goal
  ADD COLUMN checkin_cadence checkin_cadence;

COMMENT ON COLUMN goal.checkin_cadence IS
  'Overrides the period cadence for this goal. NULL means inherit.';

CREATE FUNCTION app.cadence_days(c checkin_cadence) RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE c
    WHEN 'weekly' THEN 7
    WHEN 'biweekly' THEN 14
    WHEN 'monthly' THEN 30
    WHEN 'quarterly' THEN 91
    ELSE NULL
  END;
$$;

-- ---------------------------------------------------------------------------
-- Check-in status per goal
-- ---------------------------------------------------------------------------
-- A view rather than a materialised column: "overdue" is a function of today's
-- date, so storing it would be stale the moment it was written and would need
-- a nightly job to stay honest.
--
-- Security note: views run with the PRIVILEGES OF THEIR OWNER by default,
-- which would bypass RLS on the underlying tables. `security_invoker = true`
-- makes the view run as the CALLER, so goal RLS still applies. Without it this
-- view would leak every goal in the organization to anyone who selected it.

CREATE VIEW goal_checkin_status
WITH (security_invoker = true) AS
SELECT g.id                            AS goal_id,
       g.employee_id,
       g.goal_period_id,
       g.title,
       g.state,
       COALESCE(g.checkin_cadence, p.checkin_cadence) AS cadence,
       app.cadence_days(COALESCE(g.checkin_cadence, p.checkin_cadence)) AS cadence_days,
       last.period_ending               AS last_checkin_on,
       last.status_flag                 AS last_status,
       -- Never-checked-in goals count from creation, so a goal that is ignored
       -- from day one still becomes overdue.
       (CURRENT_DATE - COALESCE(last.period_ending, g.created_at::date))::int
                                        AS days_since_checkin,
       CASE
         WHEN g.state <> 'active' THEN FALSE
         WHEN app.cadence_days(COALESCE(g.checkin_cadence, p.checkin_cadence)) IS NULL
           THEN FALSE
         ELSE (CURRENT_DATE - COALESCE(last.period_ending, g.created_at::date))
              > app.cadence_days(COALESCE(g.checkin_cadence, p.checkin_cadence))
       END                              AS is_overdue,
       CASE
         WHEN app.cadence_days(COALESCE(g.checkin_cadence, p.checkin_cadence)) IS NULL
           THEN NULL
         ELSE COALESCE(last.period_ending, g.created_at::date)
              + app.cadence_days(COALESCE(g.checkin_cadence, p.checkin_cadence))
       END                              AS next_checkin_due
  FROM goal g
  JOIN goal_period p ON p.id = g.goal_period_id
  LEFT JOIN LATERAL (
    SELECT c.period_ending, c.status_flag
      FROM goal_checkin c
     WHERE c.goal_id = g.id
     ORDER BY c.period_ending DESC, c.created_at DESC
     LIMIT 1
  ) last ON TRUE;

GRANT SELECT ON goal_checkin_status TO hr_app;

-- ---------------------------------------------------------------------------
-- Escalation
-- ---------------------------------------------------------------------------
-- Two or more consecutive non-on_track check-ins is the signal. A single bad
-- week is noise; a trend is a conversation -- and often the trigger for a PIP.

CREATE FUNCTION app.goal_escalations(p_goal_period_id UUID)
RETURNS TABLE (
  goal_id UUID,
  employee_id UUID,
  title TEXT,
  consecutive_bad INTEGER,
  worst_status checkin_status,
  last_checkin_on DATE
)
LANGUAGE sql STABLE AS $$
  WITH ranked AS (
    SELECT c.goal_id, c.status_flag, c.period_ending,
           ROW_NUMBER() OVER (PARTITION BY c.goal_id
                              ORDER BY c.period_ending DESC, c.created_at DESC) AS rn
      FROM goal_checkin c
      JOIN goal g ON g.id = c.goal_id
     WHERE g.goal_period_id = p_goal_period_id
       AND g.state = 'active'
  ),
  -- Length of the unbroken run of non-on_track check-ins at the head of the
  -- history: the position of the most recent on_track, minus one.
  streak AS (
    SELECT r.goal_id,
           COALESCE(MIN(r.rn) FILTER (WHERE r.status_flag = 'on_track'),
                    MAX(r.rn) + 1) - 1 AS consecutive_bad
      FROM ranked r
     GROUP BY r.goal_id
  )
  SELECT g.id, g.employee_id, g.title,
         s.consecutive_bad::int,
         (SELECT r.status_flag FROM ranked r
           WHERE r.goal_id = g.id ORDER BY r.rn LIMIT 1),
         (SELECT r.period_ending FROM ranked r
           WHERE r.goal_id = g.id ORDER BY r.rn LIMIT 1)
    FROM streak s
    JOIN goal g ON g.id = s.goal_id
   WHERE s.consecutive_bad >= 2
   ORDER BY s.consecutive_bad DESC;
$$;

COMMENT ON FUNCTION app.goal_escalations IS
  'Goals with 2+ consecutive at_risk/off_track check-ins. NOT security definer '
  '-- it reads goal_checkin under the caller''s RLS, so results are already '
  'scoped to what the caller may see.';

COMMIT;
