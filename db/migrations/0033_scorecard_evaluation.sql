-- 0033_scorecard_evaluation.sql
-- The client's second option: "load KPI and evaluate".
--
-- 0032 loaded what people are measured on. This scores them against it: a
-- period, a claim on each line of what was actually done, and a total against
-- the target.
--
-- THE LINES ARE SNAPSHOTTED, NOT REFERENCED.
--
-- This is the same principle the review forms follow (architecture.md): a
-- definition may be edited, and an instance issued under the old definition
-- must not move when it is. Scorecards will be edited -- the client is still
-- writing them, and R10/R11 alone will change several. If an evaluation read
-- its lines live from scorecard_item, then correcting a typo in an acceptance
-- criterion in March would silently rewrite what somebody was judged against in
-- January, and adding a line would change a total that a person has already
-- signed. So each evaluation copies the indicator name, the criterion, the
-- nature and the points available at the moment it is opened, and never reads
-- them again. scorecard_item_id is kept alongside, but only so the two can be
-- traced to each other -- it is deliberately nullable and deliberately not the
-- source of truth on read.

BEGIN;

CREATE TYPE evaluation_state AS ENUM ('draft', 'submitted', 'acknowledged');

CREATE TABLE scorecard_evaluation (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id    UUID NOT NULL,
  scorecard_id   UUID NOT NULL,
  evaluator_employee_id UUID NOT NULL,

  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,

  state          evaluation_state NOT NULL DEFAULT 'draft',

  -- Snapshot of the target at the moment the evaluation was opened. Stored
  -- rather than summed on read for the same reason as the lines: the scorecard
  -- behind it will change.
  target_points  NUMERIC(8,2) NOT NULL,
  -- Filled in on submit, from the lines, in the same statement.
  awarded_points NUMERIC(8,2),

  submitted_at     TIMESTAMPTZ,
  acknowledged_at  TIMESTAMPTZ,
  note             TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,

  CONSTRAINT scorecard_evaluation_employee_same_org
    FOREIGN KEY (employee_id, org_id) REFERENCES employee (id, org_id),
  CONSTRAINT scorecard_evaluation_evaluator_same_org
    FOREIGN KEY (evaluator_employee_id, org_id) REFERENCES employee (id, org_id),
  CONSTRAINT scorecard_evaluation_scorecard_same_org
    FOREIGN KEY (scorecard_id, org_id) REFERENCES scorecard (id, org_id),

  CONSTRAINT scorecard_evaluation_period_ordered CHECK (period_start <= period_end),
  CONSTRAINT scorecard_evaluation_target_positive CHECK (target_points > 0),

  -- A submitted evaluation carries its total and the moment it was submitted.
  -- A draft carries neither. Stated as a constraint so no code path can produce
  -- a submitted evaluation with no score, which would read as a zero.
  CONSTRAINT scorecard_evaluation_submitted_complete CHECK (
    (state = 'draft' AND awarded_points IS NULL AND submitted_at IS NULL)
    OR (state <> 'draft' AND awarded_points IS NOT NULL AND submitted_at IS NOT NULL)
  ),
  CONSTRAINT scorecard_evaluation_acknowledged_after CHECK (
    (state = 'acknowledged') = (acknowledged_at IS NOT NULL)
  ),
  -- The total cannot exceed what was available. Per-line ceilings are enforced
  -- on the lines; this catches a total written directly.
  CONSTRAINT scorecard_evaluation_within_target CHECK (
    awarded_points IS NULL
    OR (awarded_points >= 0 AND awarded_points <= target_points)
  )
);

-- One evaluation per person per scorecard per period. Two would each show a
-- plausible total and nothing on screen would say which counted.
CREATE UNIQUE INDEX scorecard_evaluation_unique_period
  ON scorecard_evaluation (employee_id, scorecard_id, period_start, period_end);

CREATE INDEX scorecard_evaluation_employee_idx
  ON scorecard_evaluation (employee_id, period_end DESC);
CREATE INDEX scorecard_evaluation_evaluator_idx
  ON scorecard_evaluation (evaluator_employee_id) WHERE state = 'draft';

COMMENT ON COLUMN scorecard_evaluation.target_points IS
  'Snapshot of app.scorecard_target() when the evaluation was opened. The '
  'scorecard behind it may change; this must not.';

CREATE TABLE scorecard_evaluation_line (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  evaluation_id UUID NOT NULL REFERENCES scorecard_evaluation(id) ON DELETE CASCADE,

  -- Traceability only. Nullable because the line it came from may later be
  -- deleted, and that must not delete the record of how somebody was judged.
  scorecard_item_id UUID REFERENCES scorecard_item(id) ON DELETE SET NULL,

  -- The snapshot. Everything shown to a reader comes from these four columns.
  indicator_name   TEXT NOT NULL,
  criteria         TEXT,
  nature           task_nature NOT NULL,
  points_available NUMERIC(6,2) NOT NULL,

  -- The claim. NULL means "not yet assessed", which is distinct from 0,
  -- "assessed and earned nothing" -- the difference between an unfinished
  -- evaluation and a bad one.
  points_awarded   NUMERIC(6,2),
  note             TEXT,

  sequence      SMALLINT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,

  CONSTRAINT scorecard_evaluation_line_points_positive CHECK (points_available > 0),
  CONSTRAINT scorecard_evaluation_line_within_available CHECK (
    points_awarded IS NULL
    OR (points_awarded >= 0 AND points_awarded <= points_available)
  )
);

