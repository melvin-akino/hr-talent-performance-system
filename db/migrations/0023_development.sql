-- 0023_development.sql
-- Phase 6: individual development plans, career paths, and the learning library.
--
-- From the meeting notes: "Indiv Devt Plan - career path", "HR library per
-- employee", "library - trainings & reference materials".
--
-- The value here is not the three tables in isolation — it is the join between
-- them and Phase 4. A competency gap should produce a development action, and a
-- development action should point at something an employee can actually go and
-- do. A development plan whose actions are free text is a wish list.

BEGIN;

-- ---------------------------------------------------------------------------
-- Learning library
-- ---------------------------------------------------------------------------

CREATE TYPE learning_resource_type AS ENUM
  ('course', 'document', 'video', 'book', 'workshop', 'link', 'mentoring');

CREATE TABLE learning_resource (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organization(id),
  title            TEXT NOT NULL,
  description      TEXT,
  resource_type    learning_resource_type NOT NULL,
  url              TEXT,
  provider         TEXT,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  -- Links the library to the competency framework, which is what lets a gap
  -- report recommend something concrete instead of "get better at this".
  competency_id    UUID REFERENCES competency(id) ON DELETE SET NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID
);

CREATE INDEX learning_resource_competency_idx
  ON learning_resource (competency_id) WHERE competency_id IS NOT NULL;
CREATE INDEX learning_resource_org_idx ON learning_resource (org_id) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Career paths
-- ---------------------------------------------------------------------------
-- Directed edges between positions. Deliberately a graph rather than a ladder:
-- real organisations have lateral moves and multiple routes into a role, and a
-- single linear "next level" field cannot express either.

CREATE TABLE career_path (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organization(id),
  from_position_id UUID NOT NULL REFERENCES position(id) ON DELETE CASCADE,
  to_position_id   UUID NOT NULL REFERENCES position(id) ON DELETE CASCADE,
  -- 'promotion' | 'lateral' | 'specialisation' -- affects nothing functionally,
  -- but an employee reading a path wants to know which kind of move it is.
  move_type        TEXT NOT NULL DEFAULT 'promotion',
  typical_months   INTEGER CHECK (typical_months IS NULL OR typical_months > 0),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,
  CONSTRAINT career_path_not_self CHECK (from_position_id <> to_position_id),
  UNIQUE (from_position_id, to_position_id)
);

CREATE INDEX career_path_from_idx ON career_path (from_position_id);

-- ---------------------------------------------------------------------------
-- Development plans
-- ---------------------------------------------------------------------------

CREATE TYPE development_plan_state AS ENUM
  ('draft', 'active', 'completed', 'cancelled');

CREATE TABLE development_plan (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organization(id),
  employee_id     UUID NOT NULL REFERENCES employee(id),
  title           TEXT NOT NULL,
  objective       TEXT,
  -- Optional links to the cycle that prompted the plan. A plan that arose from
  -- a review should be traceable to it; a plan created off-cycle should not be
  -- forced to invent one.
  goal_period_id  UUID REFERENCES goal_period(id) ON DELETE SET NULL,
  review_cycle_id UUID REFERENCES review_cycle(id) ON DELETE SET NULL,
  -- The role the employee is working toward, if any. Drives the gap view.
  target_position_id UUID REFERENCES position(id) ON DELETE SET NULL,
  starts_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  target_date     DATE,
  state           development_plan_state NOT NULL DEFAULT 'draft',
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID,
  CONSTRAINT development_plan_range
    CHECK (target_date IS NULL OR target_date >= starts_on),
  CONSTRAINT development_plan_same_org
    FOREIGN KEY (employee_id, org_id) REFERENCES employee (id, org_id)
);

CREATE INDEX development_plan_employee_idx
  ON development_plan (employee_id, starts_on DESC);

CREATE TYPE dev_action_status AS ENUM
  ('not_started', 'in_progress', 'completed', 'deferred', 'cancelled');

