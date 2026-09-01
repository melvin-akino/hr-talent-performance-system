-- 0041_peer_instrument.sql
-- D1: the fixed 30-point peer instrument, and accepting an invitation (§6.1).
--
--   Mastery                      5
--   Demeanor A (phone/messaging) 5
--   Demeanor B (in person)       5
--   Customer Service            10
--   Promptness                   5
--                               --
--                               30
--
-- The instrument itself is a form template like any other -- B1 built the point
-- machinery and B3 the seeding pattern, so §6.1 is a seed, not a subsystem. What
-- needs care is the two joins either side of it: a solicitation becoming a real
-- review, and who may read the result.
--
-- ANONYMITY IS NOT DECIDED HERE, AND MUST NOT BE DECIDED BY ACCIDENT.
--
-- Q5 is open. The existing policy (0014) lets a subject read any instance about
-- them once the review is released -- which, applied to a peer instance, would
-- disclose which colleague wrote it. That is precisely the question the client
-- has not answered, and shipping it as a side effect of adding a reviewer_role
-- would answer it for them, irreversibly, in the direction that cannot be taken
-- back.
--
-- So this adds a RESTRICTIVE policy: a subject never sees a peer instance,
-- whatever the permissive policies say. Restrictive rather than editing 0014's
-- rule, because ANDing a narrow exception is a change nobody can undo by
-- widening something else later without noticing.
--
-- When Q5 is answered:
--   * anonymous  -> this policy stays, and D4 shows the subject the average only;
--   * attributed -> drop this policy, and 0014's existing rule already does it.
-- Either answer is one migration. Neither requires unpicking anything.

BEGIN;

ALTER TYPE reviewer_role ADD VALUE IF NOT EXISTS 'peer' AFTER 'dept_head';

COMMIT;

BEGIN;

/*
 * A subject may not read a peer assessment of themselves.
 *
 * RESTRICTIVE, so it ANDs with everything else. The reviewer still sees their
 * own work, and HR still sees it under their grant -- this removes exactly one
 * audience, and only until Q5 says otherwise.
 */
CREATE POLICY review_instance_peer_not_to_subject ON review_instance
  AS RESTRICTIVE FOR SELECT
  USING (
    reviewer_role <> 'peer'
    OR subject_employee_id <> app.current_employee_id()
  );

COMMENT ON POLICY review_instance_peer_not_to_subject ON review_instance IS
  'Q5 is unanswered. Until it is, a subject does not learn which colleague '
  'assessed them -- a link disclosed cannot be undisclosed. Drop this policy '
  'if the client says peer reviews are attributed.';

/*
 * Accepting an invitation, which is where a solicitation becomes real work.
 *
 * D3 stopped at 'accepted' because the instrument did not exist. Now it does,
 * so acceptance creates the review instance in the same statement -- the two
 * apart would leave somebody who has agreed to review with nothing to fill in,
 * and a panel that looks complete from one table and empty from the other.
 *
 * The form is resolved by code rather than passed in: there is one peer
 * instrument (§6.1 is a fixed list), and letting a caller choose would make the
 * 30 points a property of the call site.
 */
CREATE FUNCTION app.accept_peer_solicitation(p_solicitation UUID)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_org      UUID;
  v_cycle    UUID;
  v_subject  UUID;
  v_reviewer UUID;
  v_version  UUID;
  v_instance UUID;
BEGIN
  SELECT org_id, review_cycle_id, subject_employee_id, reviewer_employee_id
    INTO v_org, v_cycle, v_subject, v_reviewer
    FROM peer_review_solicitation
   WHERE id = p_solicitation AND state = 'drawn';

  IF v_cycle IS NULL THEN
    RAISE EXCEPTION 'That invitation is not outstanding, or not yours to answer';
  END IF;

  SELECT v.id INTO v_version
    FROM form_template t
    JOIN form_version v ON v.form_template_id = t.id AND v.is_active
   WHERE t.org_id = v_org AND t.code = 'PEER-30'
   ORDER BY v.version DESC
   LIMIT 1;

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'No peer-review form is published for this organisation'
      USING HINT = 'Run provision-org, which seeds PEER-30.';
  END IF;

  UPDATE peer_review_solicitation SET state = 'accepted'
   WHERE id = p_solicitation;

  INSERT INTO review_instance (
    review_cycle_id, subject_employee_id, reviewer_employee_id,
    reviewer_role, form_version_id, state)
  VALUES (v_cycle, v_subject, v_reviewer, 'peer', v_version, 'not_started')
  RETURNING id INTO v_instance;

  RETURN v_instance;
END;
$$;

COMMENT ON FUNCTION app.accept_peer_solicitation IS
  'Accepts an invitation and creates the review instance in one statement. '
  'Apart, they leave a reviewer who has agreed with nothing to fill in.';

COMMIT;
