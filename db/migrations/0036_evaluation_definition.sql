-- 0036_evaluation_definition.sql
-- C1: what an evaluation IS, as configuration (requirements §2).
--
-- The client names five evaluation types:
--
--   I    Probationary   — 3rd and 4th month, averaged
--   II   Annual         — drives year-end bonuses and branch ranking
--   III  Semi-annual    — midyear and year-end, averaged, drives promotions
--   IV   Project / term — special, behavioural, corrective, promotion
--   V    KPI            — quarterly, semi-annual or annual; basis for incentives
--
-- THESE ARE NOT FIVE FEATURES. They are one definition — type, scoring model,
-- period basis, participants, averaging rule — with five configurations.
-- Building five parallel flows is the mistake this migration exists to avoid:
-- five flows means five places to fix when a rule changes, and the client has
-- already told us several rules are still moving.
--
-- WHAT THIS DELIBERATELY DOES NOT DO.
--
-- It does not schedule anything. Firing an evaluation on somebody's third month
-- is C2, and C2 waits on Q7 — we do not know whether the third month runs from
-- the hire date, nor what happens when a regularisation moves. So the ANSWER is
-- stored here as data (`anchor`, `offset_months`) and the scheduler that reads
-- it is written when the answer arrives. Q7 then costs an UPDATE, not a rewrite.
--
-- The same reasoning covers Type IV: `project` is a configuration of this table,
-- so Q10 decides which form it points at, not whether the type exists.

BEGIN;

CREATE TYPE evaluation_type AS ENUM (
  'probationary', 'annual', 'semi_annual', 'project', 'kpi'
);

/*
 * Calendar: everyone is evaluated over the same dates, which is how review
 * cycles already work.
 *
 * Employee-relative: the dates are computed per person from something in their
 * own record — the case the current system cannot express at all, and the whole
 * reason Type I is listed as missing.
 */
CREATE TYPE evaluation_period_basis AS ENUM ('calendar', 'employee_relative');

/*
 * What an employee-relative period counts from.
 *
 * All three already exist as milestones (0029, app.employment_milestones), so
 * whichever way Q7 is answered the data is there. Listing more than one is the
 * point: 'hired_on' is our assumption, not a fact, and the alternative has to be
 * reachable without a migration.
 */
CREATE TYPE evaluation_anchor AS ENUM ('hired_on', 'regularized_on', 'last_promoted_on');

/*
 * How several instances become one result.
 *
 * 'single' is one evaluation, one result. 'mean' is the client's "3rd & 4th
 * month → averaging" and "midyear + year-end averaged". There is deliberately no
 * 'sum' or 'latest': neither appears anywhere in their document, and an
 * averaging rule nobody asked for is a rule somebody will eventually select by
 * accident.
 */
CREATE TYPE evaluation_averaging AS ENUM ('single', 'mean');

/*
 * Who takes part.
 *
 * Kept separate from `reviewer_role` (self, supervisor, calibrator) on purpose.
 * That enum describes who holds a review INSTANCE and is load-bearing in the
 * confidentiality policies of 0014; widening it to say who is *invited* would
 * mix two questions in one column. Extending reviewer_role for the Department
 * Head step is C3's job and touches those policies deliberately.
 *
 * 'peer' and 'subordinate' are listed because the client's routing names them.
 * Whether subordinate evaluation is in scope at all is R5, and unanswered — so
 * it is expressible here and used by nothing yet.
 */
CREATE TYPE evaluation_participant AS ENUM (
  'self', 'supervisor', 'dept_head', 'peer', 'subordinate'
);

