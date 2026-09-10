-- 0044_employee_insert_policy.sql
-- Make "create an employee" expressible in row-level security.
--
-- THE POLICY THAT COULD NEVER PASS.
--
-- 0004 gave employee this:
--
--   CREATE POLICY employee_insert ON employee FOR INSERT
--     WITH CHECK (app.can_access('employee', 'write', id));
--
-- which was right when it was written. 0015 then put a tenant guard in front of
-- can_access: before any grant is considered, the TARGET employee must already
-- exist in the caller's organisation. That guard is correct and stays -- it is
-- what stops a role in one tenant conferring rights in another.
--
-- But it makes every such predicate unsatisfiable for a row that does not exist
-- yet. Nobody has been able to create an employee through RLS since 0015. The
-- CSV importer only works because it runs on a connection that bypasses RLS
-- entirely, which db.service.ts reserves for the operator CLI and says in as
-- many words must never be reached from a request path. So the system could
-- evaluate people and could not be given people.
--
-- THREE STATEMENTS, NOT ONE, AND THE OTHER TWO ARE THE INTERESTING ONES.
--
-- Fixing the INSERT policy alone was not enough, and the way that surfaced is
-- worth recording because the error is identical in all three cases -- "new row
-- violates row-level security policy for table employee" -- and names neither
-- the policy nor the clause. Tested side by side under the new INSERT policy:
--
--   INSERT                          -> accepted
--   INSERT ... RETURNING id         -> refused
--   INSERT ... ON CONFLICT DO NOTHING -> refused
--
-- RETURNING reads the row back, and ON CONFLICT must read the conflicting row
-- to find it: both go through the SELECT policy, which asks
-- can_access('employee','read', id) -- the same predicate, on a row that within
-- this statement still does not exist to a STABLE function's snapshot. The
-- importer's write is an upsert with RETURNING, so it hit both.
--
-- WHAT IS ACTUALLY WIDENED.
--
-- Nothing anyone can newly see or edit. A holder of an ORG-scoped employee:read
-- grant can already read every employee in their organisation; a holder of
-- org-scoped employee:write can already edit every one of them. The change is
-- that those two facts become evaluable WITHOUT the row having to pre-exist, by
-- asking about the grant and the tenant directly instead of routing through a
-- target that is not there yet. Narrower scopes -- self, direct_reports,
-- subtree, department -- are untouched and still go through can_access.
--
-- An hr_partner scoped to one department deliberately cannot create people. A
-- department-scoped grant cannot say which department someone who does not
-- exist yet belongs to; their employment row is written after this insert, not
-- before it. Widening that means deciding what a partner may do with a row
-- whose department is not yet known, which is a real question and not one to
-- answer by loosening a policy in passing.

BEGIN;

/*
 * Does the caller hold this permission across the whole organisation?
 *
 * The half of can_access that does not depend on a target: same tenant
 * conditions, same effective-dating, no subject. Written once so the policies
 * below and the API ask the same question -- an invariant enforced in two
 * places written separately is not an invariant, it is two things that agree
 * until they drift.
 */
CREATE FUNCTION app.has_org_grant(p_resource TEXT, p_action grant_action)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT CASE
    WHEN app.current_employee_id() IS NULL THEN FALSE
    WHEN app.current_org_id() IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
        FROM role_assignment ra
        JOIN access_grant ag ON ag.role_id = ra.role_id
       WHERE ra.employee_id = app.current_employee_id()
         -- Both sides pinned to the caller's tenant, exactly as can_access
         -- does: an assignment from another organisation confers nothing here
         -- even if one were somehow created.
         AND ra.org_id = app.current_org_id()
         AND ag.org_id = app.current_org_id()
         AND ra.effective_from <= CURRENT_DATE
         AND (ra.effective_to IS NULL OR CURRENT_DATE < ra.effective_to)
         AND ag.resource_type = p_resource
         AND ag.action = p_action
         -- Organisation-wide only. Every narrower scope is a statement about a
         -- particular person and belongs in can_access.
         AND ag.scope_type = 'org'
    )
  END;
$$;

COMMENT ON FUNCTION app.has_org_grant(TEXT, grant_action) IS
  'Target-free half of can_access: does the caller hold this permission across '
  'their whole organisation? For predicates that must be evaluated before the '
  'row they concern exists.';

/*
 * May the caller bring a new person into existence in this organisation?
 *
 * p_org_id is the NEW row's org_id, so the tenant check is on where the row
 * lands rather than on a target that is not there yet.
 */
CREATE FUNCTION app.can_create_employee(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT p_org_id IS NOT DISTINCT FROM app.current_org_id()
     AND app.has_org_grant('employee', 'write');
$$;

COMMENT ON FUNCTION app.can_create_employee(UUID) IS
  'May the current user create an employee in this organisation? Requires an '
  'org-scoped employee:write grant and that the row lands in their own tenant.';

REVOKE ALL ON FUNCTION app.has_org_grant(TEXT, grant_action) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.can_create_employee(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_org_grant(TEXT, grant_action) TO hr_app;
GRANT EXECUTE ON FUNCTION app.can_create_employee(UUID) TO hr_app;

-- --------------------------------------------------------------------------
-- INSERT
-- --------------------------------------------------------------------------
-- Replaced rather than supplemented. Permissive policies are OR-ed, so leaving
-- the old one would be harmless -- and would leave a policy in the schema that
-- denies every row it is asked about, for the next person to read and believe.
DROP POLICY employee_insert ON employee;

CREATE POLICY employee_insert ON employee FOR INSERT
  WITH CHECK (app.can_create_employee(org_id));

-- --------------------------------------------------------------------------
-- SELECT -- so RETURNING and ON CONFLICT can see the row
-- --------------------------------------------------------------------------
-- The added clause is what an org-scoped reader could already do; it just no
-- longer requires the row to have existed before this statement began. Note
-- deleted_at stays outside the OR: a soft-deleted employee remains invisible to
-- everyone through this policy, whatever grant the caller holds.
DROP POLICY employee_select ON employee;

CREATE POLICY employee_select ON employee FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      id = app.current_employee_id()
      OR app.can_access('employee', 'read', id)
      OR (org_id = app.current_org_id()
          AND app.has_org_grant('employee', 'read'))
    )
  );

-- --------------------------------------------------------------------------
-- UPDATE -- the upsert's DO UPDATE branch
-- --------------------------------------------------------------------------
-- USING is deliberately unchanged: it decides which EXISTING rows may be
-- targeted at all, and that stays target-scoped. Only the post-image check is
-- widened, and only to "the row ends up in my own organisation" -- which also
-- forbids moving a person into another tenant by update.
DROP POLICY employee_update ON employee;

CREATE POLICY employee_update ON employee FOR UPDATE
  USING (app.can_access('employee', 'write', id))
  WITH CHECK (
    app.can_access('employee', 'write', id)
    OR app.can_create_employee(org_id)
  );

COMMIT;
