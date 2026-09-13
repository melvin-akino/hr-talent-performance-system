-- 0047_evaluation_report.sql
-- F2: the report builder (requirements §7.2) — "reports by name, evaluation
-- type, period, and PIP results".
--
-- WHY THIS DOES NOT WRITE A SECOND UNION.
--
-- The obvious implementation is a new query that unions reviews, task
-- evaluations, PIPs, competency assessments and employment events, filtered
-- across many employees. That union already exists: 0035 wrote it for one
-- person, as app.employee_timeline. Writing it a second time would mean every
-- future source — promotion programmes, requests — has to be remembered in two
-- places, and the day somebody forgets, the report and the history screen
-- disagree about the same person with nothing on either screen to say so.
--
-- So the union moves DOWN into app.evaluation_events, which takes an optional
-- employee, and app.employee_timeline is replaced by a wrapper over it with
-- the identical signature. Nothing above the database changes. The history
-- screen and the report are now two questions asked of one answer.
--
-- The employee filter is a PARAMETER pushed into each branch rather than a
-- predicate applied after the union. Written the other way, opening one
-- person's history would scan every evaluation in the organisation — which is
-- survivable on a laptop and is not survivable on the 1 GiB host this runs on.
--
-- SECURITY INVOKER, for the reason 0035 gave and this inherits: a draft task
-- evaluation is invisible to its subject (0033), an unreleased review until
-- sign-off (0014). Nothing here re-implements any of that. A cross-employee
-- report is the single most likely place for confidential assessment to leak,
-- and a SECURITY DEFINER function that "just joins the history" is exactly how
-- that happens.
--
-- WHAT "EVALUATION TYPE" MEANS HERE, SINCE THERE ARE TWO ANSWERS.
--
-- `kind` is the SOURCE: a review, a task evaluation, a PIP, a competency
-- assessment, an employment event. `eval_type` is the client's Type I–V, and
-- lives on evaluation_definition (0036) — so it exists only for reviews run
-- from a definition, and is NULL everywhere else. Both are offered as filters
-- and they are not interchangeable: filtering by eval_type necessarily
-- excludes every PIP and every task evaluation, because those are not that
-- kind of thing. The screen says so rather than returning a confusingly empty
-- report.
--
-- eval_type is read LIVE from the definition rather than snapshotted onto the
-- cycle the way expected_instances and averaging were (0036). Those two decide
-- a score and must never move under one already given; eval_type is the
-- definition's identity, and re-labelling a definition should re-label the
-- reports that group by it.

BEGIN;

