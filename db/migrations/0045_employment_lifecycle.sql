-- 0045_employment_lifecycle.sql
-- F0c: recording that something happened to somebody, without losing what was
-- true before it happened. See decisions.md D-016.
--
-- WHY THIS IS A DATABASE FUNCTION AND NOT A SERVICE METHOD.
--
-- `employment` carries a GiST exclusion constraint forbidding overlapping
-- periods for one employee. So recording a transfer is two statements — close
-- the open row, open a new one — and they are only correct together. Run them
-- apart and the second is rejected with the first already committed, which
-- leaves the person with a GAP in their employment history: worse than an
-- error, because nothing tells anyone.
--
-- A service could wrap both in a transaction. It would also be the second
-- writer: the 201 importer writes employment too, and an invariant enforced in
-- one of two writers is not an invariant. So the close-and-open lives here,
-- once, and both callers get it.
--
-- WHAT A CORRECTION IS NOT.
--
-- 0029 gave `event_type` the value 'correction' and said in its own comment
-- that "a row fixing a typo in last month's transfer is not itself a transfer".
-- This function refuses to record one, deliberately: a correction amends an
-- existing row in place and never closes anything, so routing it through
-- close-and-open would append a period that never existed. It is a different
-- operation and it belongs on a different endpoint.
--
-- app.employment_milestones() depends on that distinction holding. It reads the
-- client's three 201 dates back out of the event history, taking the EARLIEST
-- regularisation (probation extended twice still became regular once) and the
-- LATEST promotion. A correction counted as a real event moves dates that are
-- not supposed to move.

BEGIN;

/*
 * Record a real-world change to somebody's employment.
 *
 * Closes the period that covers p_effective_from and opens a new one beginning
 * on that date. Everything not supplied is carried forward from the row being
 * closed, so a promotion that changes only the position does not require the
 * caller to restate the department.
 *
 * Backdating is legitimate and supported: HCM routinely learns about a transfer
 * after it happened. Forward-dating is legitimate too. Both are ordinary
 * effective-dating rather than special cases, so neither is guarded against —
 * what IS guarded is landing on a date that would produce an overlap or a gap.
 *
 * SECURITY INVOKER on purpose. It runs as the caller, so every insert and
 * update inside it is subject to the same policies as any other write. This
 * function is convenience and atomicity; it is not an authorization bypass, and
 * an employee calling it gets exactly the refusal they should.
 */
