-- 0007_goals.sql
-- Phase 1: KPI definitions, goal periods, goals, targets, and check-ins.
--
-- Two rules from architecture.md are doing most of the work here:
--
--  * Principle 1 (versioning): a goal snapshots the KPI definition version it
--    was authored against. Publishing v2 of a KPI must not retroactively
--    change what a 2026 goal meant.
--  * Direction-aware attainment is a GENERATED column. `lower_is_better`
--    inverts the formula, and duplicating that across API, reports, and
--    exports guarantees they eventually disagree. One definition, in the DB.

BEGIN;

-- ---------------------------------------------------------------------------
-- Goal period
-- ---------------------------------------------------------------------------

CREATE TYPE goal_period_type AS ENUM ('annual', 'semi_annual', 'quarterly', 'custom');

-- open   -- goals may be created, edited, weighted
-- locked -- goal SET is frozen; check-ins and actuals still flow
-- closed -- everything frozen; the historical record
CREATE TYPE goal_period_state AS ENUM ('draft', 'open', 'locked', 'closed');

CREATE TABLE goal_period (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organization(id),
  name        TEXT NOT NULL,
  period_type goal_period_type NOT NULL,
  starts_on   DATE NOT NULL,
  ends_on     DATE NOT NULL,
  state       goal_period_state NOT NULL DEFAULT 'draft',
  locked_at   TIMESTAMPTZ,
  closed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID,
  CONSTRAINT goal_period_range_valid CHECK (ends_on > starts_on),
  UNIQUE (org_id, name)
);

-- ---------------------------------------------------------------------------
-- KPI definition library (versioned)
-- ---------------------------------------------------------------------------

CREATE TYPE kpi_measure_type AS ENUM
  ('numeric', 'percentage', 'currency', 'ratio', 'milestone', 'boolean');

CREATE TYPE kpi_direction AS ENUM ('higher_is_better', 'lower_is_better');

CREATE TABLE kpi_definition (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organization(id),
  code           TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  name           TEXT NOT NULL,
  description    TEXT,
  category       TEXT,
  measure_type   kpi_measure_type NOT NULL,
  direction      kpi_direction NOT NULL DEFAULT 'higher_is_better',
  unit           TEXT,
  default_weight NUMERIC(5,2) CHECK (default_weight IS NULL
                                     OR (default_weight > 0 AND default_weight <= 100)),
  -- A version is retired by superseding it, never by editing or deleting it.
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  supersedes_id  UUID REFERENCES kpi_definition(id),
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,
  UNIQUE (org_id, code, version)
);

-- Exactly one active version per code. Prevents two "current" definitions of
-- the same KPI, which would make goal creation nondeterministic.
CREATE UNIQUE INDEX kpi_definition_active_version_uq
  ON kpi_definition (org_id, code) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Goal
-- ---------------------------------------------------------------------------

CREATE TYPE goal_state AS ENUM
  ('draft', 'pending_approval', 'active', 'achieved', 'missed', 'cancelled');

CREATE TABLE goal (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organization(id),
  goal_period_id        UUID NOT NULL REFERENCES goal_period(id),
  employee_id           UUID NOT NULL REFERENCES employee(id),

  -- NULL = free-form goal not drawn from the library.
  kpi_definition_id     UUID REFERENCES kpi_definition(id),
  -- Snapshot of the version in force at creation. Frozen by trigger; see
  -- app.freeze_kpi_version() below.
  kpi_definition_version INTEGER,

  -- Cascade: a department or manager goal decomposed into individual goals.
  parent_goal_id        UUID REFERENCES goal(id) ON DELETE RESTRICT,

  title                 TEXT NOT NULL,
  description           TEXT,
  weight                NUMERIC(5,2) NOT NULL
                          CHECK (weight > 0 AND weight <= 100),
  due_on                DATE,
  state                 goal_state NOT NULL DEFAULT 'draft',
  approved_by           UUID REFERENCES employee(id),
  approved_at           TIMESTAMPTZ,
  cancelled_reason      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID,

  CONSTRAINT goal_not_own_parent CHECK (parent_goal_id IS DISTINCT FROM id),
  CONSTRAINT goal_approved_fields_together
    CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT goal_version_requires_definition
    CHECK (kpi_definition_version IS NULL OR kpi_definition_id IS NOT NULL)
);

