-- 0027_org_unit_type.sql
-- What level of the organisation a `department` row actually is.
--
-- The table has always been a self-referencing, effective-dated tree, which is
-- the right shape — but every node was implicitly "a department". The client's
-- structure has six named levels (docs/client-requirements.md §5.3):
--
--   Holdings → Group → Division → Departments/Area → Branch/Brands
--
-- and the distinction is load-bearing, not cosmetic:
--
--   * Peer-review routing is written in these terms — "Branch Heads from the
--     same Area", "Dept Head of CSS". Without a level on the node, those rules
--     cannot be expressed at all.
--   * Branch ranking needs to know which nodes are branches.
--   * An Area Head's access is scoped to an area, and `access_grant` already
--     resolves a department subtree, so labelling the node is the only piece
--     missing.
--
-- The table keeps its name. Renaming it to org_unit would touch every policy,
-- every foreign key and every query for a word — and `department` remains the
-- common case. The UI says "org unit" where the distinction matters.
--
-- SECTION is included because it is real: the client's HCM department contains
-- Hiring & Selection, Compensation & Benefits and so on, and back-office staff
-- are routed by section. It sits at the same depth as AREA — the two are
-- siblings in depth but different in kind, one back office and one branch
-- network.
--
-- REGION is deliberately NOT a level here. The client's nomenclature sheet lists
-- it alongside the others, but it behaves as a cross-cutting attribute (a
-- province grouping) rather than a parent of branch: several areas map into one
-- region and areas span provinces. Modelling it as a tree level would force a
-- false parent. It is an open question (R4 in docs/client-questions-round2.md)
-- and gets its own column when answered.

BEGIN;

CREATE TYPE org_unit_type AS ENUM (
  'holdings', 'group', 'division', 'department', 'section', 'area', 'branch'
);

-- Depth, not display order. AREA and SECTION share a depth on purpose.
CREATE FUNCTION app.org_unit_depth(t org_unit_type) RETURNS SMALLINT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE t
    WHEN 'holdings'   THEN 1
    WHEN 'group'      THEN 2
    WHEN 'division'   THEN 3
    WHEN 'department' THEN 4
    WHEN 'section'    THEN 5
    WHEN 'area'       THEN 5
    WHEN 'branch'     THEN 6
  END::SMALLINT;
$$;

COMMENT ON FUNCTION app.org_unit_depth(org_unit_type) IS
  'Depth of an org unit level. AREA and SECTION share depth 5: siblings in '
  'depth, different in kind.';

-- Existing rows are departments. That is what they were created as, and
-- pretending otherwise would put a guess in the data.
ALTER TABLE department
  ADD COLUMN unit_type org_unit_type NOT NULL DEFAULT 'department';

COMMENT ON COLUMN department.unit_type IS
  'Which level of the organisation this node is. See 0027 for why region is not '
  'one of them.';

/*
 * A child may not sit ABOVE its parent.
 *
 * Expressed as "child depth >= parent depth" rather than strict descent, for
 * two reasons. Departments genuinely nest inside departments in this business —
 * the HCM department contains sections that were themselves loaded as
 * departments before this migration existed — and an area under a division that
 * has no intermediate department is normal, so skipping levels has to stay
 * legal. What is nonsense, and what this rejects, is inversion: a division
 * inside a branch, a group inside a department.
 *
 * A trigger rather than a CHECK because the rule spans two rows.
 */
CREATE FUNCTION app.department_hierarchy_valid() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  parent_type org_unit_type;
BEGIN
  IF NEW.parent_department_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT unit_type INTO parent_type
    FROM department WHERE id = NEW.parent_department_id;

  IF parent_type IS NULL THEN
    RETURN NEW;   -- the foreign key reports a missing parent; not our job
  END IF;

  IF app.org_unit_depth(NEW.unit_type) < app.org_unit_depth(parent_type) THEN
    RAISE EXCEPTION
      'org unit % (%) cannot sit inside % (%): a child may not be a higher '
      'level than its parent',
      NEW.code, NEW.unit_type, parent_type, NEW.parent_department_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER department_hierarchy_valid
  BEFORE INSERT OR UPDATE OF unit_type, parent_department_id ON department
  FOR EACH ROW EXECUTE FUNCTION app.department_hierarchy_valid();

-- Reading the tree by level is the common query behind peer routing and branch
-- ranking, and it is always scoped to one tenant.
CREATE INDEX department_org_unit_type_idx ON department (org_id, unit_type)
  WHERE effective_to IS NULL;

COMMIT;
