-- 0046_unit_scope_predicate.sql
-- "Does this person have a unit at all?" — for the F3 dashboard (§7.3).
--
-- WHY THIS CANNOT BE AN INLINE QUERY, WHICH IS THE WHOLE POINT.
--
-- The obvious implementation is an EXISTS over role_assignment joined to
-- access_grant, written in the service. It returns FALSE for everybody who
-- should pass, and it took a debug session to see why: **access_grant is itself
-- protected**. Reading it needs access_grant:read, which only hr_admin holds
-- (0005), so a Department Head asking about their own grants sees no rows and
-- concludes they have none.
--
-- That is the second time this has been hit. 0044's has_org_grant() is
-- SECURITY DEFINER for exactly this reason, and the note there did not
-- generalise. So: any predicate that reads the grant tables must be SECURITY
-- DEFINER, and the tell is that it answers "no" for a caller you can see the
-- grant for in psql as a superuser.
--
-- WHY "WIDER THAN SELF" RATHER THAN A LIST OF ROLES.
--
-- A unit dashboard needs a unit. What it must NOT do is enumerate which scopes
-- count — 'department' OR 'subtree' OR 'org' — because that list would then
-- have to be maintained alongside the grants, and the two would drift. The
-- question is only whether "how far can you see" is a meaningful question for
-- this person. RLS then answers it, row by row, as it does everywhere else.
--
-- Found by a test, and worth recording: an ordinary employee holding
-- employee:read at 'self' came back from the dashboard with ONE unit — their
-- own department, headcount 1. Nothing leaked; they saw only themselves. But
-- "one person, none with goals" is a false statement about a section, and a
-- dashboard whose figures are silently scoped to whoever is reading is worse
-- than one that declines to answer.

BEGIN;

CREATE FUNCTION app.has_scope_wider_than_self(
  p_resource TEXT,
  p_action   grant_action
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT CASE
    WHEN app.current_employee_id() IS NULL THEN FALSE
    WHEN app.current_org_id() IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
        FROM role_assignment ra
        JOIN access_grant ag ON ag.role_id = ra.role_id
       WHERE ra.employee_id = app.current_employee_id()
         -- Both sides pinned to the caller's tenant, as can_access does: an
         -- assignment from another organisation confers nothing here.
         AND ra.org_id = app.current_org_id()
         AND ag.org_id = app.current_org_id()
         AND ra.effective_from <= CURRENT_DATE
         AND (ra.effective_to IS NULL OR CURRENT_DATE < ra.effective_to)
         AND ag.resource_type = p_resource
         AND ag.action = p_action
         -- Deliberately NOT a list of acceptable scopes. See the header.
         AND ag.scope_type <> 'self'
    )
  END;
$$;

COMMENT ON FUNCTION app.has_scope_wider_than_self(TEXT, grant_action) IS
  'Does the caller hold this permission over anyone but themselves? For views '
  'that are meaningless without a unit. Says nothing about HOW far they see — '
  'RLS answers that. SECURITY DEFINER because access_grant is itself '
  'protected, so a caller cannot read their own grants.';

REVOKE ALL ON FUNCTION app.has_scope_wider_than_self(TEXT, grant_action) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_scope_wider_than_self(TEXT, grant_action) TO hr_app;

COMMIT;
