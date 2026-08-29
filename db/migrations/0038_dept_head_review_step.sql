-- 0038_dept_head_review_step.sql
-- C3: the Department Head revises, approves or disapproves (requirements §4.5b).
--
-- Their step 5b sits between the supervisor filling in an evaluation and it
-- becoming final. Our chain is self → supervisor → calibration → sign-off, and
-- the DH appears nowhere in it: `reviewer_role` has no `dept_head`, so a DH
-- cannot hold an instance, and there is no phase for them to work in.
--
-- WHY A REVIEW INSTANCE RATHER THAN A NEW MECHANISM.
--
-- A DH approval is an assessment step by a named person on a named subject
-- within a cycle, which is exactly what `review_instance` already is. Giving it
-- its own table would duplicate the confidentiality policies of 0014 -- the
-- ones deciding that a subject cannot read an unreleased assessment -- and two
-- copies of that rule is one more than can be kept in step.
--
-- It also means sign-off already waits for the DH: `signOff` refuses while any
-- instance for the subject is unsubmitted. The gate is a consequence of the
-- existing rule rather than a new check that could be forgotten.
--
-- DISAPPROVAL IS `returned`, WHICH ALSO ALREADY EXISTS.
--
-- `review_instance.state` has `returned` and `returned_reason`, and the return
-- path notifies the reviewer. A DH disapproving a supervisor's evaluation is
-- that same act performed by a different person, so it needs a permission, not
-- a mechanism.

BEGIN;

ALTER TYPE reviewer_role     ADD VALUE IF NOT EXISTS 'dept_head' AFTER 'supervisor';
ALTER TYPE review_phase_type ADD VALUE IF NOT EXISTS 'dept_head' AFTER 'supervisor';

COMMIT;

BEGIN;

/*
 * What a Department Head may do, and to whom.
 *
 * `review:write` over their department lets them hold their own instance.
 * `review:approve` is the new one: it is what permits returning somebody else's
 * submitted evaluation, and it is deliberately NOT held by `manager`.
 *
 * A supervisor returning their own submitted evaluation to themselves is not a
 * review step, it is an edit -- and the whole point of 5b is that a second
 * person looked. HR keeps it org-wide because somebody has to be able to unstick
 * a cycle when a DH is on leave.
 */
CREATE FUNCTION app.seed_dept_head_review_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_dept_head UUID;
  v_hr_admin  UUID;
BEGIN
  SELECT id INTO v_dept_head FROM app_role WHERE org_id = p_org_id AND code = 'dept_head';
  SELECT id INTO v_hr_admin  FROM app_role WHERE org_id = p_org_id AND code = 'hr_admin';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  VALUES
    (p_org_id, v_dept_head, 'review', 'read',    'department'),
    (p_org_id, v_dept_head, 'review', 'write',   'department'),
    (p_org_id, v_dept_head, 'review', 'approve', 'department'),
    (p_org_id, v_hr_admin,  'review', 'approve', 'org')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_dept_head_review_grants(r.id);
  END LOOP;
END $do$;

/*
 * Returning somebody else's evaluation needs review:approve on the subject.
 *
 * `returnForRevision` has no permission check of its own: it relies on
 * review_instance's UPDATE policy, which permits the ASSIGNED REVIEWER to edit
 * their own instance. That is right for filling one in and wrong for sending
 * one back -- as it stands a supervisor can return their own submitted
 * evaluation and rewrite it.
 *
 * To be exact about how bad that is: it is NOT silent. The state machine (0013)
 * refuses a return with no reason, and the audit trigger records both the
 * transition and the reason. What is missing is only that a second person has
 * to be the one doing it -- which is the entire content of their step 5b, so it
 * matters here even though nothing is hidden.
 */
CREATE FUNCTION app.can_return_review(p_instance UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM review_instance ri
     WHERE ri.id = p_instance
       AND app.can_access('review', 'approve', ri.subject_employee_id)
  );
$$;

COMMENT ON FUNCTION app.can_return_review IS
  'Whether the caller may send a submitted evaluation back. Distinct from '
  'writing one: the reviewer owns their own instance, but returning it is a '
  'second person''s judgement on it.';

COMMIT;
