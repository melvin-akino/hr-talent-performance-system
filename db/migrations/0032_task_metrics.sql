-- 0032_task_metrics.sql
-- Task indicators, and the scorecards that assign them to people.
--
-- The client asked for two modes: "just load the metrics for the staff for later
-- use", and "load KPI and evaluate". This migration is the first — everything
-- needed to define what a person is measured on, without evaluating anything.
--
-- It is the same definition/instance split the schema already runs on. A
-- scorecard is a DEFINITION: these indicators, these points, this is what good
-- looks like. An evaluation is an INSTANCE issued against it. Keeping them apart
-- is what lets HCM prepare a department in March and evaluate it in June without
-- the March work being an evaluation nobody asked for.
--
-- ---------------------------------------------------------------------------
-- WHERE THE SHAPE COMES FROM
-- ---------------------------------------------------------------------------
-- The client's `hcm kpi` sheet, which is a working document rather than a
-- specification. Rows 26-57 are a controlled vocabulary of ~75 task names in
-- three columns — Administrative, Field, Technical. Rows 61-481 are fifteen
-- scorecards, each a subset of that vocabulary with points and a written
-- acceptance criterion:
--
--   Hiring & Selection | T | Applicant Screening | 2 | 40 applicants/week with
--                                                     comprehensively filled
--                                                     interview sheets
--
-- The nature is not decoration: it carries the multiplier. Administrative work
-- is worth 1, Field 1.5, Technical 2 (rows 15-18). That is the "Weight (1, 1.5,
-- 2)" from the 5-pager, which read as an arbitrary weighting until the workbook
-- explained it.
--
-- Points are NOT derived from the nature, though, because the sheet overrides
-- them: "Applicant Matching" is Technical but scores 14, being "2 pts per
-- division" across seven divisions. So the nature supplies the default and the
-- scorecard may say otherwise.

BEGIN;

-- The composite tenant key the scorecard needs to point at a unit. Every other
-- cross-tenant reference in this schema is guarded this way (employee and
-- job_rank already carry one); department never needed it until now.
ALTER TABLE department ADD CONSTRAINT department_id_org_uq UNIQUE (id, org_id);

CREATE TYPE task_nature AS ENUM ('administrative', 'field', 'technical');

CREATE FUNCTION app.task_nature_multiplier(p_nature task_nature) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_nature
    WHEN 'administrative' THEN 1.0
    WHEN 'field'          THEN 1.5
    WHEN 'technical'      THEN 2.0
  END::NUMERIC;
$$;

COMMENT ON FUNCTION app.task_nature_multiplier(task_nature) IS
  'Points one occurrence of this kind of work is worth by default: '
  'administrative 1, field 1.5, technical 2 (client workbook, hcm kpi rows 15-18).';

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------
-- Shared vocabulary, not free text. Two supervisors writing "Dox Filing" and
-- "Document Filing" for the same work make every cross-department comparison
-- meaningless, and comparison is the whole point of a scoring system.

CREATE TABLE task_indicator (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organization(id),
  name        TEXT NOT NULL,
  nature      task_nature NOT NULL,
  -- What the work is, for a supervisor choosing from a list of seventy-five.
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID,

  UNIQUE (org_id, name),
  UNIQUE (id, org_id)
);

-- ---------------------------------------------------------------------------
-- Scorecards
-- ---------------------------------------------------------------------------

CREATE TABLE scorecard (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organization(id),
  name        TEXT NOT NULL,
  -- The section or department this belongs to. Optional: a scorecard may span
  -- units, and one that names none is simply not filed under a unit.
  department_id UUID,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID,

  UNIQUE (org_id, name),
  UNIQUE (id, org_id),
  CONSTRAINT scorecard_department_same_org
    FOREIGN KEY (department_id, org_id) REFERENCES department (id, org_id)
);

