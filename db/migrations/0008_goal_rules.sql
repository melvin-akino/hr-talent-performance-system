-- 0008_goal_rules.sql
-- Invariants that must hold regardless of which code path writes.
--
-- These are triggers rather than service-layer checks for the same reason the
-- audit log is: the CLI, a future importer, and a manual psql fix all bypass
-- application code. An invariant enforced in one service is not an invariant.

BEGIN;

-- ---------------------------------------------------------------------------
-- KPI version snapshotting
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.freeze_kpi_version() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kpi_definition_id IS NOT NULL AND NEW.kpi_definition_version IS NULL THEN
      SELECT version INTO NEW.kpi_definition_version
        FROM kpi_definition WHERE id = NEW.kpi_definition_id;
    END IF;
  ELSIF NEW.kpi_definition_version IS DISTINCT FROM OLD.kpi_definition_version THEN
    RAISE EXCEPTION
      'kpi_definition_version is a snapshot and cannot be changed (goal %)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER goal_freeze_kpi_version
  BEFORE INSERT OR UPDATE ON goal
  FOR EACH ROW EXECUTE FUNCTION app.freeze_kpi_version();

-- ---------------------------------------------------------------------------
-- Goal state machine
-- ---------------------------------------------------------------------------
-- draft -> pending_approval -> active -> achieved | missed
-- Anything not terminal may be cancelled. Terminal states are terminal.

