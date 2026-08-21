-- 0005_baseline_roles.sql
-- Baseline role/grant matrix. Deliberately a MIGRATION, not runtime seed data:
-- an on-prem restore must come back with a working permission model, and
-- reproducing it by hand at 2am is how outages become breaches.
--
-- These are defaults. HR may add roles and grants at runtime via access_grant
-- ("viewing access - customizable"). Nothing below is hard-coded in the app.

BEGIN;

CREATE FUNCTION app.seed_baseline_roles(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_employee UUID;
  v_manager  UUID;
  v_hr_partner UUID;
  v_hr_admin UUID;
BEGIN
  INSERT INTO app_role (org_id, code, name, is_security_admin) VALUES
    (p_org_id, 'employee',   'Employee',       FALSE),
    (p_org_id, 'manager',    'People Manager', FALSE),
    (p_org_id, 'hr_partner', 'HR Partner',     FALSE),
    (p_org_id, 'hr_admin',   'HR Administrator', TRUE)
  ON CONFLICT (org_id, code) DO NOTHING;

  SELECT id INTO v_employee   FROM app_role WHERE org_id = p_org_id AND code = 'employee';
  SELECT id INTO v_manager    FROM app_role WHERE org_id = p_org_id AND code = 'manager';
  SELECT id INTO v_hr_partner FROM app_role WHERE org_id = p_org_id AND code = 'hr_partner';
  SELECT id INTO v_hr_admin   FROM app_role WHERE org_id = p_org_id AND code = 'hr_admin';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type, subtree_depth)
  VALUES
    -- Employee: sees only themselves.
    (p_org_id, v_employee, 'employee', 'read', 'self', NULL),

    -- Manager: reads their whole reporting subtree (skip-level included --
    -- a director must see their directors' teams). Cannot edit HR master data.
    (p_org_id, v_manager, 'employee', 'read', 'self', NULL),
    (p_org_id, v_manager, 'employee', 'read', 'subtree', NULL),

    -- HR Partner: scoped to the department subtree on their role_assignment.
    (p_org_id, v_hr_partner, 'employee', 'read', 'self', NULL),
    (p_org_id, v_hr_partner, 'employee', 'read', 'department', NULL),
    (p_org_id, v_hr_partner, 'employee', 'write', 'department', NULL),
    (p_org_id, v_hr_partner, 'employment', 'write', 'department', NULL),
    (p_org_id, v_hr_partner, 'reporting_line', 'write', 'department', NULL),
    (p_org_id, v_hr_partner, 'audit_log', 'read', 'department', NULL),

    -- HR Admin: org-wide, including the security tables.
    (p_org_id, v_hr_admin, 'employee', 'read', 'org', NULL),
    (p_org_id, v_hr_admin, 'employee', 'write', 'org', NULL),
    (p_org_id, v_hr_admin, 'employment', 'write', 'org', NULL),
    (p_org_id, v_hr_admin, 'reporting_line', 'write', 'org', NULL),
    (p_org_id, v_hr_admin, 'department', 'write', 'org', NULL),
    (p_org_id, v_hr_admin, 'position', 'write', 'org', NULL),
    (p_org_id, v_hr_admin, 'employment_type', 'write', 'org', NULL),
    (p_org_id, v_hr_admin, 'organization', 'write', 'org', NULL),
    (p_org_id, v_hr_admin, 'role_assignment', 'read', 'org', NULL),
    (p_org_id, v_hr_admin, 'role_assignment', 'write', 'org', NULL),
    (p_org_id, v_hr_admin, 'access_grant', 'read', 'org', NULL),
    (p_org_id, v_hr_admin, 'access_grant', 'write', 'org', NULL),
    (p_org_id, v_hr_admin, 'audit_log', 'read', 'org', NULL)
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

COMMIT;
