-- 0006_identity_link.sql
-- Authentication bootstrap.
--
-- Chicken-and-egg problem: resolving a token subject to an employee id happens
-- BEFORE any identity is established, so `app.current_employee_id()` is NULL
-- and every RLS policy correctly denies. The login path therefore needs one
-- narrow, audited SECURITY DEFINER function rather than a policy exemption.
--
-- This function is the ONLY sanctioned way to read employee data without an
-- established identity. It returns a single id and nothing else -- it cannot be
-- used to enumerate staff, and it will not link an already-claimed record.

BEGIN;

CREATE FUNCTION app.resolve_employee_by_subject(
  p_subject TEXT,
  p_email   CITEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_subject IS NULL OR length(trim(p_subject)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
    FROM employee
   WHERE idp_subject = p_subject
     AND deleted_at IS NULL
     AND status <> 'separated';

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  IF p_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- First login. `idp_subject IS NULL` is the safety clause: an employee
  -- already bound to an IdP account can never be re-bound to a different one
  -- by presenting a matching email.
  UPDATE employee
     SET idp_subject = p_subject
   WHERE work_email = p_email
     AND idp_subject IS NULL
     AND deleted_at IS NULL
     AND status <> 'separated'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION app.resolve_employee_by_subject(TEXT, CITEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_employee_by_subject(TEXT, CITEXT) TO hr_app;

COMMENT ON FUNCTION app.resolve_employee_by_subject IS
  'Login-time identity resolution. SECURITY DEFINER by necessity: runs before '
  'an RLS identity exists. Deliberately returns only a UUID.';

COMMIT;
