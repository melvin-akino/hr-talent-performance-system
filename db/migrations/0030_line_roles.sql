-- 0030_line_roles.sql
-- The line roles the client's access matrix names, and one narrow admin role.
--
-- Their document lists five user levels: HCM, DH (Department Head), Supervisor,
-- RH/AH (Regional / Area Head), and GM — plus a restricted pair, "Only HCM DM &
-- CB PW can set / reset scoring parameters".
--
-- Three of those already exist under different names, and adding duplicates
-- would be worse than useless:
--
--   HCM         -> hr_admin, which is exactly this: org-wide HR administration.
--   Supervisor  -> manager. DELIBERATELY NOT ADDED AS A NEW ROLE. `manager` is
--                  derived from the reporting lines by `hr sync-roles`, so it is
--                  always correct and never needs granting. A parallel
--                  `supervisor` role would have to be assigned by hand, would
--                  drift from the org chart within a month, and would leave two
--                  answers to "is this person someone's boss".
--   HR Partner  -> hr_partner, already scoped to a department subtree.
--
-- So this migration adds only what is genuinely missing.
--
-- ---------------------------------------------------------------------------
-- AREA HEAD NEEDS NO NEW MACHINERY
-- ---------------------------------------------------------------------------
-- An Area Head oversees an area. Migration 0027 made an area a `department` row
-- with unit_type = 'area', and `scope_type = 'department'` already resolves the
-- whole subtree beneath the node named on the role assignment. So an area head
-- is a role whose assignment points at an area node, and a department head is
-- the same role shape pointing at a department node. Nothing in can_access()
-- changes.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY LEFT OPEN
-- ---------------------------------------------------------------------------
-- Q6 and R4 are unanswered: whether RH and AH are one level or two, whether a
-- GM sees their division or the whole company, and who exactly holds "HCM DM"
-- and "CB PW". This migration therefore defines the roles and what each MAY do,
-- and assigns them to nobody. Assignment is a decision for the customer, made
-- through `hr grant-admin`-style operator commands or the UI, and it is
-- reversible; guessing at it here would not be.

BEGIN;

CREATE FUNCTION app.seed_line_role_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_dept_head     UUID;
  v_area_head     UUID;
  v_gm            UUID;
  v_scoring_admin UUID;
BEGIN
  INSERT INTO app_role (org_id, code, name, is_security_admin) VALUES
    (p_org_id, 'dept_head',     'Department Head',   FALSE),
    (p_org_id, 'area_head',     'Area Head',         FALSE),
    (p_org_id, 'gm',            'General Manager',   FALSE),
    -- Not a security admin: it administers SCORING, not access. Keeping the
    -- flag FALSE means holding it never confers the ability to widen itself.
    (p_org_id, 'scoring_admin', 'Scoring Administrator', FALSE)
  ON CONFLICT (org_id, code) DO NOTHING;

  SELECT id INTO v_dept_head     FROM app_role WHERE org_id = p_org_id AND code = 'dept_head';
  SELECT id INTO v_area_head     FROM app_role WHERE org_id = p_org_id AND code = 'area_head';
  SELECT id INTO v_gm            FROM app_role WHERE org_id = p_org_id AND code = 'gm';
  SELECT id INTO v_scoring_admin FROM app_role WHERE org_id = p_org_id AND code = 'scoring_admin';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type, subtree_depth)
  VALUES
    -- Department Head: reads their unit and everyone in it, and runs the
    -- evaluation steps their document assigns them (Step 4b: "DH - fills out /
    -- revises eval / recomm + Approves / Disapproves"). Writes reviews and
    -- goals for their unit; does NOT edit HR master data — that stays with HR.
    (p_org_id, v_dept_head, 'employee',    'read',  'self',       NULL),
    (p_org_id, v_dept_head, 'employee',    'read',  'department', NULL),
    (p_org_id, v_dept_head, 'goal',        'read',  'department', NULL),
    (p_org_id, v_dept_head, 'goal',        'write', 'department', NULL),
    (p_org_id, v_dept_head, 'review',      'read',  'department', NULL),
    (p_org_id, v_dept_head, 'review',      'write', 'department', NULL),
    (p_org_id, v_dept_head, 'pip',         'read',  'department', NULL),
    (p_org_id, v_dept_head, 'feedback',    'read',  'department', NULL),

    -- Area Head: the same shape, pointed at an area node instead. Identical
    -- grants on purpose — the difference between the two roles is WHERE the
    -- assignment points, not what the holder may do.
    (p_org_id, v_area_head, 'employee',    'read',  'self',       NULL),
    (p_org_id, v_area_head, 'employee',    'read',  'department', NULL),
    (p_org_id, v_area_head, 'goal',        'read',  'department', NULL),
    (p_org_id, v_area_head, 'goal',        'write', 'department', NULL),
    (p_org_id, v_area_head, 'review',      'read',  'department', NULL),
    (p_org_id, v_area_head, 'review',      'write', 'department', NULL),
    (p_org_id, v_area_head, 'pip',         'read',  'department', NULL),
    (p_org_id, v_area_head, 'feedback',    'read',  'department', NULL),

    -- General Manager: read across their scope, and no write. A GM reads the
    -- numbers; they do not fill in other people's evaluations. Scoped by
    -- assignment like the two above, so "division" or "company-wide" is a
    -- decision made when the role is granted rather than baked in here (Q6).
    (p_org_id, v_gm, 'employee',   'read', 'self',       NULL),
    (p_org_id, v_gm, 'employee',   'read', 'department', NULL),
    (p_org_id, v_gm, 'goal',       'read', 'department', NULL),
    (p_org_id, v_gm, 'review',     'read', 'department', NULL),
    (p_org_id, v_gm, 'pip',        'read', 'department', NULL),

    -- Scoring administrator: the narrow one. Their rule is that only two named
    -- people may "set / reset scoring parameters / fields", which is a much
    -- smaller thing than hr_admin. It is org-wide because scoring parameters
    -- are org-wide, and it carries no employee-data grant at all — holding it
    -- lets you change how scores are computed, not read anybody's score.
    (p_org_id, v_scoring_admin, 'scoring_parameter', 'read',  'org', NULL),
    (p_org_id, v_scoring_admin, 'scoring_parameter', 'write', 'org', NULL)
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION app.seed_line_role_grants(UUID) IS
  'Adds dept_head, area_head, gm and scoring_admin. Supervisor is deliberately '
  'absent: that is `manager`, derived from the reporting lines.';

-- Every existing tenant gets the roles, unassigned. Defining a role grants
-- nobody anything until someone holds it.
DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_line_role_grants(r.id);
  END LOOP;
END $do$;

COMMIT;
