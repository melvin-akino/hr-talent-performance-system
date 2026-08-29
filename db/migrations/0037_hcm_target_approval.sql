-- 0037_hcm_target_approval.sql
-- C5: HCM approves targets before they count (requirements §4.3).
--
-- Their step 3 reads "HCM sets timeline, approves targets, revises". The
-- timeline half already exists — goal periods and review cycles both carry
-- their dates. What is missing is the approval: today a goal goes active the
-- moment the supervisor approves it, and HCM never sees it.
--
-- WHY THIS IS OPTIONAL, AND OFF BY DEFAULT.
--
-- A second mandatory gate on every goal in every tenant would change how the
-- system already behaves for everyone, to satisfy one client's process. It is a
-- per-period switch instead: `goal_period.requires_hcm_approval`. Off, the
-- existing single-approval flow is untouched; on, supervisor approval parks the
-- goal at `pending_hcm` and HCM releases it.
--
-- Per PERIOD rather than per organisation because the client's own document
-- describes this for KPI target-setting specifically, and a company that wants
-- the gate on annual targets may not want it on a project period. Making it a
-- property of the period also means turning it on cannot retroactively
-- un-approve goals that are already active in a previous one.

BEGIN;

ALTER TABLE goal_period
  ADD COLUMN requires_hcm_approval BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN goal_period.requires_hcm_approval IS
  'When true, a supervisor-approved goal waits at pending_hcm until HCM '
  'releases it (requirements 4.3). Off by default: a second gate on every '
  'tenant is not ours to impose.';

-- The waiting room between the supervisor and active.
ALTER TYPE goal_state ADD VALUE IF NOT EXISTS 'pending_hcm' AFTER 'pending_approval';

COMMIT;

-- A new enum value cannot be used in the same transaction that adds it.
BEGIN;

ALTER TABLE goal
  ADD COLUMN hcm_approved_by UUID REFERENCES employee(id),
  ADD COLUMN hcm_approved_at TIMESTAMPTZ,
  /*
   * Why HCM sent it back. Their step says "approves targets, revises" — a
   * revision with no reason attached is one the supervisor has to guess at,
   * and guessing produces a resubmission with the same problem.
   */
  ADD COLUMN hcm_revision_note TEXT,

  ADD CONSTRAINT goal_hcm_approval_complete CHECK (
    (hcm_approved_by IS NULL) = (hcm_approved_at IS NULL)
  );

/*
 * HCM cannot approve their own target, for the same reason a supervisor cannot
 * approve their own goal (0008). Stated in the database rather than only in the
 * service, because the service is one of several ways a row can be written.
 */
ALTER TABLE goal
  ADD CONSTRAINT goal_hcm_approver_not_subject
    CHECK (hcm_approved_by IS NULL OR hcm_approved_by <> employee_id);

COMMENT ON COLUMN goal.hcm_revision_note IS
  'Why HCM sent the target back. Cleared when it is resubmitted, so a stale '
  'note cannot read as a comment on the current version.';

/*
 * The grant that releases a target.
 *
 * A distinct action rather than reusing 'approve': a supervisor holds
 * goal:approve over their own reports, and if HCM's release used the same
 * action every supervisor would acquire it. Two gates that one role can pass
 * alone is not two gates.
 */
CREATE FUNCTION app.seed_hcm_target_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_hr_admin   UUID;
  v_hr_partner UUID;
BEGIN
  SELECT id INTO v_hr_admin   FROM app_role WHERE org_id = p_org_id AND code = 'hr_admin';
  SELECT id INTO v_hr_partner FROM app_role WHERE org_id = p_org_id AND code = 'hr_partner';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  VALUES
    (p_org_id, v_hr_admin,   'goal_target', 'approve', 'org'),
    (p_org_id, v_hr_partner, 'goal_target', 'approve', 'org')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_hcm_target_grants(r.id);
  END LOOP;
END $do$;

/*
 * Where a supervisor's approval lands, given the period's setting.
 *
 * One function so the answer is written once. The service asks it rather than
 * repeating the condition, and a period switched on mid-flight changes only
 * what happens next -- goals already active stay active.
 */
