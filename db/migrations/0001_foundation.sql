-- 0001_foundation.sql
-- Phase 0: organization, people, and the temporal reporting hierarchy.
--
-- Temporal convention used throughout (architecture.md principle 3):
--   effective_from  DATE NOT NULL
--   effective_to    DATE NULL       -- NULL means "still in effect"
-- Ranges are half-open: [effective_from, effective_to). A row is in effect on
-- date D when  effective_from <= D AND (effective_to IS NULL OR D < effective_to).
-- Non-overlap is enforced by exclusion constraints, not application code.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist; -- exclusion constraints on uuid + range
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email comparison

CREATE SCHEMA IF NOT EXISTS app;
COMMENT ON SCHEMA app IS
  'Security helper functions. Kept out of public so RLS policies cannot be '
  'shadowed by a same-named object in a caller-controlled search_path.';

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------

CREATE TABLE organization (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     TEXT NOT NULL UNIQUE,
  name                     TEXT NOT NULL,
  timezone                 TEXT NOT NULL DEFAULT 'Asia/Manila',
  fiscal_year_start_month  SMALLINT NOT NULL DEFAULT 1
                             CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               UUID,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               UUID
);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

-- Drives form-template resolution in Phase 3 ("templates by user & EE type").
CREATE TABLE employment_type (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organization(id),
  code                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  is_eligible_for_review BOOLEAN NOT NULL DEFAULT TRUE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID,
  UNIQUE (org_id, code)
);

CREATE TABLE department (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id),
  parent_department_id UUID REFERENCES department(id),
  code                 TEXT NOT NULL,
  name                 TEXT NOT NULL,
  effective_from       DATE NOT NULL,
  effective_to         DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID,
  CONSTRAINT department_period_valid
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT department_not_own_parent
    CHECK (parent_department_id IS DISTINCT FROM id),
  UNIQUE (org_id, code, effective_from)
);

CREATE TABLE position (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organization(id),
  department_id UUID REFERENCES department(id),
  title         TEXT NOT NULL,
  job_level     TEXT,
  job_family    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID
);

-- Required for the importer's idempotent position upsert. Without it,
-- re-running an import creates a duplicate position per row, per run.
CREATE UNIQUE INDEX position_org_title_dept_uq
  ON position (org_id, title, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
-- Employee -- this system is the source of truth for people data (Q3).
-- ---------------------------------------------------------------------------

CREATE TYPE employee_status AS ENUM ('active', 'on_leave', 'suspended', 'separated');

CREATE TABLE employee (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organization(id),
  employee_no   TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  middle_name   TEXT,
  last_name     TEXT NOT NULL,
  preferred_name TEXT,
  work_email    CITEXT,
  personal_email CITEXT,
  -- Link to the IdP subject. Nullable because employees are imported before
  -- they ever log in; populated on first successful OIDC authentication.
  idp_subject   TEXT UNIQUE,
  status        employee_status NOT NULL DEFAULT 'active',
  hired_on      DATE NOT NULL,
  separated_on  DATE,
  -- Soft delete only (architecture.md principle 4). Performance data is
  -- evidence; a hard DELETE would orphan audit history.
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  CONSTRAINT employee_separation_after_hire
    CHECK (separated_on IS NULL OR separated_on >= hired_on),
  CONSTRAINT employee_separated_has_date
    CHECK (status <> 'separated' OR separated_on IS NOT NULL),
  UNIQUE (org_id, employee_no)
);

-- Partial unique: work_email must be unique among the living, but a separated
-- employee's address should not block a rehire or a new starter reusing it.
CREATE UNIQUE INDEX employee_work_email_active_uq
  ON employee (org_id, work_email)
  WHERE deleted_at IS NULL AND work_email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Employment -- effective-dated placement facts
-- ---------------------------------------------------------------------------

CREATE TYPE employment_status AS ENUM
  ('probationary', 'regular', 'project', 'fixed_term', 'consultant', 'intern');

CREATE TABLE employment (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organization(id),
  employee_id        UUID NOT NULL REFERENCES employee(id),
  position_id        UUID REFERENCES position(id),
  department_id      UUID NOT NULL REFERENCES department(id),
  employment_type_id UUID NOT NULL REFERENCES employment_type(id),
  status             employment_status NOT NULL,
  effective_from     DATE NOT NULL,
  effective_to       DATE,
  change_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID,
  CONSTRAINT employment_period_valid
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- An employee holds at most one employment record at any instant.
  -- Enforced by the database because overlapping records make "which
  -- department was this person in during Q3" unanswerable.
  CONSTRAINT employment_no_overlap EXCLUDE USING gist (
    employee_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);

CREATE INDEX employment_employee_idx ON employment (employee_id, effective_from DESC);
CREATE INDEX employment_department_idx ON employment (department_id);

-- ---------------------------------------------------------------------------
-- Reporting line -- the authorization backbone (architecture.md principle 2)
-- ---------------------------------------------------------------------------

CREATE TYPE reporting_line_type AS ENUM ('primary', 'dotted', 'matrix');

CREATE TABLE reporting_line (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES organization(id),
  employee_id            UUID NOT NULL REFERENCES employee(id),
  supervisor_employee_id UUID NOT NULL REFERENCES employee(id),
  line_type              reporting_line_type NOT NULL DEFAULT 'primary',
  effective_from         DATE NOT NULL,
  effective_to           DATE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by             UUID,
  CONSTRAINT reporting_line_period_valid
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT reporting_line_no_self_report
    CHECK (employee_id <> supervisor_employee_id),
  -- Exactly one PRIMARY supervisor at a time. Dotted/matrix lines may overlap
  -- freely, which is why line_type participates in the exclusion key.
  CONSTRAINT reporting_line_no_overlap EXCLUDE USING gist (
    employee_id WITH =,
    line_type WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);

CREATE INDEX reporting_line_supervisor_idx
  ON reporting_line (supervisor_employee_id, effective_from DESC);
CREATE INDEX reporting_line_employee_idx
  ON reporting_line (employee_id, effective_from DESC);

COMMIT;
