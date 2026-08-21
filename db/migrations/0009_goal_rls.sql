-- 0009_goal_rls.sql
-- RLS for the Phase 1 tables, plus the grants that make the baseline roles
-- work with goals.
--
-- Every policy routes through app.can_access() (migration 0002). No bespoke
-- visibility logic is introduced here -- that was the point of building the
-- predicate first.

BEGIN;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['goal_period', 'kpi_definition', 'goal',
                           'goal_target', 'goal_checkin'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO hr_app', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Reference data: periods and the KPI library are readable org-wide
-- ---------------------------------------------------------------------------
-- A KPI library everyone can read is the point of a library. Writes stay with
-- HR.

CREATE POLICY goal_period_select ON goal_period FOR SELECT
  USING (app.current_employee_id() IS NOT NULL);

CREATE POLICY goal_period_insert ON goal_period FOR INSERT
  WITH CHECK (app.can_access('goal_period', 'write', app.current_employee_id()));

CREATE POLICY goal_period_update ON goal_period FOR UPDATE
  USING (app.can_access('goal_period', 'write', app.current_employee_id()))
  WITH CHECK (app.can_access('goal_period', 'write', app.current_employee_id()));

CREATE POLICY kpi_definition_select ON kpi_definition FOR SELECT
  USING (app.current_employee_id() IS NOT NULL);

CREATE POLICY kpi_definition_insert ON kpi_definition FOR INSERT
  WITH CHECK (app.can_access('kpi_definition', 'write', app.current_employee_id()));

CREATE POLICY kpi_definition_update ON kpi_definition FOR UPDATE
  USING (app.can_access('kpi_definition', 'write', app.current_employee_id()))
  WITH CHECK (app.can_access('kpi_definition', 'write', app.current_employee_id()));

-- ---------------------------------------------------------------------------
-- Goals -- visibility follows the subject employee
-- ---------------------------------------------------------------------------

CREATE POLICY goal_select ON goal FOR SELECT
  USING (
    employee_id = app.current_employee_id()
    OR app.can_access('goal', 'read', employee_id)
  );

-- An employee may draft their own goals; a manager may draft for their reports.
CREATE POLICY goal_insert ON goal FOR INSERT
  WITH CHECK (
    employee_id = app.current_employee_id()
    OR app.can_access('goal', 'write', employee_id)
  );

CREATE POLICY goal_update ON goal FOR UPDATE
  USING (
    employee_id = app.current_employee_id()
    OR app.can_access('goal', 'write', employee_id)
  )
  WITH CHECK (
    employee_id = app.current_employee_id()
    OR app.can_access('goal', 'write', employee_id)
  );

-- ---------------------------------------------------------------------------
-- Targets and check-ins inherit the parent goal's visibility
-- ---------------------------------------------------------------------------
-- EXISTS against `goal` re-enters that table's own RLS, so the rule is stated
-- once and cannot drift between the two.

CREATE POLICY goal_target_select ON goal_target FOR SELECT
  USING (EXISTS (SELECT 1 FROM goal g WHERE g.id = goal_target.goal_id));

CREATE POLICY goal_target_insert ON goal_target FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM goal g
     WHERE g.id = goal_target.goal_id
       AND (g.employee_id = app.current_employee_id()
            OR app.can_access('goal', 'write', g.employee_id))));

CREATE POLICY goal_target_update ON goal_target FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM goal g
     WHERE g.id = goal_target.goal_id
       AND (g.employee_id = app.current_employee_id()
            OR app.can_access('goal', 'write', g.employee_id))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM goal g
     WHERE g.id = goal_target.goal_id
       AND (g.employee_id = app.current_employee_id()
            OR app.can_access('goal', 'write', g.employee_id))));

CREATE POLICY goal_checkin_select ON goal_checkin FOR SELECT
  USING (EXISTS (SELECT 1 FROM goal g WHERE g.id = goal_checkin.goal_id));

-- Check-ins may be written by the goal owner or anyone who may write the goal.
-- checked_in_by is pinned to the caller so a check-in cannot be attributed to
-- someone else.
CREATE POLICY goal_checkin_insert ON goal_checkin FOR INSERT
  WITH CHECK (
    checked_in_by = app.current_employee_id()
    AND EXISTS (
      SELECT 1 FROM goal g
       WHERE g.id = goal_checkin.goal_id
         AND (g.employee_id = app.current_employee_id()
              OR app.can_access('goal', 'write', g.employee_id))));

-- ---------------------------------------------------------------------------
-- Phase 1 grants for the baseline roles
-- ---------------------------------------------------------------------------
-- A separate function rather than an edit to seed_baseline_roles(): migration
-- 0005 has already been applied on any live database, and applied migrations
-- are immutable (enforced by checksum in migrate.ts).

CREATE FUNCTION app.seed_phase1_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_employee UUID; v_manager UUID; v_hr_partner UUID; v_hr_admin UUID;
BEGIN
  SELECT id INTO v_employee   FROM app_role WHERE org_id=p_org_id AND code='employee';
  SELECT id INTO v_manager    FROM app_role WHERE org_id=p_org_id AND code='manager';
  SELECT id INTO v_hr_partner FROM app_role WHERE org_id=p_org_id AND code='hr_partner';
  SELECT id INTO v_hr_admin   FROM app_role WHERE org_id=p_org_id AND code='hr_admin';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  VALUES
    -- Employee: reads and drafts their own goals. Cannot approve -- that is
    -- what the state machine's approver check enforces at the row level too.
    (p_org_id, v_employee, 'goal', 'read', 'self'),
    (p_org_id, v_employee, 'goal', 'write', 'self'),

    -- Manager: full subtree read; write and approve for their reports.
    (p_org_id, v_manager, 'goal', 'read', 'subtree'),
    (p_org_id, v_manager, 'goal', 'write', 'subtree'),
    (p_org_id, v_manager, 'goal', 'approve', 'subtree'),

    -- HR Partner: scoped to their department subtree.
    (p_org_id, v_hr_partner, 'goal', 'read', 'department'),
    (p_org_id, v_hr_partner, 'goal', 'write', 'department'),

    -- HR Admin: org-wide, and owns the library and period lifecycle.
    (p_org_id, v_hr_admin, 'goal', 'read', 'org'),
    (p_org_id, v_hr_admin, 'goal', 'write', 'org'),
    (p_org_id, v_hr_admin, 'goal_period', 'write', 'org'),
    (p_org_id, v_hr_admin, 'kpi_definition', 'write', 'org')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

-- Apply to organizations that already exist.
DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organization LOOP
    PERFORM app.seed_phase1_grants(v_org);
  END LOOP;
END $$;

COMMIT;
