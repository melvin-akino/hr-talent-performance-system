-- 0018_reference_data_admin.sql
-- Makes departments and employment types safely administrable.
--
-- Both are currently created as a side effect of importing a 201 file, with no
-- way for HR to correct a derived code or a name afterwards. Adding CRUD means
-- adding the guards that stop CRUD doing damage.

BEGIN;

-- ---------------------------------------------------------------------------
-- One live department per code
-- ---------------------------------------------------------------------------
-- The original UNIQUE (org_id, code, effective_from) permits two rows with the
-- same code and different start dates, which is what temporal versioning needs
-- -- but it also lets an admin create a second live 'OPS' by accident, and the
-- importer would then resolve department codes nondeterministically.

CREATE UNIQUE INDEX department_current_code_uq
  ON department (org_id, code)
  WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- A department cannot be closed while people are still in it
-- ---------------------------------------------------------------------------
-- Closing a department does not break the foreign key, which is exactly the
-- danger: the employments stay pointing at a department that no longer exists
-- as of today, and every as-of-date query silently stops resolving them.

CREATE FUNCTION app.department_close_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_headcount INT;
BEGIN
  IF NEW.effective_to IS NOT NULL AND OLD.effective_to IS NULL THEN
    SELECT count(*) INTO v_headcount
      FROM employment em
      JOIN employee e ON e.id = em.employee_id
     WHERE em.department_id = NEW.id
       AND (em.effective_to IS NULL OR em.effective_to > NEW.effective_to)
       AND e.deleted_at IS NULL
       AND e.status <> 'separated';

    IF v_headcount > 0 THEN
      RAISE EXCEPTION
        'Cannot close department "%": % employee(s) are still assigned to it. '
        'Move them first.', NEW.name, v_headcount
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER department_close_requires_empty
  BEFORE UPDATE ON department
  FOR EACH ROW EXECUTE FUNCTION app.department_close_guard();

-- A department cannot become its own ancestor. The recursive department walk in
-- app.department_in_subtree() is depth-capped, so a cycle would not hang -- but
-- it would silently produce wrong departmental visibility for HR partners.
CREATE FUNCTION app.department_no_cycle() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_cursor UUID := NEW.parent_department_id;
  v_depth  INT := 0;
BEGIN
  WHILE v_cursor IS NOT NULL LOOP
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'Department hierarchy would form a cycle'
        USING ERRCODE = 'check_violation';
    END IF;
    v_depth := v_depth + 1;
    IF v_depth > 32 THEN
      RAISE EXCEPTION 'Department hierarchy exceeds maximum depth of 32'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_department_id INTO v_cursor FROM department WHERE id = v_cursor;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER department_acyclic
  BEFORE INSERT OR UPDATE OF parent_department_id ON department
  FOR EACH ROW WHEN (NEW.parent_department_id IS NOT NULL)
  EXECUTE FUNCTION app.department_no_cycle();

-- ---------------------------------------------------------------------------
-- Employment types
-- ---------------------------------------------------------------------------
-- `is_eligible_for_review` decides who a review cycle picks up, so HR must own
-- it rather than inheriting whatever the importer guessed. Deactivating a type
-- that is still in use has the same problem as closing a populated department.

CREATE FUNCTION app.employment_type_deactivate_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_headcount INT;
BEGIN
  IF NEW.is_active = FALSE AND OLD.is_active = TRUE THEN
    SELECT count(*) INTO v_headcount
      FROM employment em
      JOIN employee e ON e.id = em.employee_id
     WHERE em.employment_type_id = NEW.id
       AND em.effective_to IS NULL
       AND e.deleted_at IS NULL
       AND e.status <> 'separated';

    IF v_headcount > 0 THEN
      RAISE EXCEPTION
        'Cannot deactivate employment type "%": % employee(s) currently hold it.',
        NEW.name, v_headcount
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER employment_type_deactivate_requires_empty
  BEFORE UPDATE ON employment_type
  FOR EACH ROW EXECUTE FUNCTION app.employment_type_deactivate_guard();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- hr_admin already holds 'department' and 'employment_type' write org-wide from
-- migration 0005. HR partners get department read/write within their own
-- department subtree so they can maintain their own area's structure.

CREATE FUNCTION app.seed_reference_admin_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_hr_partner UUID;
BEGIN
  SELECT id INTO v_hr_partner FROM app_role
   WHERE org_id = p_org_id AND code = 'hr_partner';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  VALUES (p_org_id, v_hr_partner, 'department', 'write', 'department')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organization LOOP
    PERFORM app.seed_reference_admin_grants(v_org);
  END LOOP;
END $$;

COMMIT;