CREATE TABLE dev_action (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  development_plan_id  UUID NOT NULL REFERENCES development_plan(id) ON DELETE CASCADE,
  sequence             SMALLINT NOT NULL,
  description          TEXT NOT NULL,
  -- The Phase 4 link: this action closes a specific competency gap.
  competency_id        UUID REFERENCES competency(id) ON DELETE SET NULL,
  target_level         SMALLINT CHECK (target_level IS NULL OR target_level > 0),
  -- The library link: something concrete to actually do.
  learning_resource_id UUID REFERENCES learning_resource(id) ON DELETE SET NULL,
  support_needed       TEXT,
  target_date          DATE,
  status               dev_action_status NOT NULL DEFAULT 'not_started',
  completed_on         DATE,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID,
  -- "Completed" without a date is not a record, it is a checkbox. The pairing
  -- is enforced both ways so neither can drift.
  CONSTRAINT dev_action_completion_pair
    CHECK ((status = 'completed') = (completed_on IS NOT NULL)),
  UNIQUE (development_plan_id, sequence)
);

CREATE INDEX dev_action_plan_idx ON dev_action (development_plan_id, sequence);
CREATE INDEX dev_action_competency_idx
  ON dev_action (competency_id) WHERE competency_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Learning assignments -- "HR library per employee"
-- ---------------------------------------------------------------------------

CREATE TYPE learning_assignment_state AS ENUM
  ('assigned', 'in_progress', 'completed', 'waived');

CREATE TABLE learning_assignment (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id),
  employee_id          UUID NOT NULL REFERENCES employee(id),
  learning_resource_id UUID NOT NULL REFERENCES learning_resource(id) ON DELETE CASCADE,
  assigned_by          UUID REFERENCES employee(id),
  -- Set when the assignment came from a development action, so completing the
  -- learning can close the action.
  dev_action_id        UUID REFERENCES dev_action(id) ON DELETE SET NULL,
  due_on               DATE,
  state                learning_assignment_state NOT NULL DEFAULT 'assigned',
  completed_on         DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID,
  CONSTRAINT learning_assignment_completion_pair
    CHECK ((state = 'completed') = (completed_on IS NOT NULL)),
  CONSTRAINT learning_assignment_same_org
    FOREIGN KEY (employee_id, org_id) REFERENCES employee (id, org_id),
  -- One live assignment of a resource per person. Re-assigning something an
  -- employee already has open is noise, not emphasis.
  UNIQUE (employee_id, learning_resource_id)
);

CREATE INDEX learning_assignment_employee_idx
  ON learning_assignment (employee_id, state);

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.development_plan_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_allowed development_plan_state[];
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;

  v_allowed := CASE OLD.state
    WHEN 'draft'  THEN ARRAY['active', 'cancelled']::development_plan_state[]
    WHEN 'active' THEN ARRAY['completed', 'cancelled']::development_plan_state[]
    ELSE ARRAY[]::development_plan_state[]
  END;

  IF NOT (NEW.state = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Invalid development plan transition % -> %', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  -- A plan with no actions is an intention, not a plan.
  IF NEW.state = 'active'
     AND NOT EXISTS (SELECT 1 FROM dev_action WHERE development_plan_id = NEW.id) THEN
    RAISE EXCEPTION 'A development plan needs at least one action before it starts'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state IN ('completed', 'cancelled') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER development_plan_state_machine
  BEFORE UPDATE ON development_plan
  FOR EACH ROW EXECUTE FUNCTION app.development_plan_transition();

-- The target level of an action must exist on that competency's own scale,
-- exactly as position requirements are validated in Phase 4.
CREATE FUNCTION app.validate_dev_action_level() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.competency_id IS NOT NULL AND NEW.target_level IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM competency_level cl
        WHERE cl.competency_id = NEW.competency_id
          AND cl.level_no = NEW.target_level) THEN
    RAISE EXCEPTION 'Target level % is not defined for this competency',
      NEW.target_level USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER dev_action_level_valid
  BEFORE INSERT OR UPDATE ON dev_action
  FOR EACH ROW EXECUTE FUNCTION app.validate_dev_action_level();

