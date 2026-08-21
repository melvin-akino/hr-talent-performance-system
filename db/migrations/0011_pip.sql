-- 0011_pip.sql
-- Phase 2, part 2: Performance Improvement Plans.
--
-- PIPs are the most sensitive records in the system so far. A PIP becoming
-- visible to the wrong person -- a peer, a skip-level manager with no
-- involvement, a departmental colleague -- is a serious HR incident and a
-- likely legal one.
--
-- So PIP visibility is DELIBERATELY NARROWER than goals: employee, their
-- DIRECT supervisor, and HR. Note the absence of 'subtree' in the grants at
-- the bottom of this file: a director does not automatically see PIPs two
-- levels down, even though they do see goals there. That asymmetry is
-- intentional; do not "fix" it for consistency.

BEGIN;

CREATE TYPE pip_state AS ENUM ('draft', 'active', 'completed', 'cancelled');

CREATE TYPE pip_outcome AS ENUM
  ('successful', 'extended', 'unsuccessful', 'withdrawn');

CREATE TABLE pip_plan (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organization(id),
  employee_id        UUID NOT NULL REFERENCES employee(id),
  initiated_by       UUID NOT NULL REFERENCES employee(id),
  -- The supervisor accountable for the plan, captured at initiation. Stored
  -- rather than derived because reporting lines change, and the person who
  -- ran the PIP must remain identifiable afterwards.
  supervisor_id      UUID NOT NULL REFERENCES employee(id),
  goal_period_id     UUID REFERENCES goal_period(id),
  reason             TEXT NOT NULL,
  expected_outcome   TEXT,
  starts_on          DATE NOT NULL,
  ends_on            DATE NOT NULL,
  review_cadence     checkin_cadence NOT NULL DEFAULT 'biweekly',
  state              pip_state NOT NULL DEFAULT 'draft',
  outcome            pip_outcome,
  outcome_notes      TEXT,
  closed_at          TIMESTAMPTZ,
  acknowledged_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID,
  CONSTRAINT pip_range_valid CHECK (ends_on > starts_on),
  CONSTRAINT pip_not_self_initiated CHECK (employee_id <> initiated_by),
  CONSTRAINT pip_not_self_supervised CHECK (employee_id <> supervisor_id),
  -- A completed plan must say how it ended. "It just stopped" is not an
  -- acceptable record for a document with employment consequences.
  CONSTRAINT pip_completed_has_outcome
    CHECK (state <> 'completed' OR outcome IS NOT NULL)
);

CREATE INDEX pip_plan_employee_idx ON pip_plan (employee_id, starts_on DESC);
CREATE INDEX pip_plan_supervisor_idx ON pip_plan (supervisor_id, state);

CREATE TABLE pip_milestone (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_plan_id  UUID NOT NULL REFERENCES pip_plan(id) ON DELETE CASCADE,
  sequence     SMALLINT NOT NULL,
  description  TEXT NOT NULL,
  success_criteria TEXT,
  due_on       DATE NOT NULL,
  met          BOOLEAN,
  assessed_by  UUID REFERENCES employee(id),
  assessed_at  TIMESTAMPTZ,
  assessment_notes TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,
  CONSTRAINT pip_milestone_assessment_complete
    CHECK ((met IS NULL) = (assessed_by IS NULL)),
  UNIQUE (pip_plan_id, sequence)
);

-- Periodic review conversations during the plan. Append-only for the same
-- reason as goal check-ins: this is a contemporaneous record, and a PIP that
-- can be retroactively edited is worthless as evidence for either side.
CREATE TABLE pip_review (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_plan_id  UUID NOT NULL REFERENCES pip_plan(id) ON DELETE RESTRICT,
  reviewed_by  UUID NOT NULL REFERENCES employee(id),
  review_date  DATE NOT NULL,
  progress_summary TEXT NOT NULL,
  status_flag  checkin_status NOT NULL,
  employee_comment TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID
);

CREATE INDEX pip_review_plan_idx ON pip_review (pip_plan_id, review_date DESC);