CREATE FUNCTION app.record_employment_event(
  p_employee           UUID,
  p_event              employment_event,
  p_effective_from     DATE,
  p_reason             TEXT,
  p_position_id        UUID DEFAULT NULL,
  p_department_id      UUID DEFAULT NULL,
  p_employment_type_id UUID DEFAULT NULL,
  p_status             employment_status DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_current employment;
  v_new_id  UUID;
BEGIN
  IF p_event = 'correction' THEN
    RAISE EXCEPTION
      'A correction amends the row that is wrong; it does not open a new '
      'period. Use the correction endpoint instead.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION
      'Every employment change needs a reason. An undated, unexplained '
      'transfer cannot be defended a year later.'
      USING ERRCODE = 'P0001';
  END IF;

  -- The period that covers the new date. Not simply "the open one": a
  -- backdated change lands inside a period that may already be closed, and
  -- splitting the right one is the whole point.
  SELECT * INTO v_current
    FROM employment
   WHERE employee_id = p_employee
     AND effective_from <= p_effective_from
     AND (effective_to IS NULL OR p_effective_from < effective_to)
   ORDER BY effective_from DESC
   LIMIT 1;

  IF v_current.id IS NULL THEN
    -- Either the person does not exist, this caller cannot see them, or the
    -- date precedes their first employment row. All three are the caller's
    -- mistake and none is safe to guess at.
    RAISE EXCEPTION
      'No employment period covers % for this employee. Check the date, and '
      'that the person exists and you may see them.', p_effective_from
      USING ERRCODE = 'P0001';
  END IF;

  IF v_current.effective_from = p_effective_from THEN
    -- Two events on one day would need a zero-length period between them,
    -- which the period CHECK forbids. Saying so beats a constraint name.
    RAISE EXCEPTION
      'An employment change already takes effect on %. Correct that row '
      'rather than recording a second change on the same day.', p_effective_from
      USING ERRCODE = 'P0001';
  END IF;

  -- Close first. The exclusion constraint would reject the insert otherwise,
  -- and doing it in this order means a failure leaves nothing behind.
  UPDATE employment
     SET effective_to = p_effective_from,
         updated_at = now(),
         updated_by = app.current_employee_id()
   WHERE id = v_current.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Not permitted to change this employee''s employment.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO employment (
    org_id, employee_id, position_id, department_id, employment_type_id,
    status, effective_from, effective_to, change_reason, event_type,
    created_by, updated_by)
  VALUES (
    v_current.org_id,
    p_employee,
    COALESCE(p_position_id, v_current.position_id),
    COALESCE(p_department_id, v_current.department_id),
    COALESCE(p_employment_type_id, v_current.employment_type_id),
    COALESCE(p_status, v_current.status),
    p_effective_from,
    v_current.effective_to,   -- inherit the far edge: a split keeps its end
    p_reason,
    p_event,
    app.current_employee_id(),
    app.current_employee_id())
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION app.record_employment_event IS
  'Closes the employment period covering the given date and opens a new one '
  'from it, in one statement. Carries forward anything not supplied. Refuses '
  'event_type = correction: that amends a row rather than adding a period.';

REVOKE ALL ON FUNCTION app.record_employment_event(
  UUID, employment_event, DATE, TEXT, UUID, UUID, UUID, employment_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_employment_event(
  UUID, employment_event, DATE, TEXT, UUID, UUID, UUID, employment_status) TO hr_app;

-- ---------------------------------------------------------------------------
-- Separation
-- ---------------------------------------------------------------------------
/*
 * What separating somebody would orphan.
 *
 * Read before the act rather than blocking it: HR sometimes has to separate a
 * person mid-cycle, and a system that refuses outright gets worked around in
 * the database. So this reports, the caller decides, and the decision is
 * recorded — which is the difference between a guard and an obstacle.
 */
CREATE FUNCTION app.separation_blockers(p_employee UUID)
RETURNS TABLE (kind TEXT, detail TEXT)
LANGUAGE sql STABLE AS $$
  SELECT 'open_review'::TEXT,
         c.name || ' — ' || ri.state::text ||
         CASE WHEN ri.reviewer_employee_id = p_employee
              THEN ' (they are the reviewer)' ELSE ' (they are the subject)' END
    FROM review_instance ri
    JOIN review_cycle c ON c.id = ri.review_cycle_id
   WHERE (ri.subject_employee_id = p_employee
          OR ri.reviewer_employee_id = p_employee)
     AND ri.state <> 'submitted'
     AND c.state = 'open'
  UNION ALL
  SELECT 'active_pip'::TEXT,
         'PIP running to ' || p.ends_on::text
    FROM pip_plan p
   WHERE p.employee_id = p_employee
     AND p.state = 'active';
$$;

COMMENT ON FUNCTION app.separation_blockers(UUID) IS
  'Work that separating this person would leave orphaned: unsubmitted reviews '
  'in an open cycle, where they are subject OR reviewer, and running PIPs. '
  'Advisory — the caller decides and records the decision.';

REVOKE ALL ON FUNCTION app.separation_blockers(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.separation_blockers(UUID) TO hr_app;

/*
 * Separate somebody.
 *
 * Closes the open employment period, sets the employee's status and date.
 * Nothing is deleted: their reviews, goals and history still reference them,
 * and a separated person must stay answerable — "why was this decision made"
 * outlives the employment.
 */
CREATE FUNCTION app.separate_employee(
  p_employee     UUID,
  p_separated_on DATE,
  p_reason       TEXT,
  p_acknowledge_blockers BOOLEAN DEFAULT FALSE
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_blockers TEXT;
  v_open     UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A separation needs a reason.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT p_acknowledge_blockers THEN
    SELECT string_agg(kind || ': ' || detail, '; ')
      INTO v_blockers
      FROM app.separation_blockers(p_employee);

    IF v_blockers IS NOT NULL THEN
      RAISE EXCEPTION
        'Separating this person would leave work unfinished — %. Resolve it, '
        'or confirm the separation anyway.', v_blockers
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT id INTO v_open
    FROM employment
   WHERE employee_id = p_employee AND effective_to IS NULL;

  IF v_open IS NULL THEN
    RAISE EXCEPTION
      'This employee has no open employment period — they may already be '
      'separated, or you may not be permitted to see them.'
      USING ERRCODE = 'P0001';
  END IF;

  -- effective_to is exclusive, so a last day of the 31st closes on the 1st.
  UPDATE employment
     SET effective_to = p_separated_on + 1,
         change_reason = p_reason,
         updated_at = now(),
         updated_by = app.current_employee_id()
   WHERE id = v_open;

  -- Checked here as well as after the employee update. RLS filters an UPDATE
  -- to zero rows rather than raising, so without this a caller who may read
  -- the employment but not write it would close nothing and still be told the
  -- separation succeeded.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not permitted to change this employee''s employment.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE employee
     SET status = 'separated',
         separated_on = p_separated_on,
         updated_at = now(),
         updated_by = app.current_employee_id()
   WHERE id = p_employee;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not permitted to separate this employee.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION app.separate_employee IS
  'Closes the open employment period and marks the employee separated. '
  'Refuses when unfinished work would be orphaned unless explicitly '
  'acknowledged. Deletes nothing: past results still reference the person.';

REVOKE ALL ON FUNCTION app.separate_employee(UUID, DATE, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.separate_employee(UUID, DATE, TEXT, BOOLEAN) TO hr_app;

COMMIT;
