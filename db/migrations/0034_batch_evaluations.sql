-- 0034_batch_evaluations.sql
-- T3: opening a quarter's evaluations for a whole section at once.
--
-- 0033 opens one evaluation for one person. That is the right unit for a
-- supervisor correcting an omission, and the wrong one for the thing HCM
-- actually does four times a year: open the quarter for a section of twenty
-- people and hand each one to the right supervisor.
--
-- Done one at a time, the failure mode is not an error -- it is somebody being
-- quietly missed, and nobody noticing until the incentive run. So this reports
-- on EVERY person in scope, including the ones it did not open, and says why.
-- A batch that silently skipped people would be worse than no batch at all.

BEGIN;

/*
 * Why each person in scope did or did not get an evaluation.
 *
 * 'no_scorecard' is the common one and is not an error: most of the client's
 * staff are not on a scorecard yet, and during the load that is the expected
 * state. It has to be visible rather than swallowed, because "opened 4 of 20"
 * is the number that tells HCM the load is unfinished.
 */
CREATE TYPE evaluation_open_outcome AS ENUM (
  'opened',
  'already_open',
  'no_scorecard',
  'empty_scorecard',
  'not_permitted'
);

/*
 * Opens evaluations for everyone in a department, for one period.
 *
 * Scope is resolved at the END of the period, like everything else here: the
 * people being evaluated for Q1 are the people who were in that section for Q1,
 * not whoever sits there now.
 *
 * Idempotent. Re-running reports 'already_open' rather than raising, because the
 * realistic use is running it again after fixing the two people it could not do
 * the first time.
 */
CREATE FUNCTION app.open_evaluations_for_department(
  p_department UUID,
  p_start      DATE,
  p_end        DATE,
  p_include_subtree BOOLEAN DEFAULT TRUE
) RETURNS TABLE (
  employee_id   UUID,
  employee_name TEXT,
  scorecard_id  UUID,
  evaluation_id UUID,
  outcome       evaluation_open_outcome
)
LANGUAGE plpgsql AS $$
DECLARE
  r           RECORD;
  v_scorecard UUID;
  v_existing  UUID;
  v_evaluator UUID;
  v_target    NUMERIC(8,2);
  v_eval      UUID;
  v_org       UUID;
BEGIN
  IF p_start > p_end THEN
    RAISE EXCEPTION 'Period starts after it ends (% to %)', p_start, p_end;
  END IF;

  v_org := app.current_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No identity set, so no organization to work in';
  END IF;

  FOR r IN
    SELECT e.id, app.display_name(e.id) AS name
      FROM employee e
      JOIN employment em
        ON em.employee_id = e.id
       AND em.effective_from <= p_end
       AND (em.effective_to IS NULL OR p_end < em.effective_to)
     WHERE e.org_id = v_org
       AND (
         CASE WHEN p_include_subtree
              THEN app.department_in_subtree(em.department_id, p_department, p_end)
              ELSE em.department_id = p_department
         END)
     ORDER BY app.display_name(e.id)
  LOOP
    employee_id   := r.id;
    employee_name := r.name;
    scorecard_id  := NULL;
    evaluation_id := NULL;

    v_scorecard := app.scorecard_for(r.id, p_end);
    IF v_scorecard IS NULL THEN
      outcome := 'no_scorecard';
      RETURN NEXT;
      CONTINUE;
    END IF;
    scorecard_id := v_scorecard;

    SELECT id INTO v_existing
      FROM scorecard_evaluation
     WHERE scorecard_evaluation.employee_id = r.id
       AND scorecard_evaluation.scorecard_id = v_scorecard
       AND period_start = p_start
       AND period_end = p_end;
    IF v_existing IS NOT NULL THEN
      evaluation_id := v_existing;
      outcome := 'already_open';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Checked rather than left to the INSERT: a policy violation would abort
    -- the whole batch, and one person out of scope must not cost the other
    -- nineteen their evaluations.
    IF NOT app.can_access('evaluation', 'write', r.id, p_end) THEN
      outcome := 'not_permitted';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_target := app.scorecard_target(v_scorecard);
    IF v_target IS NULL OR v_target <= 0 THEN
      outcome := 'empty_scorecard';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- The person's supervisor at the end of the period does the evaluating.
    -- Not the caller: HCM opening the quarter for a section is an
    -- administrative act, and it must not make an HR administrator the author
    -- of twenty assessments they did not write. Where there is no supervisor
    -- -- the top of the chart -- it falls back to the caller, who at least
    -- knows the evaluation exists.
    SELECT rl.supervisor_employee_id INTO v_evaluator
      FROM reporting_line rl
     WHERE rl.employee_id = r.id
       AND rl.effective_from <= p_end
       AND (rl.effective_to IS NULL OR p_end < rl.effective_to)
     ORDER BY rl.effective_from DESC
     LIMIT 1;
    v_evaluator := COALESCE(v_evaluator, app.current_employee_id());

    INSERT INTO scorecard_evaluation (
      org_id, employee_id, scorecard_id, evaluator_employee_id,
      period_start, period_end, target_points)
    VALUES (v_org, r.id, v_scorecard, v_evaluator, p_start, p_end, v_target)
    RETURNING id INTO v_eval;

    INSERT INTO scorecard_evaluation_line (
      org_id, evaluation_id, scorecard_item_id,
      indicator_name, criteria, nature, points_available, sequence)
    SELECT v_org, v_eval, i.id, t.name, i.criteria, t.nature, i.points, i.sequence
      FROM scorecard_item i
      JOIN task_indicator t ON t.id = i.task_indicator_id
     WHERE i.scorecard_id = v_scorecard
     ORDER BY i.sequence;

    evaluation_id := v_eval;
    outcome := 'opened';
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION app.open_evaluations_for_department IS
  'Opens one period''s evaluations for a whole department. Reports on every '
  'person in scope, including those it did not open and why -- a batch that '
  'silently skipped people would be worse than no batch at all.';

COMMIT;
