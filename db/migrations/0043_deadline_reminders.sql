-- 0043_deadline_reminders.sql
-- F5b: the reminders half of §7.8 — messages nobody's click triggers.
--
-- Every one of the seventeen events F5 wired fires because a PERSON did
-- something. Nothing fires because a date arrived, and "reminders" is the first
-- word in their §7.8. The gap is not templates, it is that nothing is watching.
--
-- WHAT IS WATCHED, AND WHY THESE FOUR.
--
-- Each is a place where work stalls INVISIBLY — where nobody is waiting on a
-- screen that shows the problem:
--
--   * a review not submitted as its cycle closes, and after it has closed;
--   * a goal whose check-in cadence has lapsed (the template for this has been
--     seeded since 0021 with nothing ever emitting it);
--   * a peer invitation nobody has answered, which quietly holds up a panel;
--   * a task evaluation left in draft after its period ended, which the subject
--     cannot see and therefore cannot chase.
--
-- IDEMPOTENCE IS THE WHOLE PROBLEM.
--
-- A scan that runs hourly must not send hourly. Every reminder here dedupes on
-- the MILESTONE it is about, not on the day it was noticed: "your review closes
-- in 7 days" carries the instance and the threshold, so it sends once however
-- often the scan runs. An overdue check-in dedupes on how many whole cadence
-- periods have been missed, so a second missed week sends a second nudge and a
-- hundred scans in that week send none.
--
-- Getting this wrong does not look like a bug. It looks like the system working
-- and people ignoring it, which is worse, because the fix is then invisible too.

BEGIN;

