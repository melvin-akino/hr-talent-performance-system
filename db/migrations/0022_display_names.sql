-- 0022_display_names.sql
-- A narrow way to render someone's name without widening who you can see.
--
-- The problem this fixes, found by clicking through the app rather than by any
-- test: feedback list queries join `employee` twice, for the subject's name and
-- the author's name. RLS on `employee` is deliberately tight -- an IC may read
-- only themselves -- so when a PEER writes feedback about you, the thread is
-- visible but the author's employee row is not, and the INNER JOIN silently
-- drops the row. The feedback existed and was permitted; it just vanished.
--
-- Two bad fixes were rejected:
--   * LEFT JOIN and show a blank name -- the record becomes anonymous.
--   * Grant everyone read on `employee` -- that is a staff directory by
--     accident, and it would leak email, hire date, and status.
--
-- Instead: one SECURITY DEFINER function returning ONLY a display name for an
-- id the caller already holds. It cannot be used to enumerate anyone, because
-- you must already know the UUID to ask.

BEGIN;

CREATE FUNCTION app.display_name(p_employee_id UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT e.first_name || ' ' || e.last_name
    FROM employee e
   WHERE e.id = p_employee_id
     -- Never across a tenant boundary, even though a UUID is unguessable.
     AND e.org_id = app.current_org_id();
$$;

COMMENT ON FUNCTION app.display_name IS
  'Display name for an employee id the caller already holds. Returns ONLY the '
  'name -- no email, status, or dates -- and never crosses a tenant boundary. '
  'Use for rendering authorship where employee RLS would otherwise drop the '
  'row from an inner join. It is not a directory: enumeration is impossible '
  'because the id must be known in advance.';

REVOKE ALL ON FUNCTION app.display_name(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.display_name(UUID) TO hr_app;

COMMIT;