CREATE TABLE scorecard_item (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organization(id),
  scorecard_id UUID NOT NULL,
  task_indicator_id UUID NOT NULL,

  -- Defaults to the nature's multiplier, overridable because the sheet does
  -- exactly that where one indicator covers repeated work.
  points       NUMERIC(6,2) NOT NULL,

  -- The acceptance criterion, in the supervisor's own words: "40 applicants/
  -- week with comprehensively filled interview sheets". This is the most useful
  -- text in the whole workbook — it is what makes a score arguable rather than
  -- a matter of taste — so it is a first-class column, not a note.
  criteria     TEXT,
  sequence     SMALLINT NOT NULL DEFAULT 1,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,

  CONSTRAINT scorecard_item_points_positive CHECK (points > 0),
  -- NO uniqueness on (scorecard, indicator). The line is the unit, not the
  -- indicator, and the client'''s sheet relies on it: Social Insurances lists
  -- "Claims Processing" three times — accident, maternity, sickness — and
  -- "Payments processing" eleven times, once per company, each worth a point.
  -- A unique constraint here silently collapsed those to one line and took a
  -- 33-point scorecard down to 19.
  CONSTRAINT scorecard_item_scorecard_same_org
    FOREIGN KEY (scorecard_id, org_id) REFERENCES scorecard (id, org_id) ON DELETE CASCADE,
  CONSTRAINT scorecard_item_indicator_same_org
    FOREIGN KEY (task_indicator_id, org_id) REFERENCES task_indicator (id, org_id)
);

-- ---------------------------------------------------------------------------
-- Who holds which scorecard
-- ---------------------------------------------------------------------------
-- Effective-dated, like employment and reporting lines. Someone who moves from
-- Screening to Onboarding in June was measured on Screening until then, and an
-- evaluation covering the first half of the year has to be able to say so.

CREATE TABLE scorecard_assignment (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organization(id),
  scorecard_id   UUID NOT NULL,
  employee_id    UUID NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,

  CONSTRAINT scorecard_assignment_range CHECK (effective_to IS NULL
                                               OR effective_to > effective_from),
  CONSTRAINT scorecard_assignment_scorecard_same_org
    FOREIGN KEY (scorecard_id, org_id) REFERENCES scorecard (id, org_id),
  CONSTRAINT scorecard_assignment_employee_same_org
    FOREIGN KEY (employee_id, org_id) REFERENCES employee (id, org_id)
);

-- A person holds one scorecard at a time. Two overlapping ones would make "what
-- is this person measured on" ambiguous on the day it matters most.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE scorecard_assignment
  ADD CONSTRAINT scorecard_assignment_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  );

CREATE INDEX scorecard_assignment_current_idx
  ON scorecard_assignment (employee_id) WHERE effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- What a person is measured on, as of a date
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.scorecard_for(p_employee UUID, p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT sa.scorecard_id
    FROM scorecard_assignment sa
   WHERE sa.employee_id = p_employee
     AND sa.effective_from <= p_as_of
     AND (sa.effective_to IS NULL OR p_as_of < sa.effective_to)
   LIMIT 1;
$$;

-- The target a scorecard adds up to. Computed rather than stored: the workbook's
-- own totals are SUM formulas over the rows, and a stored copy would drift the
-- first time somebody edited a line.
CREATE FUNCTION app.scorecard_target(p_scorecard UUID) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(points), 0) FROM scorecard_item WHERE scorecard_id = p_scorecard;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Reading is tenant-wide: a person must be able to see what they are measured
-- on, and a supervisor must be able to see it before an evaluation, not after.
-- Writing follows the client's own division of labour — the department head
-- sets the performance items for their unit, HCM does so anywhere.

DO $do$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_indicator','scorecard','scorecard_item','scorecard_assignment']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (
         app.current_employee_id() IS NOT NULL AND org_id = app.current_org_id())',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (
         org_id = app.current_org_id()
         AND app.can_access(''scorecard'', ''write'', app.current_employee_id()))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (
         app.can_access(''scorecard'', ''write'', app.current_employee_id()))',
      t || '_update', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO hr_app', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $do$;

-- Deleting a scorecard line is a normal correction, so DELETE is granted above;
-- the audit trigger records it either way.
CREATE POLICY scorecard_item_delete ON scorecard_item FOR DELETE
  USING (app.can_access('scorecard', 'write', app.current_employee_id()));

CREATE FUNCTION app.seed_scorecard_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_hr_admin  UUID;
  v_dept_head UUID;
BEGIN
  SELECT id INTO v_hr_admin  FROM app_role WHERE org_id = p_org_id AND code = 'hr_admin';
  SELECT id INTO v_dept_head FROM app_role WHERE org_id = p_org_id AND code = 'dept_head';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  VALUES
    (p_org_id, v_hr_admin,  'scorecard', 'write', 'org'),
    -- Scoped to their unit: a department head defines their own people's
    -- metrics and nobody else's.
    (p_org_id, v_dept_head, 'scorecard', 'write', 'department')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_scorecard_grants(r.id);
  END LOOP;
END $do$;

COMMIT;
