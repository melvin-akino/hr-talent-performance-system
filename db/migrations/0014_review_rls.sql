-- 0014_review_rls.sql
-- Phase 3, part 3: RLS for reviews.
--
-- The rule that matters most:
--   AN EMPLOYEE MUST NOT SEE THEIR SUPERVISOR'S ASSESSMENT BEFORE RELEASE.
--
-- A manager drafting candid feedback must be able to do so without the subject
-- reading it in real time. Equally, once the review is signed off, the subject
-- MUST be able to read it -- a performance record you cannot see is
-- indefensible. Both halves are enforced below via app.review_released().

BEGIN;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['review_cycle', 'review_cycle_phase', 'review_summary',
                           'review_instance', 'form_response'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO hr_app', t);
  END LOOP;
END $$;

-- Cycle definitions are org-wide readable; everyone needs to know a review is
-- running and when it closes.
CREATE POLICY review_cycle_select ON review_cycle FOR SELECT
  USING (app.current_employee_id() IS NOT NULL);
CREATE POLICY review_cycle_insert ON review_cycle FOR INSERT
  WITH CHECK (app.can_access('review_cycle', 'write', app.current_employee_id()));
CREATE POLICY review_cycle_update ON review_cycle FOR UPDATE
  USING (app.can_access('review_cycle', 'write', app.current_employee_id()))
  WITH CHECK (app.can_access('review_cycle', 'write', app.current_employee_id()));

CREATE POLICY review_phase_select ON review_cycle_phase FOR SELECT
  USING (app.current_employee_id() IS NOT NULL);
CREATE POLICY review_phase_insert ON review_cycle_phase FOR INSERT
  WITH CHECK (app.can_access('review_cycle', 'write', app.current_employee_id()));
CREATE POLICY review_phase_update ON review_cycle_phase FOR UPDATE
  USING (app.can_access('review_cycle', 'write', app.current_employee_id()))
  WITH CHECK (app.can_access('review_cycle', 'write', app.current_employee_id()));

-- ---------------------------------------------------------------------------
-- review_instance
-- ---------------------------------------------------------------------------

CREATE POLICY review_instance_select ON review_instance FOR SELECT
  USING (
    -- Reviewers always see their own work in progress.
    reviewer_employee_id = app.current_employee_id()
    -- The subject sees their OWN self-review at any time...
    OR (subject_employee_id = app.current_employee_id() AND reviewer_role = 'self')
    -- ...and everything else only after release.
    OR (subject_employee_id = app.current_employee_id()
        AND app.review_released(review_cycle_id, subject_employee_id))
    -- HR and managers with a review grant, per their scope.
    OR app.can_access('review', 'read', subject_employee_id)
  );

CREATE POLICY review_instance_insert ON review_instance FOR INSERT
  WITH CHECK (app.can_access('review', 'write', subject_employee_id));

-- Only the assigned reviewer may edit their own instance; HR may return or
-- reassign one.
CREATE POLICY review_instance_update ON review_instance FOR UPDATE
  USING (
    reviewer_employee_id = app.current_employee_id()
    OR app.can_access('review', 'write', subject_employee_id)
  )
  WITH CHECK (
    reviewer_employee_id = app.current_employee_id()
    OR app.can_access('review', 'write', subject_employee_id)
  );

-- ---------------------------------------------------------------------------
-- form_response -- inherits instance visibility
-- ---------------------------------------------------------------------------
-- EXISTS against review_instance re-enters that table's RLS, so the release
-- rule above is stated once and cannot drift.

CREATE POLICY form_response_select ON form_response FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM review_instance ri WHERE ri.id = form_response.review_instance_id));

CREATE POLICY form_response_insert ON form_response FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM review_instance ri
     WHERE ri.id = form_response.review_instance_id
       AND ri.reviewer_employee_id = app.current_employee_id()));

CREATE POLICY form_response_update ON form_response FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM review_instance ri
     WHERE ri.id = form_response.review_instance_id
       AND ri.reviewer_employee_id = app.current_employee_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM review_instance ri
     WHERE ri.id = form_response.review_instance_id
       AND ri.reviewer_employee_id = app.current_employee_id()));

-- ---------------------------------------------------------------------------
-- review_summary
-- ---------------------------------------------------------------------------

CREATE POLICY review_summary_select ON review_summary FOR SELECT
  USING (
    -- The subject sees their summary only once released. Before that, an
    -- unreleased rating is a draft opinion, not a record.
    (subject_employee_id = app.current_employee_id() AND released_at IS NOT NULL)
    OR app.can_access('review', 'read', subject_employee_id)
  );

CREATE POLICY review_summary_insert ON review_summary FOR INSERT
  WITH CHECK (app.can_access('review', 'write', subject_employee_id));

-- The subject may write ONLY their acknowledgement and comment; the WITH CHECK
-- cannot express "which columns", so the service restricts its UPDATE to those
-- two and the signoff trigger blocks rating changes after sign-off.
CREATE POLICY review_summary_update ON review_summary FOR UPDATE
  USING (
    (subject_employee_id = app.current_employee_id() AND released_at IS NOT NULL)
    OR app.can_access('review', 'write', subject_employee_id)
  )
  WITH CHECK (
    (subject_employee_id = app.current_employee_id() AND released_at IS NOT NULL)
    OR app.can_access('review', 'write', subject_employee_id)
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.seed_phase3_grants(p_org_id UUID) RETURNS VOID
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
    -- 'self' read is intentionally NOT granted here: an employee's access to
    -- their own review is governed by the release rule in the policy above,
    -- not by a grant that would bypass it.
    (p_org_id, v_manager, 'review', 'read', 'subtree'),
    (p_org_id, v_manager, 'review', 'write', 'direct_reports'),

    (p_org_id, v_hr_partner, 'review', 'read', 'department'),
    (p_org_id, v_hr_partner, 'review', 'write', 'department'),

    (p_org_id, v_hr_admin, 'review', 'read', 'org'),
    (p_org_id, v_hr_admin, 'review', 'write', 'org'),
    (p_org_id, v_hr_admin, 'review_cycle', 'write', 'org'),
    (p_org_id, v_hr_admin, 'form_template', 'write', 'org')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organization LOOP
    PERFORM app.seed_phase3_grants(v_org);
  END LOOP;
END $$;

COMMIT;