CREATE TABLE evaluation_definition (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,

  eval_type    evaluation_type NOT NULL,
  period_basis evaluation_period_basis NOT NULL DEFAULT 'calendar',

  -- Employee-relative only. Both NULL for a calendar definition.
  anchor        evaluation_anchor,
  /*
   * Months after the anchor at which each instance falls: {3,4} is the client's
   * probationary pair. An array rather than two columns because Type III is the
   * same shape with different numbers, and because a third instance must not
   * need a migration.
   */
  offset_months SMALLINT[],

  /*
   * How many evaluations make up one result. Two for probationary and
   * semi-annual, one for the rest.
   */
  expected_instances SMALLINT NOT NULL DEFAULT 1,
  averaging          evaluation_averaging NOT NULL DEFAULT 'single',

  participants evaluation_participant[] NOT NULL DEFAULT '{self,supervisor}',

  is_active  BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,

  UNIQUE (org_id, code),
  UNIQUE (id, org_id),

  CONSTRAINT evaluation_definition_instances_positive
    CHECK (expected_instances >= 1),

  -- Averaging and instance count have to agree. 'mean' over one instance is
  -- meaningless, and 'single' over two silently discards one of them -- which
  -- is the failure that would show up as a person's score being half of what
  -- their evaluators recorded.
  CONSTRAINT evaluation_definition_averaging_agrees CHECK (
    (averaging = 'single' AND expected_instances = 1)
    OR (averaging = 'mean' AND expected_instances > 1)
  ),

  -- An employee-relative definition needs to know what it counts from and when.
  -- A calendar one must carry neither, so a stray anchor cannot sit unused and
  -- unnoticed until somebody flips the basis and gets last year's offsets.
  CONSTRAINT evaluation_definition_relative_complete CHECK (
    (period_basis = 'employee_relative'
       AND anchor IS NOT NULL
       AND offset_months IS NOT NULL
       -- cardinality(), not array_length(): the latter returns NULL for an
       -- empty array rather than 0, and a CHECK evaluating to NULL PASSES.
       AND cardinality(offset_months) >= 1)
    OR (period_basis = 'calendar' AND anchor IS NULL AND offset_months IS NULL)
  ),

  -- The offsets are the months an instance falls at. Zero or negative would
  -- schedule an evaluation on or before the event it is counted from.
  --
  -- Written with the array ALL operator rather than a subquery over unnest(),
  -- which PostgreSQL rejects in a CHECK. The NULL guard is not decorative:
  -- `0 < ALL (ARRAY[3, NULL])` is NULL, and a CHECK that evaluates to NULL
  -- passes -- so without it a null offset would sail through the very
  -- constraint meant to catch a malformed array.
  CONSTRAINT evaluation_definition_offsets_positive CHECK (
    offset_months IS NULL
    OR (0 < ALL (offset_months) AND array_position(offset_months, NULL) IS NULL)
  ),

  -- cardinality() for the same reason as above. This one was written with
  -- array_length() first and a test caught it: an empty participants array
  -- was accepted, because array_length(ARRAY[]::x[], 1) is NULL and
  -- `NULL >= 1` is NULL, which a CHECK treats as satisfied. An evaluation
  -- nobody takes part in would have generated no instances and simply never
  -- happened, with nothing to say why.
  CONSTRAINT evaluation_definition_participants_present
    CHECK (cardinality(participants) >= 1)
);

CREATE INDEX evaluation_definition_org_idx
  ON evaluation_definition (org_id) WHERE is_active;

COMMENT ON TABLE evaluation_definition IS
  'One row per evaluation type (requirements section 2). Types I-V are five '
  'configurations of this table, not five features.';
COMMENT ON COLUMN evaluation_definition.anchor IS
  'What an employee-relative period counts from. Q7 confirms which; changing it '
  'is an UPDATE, not a migration.';

-- ---------------------------------------------------------------------------
-- Linking a cycle to its definition
-- ---------------------------------------------------------------------------

ALTER TABLE review_cycle
  ADD COLUMN evaluation_definition_id UUID,
  -- Snapshot, for the same reason the form version is pinned: these two decide
  -- how a person's results are combined into their score, and a definition
  -- edited in March must not retroactively change what a January cycle meant.
  ADD COLUMN expected_instances SMALLINT,
  ADD COLUMN averaging evaluation_averaging,
  ADD CONSTRAINT review_cycle_definition_same_org
    FOREIGN KEY (evaluation_definition_id, org_id)
    REFERENCES evaluation_definition (id, org_id),
  -- Nullable throughout: cycles created before this migration have no
  -- definition, and inventing one for them would be a claim about what they
  -- were rather than a record of it.
  ADD CONSTRAINT review_cycle_snapshot_complete CHECK (
    evaluation_definition_id IS NULL
    OR (expected_instances IS NOT NULL AND averaging IS NOT NULL)
  );

COMMENT ON COLUMN review_cycle.averaging IS
  'Snapshot of the definition at the moment the cycle was opened. Never read '
  'live from evaluation_definition: editing a definition must not move a score '
  'already given.';

