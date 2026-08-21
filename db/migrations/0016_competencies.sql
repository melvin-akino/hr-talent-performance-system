-- 0016_competencies.sql
-- Phase 4: competency frameworks, position requirements, assessment, gaps.
--
-- Versioning is the same rule as everywhere else (architecture.md principle 1):
-- a framework is published, then frozen. An assessment snapshots the framework
-- version it was made against, so "Level 3 — Proficient" means in 2029 exactly
-- what it meant in 2026, even after the framework is rewritten.
--
-- Competency assessments are as sensitive as the reviews that produce them.
-- Where an assessment belongs to a review, it inherits that review's
-- confidentiality — including the rule that an employee cannot see their
-- supervisor's judgement before release (migration 0014).

BEGIN;

-- Assessing someone against a competency is a distinct capability from editing
-- the framework ('write') or reading a gap report ('read'): a manager assesses
-- but must not redefine the model. Added here rather than in 0017 because
-- PostgreSQL forbids USING a new enum value in the transaction that adds it.
ALTER TYPE grant_action ADD VALUE IF NOT EXISTS 'assess';

-- ---------------------------------------------------------------------------
-- Framework (versioned)
-- ---------------------------------------------------------------------------

CREATE TABLE competency_framework (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organization(id),
  code          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  name          TEXT NOT NULL,
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  supersedes_id UUID REFERENCES competency_framework(id),
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  UNIQUE (org_id, code, version),
  CONSTRAINT competency_framework_active_is_published
    CHECK (NOT is_active OR published_at IS NOT NULL)
);

-- One live framework per code, per tenant.
CREATE UNIQUE INDEX competency_framework_active_uq
  ON competency_framework (org_id, code) WHERE is_active;

CREATE TABLE competency (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id UUID NOT NULL REFERENCES competency_framework(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  -- e.g. core | leadership | functional | technical
  category     TEXT,
  sequence     SMALLINT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,
  UNIQUE (framework_id, code)
);

CREATE INDEX competency_framework_idx ON competency (framework_id, sequence);

-- The behavioural indicators. This is what makes a competency assessable
-- rather than a vibe: level 3 is defined by observable behaviour, not by the
-- assessor's private notion of "proficient".
CREATE TABLE competency_level (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_id        UUID NOT NULL REFERENCES competency(id) ON DELETE CASCADE,
  level_no             SMALLINT NOT NULL CHECK (level_no > 0),
  label                TEXT NOT NULL,
  behavioral_indicator TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID,
  UNIQUE (competency_id, level_no)
);

-- A published framework is immutable, exactly like form versions. Without
-- this, editing a level's meaning silently rewrites every past assessment.
-- One function per table rather than one shared function branching on
-- TG_TABLE_NAME: a shared body must name columns that only exist on some of
-- the tables, and plpgsql resolves record fields at runtime regardless of which
-- branch is taken, so it fails with "record new has no field ...".

CREATE FUNCTION app.framework_identity_immutable() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL
     AND (NEW.version IS DISTINCT FROM OLD.version
          OR NEW.code IS DISTINCT FROM OLD.code) THEN
    RAISE EXCEPTION 'Published frameworks are immutable; publish a new version'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION app.competency_frozen() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_published TIMESTAMPTZ;
BEGIN
  SELECT f.published_at INTO v_published
    FROM competency_framework f
   WHERE f.id = COALESCE(NEW.framework_id, OLD.framework_id);

  IF v_published IS NOT NULL THEN
    RAISE EXCEPTION
      'This framework is published and cannot be edited. Publish a new version.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION app.competency_level_frozen() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_published TIMESTAMPTZ;
BEGIN
  SELECT f.published_at INTO v_published
    FROM competency c
    JOIN competency_framework f ON f.id = c.framework_id
   WHERE c.id = COALESCE(NEW.competency_id, OLD.competency_id);

  IF v_published IS NOT NULL THEN
    RAISE EXCEPTION
      'This framework is published and cannot be edited. Publish a new version.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER competency_framework_freeze
  BEFORE UPDATE ON competency_framework
  FOR EACH ROW EXECUTE FUNCTION app.framework_identity_immutable();

CREATE TRIGGER competency_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON competency
  FOR EACH ROW EXECUTE FUNCTION app.competency_frozen();

CREATE TRIGGER competency_level_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON competency_level
  FOR EACH ROW EXECUTE FUNCTION app.competency_level_frozen();

-- ---------------------------------------------------------------------------
-- Position requirements -- "competency mapping"
-- ---------------------------------------------------------------------------

CREATE TABLE position_competency_map (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organization(id),
  position_id    UUID NOT NULL REFERENCES position(id) ON DELETE CASCADE,
  competency_id  UUID NOT NULL REFERENCES competency(id) ON DELETE CASCADE,
  required_level SMALLINT NOT NULL CHECK (required_level > 0),
  -- Weight lets a job family say "judgement matters more than tooling here".
  weight         NUMERIC(5,2) CHECK (weight IS NULL OR (weight > 0 AND weight <= 100)),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,
  UNIQUE (position_id, competency_id)
);

CREATE INDEX position_competency_position_idx ON position_competency_map (position_id);

-- The required level must exist in that competency's own scale. A requirement
-- of 7 against a 5-level competency is unmeetable by construction.
CREATE FUNCTION app.validate_required_level() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM competency_level cl
     WHERE cl.competency_id = NEW.competency_id
       AND cl.level_no = NEW.required_level
  ) THEN
    RAISE EXCEPTION
      'Required level % is not defined for this competency', NEW.required_level
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER position_competency_level_valid
  BEFORE INSERT OR UPDATE ON position_competency_map
  FOR EACH ROW EXECUTE FUNCTION app.validate_required_level();

