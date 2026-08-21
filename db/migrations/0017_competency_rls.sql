-- 0017_competency_rls.sql
-- RLS and grants for Phase 4.
--
-- Written tenant-scoped from the start (decisions.md D-008). Every policy here
-- carries an org predicate; none uses the org-blind
-- "current_employee_id() IS NOT NULL" pattern that leaked in 0004-0014.

BEGIN;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['competency_framework', 'competency', 'competency_level',
                           'position_competency_map', 'competency_assessment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO hr_app', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Framework definitions -- readable across the tenant, writable by HR
-- ---------------------------------------------------------------------------
-- Employees must be able to read the framework they are assessed against.
-- A competency model nobody can see is not a development tool, it is a secret
-- scoring rubric.

CREATE POLICY competency_framework_select ON competency_framework FOR SELECT
  USING (org_id = app.current_org_id());

CREATE POLICY competency_framework_insert ON competency_framework FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('competency', 'write', app.current_employee_id()));

CREATE POLICY competency_framework_update ON competency_framework FOR UPDATE
  USING (org_id = app.current_org_id()
         AND app.can_access('competency', 'write', app.current_employee_id()))
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('competency', 'write', app.current_employee_id()));

-- Child tables inherit through the framework, whose policy is tenant-scoped.
CREATE POLICY competency_select ON competency FOR SELECT
  USING (EXISTS (SELECT 1 FROM competency_framework f WHERE f.id = competency.framework_id));

CREATE POLICY competency_insert ON competency FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM competency_framework f
     WHERE f.id = competency.framework_id
       AND app.can_access('competency', 'write', app.current_employee_id())));

CREATE POLICY competency_update ON competency FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM competency_framework f
     WHERE f.id = competency.framework_id
       AND app.can_access('competency', 'write', app.current_employee_id())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM competency_framework f
     WHERE f.id = competency.framework_id
       AND app.can_access('competency', 'write', app.current_employee_id())));

CREATE POLICY competency_level_select ON competency_level FOR SELECT
  USING (EXISTS (SELECT 1 FROM competency c WHERE c.id = competency_level.competency_id));

CREATE POLICY competency_level_insert ON competency_level FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM competency c
     WHERE c.id = competency_level.competency_id
       AND app.can_access('competency', 'write', app.current_employee_id())));

CREATE POLICY competency_level_update ON competency_level FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM competency c
     WHERE c.id = competency_level.competency_id
       AND app.can_access('competency', 'write', app.current_employee_id())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM competency c
     WHERE c.id = competency_level.competency_id
       AND app.can_access('competency', 'write', app.current_employee_id())));

-- Position requirements are job descriptions, not personal data.
CREATE POLICY position_competency_select ON position_competency_map FOR SELECT
  USING (org_id = app.current_org_id());

CREATE POLICY position_competency_insert ON position_competency_map FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('competency', 'write', app.current_employee_id()));

CREATE POLICY position_competency_update ON position_competency_map FOR UPDATE
  USING (org_id = app.current_org_id()
         AND app.can_access('competency', 'write', app.current_employee_id()))
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('competency', 'write', app.current_employee_id()));

-- ---------------------------------------------------------------------------
-- Assessments -- personal, and review-gated where they came from a review
-- ---------------------------------------------------------------------------
-- The first clause is the important one. An assessment attached to a review
-- delegates visibility to review_instance, which already encodes the release
-- rule: the subject cannot read a supervisor's judgement before sign-off, and
-- can read it afterwards. Restating that rule here would let the two drift.

CREATE POLICY competency_assessment_select ON competency_assessment FOR SELECT
  USING (
    org_id = app.current_org_id()
    AND (
      -- Tied to a review: inherit that review's visibility exactly.
      (review_instance_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM review_instance ri
                    WHERE ri.id = competency_assessment.review_instance_id))
      -- Standalone: the subject may always see it, plus anyone with the grant.
      OR (review_instance_id IS NULL
          AND (subject_employee_id = app.current_employee_id()
               OR app.can_access('competency', 'read', subject_employee_id)))
    )
  );

-- assessed_by is pinned to the caller so an assessment cannot be attributed to
-- someone else.
CREATE POLICY competency_assessment_insert ON competency_assessment FOR INSERT
  WITH CHECK (
    org_id = app.current_org_id()
    AND assessed_by = app.current_employee_id()
    AND subject_employee_id <> app.current_employee_id()
    AND app.can_access('competency', 'assess', subject_employee_id)
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.seed_phase4_grants(p_org_id UUID) RETURNS VOID
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
    -- Employees read their own gap report; that is the point of publishing a
    -- competency model. They cannot assess anyone, including themselves.
    (p_org_id, v_employee, 'competency', 'read', 'self'),

    (p_org_id, v_manager, 'competency', 'read', 'subtree'),
    (p_org_id, v_manager, 'competency', 'assess', 'direct_reports'),

    (p_org_id, v_hr_partner, 'competency', 'read', 'department'),
    (p_org_id, v_hr_partner, 'competency', 'assess', 'department'),

    (p_org_id, v_hr_admin, 'competency', 'read', 'org'),
    (p_org_id, v_hr_admin, 'competency', 'assess', 'org'),
    (p_org_id, v_hr_admin, 'competency', 'write', 'org')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organization LOOP
    PERFORM app.seed_phase4_grants(v_org);
  END LOOP;
END $$;

COMMIT;