/*
 * Copies the definition's rules onto a cycle as it is created.
 *
 * A trigger rather than application code because review cycles are created from
 * three places (the API, the CLI, seed-demo) and a snapshot that depends on the
 * caller remembering to take it is a snapshot that will be missed once.
 */
CREATE FUNCTION app.snapshot_evaluation_definition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.evaluation_definition_id IS NOT NULL
     AND (NEW.expected_instances IS NULL OR NEW.averaging IS NULL) THEN
    SELECT d.expected_instances, d.averaging
      INTO NEW.expected_instances, NEW.averaging
      FROM evaluation_definition d
     WHERE d.id = NEW.evaluation_definition_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER review_cycle_snapshot_definition
  BEFORE INSERT ON review_cycle
  FOR EACH ROW EXECUTE FUNCTION app.snapshot_evaluation_definition();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Definitions are reference data: everyone reads them, because a person is
-- entitled to know what kind of evaluation they are being put through and how
-- its instances combine. Writing needs the same grant that authors review
-- cycles, since a definition is what a cycle is issued under.

ALTER TABLE evaluation_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_definition FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON evaluation_definition TO hr_app;

CREATE POLICY evaluation_definition_select ON evaluation_definition FOR SELECT
  USING (app.current_employee_id() IS NOT NULL AND org_id = app.current_org_id());

CREATE POLICY evaluation_definition_insert ON evaluation_definition FOR INSERT
  WITH CHECK (
    org_id = app.current_org_id()
    AND app.can_access('review_cycle', 'write', app.current_employee_id()));

CREATE POLICY evaluation_definition_update ON evaluation_definition FOR UPDATE
  USING (app.can_access('review_cycle', 'write', app.current_employee_id()))
  WITH CHECK (
    org_id = app.current_org_id()
    AND app.can_access('review_cycle', 'write', app.current_employee_id()));

/*
 * DELETE is granted but a definition a cycle was issued under cannot be
 * removed -- the foreign key sees to that. Retiring one is `is_active = FALSE`,
 * which keeps the record of what past cycles meant.
 */
CREATE POLICY evaluation_definition_delete ON evaluation_definition FOR DELETE
  USING (app.can_access('review_cycle', 'write', app.current_employee_id()));

CREATE TRIGGER evaluation_definition_audit
  AFTER INSERT OR UPDATE OR DELETE ON evaluation_definition
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
CREATE TRIGGER evaluation_definition_touch
  BEFORE UPDATE ON evaluation_definition
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The client's five, seeded
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.seed_evaluation_definitions(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO evaluation_definition (
    org_id, code, name, description, eval_type, period_basis,
    anchor, offset_months, expected_instances, averaging, participants)
  VALUES
    -- Type I. The offsets are stated on their page 1 and are not in question;
    -- the ANCHOR is Q7, seeded to our stated assumption so the answer is a
    -- one-row UPDATE either way.
    (p_org_id, 'PROB', 'Probationary',
     'Third and fourth month, averaged into one result. The anchor is our '
     || 'assumption pending Q7.',
     'probationary', 'employee_relative', 'hired_on', ARRAY[3,4]::SMALLINT[],
     2, 'mean', '{self,supervisor}'),

    (p_org_id, 'ANNUAL', 'Annual performance',
     'Drives year-end bonuses and branch ranking.',
     'annual', 'calendar', NULL, NULL, 1, 'single', '{self,supervisor}'),

    (p_org_id, 'SEMI', 'Semi-annual',
     'Midyear and year-end, averaged. Drives rank promotions.',
     'semi_annual', 'calendar', NULL, NULL, 2, 'mean', '{self,supervisor}'),

    -- Type IV runs outside the calendar against a named subset. Whether it uses
    -- the standard 100-point template is Q10; that is a form assignment, not a
    -- property of the type, so nothing here waits on it.
    (p_org_id, 'PROJECT', 'Project / term-based',
     'Special, behavioural, corrective and promotion evaluations, run outside '
     || 'the calendar for a named group.',
     'project', 'calendar', NULL, NULL, 1, 'single', '{supervisor}'),

    (p_org_id, 'KPI', 'KPI evaluation',
     'Basis for incentives. Settable quarterly, semi-annually or annually.',
     'kpi', 'calendar', NULL, NULL, 1, 'single', '{supervisor}')
  ON CONFLICT (org_id, code) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_evaluation_definitions(r.id);
  END LOOP;
END $do$;

COMMIT;