-- ---------------------------------------------------------------------------
-- Assessment
-- ---------------------------------------------------------------------------

CREATE TABLE competency_assessment (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organization(id),
  subject_employee_id UUID NOT NULL REFERENCES employee(id),
  competency_id       UUID NOT NULL REFERENCES competency(id),
  -- Snapshot of the framework version in force at assessment time.
  framework_version   INTEGER NOT NULL,
  assessed_level      SMALLINT NOT NULL CHECK (assessed_level > 0),
  assessed_by         UUID NOT NULL REFERENCES employee(id),
  notes               TEXT,
  -- When an assessment arises from a review, it inherits that review's
  -- confidentiality. Standalone assessments (recorded by HR outside a cycle)
  -- leave this NULL and fall back to the competency grant.
  review_instance_id  UUID REFERENCES review_instance(id) ON DELETE SET NULL,
  assessed_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID,
  CONSTRAINT competency_assessment_same_org
    FOREIGN KEY (subject_employee_id, org_id) REFERENCES employee (id, org_id)
);

CREATE INDEX competency_assessment_subject_idx
  ON competency_assessment (subject_employee_id, competency_id, assessed_on DESC);
CREATE INDEX competency_assessment_review_idx
  ON competency_assessment (review_instance_id);

-- Append-only, like check-ins and review answers: an assessment is a
-- contemporaneous judgement, and a re-assessment is a NEW row so the trajectory
-- stays visible.
CREATE RULE competency_assessment_no_update AS
  ON UPDATE TO competency_assessment DO INSTEAD NOTHING;
CREATE RULE competency_assessment_no_delete AS
  ON DELETE TO competency_assessment DO INSTEAD NOTHING;

CREATE FUNCTION app.snapshot_framework_version() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.framework_version IS NULL THEN
    SELECT f.version INTO NEW.framework_version
      FROM competency c JOIN competency_framework f ON f.id = c.framework_id
     WHERE c.id = NEW.competency_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competency_level cl
     WHERE cl.competency_id = NEW.competency_id
       AND cl.level_no = NEW.assessed_level
  ) THEN
    RAISE EXCEPTION
      'Assessed level % is not defined for this competency', NEW.assessed_level
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER competency_assessment_snapshot
  BEFORE INSERT ON competency_assessment
  FOR EACH ROW EXECUTE FUNCTION app.snapshot_framework_version();

-- ---------------------------------------------------------------------------
-- Gap analysis
-- ---------------------------------------------------------------------------
-- Required (from the employee's current position) vs assessed (their most
-- recent assessment per competency). Runs under the CALLER's RLS, so it can
-- never report on someone out of scope.

CREATE FUNCTION app.competency_gaps(p_employee_id UUID, p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  competency_id   UUID,
  competency_code TEXT,
  competency_name TEXT,
  category        TEXT,
  required_level  SMALLINT,
  assessed_level  SMALLINT,
  gap             INTEGER,
  weight          NUMERIC,
  assessed_on     DATE
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
  latest AS (
    -- One row per competency: the most recent assessment.
    SELECT DISTINCT ON (a.competency_id)
           a.competency_id, a.assessed_level, a.assessed_on
      FROM competency_assessment a
     WHERE a.subject_employee_id = p_employee_id
       AND a.assessed_on <= p_as_of
     ORDER BY a.competency_id, a.assessed_on DESC, a.created_at DESC
  )
  SELECT c.id, c.code, c.name, c.category,
         m.required_level,
         l.assessed_level,
         -- NULL assessed level means "never assessed", which is a different
         -- problem from "assessed below requirement" and must not read as 0.
         CASE WHEN l.assessed_level IS NULL THEN NULL
              ELSE l.assessed_level - m.required_level END,
         m.weight,
         l.assessed_on
    FROM position_competency_map m
    JOIN current_position cp ON cp.position_id = m.position_id
    JOIN competency c ON c.id = m.competency_id
    LEFT JOIN latest l ON l.competency_id = m.competency_id
   ORDER BY c.category NULLS LAST, c.name;
$$;

COMMENT ON FUNCTION app.competency_gaps IS
  'Required vs latest assessed level for an employee''s current position. '
  'A NULL gap means never assessed -- distinct from a gap of 0.';

COMMIT;