CREATE FUNCTION app.goal_state_after_supervisor_approval(p_goal UUID)
RETURNS goal_state
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p.requires_hcm_approval THEN 'pending_hcm'::goal_state
              ELSE 'active'::goal_state END
    FROM goal g JOIN goal_period p ON p.id = g.goal_period_id
   WHERE g.id = p_goal;
$$;

COMMENT ON FUNCTION app.goal_state_after_supervisor_approval IS
  'Whether supervisor approval activates a goal or parks it for HCM. Asked, '
  'not repeated: one place decides, so the two paths cannot drift.';

COMMIT;

BEGIN;

/*
 * The state machine, extended for the second gate.
 *
 * Replaced rather than added to, because a transition table split across two
 * migrations is one nobody can read in full. The original (0008) stays as the
 * record of what the rules were before the gate existed.
 */
CREATE OR REPLACE FUNCTION app.goal_state_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_allowed goal_state[];
BEGIN
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE OLD.state
    WHEN 'draft'            THEN ARRAY['pending_approval', 'active', 'cancelled']::goal_state[]
    -- A supervisor's approval now leads either to active or to the HCM queue,
    -- depending on the period. Both are permitted here; which one actually
    -- happens is app.goal_state_after_supervisor_approval().
    WHEN 'pending_approval' THEN ARRAY['draft', 'pending_hcm', 'active', 'cancelled']::goal_state[]
    -- Sent back to draft rather than to the supervisor: HCM revises a target
    -- because the target is wrong, and the person who wrote it has to rewrite
    -- it. Returning it to the supervisor's queue would ask them to approve the
    -- same text a second time.
    WHEN 'pending_hcm'      THEN ARRAY['draft', 'active', 'cancelled']::goal_state[]
    WHEN 'active'           THEN ARRAY['achieved', 'missed', 'cancelled']::goal_state[]
    ELSE ARRAY[]::goal_state[]   -- achieved / missed / cancelled are terminal
  END;

  IF NOT (NEW.state = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Invalid goal transition % -> %', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'active' AND NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'A goal cannot become active without an approver'
      USING ERRCODE = 'check_violation';
  END IF;

  /*
   * The second gate, made real.
   *
   * Without this, a goal parked at pending_hcm could be moved straight to
   * active by anything that writes the state column, and the HCM approval
   * would be a step people believed in rather than one the system kept.
   */
  IF OLD.state = 'pending_hcm' AND NEW.state = 'active'
     AND NEW.hcm_approved_by IS NULL THEN
    RAISE EXCEPTION 'A target awaiting HCM cannot become active without an HCM approver'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.employee_id THEN
    RAISE EXCEPTION 'An employee cannot approve their own goal'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Sending a target back clears the approvals it had. Otherwise a revised
  -- goal would still carry the signature of somebody who approved a different
  -- version of it.
  IF NEW.state = 'draft' AND OLD.state IN ('pending_approval', 'pending_hcm') THEN
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.hcm_approved_by := NULL;
    NEW.hcm_approved_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

BEGIN;

/*
 * The two events the second gate needs.
 *
 * Without `goal.awaiting_hcm` a supervisor's approval would be met with silence
 * on the employee's side, which reads as the supervisor having done nothing.
 * Without `goal.revision_requested` a target sent back would simply reappear in
 * their drafts with no explanation of why.
 */
CREATE FUNCTION app.seed_hcm_target_templates(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_template (
    org_id, code, version, description, subject, body_text, is_active, published_at)
  VALUES
    (p_org_id, 'goal.awaiting_hcm', 1,
     'A supervisor approved a target and it now waits for HCM',
     'Target approved by your supervisor: {{goalTitle}}',
     E'Hello,

'
     'Your target "{{goalTitle}}" was approved by {{approverName}} and is now '
     'with HCM for release.

'
     '-- This is an automated message.',
     TRUE, now()),

    (p_org_id, 'goal.revision_requested', 1,
     'HCM sent a target back to be rewritten',
     'Target sent back for revision: {{goalTitle}}',
     E'Hello,

'
     'HCM has asked for changes to your target "{{goalTitle}}" before it can '
     'be released:

'
     '  {{note}}

'
     'It is back in your drafts. Revise it and submit it again.

'
     '-- This is an automated message.',
     TRUE, now())
  ON CONFLICT (org_id, code, version) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_hcm_target_templates(r.id);
  END LOOP;
END $do$;

COMMIT;