CREATE FUNCTION app.goal_state_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_allowed goal_state[];
BEGIN
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE OLD.state
    WHEN 'draft'            THEN ARRAY['pending_approval', 'active', 'cancelled']::goal_state[]
    WHEN 'pending_approval' THEN ARRAY['draft', 'active', 'cancelled']::goal_state[]
    WHEN 'active'           THEN ARRAY['achieved', 'missed', 'cancelled']::goal_state[]
    ELSE ARRAY[]::goal_state[]   -- achieved / missed / cancelled are terminal
  END;

  IF NOT (NEW.state = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Invalid goal transition % -> %', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  -- Approval must record who and when. A goal that became active with no
  -- approver is indistinguishable from one an employee self-approved.
  IF NEW.state = 'active' AND NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'A goal cannot become active without an approver'
      USING ERRCODE = 'check_violation';
  END IF;

  -- An employee may not approve their own goal. The whole point of approval is
  -- that a second person saw it.
  IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.employee_id THEN
    RAISE EXCEPTION 'An employee cannot approve their own goal'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER goal_state_machine
  BEFORE UPDATE ON goal
  FOR EACH ROW EXECUTE FUNCTION app.goal_state_transition();

-- ---------------------------------------------------------------------------
-- Cascade cycle prevention
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.goal_no_cascade_cycle() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_cursor UUID := NEW.parent_goal_id;
  v_depth  INT := 0;
BEGIN
  WHILE v_cursor IS NOT NULL LOOP
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'Goal cascade would form a cycle'
        USING ERRCODE = 'check_violation';
    END IF;
    v_depth := v_depth + 1;
    IF v_depth > 32 THEN
      RAISE EXCEPTION 'Goal cascade exceeds maximum depth of 32'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_goal_id INTO v_cursor FROM goal WHERE id = v_cursor;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER goal_cascade_acyclic
  BEFORE INSERT OR UPDATE OF parent_goal_id ON goal
  FOR EACH ROW WHEN (NEW.parent_goal_id IS NOT NULL)
  EXECUTE FUNCTION app.goal_no_cascade_cycle();

-- ---------------------------------------------------------------------------
-- Period freezing
-- ---------------------------------------------------------------------------
-- open   -- everything editable
-- locked -- goal SET frozen (no add/remove, no weight or title change);
--           check-ins and actuals continue to flow, which is the entire point
--           of locking rather than closing
-- closed -- fully frozen

CREATE FUNCTION app.goal_period_state(p_goal_period_id UUID)
RETURNS goal_period_state
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT state FROM goal_period WHERE id = p_goal_period_id;
$$;

CREATE FUNCTION app.enforce_goal_period_freeze() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_state goal_period_state;
BEGIN
  v_state := app.goal_period_state(COALESCE(NEW.goal_period_id, OLD.goal_period_id));

  IF v_state = 'closed' THEN
    RAISE EXCEPTION 'Goal period is closed; goals cannot be added or changed'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_state = 'locked' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Goal period is locked; no new goals may be added'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Progress may still be recorded against a locked period; the shape of the
    -- goal set may not change.
    IF NEW.weight IS DISTINCT FROM OLD.weight
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.parent_goal_id IS DISTINCT FROM OLD.parent_goal_id THEN
      RAISE EXCEPTION 'Goal period is locked; weight, title and cascade are frozen'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER goal_period_freeze
  BEFORE INSERT OR UPDATE ON goal
  FOR EACH ROW EXECUTE FUNCTION app.enforce_goal_period_freeze();

CREATE FUNCTION app.enforce_target_period_freeze() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_state goal_period_state;
BEGIN
  SELECT app.goal_period_state(g.goal_period_id) INTO v_state
    FROM goal g WHERE g.id = COALESCE(NEW.goal_id, OLD.goal_id);

  IF v_state = 'closed' THEN
    RAISE EXCEPTION 'Goal period is closed; actuals are frozen'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_state = 'locked' AND TG_OP = 'UPDATE' THEN
    IF NEW.target_value IS DISTINCT FROM OLD.target_value
       OR NEW.baseline_value IS DISTINCT FROM OLD.baseline_value
       OR NEW.direction IS DISTINCT FROM OLD.direction THEN
      RAISE EXCEPTION 'Goal period is locked; targets and baselines are frozen'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER goal_target_period_freeze
  BEFORE INSERT OR UPDATE ON goal_target
  FOR EACH ROW EXECUTE FUNCTION app.enforce_target_period_freeze();

-- ---------------------------------------------------------------------------
-- Weight validation -- deferred to period lock
-- ---------------------------------------------------------------------------
-- Deliberately NOT a per-row constraint. A manager building a goal set saves
-- partial work constantly; requiring weights to sum to 100 on every insert
-- makes the first save impossible. The rule is checked when the period locks.

CREATE FUNCTION app.goal_weight_violations(p_goal_period_id UUID)
RETURNS TABLE (employee_id UUID, total_weight NUMERIC, goal_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT g.employee_id, SUM(g.weight), COUNT(*)
    FROM goal g
   WHERE g.goal_period_id = p_goal_period_id
     AND g.state NOT IN ('cancelled', 'draft')
   GROUP BY g.employee_id
  HAVING SUM(g.weight) <> 100;
$$;

COMMENT ON FUNCTION app.goal_weight_violations IS
  'Employees whose non-draft goal weights do not sum to 100 for a period. '
  'Drafts are excluded so incomplete work does not block the check.';

CREATE FUNCTION app.enforce_period_lock_weights() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_bad INT;
BEGIN
  IF NEW.state IN ('locked', 'closed') AND OLD.state NOT IN ('locked', 'closed') THEN
    SELECT count(*) INTO v_bad FROM app.goal_weight_violations(NEW.id);
    IF v_bad > 0 THEN
      RAISE EXCEPTION
        'Cannot lock period: % employee(s) have goal weights that do not sum to 100. '
        'Query app.goal_weight_violations(%L) for the list.', v_bad, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.locked_at := COALESCE(NEW.locked_at, now());
  END IF;

  IF NEW.state = 'closed' AND OLD.state <> 'closed' THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER goal_period_lock_weights
  BEFORE UPDATE ON goal_period
  FOR EACH ROW EXECUTE FUNCTION app.enforce_period_lock_weights();

-- ---------------------------------------------------------------------------
-- Check-ins follow the period too
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.enforce_checkin_period_open() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_state goal_period_state;
BEGIN
  SELECT app.goal_period_state(g.goal_period_id) INTO v_state
    FROM goal g WHERE g.id = NEW.goal_id;

  IF v_state = 'closed' THEN
    RAISE EXCEPTION 'Goal period is closed; no further check-ins'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_state = 'draft' THEN
    RAISE EXCEPTION 'Goal period is not open yet'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER goal_checkin_period_open
  BEFORE INSERT ON goal_checkin
  FOR EACH ROW EXECUTE FUNCTION app.enforce_checkin_period_open();

-- ---------------------------------------------------------------------------
-- Audit + updated_at for the new tables
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['goal_period', 'kpi_definition', 'goal', 'goal_target'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;

-- goal_checkin is INSERT-only, so it needs the audit trigger but never touch.
CREATE TRIGGER goal_checkin_audit
  AFTER INSERT ON goal_checkin
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();

COMMIT;