CREATE INDEX goal_employee_period_idx ON goal (employee_id, goal_period_id);
CREATE INDEX goal_period_idx ON goal (goal_period_id, state);
CREATE INDEX goal_parent_idx ON goal (parent_goal_id) WHERE parent_goal_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Goal target -- a goal may carry more than one measure
-- ---------------------------------------------------------------------------

CREATE TABLE goal_target (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id        UUID NOT NULL REFERENCES goal(id) ON DELETE CASCADE,
  sequence       SMALLINT NOT NULL DEFAULT 1,
  measure_name   TEXT NOT NULL,
  measure_type   kpi_measure_type NOT NULL,
  -- Snapshotted from the KPI definition rather than joined at read time: a
  -- generated column cannot reference another table, and more importantly the
  -- direction in force when the goal was written must not change later.
  direction      kpi_direction NOT NULL DEFAULT 'higher_is_better',
  unit           TEXT,
  baseline_value NUMERIC(18,4),
  target_value   NUMERIC(18,4) NOT NULL,
  stretch_value  NUMERIC(18,4),
  actual_value   NUMERIC(18,4),
  actual_as_of   DATE,

  -- THE attainment definition. Everything else reads this column.
  --
  -- With a baseline, attainment measures progress across the intended range
  -- (baseline -> target), which is the only correct reading when the baseline
  -- is non-zero. Without one, it falls back to a simple ratio -- inverted for
  -- lower_is_better, so a cost KPI beating its target scores above 100.
  --
  -- Every denominator is guarded; a degenerate target yields NULL, not a
  -- division error that would fail the whole write.
  attainment_pct NUMERIC(9,4) GENERATED ALWAYS AS (
    CASE
      WHEN actual_value IS NULL THEN NULL
      WHEN baseline_value IS NOT NULL AND baseline_value <> target_value THEN
        ROUND(((actual_value - baseline_value)
               / (target_value - baseline_value)) * 100, 4)
      WHEN baseline_value IS NOT NULL AND baseline_value = target_value THEN NULL
      WHEN direction = 'higher_is_better' THEN
        CASE WHEN target_value = 0 THEN NULL
             ELSE ROUND((actual_value / target_value) * 100, 4) END
      ELSE
        CASE WHEN actual_value = 0 THEN NULL
             ELSE ROUND((target_value / actual_value) * 100, 4) END
    END
  ) STORED,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID,
  UNIQUE (goal_id, sequence)
);

CREATE INDEX goal_target_goal_idx ON goal_target (goal_id);

COMMENT ON COLUMN goal_target.attainment_pct IS
  'Direction-aware attainment. Baseline-relative when a baseline exists, '
  'otherwise a ratio inverted for lower_is_better. Never compute this '
  'elsewhere -- read this column.';

-- ---------------------------------------------------------------------------
-- Goal check-in -- the KPI monitoring trail
-- ---------------------------------------------------------------------------

CREATE TYPE checkin_status AS ENUM ('on_track', 'at_risk', 'off_track');

CREATE TABLE goal_checkin (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id        UUID NOT NULL REFERENCES goal(id) ON DELETE RESTRICT,
  goal_target_id UUID REFERENCES goal_target(id) ON DELETE RESTRICT,
  checked_in_by  UUID NOT NULL REFERENCES employee(id),
  reported_value NUMERIC(18,4),
  progress_pct   NUMERIC(9,4),
  status_flag    checkin_status NOT NULL,
  comment        TEXT,
  evidence_url   TEXT,
  period_ending  DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID
);

CREATE INDEX goal_checkin_goal_idx ON goal_checkin (goal_id, period_ending DESC);
CREATE INDEX goal_checkin_status_idx ON goal_checkin (status_flag, created_at DESC);

-- Append-only. A check-in is a statement made at a point in time; editing one
-- retroactively rewrites the monitoring history the whole phase exists to
-- provide.
CREATE RULE goal_checkin_no_update AS ON UPDATE TO goal_checkin DO INSTEAD NOTHING;
CREATE RULE goal_checkin_no_delete AS ON DELETE TO goal_checkin DO INSTEAD NOTHING;

COMMIT;