CREATE FUNCTION app.evaluation_events(
  p_employee UUID DEFAULT NULL,
  p_from     DATE DEFAULT NULL,
  p_to       DATE DEFAULT NULL
) RETURNS TABLE (
  employee_id   UUID,
  employee_no   TEXT,
  employee_name TEXT,
  department_id UUID,
  department    TEXT,
  occurred_on   DATE,
  kind          timeline_kind,
  eval_type     evaluation_type,
  title         TEXT,
  detail        TEXT,
  result        TEXT,
  ref_id        UUID,
  sort_at       TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $fn$
  WITH events AS (
    -- Reviews. review_summary carries the outcome; its RLS keeps an unreleased
    -- one away from the subject, which is the behaviour this inherits rather
    -- than restates.
    SELECT s.subject_employee_id AS employee_id,
           c.closes_on AS occurred_on,
           'review'::timeline_kind AS kind,
           d.eval_type,
           c.name AS title,
           CASE WHEN s.signed_off_at IS NOT NULL THEN 'Signed off'
                WHEN s.released_at IS NOT NULL THEN 'Released'
                ELSE 'In progress' END AS detail,
           app.trim_score(COALESCE(s.calibrated_rating, s.overall_rating)) AS result,
           s.id AS ref_id,
           COALESCE(s.signed_off_at, s.released_at, s.created_at) AS sort_at
      FROM review_summary s
      JOIN review_cycle c ON c.id = s.review_cycle_id
      LEFT JOIN evaluation_definition d ON d.id = c.evaluation_definition_id
     WHERE (p_employee IS NULL OR s.subject_employee_id = p_employee)

    UNION ALL

    -- Task evaluations (T2). A draft is invisible to the subject; that is
    -- scorecard_evaluation's own policy doing the work.
    SELECT e.employee_id,
           e.period_end,
           'task_evaluation'::timeline_kind,
           NULL::evaluation_type,
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
     WHERE (p_employee IS NULL OR e.employee_id = p_employee)

    UNION ALL

    -- Performance Improvement Plans. Dated at the START: a PIP is an action
    -- taken on a date, and its outcome is carried in the same row rather than
    -- split into a second event nobody would connect to the first. That is
    -- also what makes "report on PIP results" a filter on `result` rather than
    -- a join to somewhere else.
    SELECT p.employee_id,
           p.starts_on,
           'pip'::timeline_kind,
           NULL::evaluation_type,
           'Performance Improvement Plan',
           CASE WHEN p.closed_at IS NOT NULL
                THEN 'Closed ' || p.ends_on::text
                ELSE 'Open until ' || p.ends_on::text END,
           NULLIF(p.outcome::text, ''),
           p.id,
           p.created_at
      FROM pip_plan p
     WHERE (p_employee IS NULL OR p.employee_id = p_employee)

    UNION ALL

    -- Competency assessments, one row per assessment, named by the competency.
    SELECT a.subject_employee_id,
           a.assessed_on,
           'competency'::timeline_kind,
           NULL::evaluation_type,
           comp.name,
           'Assessed by ' || app.display_name(a.assessed_by),
           'Level ' || a.assessed_level::text,
           a.id,
           a.created_at
      FROM competency_assessment a
      JOIN competency comp ON comp.id = a.competency_id
     WHERE (p_employee IS NULL OR a.subject_employee_id = p_employee)

    UNION ALL

    -- What actually happened to them: hired, regularised, promoted, moved.
    SELECT em.employee_id,
           em.effective_from,
           'employment_event'::timeline_kind,
           NULL::evaluation_type,
           initcap(replace(em.event_type::text, '_', ' ')),
           COALESCE(pos.title, 'Position not recorded')
             || COALESCE(' — ' || d.name, ''),
           NULLIF(em.change_reason, ''),
           em.id,
           em.created_at
      FROM employment em
      LEFT JOIN position pos ON pos.id = em.position_id
      LEFT JOIN department d ON d.id = em.department_id
     WHERE (p_employee IS NULL OR em.employee_id = p_employee)
  )
  SELECT ev.employee_id,
         emp.employee_no,
         app.display_name(emp.id),
         cur.department_id,
         dep.name,
         ev.occurred_on, ev.kind, ev.eval_type,
         ev.title, ev.detail, ev.result, ev.ref_id, ev.sort_at
    FROM events ev
    -- INNER: an event whose employee the caller cannot read is not theirs to
    -- count. employee's own policy decides that, here as everywhere.
    JOIN employee emp ON emp.id = ev.employee_id
    -- Where they are NOW, which is what a reader filtering by department is
    -- asking. The employment_event branch's own `detail` still names the unit
    -- the event happened in — a promotion out of a section belongs to that
    -- section in the sentence, and to the new one in the filter.
    LEFT JOIN LATERAL (
      SELECT em.department_id FROM employment em
       WHERE em.employee_id = ev.employee_id AND em.effective_to IS NULL
       ORDER BY em.effective_from DESC LIMIT 1
    ) cur ON TRUE
    LEFT JOIN department dep ON dep.id = cur.department_id
   WHERE (p_from IS NULL OR ev.occurred_on >= p_from)
     AND (p_to   IS NULL OR ev.occurred_on <= p_to);
$fn$;

COMMENT ON FUNCTION app.evaluation_events IS
  'Every evaluative event the caller may read, optionally for one employee. '
  'The single union behind both the history screen (F1) and the report '
  'builder (F2), so the two can never disagree. SECURITY INVOKER: each source '
  'filters itself under the caller''s identity.';

/*
 * One employee's history — now a wrapper.
 *
 * Identical signature and identical columns to 0035, so every caller above the
 * database is untouched. The ORDER BY stays here rather than moving into
 * evaluation_events: the report orders by person first, and a sort the caller
 * does not want is work the caller still pays for.
 */
CREATE OR REPLACE FUNCTION app.employee_timeline(
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
LANGUAGE sql STABLE AS $fn$
  SELECT e.occurred_on, e.kind, e.title, e.detail, e.result, e.ref_id, e.sort_at
    FROM app.evaluation_events(p_employee, p_from, p_to) e
   ORDER BY e.occurred_on DESC, e.sort_at DESC;
$fn$;

COMMENT ON FUNCTION app.employee_timeline IS
  'One employee''s history. Since 0047 a thin wrapper over '
  'app.evaluation_events, which is the same union asked without the employee '
  'filter. Behaviour is unchanged; what changed is that there is now one union '
  'rather than two that could drift.';

/*
 * The report.
 *
 * Every filter is NULL-means-all, so the unfiltered call is the whole history
 * of everyone the caller may see — the honest default for a screen whose first
 * question is "what have we got".
 *
 * p_department includes the SUBTREE. A Department Head filtering to their
 * section means the section, and somebody filtering to a division who got back
 * only the people attached directly to the division node would read an almost
 * empty report as a fact about the division.
 *
 * p_name matches the PERSON, not the event title. "Report by name" is the
 * client's phrase for finding a colleague; matching it against cycle names
 * would make a search for somebody called Cruz return everybody in a cycle
 * called "Cruz Branch Annual".
 */
CREATE FUNCTION app.evaluation_report(
  p_from        DATE DEFAULT NULL,
  p_to          DATE DEFAULT NULL,
  p_kinds       timeline_kind[] DEFAULT NULL,
  p_eval_types  evaluation_type[] DEFAULT NULL,
  p_department  UUID DEFAULT NULL,
  p_name        TEXT DEFAULT NULL,
  p_results     TEXT[] DEFAULT NULL,
  p_limit       INT DEFAULT 1000
) RETURNS TABLE (
  employee_id   UUID,
  employee_no   TEXT,
  employee_name TEXT,
  department    TEXT,
  occurred_on   DATE,
  kind          timeline_kind,
  eval_type     evaluation_type,
  title         TEXT,
  detail        TEXT,
  result        TEXT,
  ref_id        UUID
)
LANGUAGE sql STABLE AS $fn$
  SELECT e.employee_id, e.employee_no, e.employee_name, e.department,
         e.occurred_on, e.kind, e.eval_type, e.title, e.detail, e.result,
         e.ref_id
    FROM app.evaluation_events(NULL, p_from, p_to) e
   WHERE (p_kinds      IS NULL OR e.kind = ANY (p_kinds))
     AND (p_eval_types IS NULL OR e.eval_type = ANY (p_eval_types))
     AND (p_department IS NULL
          OR (e.department_id IS NOT NULL
              AND app.department_in_subtree(e.department_id, p_department)))
     -- Case-insensitive contains, over the name AND the employee number,
     -- because half the people asking for "a report by name" have the number
     -- in front of them. Plain ILIKE rather than full-text search: these are
     -- names, and "de la" is a prefix of nothing.
     AND (p_name IS NULL OR e.employee_name ILIKE '%' || p_name || '%'
                         OR e.employee_no   ILIKE '%' || p_name || '%')
     -- PIP outcomes are the case the client named, but the filter is on the
     -- column rather than on the kind, so "successful" and "4.5" are asked the
     -- same way and a future source needs no special case.
     AND (p_results IS NULL OR e.result = ANY (p_results))
   ORDER BY e.employee_name, e.occurred_on DESC, e.sort_at DESC
   -- Clamped rather than trusted. A report is a screen and a CSV, not a data
   -- dump: 10 000 rows is already more than anyone reads, and an unbounded
   -- limit from a query string is how one curious user pages the whole history
   -- of the organisation into a 1 GiB host's memory.
   LIMIT LEAST(GREATEST(p_limit, 1), 10000);
$fn$;

COMMENT ON FUNCTION app.evaluation_report IS
  'The F2 report builder (§7.2): filter the evaluative history by person, '
  'source, evaluation type, period, department subtree and result. Every '
  'filter is NULL-means-all. Scoped by RLS, not by argument — the same call '
  'returns a section to a Department Head and the organisation to HCM.';

COMMIT;