CREATE RULE pip_review_no_update AS ON UPDATE TO pip_review DO INSTEAD NOTHING;
CREATE RULE pip_review_no_delete AS ON DELETE TO pip_review DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- State machine
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.pip_state_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_allowed pip_state[];
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;

  v_allowed := CASE OLD.state
    WHEN 'draft'  THEN ARRAY['active', 'cancelled']::pip_state[]
    WHEN 'active' THEN ARRAY['completed', 'cancelled']::pip_state[]
    ELSE ARRAY[]::pip_state[]
  END;

  IF NOT (NEW.state = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Invalid PIP transition % -> %', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  -- A plan cannot be activated without milestones. A PIP with no measurable
  -- criteria is unfair to the employee and indefensible if challenged.
  IF NEW.state = 'active' THEN
    IF NOT EXISTS (SELECT 1 FROM pip_milestone WHERE pip_plan_id = NEW.id) THEN
      RAISE EXCEPTION 'A PIP cannot be activated without at least one milestone'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.state IN ('completed', 'cancelled') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER pip_state_machine
  BEFORE UPDATE ON pip_plan
  FOR EACH ROW EXECUTE FUNCTION app.pip_state_transition();

-- Reviews only make sense against a live plan.
CREATE FUNCTION app.enforce_pip_review_active() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_state pip_state;
BEGIN
  SELECT state INTO v_state FROM pip_plan WHERE id = NEW.pip_plan_id;
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'Reviews can only be recorded against an active PIP (state: %)',
      v_state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pip_review_requires_active
  BEFORE INSERT ON pip_review
  FOR EACH ROW EXECUTE FUNCTION app.enforce_pip_review_active();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pip_plan', 'pip_milestone'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;

CREATE TRIGGER pip_review_audit
  AFTER INSERT ON pip_review
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();

-- ---------------------------------------------------------------------------
-- RLS -- narrower than goals, by design
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pip_plan', 'pip_milestone', 'pip_review'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO hr_app', t);
  END LOOP;
END $$;

-- The subject always sees their own PIP. Transparency is not optional here --
-- an employee who cannot read their own improvement plan cannot act on it.
CREATE POLICY pip_plan_select ON pip_plan FOR SELECT
  USING (
    employee_id = app.current_employee_id()
    OR supervisor_id = app.current_employee_id()
    OR app.can_access('pip', 'read', employee_id)
  );

CREATE POLICY pip_plan_insert ON pip_plan FOR INSERT
  WITH CHECK (app.can_access('pip', 'write', employee_id));

CREATE POLICY pip_plan_update ON pip_plan FOR UPDATE
  USING (
    supervisor_id = app.current_employee_id()
    OR app.can_access('pip', 'write', employee_id)
  )
  WITH CHECK (
    supervisor_id = app.current_employee_id()
    OR app.can_access('pip', 'write', employee_id)
  );

CREATE POLICY pip_milestone_select ON pip_milestone FOR SELECT
  USING (EXISTS (SELECT 1 FROM pip_plan p WHERE p.id = pip_milestone.pip_plan_id));

CREATE POLICY pip_milestone_insert ON pip_milestone FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM pip_plan p
     WHERE p.id = pip_milestone.pip_plan_id
       AND (p.supervisor_id = app.current_employee_id()
            OR app.can_access('pip', 'write', p.employee_id))));

CREATE POLICY pip_milestone_update ON pip_milestone FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM pip_plan p
     WHERE p.id = pip_milestone.pip_plan_id
       AND (p.supervisor_id = app.current_employee_id()
            OR app.can_access('pip', 'write', p.employee_id))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM pip_plan p
     WHERE p.id = pip_milestone.pip_plan_id
       AND (p.supervisor_id = app.current_employee_id()
            OR app.can_access('pip', 'write', p.employee_id))));

CREATE POLICY pip_review_select ON pip_review FOR SELECT
  USING (EXISTS (SELECT 1 FROM pip_plan p WHERE p.id = pip_review.pip_plan_id));

CREATE POLICY pip_review_insert ON pip_review FOR INSERT
  WITH CHECK (
    reviewed_by = app.current_employee_id()
    AND EXISTS (
      SELECT 1 FROM pip_plan p
       WHERE p.id = pip_review.pip_plan_id
         AND (p.supervisor_id = app.current_employee_id()
              OR app.can_access('pip', 'write', p.employee_id))));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.seed_phase2_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_employee UUID; v_manager UUID; v_hr_partner UUID; v_hr_admin UUID;
BEGIN
  SELECT id INTO v_employee   FROM app_role WHERE org_id=p_org_id AND code='employee';
  SELECT id INTO v_manager    FROM app_role WHERE org_id=p_org_id AND code='manager';
  SELECT id INTO v_hr_partner FROM app_role WHERE org_id=p_org_id AND code='hr_partner';
  SELECT id INTO v_hr_admin   FROM app_role WHERE org_id=p_org_id AND code='hr_admin';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  VALUES
    (p_org_id, v_employee, 'pip', 'read', 'self'),

    -- DIRECT reports only. Deliberately not 'subtree' -- see the header note.
    (p_org_id, v_manager, 'pip', 'read', 'direct_reports'),
    (p_org_id, v_manager, 'pip', 'write', 'direct_reports'),

    (p_org_id, v_hr_partner, 'pip', 'read', 'department'),
    (p_org_id, v_hr_partner, 'pip', 'write', 'department'),

    (p_org_id, v_hr_admin, 'pip', 'read', 'org'),
    (p_org_id, v_hr_admin, 'pip', 'write', 'org')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organization LOOP
    PERFORM app.seed_phase2_grants(v_org);
  END LOOP;
END $$;

COMMIT;