CREATE INDEX scorecard_evaluation_line_eval_idx
  ON scorecard_evaluation_line (evaluation_id, sequence);

COMMENT ON COLUMN scorecard_evaluation_line.points_awarded IS
  'NULL = not yet assessed. 0 = assessed, earned nothing. Keeping them apart '
  'is what lets the UI say how much of an evaluation is actually done.';

-- ---------------------------------------------------------------------------
-- Opening an evaluation
-- ---------------------------------------------------------------------------

/*
 * Opens an evaluation for a person over a period, copying the lines of whatever
 * scorecard they held at the END of that period.
 *
 * The end date, not today: an evaluation of the first quarter is against the
 * scorecard they were on for it, even if they have since moved. app.scorecard_for
 * is effective-dated precisely so this question has an answer.
 */
CREATE FUNCTION app.open_scorecard_evaluation(
  p_employee   UUID,
  p_start      DATE,
  p_end        DATE,
  p_evaluator  UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_scorecard UUID;
  v_org       UUID;
  v_target    NUMERIC(8,2);
  v_eval      UUID;
BEGIN
  IF p_start > p_end THEN
    RAISE EXCEPTION 'Period starts after it ends (% to %)', p_start, p_end;
  END IF;

  v_scorecard := app.scorecard_for(p_employee, p_end);
  IF v_scorecard IS NULL THEN
    RAISE EXCEPTION 'No scorecard assigned to that employee as of %', p_end
      USING HINT = 'Assign a scorecard before evaluating against one.';
  END IF;

  SELECT org_id INTO v_org FROM scorecard WHERE id = v_scorecard;
  v_target := app.scorecard_target(v_scorecard);

  IF v_target IS NULL OR v_target <= 0 THEN
    RAISE EXCEPTION 'That scorecard has no lines yet, so there is nothing to score'
      USING HINT = 'Load the scorecard''s tasks first.';
  END IF;

  INSERT INTO scorecard_evaluation (
    org_id, employee_id, scorecard_id, evaluator_employee_id,
    period_start, period_end, target_points)
  VALUES (
    v_org, p_employee, v_scorecard,
    COALESCE(p_evaluator, app.current_employee_id()),
    p_start, p_end, v_target)
  RETURNING id INTO v_eval;

  -- The snapshot.
  INSERT INTO scorecard_evaluation_line (
    org_id, evaluation_id, scorecard_item_id,
    indicator_name, criteria, nature, points_available, sequence)
  SELECT v_org, v_eval, i.id, t.name, i.criteria, t.nature, i.points, i.sequence
    FROM scorecard_item i
    JOIN task_indicator t ON t.id = i.task_indicator_id
   WHERE i.scorecard_id = v_scorecard
   ORDER BY i.sequence;

  RETURN v_eval;
END;
$$;

/*
 * Submits an evaluation, totalling its lines in the same statement that changes
 * the state.
 *
 * Refuses while any line is unassessed. A total computed over half-finished work
 * would be indistinguishable, once stored, from a genuinely poor score.
 */
CREATE FUNCTION app.submit_scorecard_evaluation(p_evaluation UUID)
RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_unassessed INT;
  v_total      NUMERIC(8,2);
  v_state      evaluation_state;
BEGIN
  SELECT state INTO v_state FROM scorecard_evaluation WHERE id = p_evaluation;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'No such evaluation, or not visible to you';
  END IF;
  IF v_state <> 'draft' THEN
    RAISE EXCEPTION 'That evaluation was already submitted';
  END IF;

  SELECT count(*) FILTER (WHERE points_awarded IS NULL), COALESCE(sum(points_awarded), 0)
    INTO v_unassessed, v_total
    FROM scorecard_evaluation_line WHERE evaluation_id = p_evaluation;

  IF v_unassessed > 0 THEN
    RAISE EXCEPTION '% line(s) still unassessed', v_unassessed
      USING HINT = 'Every line needs a number, including the ones worth zero.';
  END IF;

  UPDATE scorecard_evaluation
     SET state = 'submitted', awarded_points = v_total, submitted_at = now()
   WHERE id = p_evaluation;

  RETURN v_total;
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- The confidentiality rule is the one from reviews (0014), for the same reason:
-- an evaluator marking somebody down needs to do it without the subject reading
-- it in real time, and the subject must be able to read it once it is submitted.
-- A score you cannot see is indefensible.

ALTER TABLE scorecard_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard_evaluation FORCE ROW LEVEL SECURITY;
ALTER TABLE scorecard_evaluation_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard_evaluation_line FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON scorecard_evaluation TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scorecard_evaluation_line TO hr_app;

CREATE POLICY scorecard_evaluation_select ON scorecard_evaluation FOR SELECT
  USING (
    org_id = app.current_org_id()
    AND (
      -- The evaluator sees their own work in progress.
      evaluator_employee_id = app.current_employee_id()
      -- The subject sees it once it is no longer a draft.
      OR (employee_id = app.current_employee_id() AND state <> 'draft')
      OR app.can_access('evaluation', 'read', employee_id)
    )
  );

CREATE POLICY scorecard_evaluation_insert ON scorecard_evaluation FOR INSERT
  WITH CHECK (
    org_id = app.current_org_id()
    AND app.can_access('evaluation', 'write', employee_id)
  );

CREATE POLICY scorecard_evaluation_update ON scorecard_evaluation FOR UPDATE
  USING (
    evaluator_employee_id = app.current_employee_id()
    OR app.can_access('evaluation', 'write', employee_id)
    -- Acknowledgement is the subject's own act, and the only write they have.
    OR (employee_id = app.current_employee_id() AND state = 'submitted')
  )
  WITH CHECK (
    evaluator_employee_id = app.current_employee_id()
    OR app.can_access('evaluation', 'write', employee_id)
    OR (employee_id = app.current_employee_id() AND state = 'acknowledged')
  );

-- Lines inherit the head's visibility. EXISTS re-enters scorecard_evaluation's
-- own policy, so the draft rule above is stated once and cannot drift out of
-- step with this table.
CREATE POLICY scorecard_evaluation_line_select ON scorecard_evaluation_line FOR SELECT
  USING (EXISTS (SELECT 1 FROM scorecard_evaluation e WHERE e.id = evaluation_id));

CREATE POLICY scorecard_evaluation_line_write ON scorecard_evaluation_line FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM scorecard_evaluation e
     WHERE e.id = evaluation_id
       AND (e.evaluator_employee_id = app.current_employee_id()
            OR app.can_access('evaluation', 'write', e.employee_id))));

