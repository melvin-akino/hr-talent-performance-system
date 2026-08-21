-- 0002_authorization.sql
-- Roles, grants, and the identity plumbing RLS policies depend on.
--
-- Access is DATA, not code (architecture.md 3.2). The meeting notes require
-- "viewing access - customizable" and "user level related access"; hard-coded
-- role checks would make every access tweak a redeploy.

BEGIN;

-- ---------------------------------------------------------------------------
-- Request identity
-- ---------------------------------------------------------------------------
-- The API sets `app.current_employee_id` per TRANSACTION (SET LOCAL) before
-- issuing any query. Transaction scope is mandatory: with a session-scoped
-- pool, a leaked GUC would let the next request inherit the previous user's
-- identity. This is the single most dangerous failure mode in the design and
-- is covered by test/rls-identity.spec.ts.

CREATE FUNCTION app.current_employee_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_employee_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app.current_employee_id() IS
  'Identity of the requesting employee. NULL when unset, which causes every '
  'RLS policy to deny -- fail closed, never fail open.';

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

CREATE TABLE app_role (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organization(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- Marks the role that may administer roles/grants themselves. Guarded so a
  -- role cannot quietly escalate its own privileges.
  is_security_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID,
  UNIQUE (org_id, code)
);

CREATE TABLE role_assignment (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organization(id),
  employee_id         UUID NOT NULL REFERENCES employee(id),
  role_id             UUID NOT NULL REFERENCES app_role(id),
  -- Scopes an HR partner to one department subtree. NULL = org-wide.
  scope_department_id UUID REFERENCES department(id),
  effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to        DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID,
  CONSTRAINT role_assignment_period_valid
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX role_assignment_employee_idx
  ON role_assignment (employee_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

CREATE TYPE grant_action AS ENUM ('read', 'write', 'approve');

CREATE TYPE grant_scope AS ENUM (
  'self',            -- only the requesting employee's own rows
  'direct_reports',  -- immediate reports (depth 1)
  'subtree',         -- the full reporting subtree, optionally depth-limited
  'department',      -- the role assignment's scoped department subtree
  'org'              -- everything in the organization
);

CREATE TABLE access_grant (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organization(id),
  role_id       UUID NOT NULL REFERENCES app_role(id) ON DELETE CASCADE,
  -- Free text rather than an enum: later phases add 'goal', 'goal_checkin',
  -- 'review', 'pip', 'feedback' without a migration to the type.
  resource_type TEXT NOT NULL,
  action        grant_action NOT NULL,
  scope_type    grant_scope NOT NULL,
  subtree_depth SMALLINT CHECK (subtree_depth IS NULL OR subtree_depth > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  CONSTRAINT access_grant_depth_only_on_subtree
    CHECK (subtree_depth IS NULL OR scope_type = 'subtree'),
  UNIQUE (role_id, resource_type, action, scope_type)
);

-- ---------------------------------------------------------------------------
-- Hierarchy resolution
-- ---------------------------------------------------------------------------

-- Walks UP the primary reporting chain from `subject`, as of a given date.
-- Depth-capped at 64 to make a data-entry cycle a bounded error rather than a
-- server hang. The exclusion constraint prevents overlaps but NOT cycles, so
-- the visited-set guard is doing real work here.
CREATE FUNCTION app.reports_to(
  subject   UUID,
  ancestor  UUID,
  as_of     DATE DEFAULT CURRENT_DATE,
  max_depth SMALLINT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  WITH RECURSIVE chain AS (
    SELECT rl.supervisor_employee_id AS sup_id,
           1 AS depth,
           ARRAY[rl.employee_id] AS seen
      FROM reporting_line rl
     WHERE rl.employee_id = subject
       AND rl.line_type = 'primary'
       AND rl.effective_from <= as_of
       AND (rl.effective_to IS NULL OR as_of < rl.effective_to)
    UNION ALL
    SELECT rl.supervisor_employee_id,
           c.depth + 1,
           c.seen || rl.employee_id
      FROM chain c
      JOIN reporting_line rl
        ON rl.employee_id = c.sup_id
       AND rl.line_type = 'primary'
       AND rl.effective_from <= as_of
       AND (rl.effective_to IS NULL OR as_of < rl.effective_to)
     WHERE c.depth < 64
       AND NOT (rl.employee_id = ANY (c.seen))
  )
  SELECT EXISTS (
    SELECT 1 FROM chain
     WHERE sup_id = ancestor
       AND (max_depth IS NULL OR depth <= max_depth)
  );
$$;

COMMENT ON FUNCTION app.reports_to IS
  'True when `ancestor` was above `subject` in the primary reporting chain on '
  '`as_of`. SECURITY DEFINER so RLS policies can traverse the hierarchy '
  'without the caller needing blanket read on reporting_line.';

-- Department subtree membership, for department-scoped role assignments.
CREATE FUNCTION app.department_in_subtree(
  candidate UUID,
  root      UUID,
  as_of     DATE DEFAULT CURRENT_DATE
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  WITH RECURSIVE tree AS (
    SELECT d.id, 1 AS depth, ARRAY[d.id] AS seen
      FROM department d
     WHERE d.id = root
    UNION ALL
    SELECT d.id, t.depth + 1, t.seen || d.id
      FROM tree t
      JOIN department d
        ON d.parent_department_id = t.id
       AND d.effective_from <= as_of
       AND (d.effective_to IS NULL OR as_of < d.effective_to)
     WHERE t.depth < 32
       AND NOT (d.id = ANY (t.seen))
  )
  SELECT EXISTS (SELECT 1 FROM tree WHERE id = candidate);
$$;

-- ---------------------------------------------------------------------------
-- The central authorization predicate
-- ---------------------------------------------------------------------------
-- Answers: may the current user perform `action` on `resource_type` for rows
-- belonging to `target_employee_id`?
--
-- Every RLS policy in this system -- Phase 0 and every phase after -- routes
-- through this one function. One definition of visibility, one place to audit.

CREATE FUNCTION app.can_access(
  resource_type TEXT,
  action        grant_action,
  target_employee_id UUID,
  as_of         DATE DEFAULT CURRENT_DATE
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT CASE
    -- Fail closed: no identity means no access, never "everything".
    WHEN app.current_employee_id() IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
        FROM role_assignment ra
        JOIN access_grant ag ON ag.role_id = ra.role_id
       WHERE ra.employee_id = app.current_employee_id()
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
               WHEN 'org' THEN TRUE
               ELSE FALSE
             END
    )
  END;
$$;

COMMENT ON FUNCTION app.can_access IS
  'Single authorization predicate for the whole system. Later phases add '
  'resource_type values; they must NOT add bespoke visibility logic.';

COMMIT;
