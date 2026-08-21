-- 0013_review_cycles.sql
-- Phase 3, part 2: review cycles, instances, responses, and sign-off.
--
-- The phase sequence from the meeting notes:
--   self -> supervisor -> calibration -> sign-off
-- with self-review an explicit requirement ("allows for self review").
--
-- The hard rule this file exists to enforce: a submitted review is immutable,
-- and an employee never sees their supervisor's assessment before it is
-- released. Both are enforced in the database, because both are the kind of
-- thing that ends up in an employment dispute.

BEGIN;

CREATE TYPE review_cycle_state AS ENUM ('draft', 'open', 'calibration', 'closed');

CREATE TYPE review_phase_type AS ENUM ('self', 'supervisor', 'calibration', 'signoff');

CREATE TYPE review_instance_state AS ENUM
  ('not_started', 'in_progress', 'submitted', 'returned');

CREATE TYPE reviewer_role AS ENUM ('self', 'supervisor', 'calibrator');

CREATE TABLE review_cycle (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organization(id),
  -- Links the review to the goals it assesses, so attainment can be pulled in.
  goal_period_id UUID REFERENCES goal_period(id),
  name           TEXT NOT NULL,
  description    TEXT,
  state          review_cycle_state NOT NULL DEFAULT 'draft',
  opens_on       DATE NOT NULL,
  closes_on      DATE NOT NULL,
  closed_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,
  CONSTRAINT review_cycle_range CHECK (closes_on > opens_on),
  UNIQUE (org_id, name)
);

CREATE TABLE review_cycle_phase (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_cycle_id UUID NOT NULL REFERENCES review_cycle(id) ON DELETE CASCADE,
  phase_type      review_phase_type NOT NULL,
  sequence        SMALLINT NOT NULL,
  opens_on        DATE NOT NULL,
  closes_on       DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID,
  CONSTRAINT review_phase_range CHECK (closes_on >= opens_on),
  UNIQUE (review_cycle_id, phase_type)
);

-- ---------------------------------------------------------------------------
-- Per-subject summary -- the record that gets signed off
-- ---------------------------------------------------------------------------

CREATE TABLE review_summary (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_cycle_id    UUID NOT NULL REFERENCES review_cycle(id) ON DELETE CASCADE,
  subject_employee_id UUID NOT NULL REFERENCES employee(id),
  -- The supervisor's rating, and the rating after calibration. Kept separate
  -- so a moderated change is visible rather than overwriting the original.
  overall_rating     NUMERIC(6,3),
  calibrated_rating  NUMERIC(6,3),
  calibration_notes  TEXT,
  -- Goal attainment snapshotted at sign-off. Actuals keep moving until the
  -- goal period closes; the review must record what was true when it was
  -- signed, not what is true when it is later read.
  goal_attainment_pct NUMERIC(9,4),
  released_at        TIMESTAMPTZ,
  signed_off_by      UUID REFERENCES employee(id),
  signed_off_at      TIMESTAMPTZ,
  employee_acknowledged_at TIMESTAMPTZ,
  employee_comment   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID,
  CONSTRAINT review_summary_signoff_pair
    CHECK ((signed_off_by IS NULL) = (signed_off_at IS NULL)),
  UNIQUE (review_cycle_id, subject_employee_id)
);

CREATE INDEX review_summary_subject_idx
  ON review_summary (subject_employee_id, review_cycle_id);

-- ---------------------------------------------------------------------------
-- Review instances -- one form, one reviewer, one subject
-- ---------------------------------------------------------------------------

CREATE TABLE review_instance (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_cycle_id     UUID NOT NULL REFERENCES review_cycle(id) ON DELETE CASCADE,
  subject_employee_id UUID NOT NULL REFERENCES employee(id),
  reviewer_employee_id UUID NOT NULL REFERENCES employee(id),
  reviewer_role       reviewer_role NOT NULL,
  -- Snapshot of the form version. Never re-resolved: reprinting a 2026 review
  -- must show the 2026 questions.
  form_version_id     UUID NOT NULL REFERENCES form_version(id),
  state               review_instance_state NOT NULL DEFAULT 'not_started',
  overall_rating      NUMERIC(6,3),
  submitted_at        TIMESTAMPTZ,
  returned_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID,
  CONSTRAINT review_instance_self_consistent
    CHECK ((reviewer_role = 'self') = (reviewer_employee_id = subject_employee_id)),
  UNIQUE (review_cycle_id, subject_employee_id, reviewer_employee_id, reviewer_role)
);

CREATE INDEX review_instance_reviewer_idx
  ON review_instance (reviewer_employee_id, state);
