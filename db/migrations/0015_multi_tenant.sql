-- 0015_multi_tenant.sql
-- Tenant isolation (decisions.md D-008).
--
-- Until this migration, "multi-tenant-ready" meant only that every table
-- carried org_id. Enforcement was absent, and a second organization would have
-- read the first one's data. Verified empirically on 2026-08-14: an HR admin in
-- org B saw org A's 8 employees, 4 departments and 4 KPI definitions through
-- the non-superuser app role with RLS enabled.
--
-- Two root causes, both fixed here:
--   1. app.can_access() resolved scope_type 'org' to a bare TRUE -- it never
--      compared the target's organization to the actor's.
--   2. Reference-data policies said "USING (current_employee_id() IS NOT NULL)",
--      i.e. any authenticated employee of any tenant.
--
-- Identity model (shared Keycloak realm): a token subject maps to exactly ONE
-- employee row, and that row's org_id IS the tenant. There is no tenant
-- selector and no tenant claim in the token -- the tenant is derived from the
-- authenticated person, which means it cannot be spoofed by the client.

BEGIN;

-- ---------------------------------------------------------------------------
-- Tenant identity
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.current_org_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT org_id FROM employee WHERE id = app.current_employee_id();
$$;

COMMENT ON FUNCTION app.current_org_id() IS
  'Tenant of the requesting employee. NULL when unauthenticated, which makes '
  'every org predicate below fail closed. SECURITY DEFINER because it must '
  'read employee before employee RLS has an org to compare against.';

-- ---------------------------------------------------------------------------
-- The authorization predicate, now tenant-aware
-- ---------------------------------------------------------------------------
-- Same signature, so all existing policies pick this up automatically. The
-- change is the leading tenant guard plus an org match on the role assignment.

CREATE OR REPLACE FUNCTION app.can_access(
  resource_type TEXT,
  action        grant_action,
  target_employee_id UUID,
  as_of         DATE DEFAULT CURRENT_DATE
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT CASE
    WHEN app.current_employee_id() IS NULL THEN FALSE
    WHEN app.current_org_id() IS NULL THEN FALSE
    -- TENANT GUARD. Nothing below can grant access across organizations, no
    -- matter which scope a role holds. Checked before any grant is considered.
    WHEN NOT EXISTS (
      SELECT 1 FROM employee te
       WHERE te.id = target_employee_id
         AND te.org_id = app.current_org_id()
    ) THEN FALSE
    ELSE EXISTS (
      SELECT 1
        FROM role_assignment ra
        JOIN access_grant ag ON ag.role_id = ra.role_id
       WHERE ra.employee_id = app.current_employee_id()
         -- Belt and braces: a role assignment from another tenant must never
         -- confer rights here, even if one were somehow created.
         AND ra.org_id = app.current_org_id()
         AND ag.org_id = app.current_org_id()
         AND ra.effective_from <= as_of
         AND (ra.effective_to IS NULL OR as_of < ra.effective_to)
         AND ag.resource_type = can_access.resource_type
         AND ag.action = can_access.action
         AND CASE ag.scope_type
               WHEN 'self' THEN
                 target_employee_id = app.current_employee_id()
               WHEN 'direct_reports' THEN
                 app.reports_to(target_employee_id,
                                app.current_employee_id(), as_of, 1::smallint)
               WHEN 'subtree' THEN
                 app.reports_to(target_employee_id,
                                app.current_employee_id(), as_of,
                                ag.subtree_depth)
               WHEN 'department' THEN
                 ra.scope_department_id IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM employment e
                    WHERE e.employee_id = target_employee_id
                      AND e.effective_from <= as_of
                      AND (e.effective_to IS NULL OR as_of < e.effective_to)
                      AND app.department_in_subtree(
                            e.department_id, ra.scope_department_id, as_of)
                 )
               -- 'org' now means "this organization", not "all of them".
               WHEN 'org' THEN TRUE
               ELSE FALSE
             END
    )
  END;
$$;

-- ---------------------------------------------------------------------------
-- Reference data: scope every previously org-blind policy
-- ---------------------------------------------------------------------------
-- These all read "any authenticated employee". They now read "any
-- authenticated employee OF THIS TENANT".

-- Tables that carry org_id directly.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'department', 'position', 'employment_type', 'app_role',
    'goal_period', 'kpi_definition', 'rating_scale', 'form_template',
    'form_template_assignment', 'review_cycle'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT
         USING (app.current_employee_id() IS NOT NULL
                AND org_id = app.current_org_id())', t || '_select', t);
  END LOOP;
END $$;

-- An organization row is visible only to its own members.
DROP POLICY IF EXISTS organization_select ON organization;
CREATE POLICY organization_select ON organization FOR SELECT
  USING (id = app.current_org_id());

-- Child tables with no org_id of their own inherit through their parent, whose
-- policy is now tenant-scoped.
DROP POLICY IF EXISTS rating_scale_point_select ON rating_scale_point;
CREATE POLICY rating_scale_point_select ON rating_scale_point FOR SELECT
  USING (EXISTS (SELECT 1 FROM rating_scale s
                  WHERE s.id = rating_scale_point.rating_scale_id));

DROP POLICY IF EXISTS form_version_select ON form_version;
CREATE POLICY form_version_select ON form_version FOR SELECT
  USING (EXISTS (SELECT 1 FROM form_template t
                  WHERE t.id = form_version.form_template_id));

