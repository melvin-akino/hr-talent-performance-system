-- 0024_development_rls.sql
-- RLS and grants for Phase 6.
--
-- Tenant-scoped from the first line (D-008). Every policy carries an org
-- predicate; none uses the org-blind pattern that leaked before migration 0015.
--
-- Sensitivity note. Development plans are NOT PIPs. A PIP is a disciplinary
-- instrument and is deliberately narrow (employee, DIRECT supervisor, HR). A
-- development plan is a growth conversation, so it follows the goal model:
-- visible up the reporting subtree. Treating development like discipline would
-- make people hide their own development needs, which defeats the feature.

BEGIN;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['learning_resource', 'career_path', 'development_plan',
                           'dev_action', 'learning_assignment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO hr_app', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Library and career paths -- readable across the tenant
-- ---------------------------------------------------------------------------
-- A career ladder nobody can see is not a ladder. Both of these are
-- organisational reference data, and hiding them would defeat their purpose.

CREATE POLICY learning_resource_select ON learning_resource FOR SELECT
  USING (org_id = app.current_org_id());

CREATE POLICY learning_resource_insert ON learning_resource FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('learning', 'write', app.current_employee_id()));

CREATE POLICY learning_resource_update ON learning_resource FOR UPDATE
  USING (org_id = app.current_org_id()
         AND app.can_access('learning', 'write', app.current_employee_id()))
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('learning', 'write', app.current_employee_id()));

CREATE POLICY career_path_select ON career_path FOR SELECT
  USING (org_id = app.current_org_id());

CREATE POLICY career_path_insert ON career_path FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('career_path', 'write', app.current_employee_id()));

CREATE POLICY career_path_update ON career_path FOR UPDATE
  USING (org_id = app.current_org_id()
         AND app.can_access('career_path', 'write', app.current_employee_id()))
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('career_path', 'write', app.current_employee_id()));

-- ---------------------------------------------------------------------------
-- Development plans -- personal, visible up the reporting line
-- ---------------------------------------------------------------------------

CREATE POLICY development_plan_select ON development_plan FOR SELECT
  USING (org_id = app.current_org_id()
         AND (employee_id = app.current_employee_id()
              OR app.can_access('development_plan', 'read', employee_id)));

-- An employee may draft their own plan; a manager may draft one for a report.
-- Self-authorship matters here: a development plan written entirely *at* someone
-- rarely gets followed.
CREATE POLICY development_plan_insert ON development_plan FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND (employee_id = app.current_employee_id()
                   OR app.can_access('development_plan', 'write', employee_id)));

CREATE POLICY development_plan_update ON development_plan FOR UPDATE
  USING (org_id = app.current_org_id()
         AND (employee_id = app.current_employee_id()
              OR app.can_access('development_plan', 'write', employee_id)))
  WITH CHECK (org_id = app.current_org_id()
              AND (employee_id = app.current_employee_id()
                   OR app.can_access('development_plan', 'write', employee_id)));

-- Actions inherit the plan's visibility by re-entering its RLS.
CREATE POLICY dev_action_select ON dev_action FOR SELECT
  USING (EXISTS (SELECT 1 FROM development_plan p
                  WHERE p.id = dev_action.development_plan_id));

CREATE POLICY dev_action_insert ON dev_action FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM development_plan p
     WHERE p.id = dev_action.development_plan_id
       AND (p.employee_id = app.current_employee_id()
            OR app.can_access('development_plan', 'write', p.employee_id))));

CREATE POLICY dev_action_update ON dev_action FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM development_plan p
     WHERE p.id = dev_action.development_plan_id
       AND (p.employee_id = app.current_employee_id()
            OR app.can_access('development_plan', 'write', p.employee_id))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM development_plan p
     WHERE p.id = dev_action.development_plan_id
       AND (p.employee_id = app.current_employee_id()
            OR app.can_access('development_plan', 'write', p.employee_id))));

-- ---------------------------------------------------------------------------
-- Learning assignments
-- ---------------------------------------------------------------------------

CREATE POLICY learning_assignment_select ON learning_assignment FOR SELECT
  USING (org_id = app.current_org_id()
         AND (employee_id = app.current_employee_id()
              OR app.can_access('development_plan', 'read', employee_id)));

CREATE POLICY learning_assignment_insert ON learning_assignment FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND (employee_id = app.current_employee_id()
                   OR app.can_access('development_plan', 'write', employee_id)));

-- The employee updates their own progress. Someone else marking your training
-- complete on your behalf is a record nobody should trust.
CREATE POLICY learning_assignment_update ON learning_assignment FOR UPDATE
  USING (org_id = app.current_org_id()
         AND (employee_id = app.current_employee_id()
              OR app.can_access('development_plan', 'write', employee_id)))
  WITH CHECK (org_id = app.current_org_id()
              AND (employee_id = app.current_employee_id()
                   OR app.can_access('development_plan', 'write', employee_id)));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.seed_phase6_grants(p_org_id UUID) RETURNS VOID
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
    -- Employees own their development: read AND write their own plan.
    (p_org_id, v_employee, 'development_plan', 'read', 'self'),
    (p_org_id, v_employee, 'development_plan', 'write', 'self'),

    (p_org_id, v_manager, 'development_plan', 'read', 'subtree'),
    (p_org_id, v_manager, 'development_plan', 'write', 'direct_reports'),

    (p_org_id, v_hr_partner, 'development_plan', 'read', 'department'),
    (p_org_id, v_hr_partner, 'development_plan', 'write', 'department'),
    (p_org_id, v_hr_partner, 'learning', 'write', 'department'),

    (p_org_id, v_hr_admin, 'development_plan', 'read', 'org'),
    (p_org_id, v_hr_admin, 'development_plan', 'write', 'org'),
    (p_org_id, v_hr_admin, 'learning', 'write', 'org'),
    (p_org_id, v_hr_admin, 'career_path', 'write', 'org')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organization LOOP
    PERFORM app.seed_phase6_grants(v_org);
  END LOOP;
END $$;

COMMIT;