CREATE INDEX review_instance_subject_idx
  ON review_instance (subject_employee_id, review_cycle_id);

CREATE TABLE form_response (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_instance_id UUID NOT NULL REFERENCES review_instance(id) ON DELETE CASCADE,
  field_key          TEXT NOT NULL,
  value_json         JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID,
  UNIQUE (review_instance_id, field_key)
);

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.review_instance_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_allowed review_instance_state[];
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;

  v_allowed := CASE OLD.state
    WHEN 'not_started' THEN ARRAY['in_progress', 'submitted']::review_instance_state[]
    WHEN 'in_progress' THEN ARRAY['submitted']::review_instance_state[]
    -- Submitted reviews go back only by being explicitly RETURNED, which is
    -- recorded and audited. There is no quiet un-submit.
    WHEN 'submitted'   THEN ARRAY['returned']::review_instance_state[]
    WHEN 'returned'    THEN ARRAY['in_progress', 'submitted']::review_instance_state[]
    ELSE ARRAY[]::review_instance_state[]
  END;

  IF NOT (NEW.state = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Invalid review transition % -> %', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'submitted' THEN
    NEW.submitted_at := COALESCE(NEW.submitted_at, now());
  ELSIF NEW.state = 'returned' THEN
    IF NEW.returned_reason IS NULL OR length(trim(NEW.returned_reason)) = 0 THEN
      RAISE EXCEPTION 'A returned review must record a reason'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.submitted_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER review_instance_state_machine
  BEFORE UPDATE ON review_instance
  FOR EACH ROW EXECUTE FUNCTION app.review_instance_transition();

-- Answers are frozen once submitted. This is the core integrity guarantee of
-- the whole phase: an assessment that can be quietly rewritten afterwards is
-- worthless to both the employee and the employer.
CREATE FUNCTION app.form_response_frozen() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_state review_instance_state;
BEGIN
  SELECT state INTO v_state FROM review_instance
   WHERE id = COALESCE(NEW.review_instance_id, OLD.review_instance_id);

  IF v_state = 'submitted' THEN
    RAISE EXCEPTION
      'This review has been submitted and can no longer be edited. '
      'Ask for it to be returned if a change is needed.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER form_response_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON form_response
  FOR EACH ROW EXECUTE FUNCTION app.form_response_frozen();

-- Sign-off stamps release, and a signed review is final.
CREATE FUNCTION app.review_summary_signoff() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_off_at IS NOT NULL THEN
    IF NEW.overall_rating IS DISTINCT FROM OLD.overall_rating
       OR NEW.calibrated_rating IS DISTINCT FROM OLD.calibrated_rating
       OR NEW.goal_attainment_pct IS DISTINCT FROM OLD.goal_attainment_pct THEN
      RAISE EXCEPTION 'This review has been signed off and its ratings are final'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Sign-off implies release: the employee must be able to read what was
  -- signed about them.
  IF NEW.signed_off_at IS NOT NULL AND NEW.released_at IS NULL THEN
    NEW.released_at := NEW.signed_off_at;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER review_summary_signoff_rules
  BEFORE UPDATE ON review_summary
  FOR EACH ROW EXECUTE FUNCTION app.review_summary_signoff();

/* True once the subject is allowed to see reviews written about them. */
CREATE FUNCTION app.review_released(p_cycle_id UUID, p_subject UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM review_summary s
     WHERE s.review_cycle_id = p_cycle_id
       AND s.subject_employee_id = p_subject
       AND s.released_at IS NOT NULL);
$$;

/* Goal attainment for a subject, for pulling Phase 1 results into a review. */
CREATE FUNCTION app.review_goal_attainment(p_subject UUID, p_goal_period UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  -- Weighted by goal weight, which is the whole point of weights.
  SELECT ROUND(
           SUM(att.pct * g.weight) / NULLIF(SUM(g.weight) FILTER (WHERE att.pct IS NOT NULL), 0),
           4)
    FROM goal g
    LEFT JOIN LATERAL (
      SELECT AVG(t.attainment_pct) AS pct FROM goal_target t
       WHERE t.goal_id = g.id AND t.attainment_pct IS NOT NULL
    ) att ON TRUE
   WHERE g.employee_id = p_subject
     AND g.goal_period_id = p_goal_period
     AND g.state NOT IN ('cancelled', 'draft');
$$;

COMMENT ON FUNCTION app.review_goal_attainment IS
  'Weight-weighted goal attainment. Reads goal data under the CALLER''s RLS, '
  'so it cannot be used to see attainment for someone out of scope.';

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['review_cycle', 'review_cycle_phase', 'review_summary',
                           'review_instance', 'form_response'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;

COMMIT;