DROP POLICY IF EXISTS review_phase_select ON review_cycle_phase;
CREATE POLICY review_phase_select ON review_cycle_phase FOR SELECT
  USING (EXISTS (SELECT 1 FROM review_cycle c
                  WHERE c.id = review_cycle_phase.review_cycle_id));

-- access_grant leaked every tenant's permission matrix: the policy authorised
-- the CALLER but never filtered the ROW.
DROP POLICY IF EXISTS access_grant_select ON access_grant;
CREATE POLICY access_grant_select ON access_grant FOR SELECT
  USING (org_id = app.current_org_id()
         AND app.can_access('access_grant', 'read', app.current_employee_id()));

DROP POLICY IF EXISTS access_grant_write ON access_grant;
CREATE POLICY access_grant_write ON access_grant FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('access_grant', 'write', app.current_employee_id()));

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
-- The audit policy keyed off the ACTOR, so rows written by system paths
-- (actor NULL) fell back to the caller and leaked across tenants. Give the log
-- its own org_id, captured from the audited row.

ALTER TABLE audit_log ADD COLUMN org_id UUID;

-- The append-only rules block the backfill, so lift them for the duration of
-- this migration and restore them immediately afterwards.
DROP RULE audit_log_no_update ON audit_log;

UPDATE audit_log
   SET org_id = COALESCE((new_data ->> 'org_id')::uuid,
                         (old_data ->> 'org_id')::uuid);

CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;

CREATE INDEX audit_log_org_idx ON audit_log (org_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION app.audit_row() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_changed TEXT[];
  v_record_id UUID;
  v_org_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_record_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_record_id := NEW.id;
    SELECT array_agg(key ORDER BY key) INTO v_changed
      FROM jsonb_each(v_old) o
     WHERE o.value IS DISTINCT FROM v_new -> o.key
       AND o.key NOT IN ('updated_at', 'updated_by');
    IF v_changed IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    v_old := to_jsonb(OLD);
    v_record_id := OLD.id;
  END IF;

  -- Prefer the audited row's own org; fall back to the actor's. Tables without
  -- an org_id column (child rows) yield NULL and are governed by the actor
  -- clause in the policy below.
  v_org_id := COALESCE((v_new ->> 'org_id')::uuid,
                       (v_old ->> 'org_id')::uuid,
                       app.current_org_id());

  INSERT INTO audit_log (
    table_name, record_id, operation, actor_employee_id,
    request_id, old_data, new_data, changed_columns, org_id
  ) VALUES (
    TG_TABLE_NAME, v_record_id, TG_OP::audit_operation,
    app.current_employee_id(),
    NULLIF(current_setting('app.request_id', true), ''),
    v_old, v_new, v_changed, v_org_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP POLICY IF EXISTS audit_log_select ON audit_log;
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (
    org_id IS NOT DISTINCT FROM app.current_org_id()
    AND app.can_access('audit_log', 'read',
                       COALESCE(actor_employee_id, app.current_employee_id()))
  );

-- ---------------------------------------------------------------------------
-- Referential integrity across tenants
-- ---------------------------------------------------------------------------
-- RLS stops a tenant READING another's rows, but plain foreign keys would still
-- permit WRITING a row that points across the boundary -- e.g. a goal in org A
-- naming an employee of org B. Composite keys make that structurally
-- impossible, with no trigger to maintain.

ALTER TABLE employee ADD CONSTRAINT employee_id_org_uq UNIQUE (id, org_id);

ALTER TABLE employment
  ADD CONSTRAINT employment_employee_same_org
  FOREIGN KEY (employee_id, org_id) REFERENCES employee (id, org_id);

ALTER TABLE reporting_line
  ADD CONSTRAINT reporting_line_employee_same_org
  FOREIGN KEY (employee_id, org_id) REFERENCES employee (id, org_id);

ALTER TABLE reporting_line
  ADD CONSTRAINT reporting_line_supervisor_same_org
  FOREIGN KEY (supervisor_employee_id, org_id) REFERENCES employee (id, org_id);

ALTER TABLE role_assignment
  ADD CONSTRAINT role_assignment_employee_same_org
  FOREIGN KEY (employee_id, org_id) REFERENCES employee (id, org_id);

ALTER TABLE goal
  ADD CONSTRAINT goal_employee_same_org
  FOREIGN KEY (employee_id, org_id) REFERENCES employee (id, org_id);

ALTER TABLE pip_plan
  ADD CONSTRAINT pip_plan_employee_same_org
  FOREIGN KEY (employee_id, org_id) REFERENCES employee (id, org_id);

-- ---------------------------------------------------------------------------
-- Identity uniqueness under a shared realm
-- ---------------------------------------------------------------------------
-- employee.idp_subject stays GLOBALLY unique. With one shared realm and no
-- tenant selector at login, a subject must resolve to exactly one employee
-- row -- otherwise resolve_employee_by_subject() would be ambiguous and login
-- non-deterministic.
--
-- CONSEQUENCE: a person belongs to exactly one tenant. Someone genuinely
-- working for two organizations needs two IdP accounts. If that becomes a real
-- requirement, it needs a tenant hint at login (separate realms, or a tenant
-- selector) -- not a relaxed constraint here.

COMMENT ON COLUMN employee.idp_subject IS
  'Keycloak subject. Globally unique by design: with a shared realm and no '
  'tenant selector, one subject must map to exactly one employee row. A person '
  'therefore belongs to exactly one tenant.';

COMMIT;