-- A submitted evaluation is frozen: the state is in the USING clause, so
-- scoring cannot be changed after the fact without a correction that is itself
-- visible in the audit trail.
CREATE POLICY scorecard_evaluation_line_update ON scorecard_evaluation_line FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM scorecard_evaluation e
     WHERE e.id = evaluation_id
       AND e.state = 'draft'
       AND (e.evaluator_employee_id = app.current_employee_id()
            OR app.can_access('evaluation', 'write', e.employee_id))));

CREATE POLICY scorecard_evaluation_line_delete ON scorecard_evaluation_line FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM scorecard_evaluation e
     WHERE e.id = evaluation_id
       AND e.state = 'draft'
       AND (e.evaluator_employee_id = app.current_employee_id()
            OR app.can_access('evaluation', 'write', e.employee_id))));

CREATE TRIGGER scorecard_evaluation_audit
  AFTER INSERT OR UPDATE OR DELETE ON scorecard_evaluation
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
CREATE TRIGGER scorecard_evaluation_touch
  BEFORE UPDATE ON scorecard_evaluation
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER scorecard_evaluation_line_audit
  AFTER INSERT OR UPDATE OR DELETE ON scorecard_evaluation_line
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
CREATE TRIGGER scorecard_evaluation_line_touch
  BEFORE UPDATE ON scorecard_evaluation_line
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.seed_evaluation_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_hr_admin  UUID;
  v_dept_head UUID;
  v_manager   UUID;
BEGIN
  SELECT id INTO v_hr_admin  FROM app_role WHERE org_id = p_org_id AND code = 'hr_admin';
  SELECT id INTO v_dept_head FROM app_role WHERE org_id = p_org_id AND code = 'dept_head';
  SELECT id INTO v_manager   FROM app_role WHERE org_id = p_org_id AND code = 'manager';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  VALUES
    (p_org_id, v_hr_admin,  'evaluation', 'read',  'org'),
    (p_org_id, v_hr_admin,  'evaluation', 'write', 'org'),
    (p_org_id, v_dept_head, 'evaluation', 'read',  'department'),
    (p_org_id, v_dept_head, 'evaluation', 'write', 'department'),
    -- A supervisor evaluates the people who report to them, and nobody else.
    -- Not 'subtree': a skip-level manager scoring somebody directly, over the
    -- head of their actual supervisor, is a conversation, not a permission.
    (p_org_id, v_manager,   'evaluation', 'read',  'direct_reports'),
    (p_org_id, v_manager,   'evaluation', 'write', 'direct_reports')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_evaluation_grants(r.id);
  END LOOP;
END $do$;

COMMIT;
