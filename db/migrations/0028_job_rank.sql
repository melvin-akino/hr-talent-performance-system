-- 0028_job_rank.sql
-- The rank ladder, as an ordered list rather than free text.
--
-- `position.job_level` is a TEXT column holding whatever the importer found:
-- 'L6', 'E1', 'R11'. That is enough to print and useless to compute with, and
-- the peer-review rules the client wrote are entirely computational:
--
--     "same level/rank, same department, 1 rank higher, 2 ranks higher"
--     "Superior (up to 2 ranks above)"
--
-- Answering "who is exactly two ranks above this person" requires knowing that
-- the ranks are ordered and by how much they differ. Hence a table.
--
-- ---------------------------------------------------------------------------
-- DIRECTION. Read this before using rank_no anywhere.
-- ---------------------------------------------------------------------------
-- The client numbers ranks 6 to 11, and a LOWER number is MORE SENIOR:
--
--     6  Department Manager        <- most senior
--     7  Assistant Dept Manager
--     8  (vacant band)
--     9  Area Coordinator
--    10  Junior Supervisor
--    11  Team Leader / Associate   <- least senior
--
-- This is the opposite of the intuition that a bigger number means a bigger
-- job, and it is their own scheme, taken from `HCM TO`. We adopt it rather than
-- inventing a parallel numbering that would then have to be translated in every
-- conversation with them.
--
-- To stop that inversion leaking into call sites as off-by-one bugs, no query
-- should compare rank_no directly. Use app.ranks_above(), which is written in
-- the language the rules are: "how many ranks above".

BEGIN;

CREATE TABLE job_rank (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organization(id),

  -- The client's own label, e.g. 'R6'. Human-facing, editable, and what an
  -- import file is most likely to carry.
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,

  -- Their number. LOWER IS MORE SENIOR — see the header.
  rank_no    SMALLINT NOT NULL,

  is_active  BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,

  UNIQUE (org_id, code),
  -- One rung per number: two ranks sharing a number would make "one rank above"
  -- ambiguous, which is precisely what this table exists to answer.
  UNIQUE (org_id, rank_no),
  -- Lets position reference a rank in its OWN tenant, below.
  UNIQUE (id, org_id)
);

COMMENT ON COLUMN job_rank.rank_no IS
  'The client''s rank number. LOWER IS MORE SENIOR (6 = Department Manager, '
  '11 = Associate). Do not compare directly — use app.ranks_above().';

ALTER TABLE position
  ADD COLUMN rank_id UUID,
  -- Composite, so a position cannot point at another tenant's rank. The same
  -- guard the rest of the schema uses for cross-tenant references.
  ADD CONSTRAINT position_rank_same_org
    FOREIGN KEY (rank_id, org_id) REFERENCES job_rank (id, org_id);

COMMENT ON COLUMN position.rank_id IS
  'Where this position sits on the ladder. NULL means unranked — normal for a '
  'tenant that has not defined ranks, and for positions outside the ladder.';

CREATE INDEX position_rank_idx ON position (org_id, rank_id) WHERE is_active;

-- ---------------------------------------------------------------------------
-- The one function every rank rule should be written in terms of
-- ---------------------------------------------------------------------------
-- Positive result: the evaluator is that many ranks ABOVE the subject.
-- Zero: same rank. Negative: the evaluator is below the subject.
--
-- Because lower numbers are more senior, "above" is a SUBTRACTION the other way
-- round from what most people write first. Doing it once, here, means no call
-- site has to get it right.
CREATE FUNCTION app.ranks_above(p_subject_rank_no SMALLINT, p_other_rank_no SMALLINT)
RETURNS SMALLINT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (p_subject_rank_no - p_other_rank_no)::SMALLINT;
$$;

COMMENT ON FUNCTION app.ranks_above(SMALLINT, SMALLINT) IS
  'How many ranks the second rank sits above the first. Positive = more senior, '
  '0 = same rank, negative = more junior. Encodes the "lower number is more '
  'senior" convention so no call site has to.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- The ladder is reference data: everyone in the tenant reads it (an employee
-- must be able to see what rank their own position is), and writing it is the
-- same permission as writing positions, which is what it describes. No new
-- grant to hand out — hr_admin already holds position:write.

ALTER TABLE job_rank ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_rank FORCE ROW LEVEL SECURITY;

CREATE POLICY job_rank_select ON job_rank FOR SELECT
  USING (app.current_employee_id() IS NOT NULL AND org_id = app.current_org_id());

CREATE POLICY job_rank_insert ON job_rank FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('position', 'write', app.current_employee_id()));

CREATE POLICY job_rank_update ON job_rank FOR UPDATE
  USING (app.can_access('position', 'write', app.current_employee_id()));

GRANT SELECT, INSERT, UPDATE ON job_rank TO hr_app;

DO $do$
DECLARE t TEXT := 'job_rank';
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
END $do$;

COMMIT;