-- Completing the learning closes the action it came from. Without this the two
-- records drift and the plan shows outstanding work that is actually done.
CREATE FUNCTION app.close_dev_action_on_learning() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'completed' AND OLD.state <> 'completed'
     AND NEW.dev_action_id IS NOT NULL THEN
    UPDATE dev_action
       SET status = 'completed',
           completed_on = COALESCE(NEW.completed_on, CURRENT_DATE)
     WHERE id = NEW.dev_action_id
       AND status <> 'completed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_assignment_closes_action
  AFTER UPDATE ON learning_assignment
  FOR EACH ROW EXECUTE FUNCTION app.close_dev_action_on_learning();

-- ---------------------------------------------------------------------------
-- Gap-driven recommendations
-- ---------------------------------------------------------------------------

/*
 * Learning resources matching an employee's current competency gaps.
 *
 * This is the join that makes Phase 4 and Phase 6 worth having together:
 * "you are below the required level in Technical Judgement, and here are three
 * things in the library that address it."
 *
 * Runs under the CALLER's RLS -- competency_gaps() already does -- so it can
 * never recommend against someone out of scope.
 */
CREATE FUNCTION app.recommended_learning(p_employee_id UUID)
RETURNS TABLE (
  competency_id UUID,
  competency_name TEXT,
  required_level SMALLINT,
  assessed_level SMALLINT,
  gap INTEGER,
  resource_id UUID,
  resource_title TEXT,
  resource_type learning_resource_type,
  already_assigned BOOLEAN
)
LANGUAGE sql STABLE AS $$
  SELECT g.competency_id, g.competency_name, g.required_level, g.assessed_level,
         g.gap, r.id, r.title, r.resource_type,
         EXISTS (SELECT 1 FROM learning_assignment la
                  WHERE la.employee_id = p_employee_id
                    AND la.learning_resource_id = r.id)
    FROM app.competency_gaps(p_employee_id) g
    JOIN learning_resource r
      ON r.competency_id = g.competency_id
     AND r.is_active
   -- Below the bar, OR never assessed: both are development conversations,
   -- and the second is the one organisations forget.
   WHERE g.gap IS NULL OR g.gap < 0
   ORDER BY g.gap NULLS LAST, g.competency_name, r.title;
$$;

/*
 * Where an employee can go from their current position, and what each move
 * would require of them.
 *
 * Returns one row per reachable position with the count of competencies they
 * already meet versus still need — the honest version of a career ladder.
 */
CREATE FUNCTION app.career_options(p_employee_id UUID, p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  to_position_id UUID,
  to_position_title TEXT,
  move_type TEXT,
  typical_months INTEGER,
  requirements_total BIGINT,
  requirements_met BIGINT,
  requirements_unassessed BIGINT
)
LANGUAGE sql STABLE AS $$
  WITH current_position AS (
    SELECT em.position_id
      FROM employment em
     WHERE em.employee_id = p_employee_id
       AND em.effective_from <= p_as_of
       AND (em.effective_to IS NULL OR p_as_of < em.effective_to)
     LIMIT 1
  ),
  latest_assessment AS (
    SELECT DISTINCT ON (a.competency_id)
           a.competency_id, a.assessed_level
      FROM competency_assessment a
     WHERE a.subject_employee_id = p_employee_id
       AND a.assessed_on <= p_as_of
     ORDER BY a.competency_id, a.assessed_on DESC, a.created_at DESC
  )
  SELECT p.id, p.title, cp.move_type, cp.typical_months,
         COUNT(m.id),
         COUNT(*) FILTER (WHERE la.assessed_level >= m.required_level),
         COUNT(*) FILTER (WHERE la.assessed_level IS NULL)
    FROM career_path cp
    JOIN current_position c ON c.position_id = cp.from_position_id
    JOIN position p ON p.id = cp.to_position_id
    LEFT JOIN position_competency_map m ON m.position_id = p.id
    LEFT JOIN latest_assessment la ON la.competency_id = m.competency_id
   GROUP BY p.id, p.title, cp.move_type, cp.typical_months
   ORDER BY p.title;
$$;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['learning_resource', 'career_path', 'development_plan',
                           'dev_action', 'learning_assignment'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;

COMMIT;
