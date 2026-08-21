-- 0012_forms.sql
-- Phase 3, part 1: versioned rating scales and the form template engine.
--
-- The meeting notes ask for "Forms Creation -- Templates by user & EE type".
-- That is the requirement driving template ASSIGNMENT below: a template is
-- matched to an employee by their employment type and/or their role, with the
-- most specific match winning.
--
-- Versioning (architecture.md principle 1) is absolute here. A review answered
-- against form v1 must render under v1 forever, including its questions, its
-- rating scale, and its labels. Published versions are immutable.

BEGIN;

-- ---------------------------------------------------------------------------
-- Rating scales
-- ---------------------------------------------------------------------------

CREATE TABLE rating_scale (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organization(id),
  code       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  name       TEXT NOT NULL,
  description TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  supersedes_id UUID REFERENCES rating_scale(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  UNIQUE (org_id, code, version)
);

CREATE UNIQUE INDEX rating_scale_active_uq
  ON rating_scale (org_id, code) WHERE is_active;

CREATE TABLE rating_scale_point (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rating_scale_id UUID NOT NULL REFERENCES rating_scale(id) ON DELETE CASCADE,
  sequence        SMALLINT NOT NULL,
  value           NUMERIC(6,3) NOT NULL,
  label           TEXT NOT NULL,
  description     TEXT,
  UNIQUE (rating_scale_id, sequence),
  UNIQUE (rating_scale_id, value)
);

-- ---------------------------------------------------------------------------
-- Form templates
-- ---------------------------------------------------------------------------

CREATE TABLE form_template (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organization(id),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  description TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  UNIQUE (org_id, code)
);

-- The schema itself lives in JSONB. A fully relational field model (sections,
-- fields, options, conditions as tables) was considered and rejected: the
-- schema is read as a whole, written as a whole, and never queried field-by-
-- field across templates. JSONB keeps versioning to a single immutable row.
--
-- Shape:
--   { "sections": [ { "key","title","description",
--                     "fields": [ { "key","label","type","required",
--                                   "helpText","options":[],"maxLength" } ] } ] }
--   type: rating | text | textarea | select | multiselect | number | boolean | goal_review
CREATE TABLE form_version (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_template_id UUID NOT NULL REFERENCES form_template(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  schema_json     JSONB NOT NULL,
  rating_scale_id UUID REFERENCES rating_scale(id),
  -- Draft versions are editable; published ones never are (trigger below).
  published_at    TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID,
  UNIQUE (form_template_id, version),
  CONSTRAINT form_version_active_is_published
    CHECK (NOT is_active OR published_at IS NOT NULL)
);

CREATE UNIQUE INDEX form_version_active_uq
  ON form_version (form_template_id) WHERE is_active;

-- Immutability of published versions. Without this the whole versioning story
-- is decorative: someone edits v1's questions and every historical review
-- silently changes meaning.
CREATE FUNCTION app.form_version_immutable() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.schema_json IS DISTINCT FROM OLD.schema_json
       OR NEW.rating_scale_id IS DISTINCT FROM OLD.rating_scale_id
       OR NEW.version IS DISTINCT FROM OLD.version THEN
      RAISE EXCEPTION
        'Published form versions are immutable. Publish a new version instead.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER form_version_no_edit_after_publish
  BEFORE UPDATE ON form_version
  FOR EACH ROW EXECUTE FUNCTION app.form_version_immutable();

-- ---------------------------------------------------------------------------
-- Template assignment -- "templates by user & EE type"
-- ---------------------------------------------------------------------------

CREATE TABLE form_template_assignment (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organization(id),
  form_template_id   UUID NOT NULL REFERENCES form_template(id) ON DELETE CASCADE,
  -- Both NULL = the organisation-wide default.
  employment_type_id UUID REFERENCES employment_type(id),
  app_role_id        UUID REFERENCES app_role(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID
);

-- One assignment per (employment type, role) combination, treating NULL as a
-- real value -- otherwise two templates could both claim the same employee and
-- resolution would be nondeterministic.
CREATE UNIQUE INDEX form_template_assignment_uq
  ON form_template_assignment (
    org_id,
    COALESCE(employment_type_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(app_role_id,        '00000000-0000-0000-0000-000000000000'::uuid));

/*
 * Resolve the form version for an employee.
 *
 * Specificity order, most specific first:
 *   1. employment type AND role both match
 *   2. employment type matches, role unspecified
 *   3. role matches, employment type unspecified
 *   4. organisation default (both unspecified)
 *
 * Returns the ACTIVE published version of the winning template. NULL when
 * nothing matches, which callers must treat as a configuration error rather
 * than silently skipping the person.
 */
CREATE FUNCTION app.resolve_form_version(
  p_employee_id UUID,
  p_as_of       DATE DEFAULT CURRENT_DATE
) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  WITH context AS (
    SELECT e.org_id,
           em.employment_type_id,
           ARRAY(
             SELECT ra.role_id FROM role_assignment ra
              WHERE ra.employee_id = p_employee_id
                AND ra.effective_from <= p_as_of
                AND (ra.effective_to IS NULL OR p_as_of < ra.effective_to)
           ) AS role_ids
      FROM employee e
      LEFT JOIN employment em
        ON em.employee_id = e.id
       AND em.effective_from <= p_as_of
       AND (em.effective_to IS NULL OR p_as_of < em.effective_to)
     WHERE e.id = p_employee_id
  )
  SELECT fv.id
    FROM form_template_assignment a
    JOIN context c ON c.org_id = a.org_id
    JOIN form_template t ON t.id = a.form_template_id AND t.is_active
    JOIN form_version fv ON fv.form_template_id = t.id AND fv.is_active
   WHERE (a.employment_type_id IS NULL OR a.employment_type_id = c.employment_type_id)
     AND (a.app_role_id IS NULL OR a.app_role_id = ANY (c.role_ids))
   ORDER BY (a.employment_type_id IS NOT NULL)::int
          + (a.app_role_id IS NOT NULL)::int DESC,
            (a.employment_type_id IS NOT NULL) DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION app.resolve_form_version IS
  'Most-specific form version for an employee: employment type + role beats '
  'either alone, which beats the org default. NULL means misconfiguration.';

-- ---------------------------------------------------------------------------
-- Audit + RLS
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['rating_scale', 'form_template', 'form_version',
                           'form_template_assignment'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['rating_scale', 'rating_scale_point', 'form_template',
                           'form_version', 'form_template_assignment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO hr_app', t);
    -- Form definitions are readable by any authenticated employee: you cannot
    -- fill in a form you are not allowed to read. Writes are HR-only.
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT
         USING (app.current_employee_id() IS NOT NULL)', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT
         WITH CHECK (app.can_access(''form_template'', ''write'',
                                    app.current_employee_id()))', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE
         USING (app.can_access(''form_template'', ''write'', app.current_employee_id()))
         WITH CHECK (app.can_access(''form_template'', ''write'',
                                    app.current_employee_id()))', t || '_update', t);
  END LOOP;
END $$;

COMMIT;
