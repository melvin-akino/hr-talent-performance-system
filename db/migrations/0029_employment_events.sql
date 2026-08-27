-- 0029_employment_events.sql
-- Names what an employment row IS, so the dates the client asks for can be
-- answered from the history rather than kept alongside it.
--
-- Their upload sheet asks for three dates per person:
--
--     Date - Hired          Date - Regularization          Date - Promotion
--
-- All three are already implied by the effective-dated `employment` table — a
-- new row starts each time someone's position, department or employment type
-- changes. What is missing is WHY each row exists. `change_reason` is free text
-- and, across every row in every tenant today, NULL: the importer writes one row
-- per person and nothing has ever written a second.
--
-- So this is not "surface data we hold". It is making the events recordable at
-- all, before anything can depend on them. Probationary evaluations fire at the
-- 3rd and 4th month and are keyed to regularisation (Q7), promotions gate the
-- MDP and Back Office programmes — both need this to exist first.
--
-- Deliberately NOT three date columns on `employee`. A column would be a second
-- copy of something the history already knows, free to drift from it, and it
-- could hold only the latest promotion. The history answers "when were they
-- promoted" as many times as it happened.

BEGIN;

CREATE TYPE employment_event AS ENUM (
  'hire',            -- first row for this person
  'regularization',  -- probationary -> regular
  'promotion',
  'lateral_transfer',-- new position or department, same rank
  'demotion',
  'rehire',          -- returning after separation
  'correction'       -- fixing a mistake, not a real-world change
);

-- Every existing row is somebody's first, and therefore their hire. That is
-- true of the data as it stands rather than a convenient default: there is
-- exactly one employment row per employee in every tenant.
ALTER TABLE employment
  ADD COLUMN event_type employment_event NOT NULL DEFAULT 'hire';

COMMENT ON COLUMN employment.event_type IS
  'Why this employment row exists. The dates on the client 201 sheet — hired, '
  'regularised, promoted — are read from these, not stored separately.';

-- 'correction' is the one that must not count as a real-world event: a row
-- fixing a typo in last month''s transfer is not itself a transfer.
CREATE INDEX employment_event_idx
  ON employment (employee_id, event_type, effective_from)
  WHERE event_type <> 'correction';

/*
 * The three dates, read from the history.
 *
 * hired_on comes straight from `employee`, which is NOT NULL and set by the
 * importer from the 201 file — the customer's own record, and more
 * authoritative than anything we could infer. There is deliberately no fallback
 * to the earliest employment row: that branch could never run, and a defensive
 * clause that cannot execute is worse than none, because the next reader
 * believes it is load-bearing.
 *
 * Regularisation is the EARLIEST such event, not the latest: someone whose
 * probation was extended has two, and the first is when they became regular.
 * Promotion is the LATEST, because "date promoted" means the most recent one.
 */
CREATE FUNCTION app.employment_milestones(p_employee UUID)
RETURNS TABLE (hired_on DATE, regularized_on DATE, last_promoted_on DATE)
LANGUAGE sql STABLE AS $$
  SELECT
    (SELECT e.hired_on FROM employee e WHERE e.id = p_employee) AS hired_on,
    (SELECT min(em.effective_from) FROM employment em
      WHERE em.employee_id = p_employee AND em.event_type = 'regularization')
      AS regularized_on,
    (SELECT max(em.effective_from) FROM employment em
      WHERE em.employee_id = p_employee AND em.event_type = 'promotion')
      AS last_promoted_on;
$$;

COMMENT ON FUNCTION app.employment_milestones(UUID) IS
  'Hire, regularisation and latest promotion dates, read from employment '
  'history. Regularisation is the earliest such event (extended probation '
  'produces more than one); promotion is the latest.';

COMMIT;