CREATE FUNCTION app.seed_reminder_templates(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_template (
    org_id, code, version, description, subject, body_text, is_active, published_at)
  VALUES
    (p_org_id, 'review.due_soon', 1,
     'A review is unsubmitted and its cycle closes shortly',
     'Review due in {{daysLeft}} days: {{subjectName}}',
     E'Hello,\n\n'
     'Your review of {{subjectName}} for {{cycleName}} has not been submitted, '
     'and the cycle closes on {{closesOn}} — {{daysLeft}} days from now.\n\n'
     '-- This is an automated message.',
     TRUE, now()),

    (p_org_id, 'review.overdue', 1,
     'A review is unsubmitted and its cycle has closed',
     'Overdue review: {{subjectName}}',
     E'Hello,\n\n'
     'Your review of {{subjectName}} for {{cycleName}} is still unsubmitted. '
     'The cycle closed on {{closesOn}}.\n\n'
     'Nobody''s review can be signed off until every reviewer has submitted, so '
     'this one is holding up {{subjectName}}''s result.\n\n'
     '-- This is an automated message.',
     TRUE, now()),

    (p_org_id, 'peer.invitation_pending', 1,
     'A peer invitation has gone unanswered',
     'Still waiting: can you review {{subjectName}}?',
     E'Hello,\n\n'
     'You were asked {{daysWaiting}} days ago whether you could take part in a '
     'peer review of {{subjectName}}, and the panel is waiting on an answer.\n\n'
     'Declining is genuinely fine — if you have not worked with them in the '
     'last six months, saying so lets somebody else be asked.\n\n'
     '-- This is an automated message.',
     TRUE, now()),

    (p_org_id, 'evaluation.overdue', 1,
     'A task evaluation is still in draft after its period ended',
     'Unfinished evaluation: {{subjectName}}',
     E'Hello,\n\n'
     'The evaluation of {{subjectName}} for {{periodStart}} to {{periodEnd}} is '
     'still a draft, {{daysLate}} days after the period ended.\n\n'
     'They cannot see it, or their score, until it is submitted.\n\n'
     '-- This is an automated message.',
     TRUE, now())
  ON CONFLICT (org_id, code, version) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_reminder_templates(r.id);
  END LOOP;
END $do$;

/*
 * Whole cadence periods between two dates. Used to bucket an overdue check-in
 * so a second missed week sends a second nudge and nothing else does.
 */
CREATE FUNCTION app.cadence_periods_elapsed(
  p_cadence checkin_cadence, p_since DATE, p_as_of DATE
) RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_cadence
    WHEN 'weekly'    THEN (p_as_of - p_since) / 7
    WHEN 'biweekly'  THEN (p_as_of - p_since) / 14
    WHEN 'monthly'   THEN (p_as_of - p_since) / 30
    WHEN 'quarterly' THEN (p_as_of - p_since) / 91
    ELSE 0
  END;
$$;

/*
 * The scan.
 *
 * SECURITY DEFINER, and deliberately so: it reads across every tenant, because
 * a system job has no employee identity to be scoped by. That is a real
 * privilege and worth naming — the safety of it rests on the fact that this
 * function only ever calls app.enqueue_notification, which addresses the person
 * whose own work is late. It cannot disclose anything to anybody who was not
 * already the recipient, and it returns counts rather than rows.
 *
 * Returns what it sent, by template, so an operator running it by hand can see
 * whether a quiet day means "nothing due" or "the scan is broken".
 */
CREATE FUNCTION app.enqueue_due_reminders(
  p_as_of      DATE DEFAULT CURRENT_DATE,
  p_days_ahead INT  DEFAULT 7
) RETURNS TABLE (template_code TEXT, enqueued INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public AS $$
BEGIN
  -- 1. Reviews closing soon, still unsubmitted.
  RETURN QUERY
  WITH sent AS (
    SELECT app.enqueue_notification(
             ri.reviewer_employee_id, 'review.due_soon',
             jsonb_build_object(
               'subjectName', app.display_name(ri.subject_employee_id),
               'cycleName', c.name,
               'closesOn', c.closes_on::text,
               'daysLeft', (c.closes_on - p_as_of)::text),
             -- The threshold, not the day: one message per milestone however
             -- often the scan runs.
             'review-due:' || ri.id::text || ':' || p_days_ahead::text) AS id
      FROM review_instance ri
      JOIN review_cycle c ON c.id = ri.review_cycle_id
     WHERE ri.state <> 'submitted'
       AND c.state = 'open'
       AND c.closes_on BETWEEN p_as_of AND p_as_of + p_days_ahead
  )
  SELECT 'review.due_soon', count(*) FILTER (WHERE id IS NOT NULL)::INT FROM sent;

  -- 2. Reviews past their cycle's close.
  RETURN QUERY
  WITH sent AS (
    SELECT app.enqueue_notification(
             ri.reviewer_employee_id, 'review.overdue',
             jsonb_build_object(
               'subjectName', app.display_name(ri.subject_employee_id),
               'cycleName', c.name,
               'closesOn', c.closes_on::text),
             'review-overdue:' || ri.id::text || ':' || c.closes_on::text) AS id
      FROM review_instance ri
      JOIN review_cycle c ON c.id = ri.review_cycle_id
     WHERE ri.state <> 'submitted'
       AND c.state = 'open'
       AND c.closes_on < p_as_of
  )
  SELECT 'review.overdue', count(*) FILTER (WHERE id IS NOT NULL)::INT FROM sent;

  -- 3. Check-ins whose cadence has lapsed. The template for this has existed
  --    since 0021 with nothing emitting it.
  RETURN QUERY
  WITH due AS (
    SELECT g.id, g.employee_id, g.title,
           app.cadence_periods_elapsed(
             p.checkin_cadence,
             COALESCE(MAX(ck.created_at)::date, g.created_at::date),
             p_as_of) AS periods,
           (p_as_of - COALESCE(MAX(ck.created_at)::date, g.created_at::date)) AS days
      FROM goal g
      JOIN goal_period p ON p.id = g.goal_period_id
      LEFT JOIN goal_checkin ck ON ck.goal_id = g.id
     WHERE g.state = 'active'
       AND p.checkin_cadence <> 'none'
       AND p.state = 'open'
     GROUP BY g.id, g.employee_id, g.title, p.checkin_cadence, g.created_at
  ),
  sent AS (
    SELECT app.enqueue_notification(
             d.employee_id, 'goal.checkin_overdue',
             jsonb_build_object('goalTitle', d.title,
                                'daysOverdue', d.days::text),
             -- Bucketed by whole periods missed: a second missed week sends a
             -- second nudge, and a hundred scans inside that week send none.
             'checkin-overdue:' || d.id::text || ':' || d.periods::text) AS id
      FROM due d WHERE d.periods >= 1
  )
  SELECT 'goal.checkin_overdue', count(*) FILTER (WHERE id IS NOT NULL)::INT FROM sent;

  -- 4. Peer invitations nobody has answered.
  RETURN QUERY
  WITH sent AS (
    SELECT app.enqueue_notification(
             s.reviewer_employee_id, 'peer.invitation_pending',
             jsonb_build_object(
               'subjectName', app.display_name(s.subject_employee_id),
               'daysWaiting', (p_as_of - s.drawn_at::date)::text),
             'peer-nudge:' || s.id::text || ':'
               || ((p_as_of - s.drawn_at::date) / p_days_ahead)::text) AS id
      FROM peer_review_solicitation s
     WHERE s.state = 'drawn'
       AND s.drawn_at::date <= p_as_of - p_days_ahead
  )
  SELECT 'peer.invitation_pending', count(*) FILTER (WHERE id IS NOT NULL)::INT
    FROM sent;

  -- 5. Task evaluations still in draft after the period ended.
  RETURN QUERY
  WITH sent AS (
    SELECT app.enqueue_notification(
             e.evaluator_employee_id, 'evaluation.overdue',
             jsonb_build_object(
               'subjectName', app.display_name(e.employee_id),
               'periodStart', e.period_start::text,
               'periodEnd', e.period_end::text,
               'daysLate', (p_as_of - e.period_end)::text),
             'evaluation-overdue:' || e.id::text || ':'
               || ((p_as_of - e.period_end) / p_days_ahead)::text) AS id
      FROM scorecard_evaluation e
     WHERE e.state = 'draft'
       AND e.period_end <= p_as_of - p_days_ahead
  )
  SELECT 'evaluation.overdue', count(*) FILTER (WHERE id IS NOT NULL)::INT FROM sent;
END;
$$;

COMMENT ON FUNCTION app.enqueue_due_reminders IS
  'Scans for work that has gone quiet and enqueues one reminder per milestone. '
  'Safe to run as often as you like: every message dedupes on what it is about, '
  'not on when it was noticed.';

REVOKE ALL ON FUNCTION app.enqueue_due_reminders(DATE, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enqueue_due_reminders(DATE, INT) TO hr_app;

COMMIT;
