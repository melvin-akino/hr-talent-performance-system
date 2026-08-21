-- 0004_rls.sql
-- Row-level security. This is the security boundary (decisions.md D-003);
-- application-layer checks are UX only.
--
-- FORCE ROW LEVEL SECURITY is applied to every table. Plain ENABLE is bypassed
-- by the table OWNER, and the owner here is hr_migrator -- so without FORCE, a
-- migration-role connection would silently see everything. FORCE closes that.

BEGIN;

-- The app role can act on tables but owns nothing.
GRANT USAGE ON SCHEMA public, app TO hr_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO hr_app;
-- Deliberately NO DELETE: soft-delete only (architecture.md principle 4).
-- audit_log is insert-only from the app's perspective; the rules above make
-- UPDATE/DELETE no-ops regardless.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hr_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO hr_app;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization', 'employment_type', 'department', 'position',
    'employee', 'employment', 'reporting_line',
    'app_role', 'role_assignment', 'access_grant', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- employee
-- ---------------------------------------------------------------------------
-- Read: self, plus anyone can_access() permits for resource 'employee'.
-- Note there is no blanket "all active employees are visible" policy. If a
-- directory feature is wanted later, it gets an explicit narrow view exposing
-- only name/department -- not a widened policy here.

CREATE POLICY employee_select ON employee FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      id = app.current_employee_id()
      OR app.can_access('employee', 'read', id)
    )
  );

CREATE POLICY employee_insert ON employee FOR INSERT
  WITH CHECK (app.can_access('employee', 'write', id));

CREATE POLICY employee_update ON employee FOR UPDATE
  USING (app.can_access('employee', 'write', id))
  WITH CHECK (app.can_access('employee', 'write', id));

-- ---------------------------------------------------------------------------
-- employment / reporting_line -- visibility follows the subject employee
-- ---------------------------------------------------------------------------

CREATE POLICY employment_select ON employment FOR SELECT
  USING (
    employee_id = app.current_employee_id()
    OR app.can_access('employee', 'read', employee_id)
  );

CREATE POLICY employment_write ON employment FOR INSERT
  WITH CHECK (app.can_access('employment', 'write', employee_id));

CREATE POLICY employment_update ON employment FOR UPDATE
  USING (app.can_access('employment', 'write', employee_id))
  WITH CHECK (app.can_access('employment', 'write', employee_id));

-- An employee may always see who they report to, and a supervisor may always
-- see the lines that make them a supervisor. Without the second clause a
-- manager could not render their own team list.
CREATE POLICY reporting_line_select ON reporting_line FOR SELECT
  USING (
    employee_id = app.current_employee_id()
    OR supervisor_employee_id = app.current_employee_id()
    OR app.can_access('employee', 'read', employee_id)
  );

CREATE POLICY reporting_line_write ON reporting_line FOR INSERT
  WITH CHECK (app.can_access('reporting_line', 'write', employee_id));

CREATE POLICY reporting_line_update ON reporting_line FOR UPDATE
  USING (app.can_access('reporting_line', 'write', employee_id))
  WITH CHECK (app.can_access('reporting_line', 'write', employee_id));

-- ---------------------------------------------------------------------------
-- Reference data -- readable by any authenticated employee
-- ---------------------------------------------------------------------------
-- Department and position names are not sensitive; an org chart is normal
-- workplace information. Writes remain restricted.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization', 'department', 'position', 'employment_type']
  LOOP
    -- Suffix concatenated before %I quoting -- see the note in 0003.
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT
         USING (app.current_employee_id() IS NOT NULL)', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT
         WITH CHECK (app.can_access(%L, ''write'', app.current_employee_id()))',
      t || '_insert', t, t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE
         USING (app.can_access(%L, ''write'', app.current_employee_id()))
         WITH CHECK (app.can_access(%L, ''write'', app.current_employee_id()))',
      t || '_update', t, t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Security tables -- only a security admin may read or change them
-- ---------------------------------------------------------------------------
-- Everyone may read their OWN role assignments (the UI needs it to decide what
-- to render), but nobody may read anyone else's without the admin role, and
-- nobody may grant themselves anything.

CREATE POLICY role_assignment_select ON role_assignment FOR SELECT
  USING (
    employee_id = app.current_employee_id()
    OR app.can_access('role_assignment', 'read', employee_id)
  );

CREATE POLICY role_assignment_write ON role_assignment FOR INSERT
  WITH CHECK (
    app.can_access('role_assignment', 'write', employee_id)
    -- Self-escalation guard: you may not grant a role to yourself, even as a
    -- security admin. Two people must be involved.
    AND employee_id <> app.current_employee_id()
  );

CREATE POLICY role_assignment_update ON role_assignment FOR UPDATE
  USING (app.can_access('role_assignment', 'write', employee_id)
         AND employee_id <> app.current_employee_id())
  WITH CHECK (app.can_access('role_assignment', 'write', employee_id)
              AND employee_id <> app.current_employee_id());

CREATE POLICY app_role_select ON app_role FOR SELECT
  USING (app.current_employee_id() IS NOT NULL);

CREATE POLICY access_grant_select ON access_grant FOR SELECT
  USING (app.can_access('access_grant', 'read', app.current_employee_id()));

CREATE POLICY access_grant_write ON access_grant FOR INSERT
  WITH CHECK (app.can_access('access_grant', 'write', app.current_employee_id()));

-- ---------------------------------------------------------------------------
-- audit_log -- readable only by those who may read the subject's data
-- ---------------------------------------------------------------------------
-- INSERT is unrestricted because rows are written by SECURITY DEFINER triggers
-- on behalf of the acting user; the rules in 0003 make the log immutable.

CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (TRUE);

CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (app.can_access('audit_log', 'read', COALESCE(actor_employee_id,
                                                      app.current_employee_id())));

COMMIT;
