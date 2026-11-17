-- ===========================================================================
-- Migration 0052: Philippine Time & Attendance + Statutory Leaves Engine
--
-- Adds:
-- 1. Holiday Calendar (Philippine Regular & Special Non-Working Holidays)
-- 2. Shifts & Schedules (Core hours, grace periods, break times)
-- 3. Daily Time Record (DTR) & Attendance Logs (In/Out, OT, Night Diff, Tardiness)
-- 4. Statutory Leave Types (SIL, Solo Parent, VAWC, Magna Carta, Maternity, Paternity, VL, SL)
-- 5. Leave Balances & Allocation Ledger
-- 6. Leave Applications & Workflow
-- 7. Interconnection with Philippine Payroll & RLS isolation
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Holiday Calendar
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS holiday_calendar (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  branch_id    UUID REFERENCES branch(id) ON DELETE CASCADE, -- NULL = Nationwide/all branches
  name         VARCHAR(255) NOT NULL,
  holiday_date DATE NOT NULL,
  holiday_type VARCHAR(32) NOT NULL DEFAULT 'regular', -- 'regular' (200%), 'special_non_working' (130%), 'special_working' (100%)
  year         INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_holiday_org_branch_date UNIQUE (org_id, branch_id, holiday_date)
);

COMMENT ON TABLE holiday_calendar IS
  'Philippine official holidays used for statutory premium rate calculations.';

-- ---------------------------------------------------------------------------
-- 2. Shifts & Work Schedules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_shift (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  code               VARCHAR(32) NOT NULL,
  name               VARCHAR(128) NOT NULL,
  start_time         TIME NOT NULL DEFAULT '08:00:00',
  end_time           TIME NOT NULL DEFAULT '17:00:00',
  break_minutes      INTEGER NOT NULL DEFAULT 60,
  grace_period_mins  INTEGER NOT NULL DEFAULT 15,
  is_night_shift     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_shift_org_code UNIQUE (org_id, code)
);

COMMENT ON TABLE attendance_shift IS
  'Working shifts defining schedule boundaries and grace periods.';

-- ---------------------------------------------------------------------------
-- 3. Daily Time Records (DTR)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_record (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  branch_id            UUID REFERENCES branch(id) ON DELETE SET NULL,
  shift_id             UUID REFERENCES attendance_shift(id) ON DELETE SET NULL,
  work_date            DATE NOT NULL,
  clock_in             TIMESTAMPTZ,
  clock_out            TIMESTAMPTZ,
  -- Time tracking metrics:
  total_hours_worked   NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
  regular_hours        NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
  tardiness_minutes    INTEGER NOT NULL DEFAULT 0,
  undertime_minutes    INTEGER NOT NULL DEFAULT 0,
  regular_ot_hours     NUMERIC(6, 2) NOT NULL DEFAULT 0.00, -- 125%
  rest_day_ot_hours    NUMERIC(6, 2) NOT NULL DEFAULT 0.00, -- 130% or 169%
  holiday_ot_hours     NUMERIC(6, 2) NOT NULL DEFAULT 0.00, -- 200% or 260%
  night_diff_hours     NUMERIC(6, 2) NOT NULL DEFAULT 0.00, -- 10:00 PM to 6:00 AM (110%)
  is_rest_day          BOOLEAN NOT NULL DEFAULT FALSE,
  is_absent            BOOLEAN NOT NULL DEFAULT FALSE,
  is_on_leave          BOOLEAN NOT NULL DEFAULT FALSE,
  status               VARCHAR(32) NOT NULL DEFAULT 'submitted', -- 'draft', 'submitted', 'approved', 'disputed'
  approved_by          UUID REFERENCES employee(id) ON DELETE SET NULL,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_attendance_emp_date UNIQUE (employee_id, work_date)
);

COMMENT ON TABLE attendance_record IS
  'Daily attendance log capturing biometric/web clockings, OT, night diff, and tardiness.';

-- ---------------------------------------------------------------------------
-- 4. Statutory & Company Leave Types
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leave_type (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  code                 VARCHAR(32) NOT NULL,
  name                 VARCHAR(128) NOT NULL,
  description          TEXT,
  is_paid              BOOLEAN NOT NULL DEFAULT TRUE,
  is_statutory         BOOLEAN NOT NULL DEFAULT FALSE, -- e.g. SIL, Solo Parent, VAWC, Maternity, Paternity
  default_days_per_year NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
  can_cash_convert     BOOLEAN NOT NULL DEFAULT FALSE, -- Commutable to cash (e.g. SIL Article 95)
  can_carry_over       BOOLEAN NOT NULL DEFAULT FALSE,
  max_carry_over_days  NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  gender_restriction   VARCHAR(16), -- 'all', 'male' (Paternity), 'female' (Maternity, Magna Carta)
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_leave_type_org_code UNIQUE (org_id, code)
);

COMMENT ON TABLE leave_type IS
  'Philippine statutory leaves and company-provided discretionary leaves.';

-- ---------------------------------------------------------------------------
-- 5. Employee Leave Balances & Allocation Ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leave_allocation (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  leave_type_id        UUID NOT NULL REFERENCES leave_type(id) ON DELETE CASCADE,
  year                 INTEGER NOT NULL,
  allocated_days       NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  used_days            NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  pending_days         NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  remaining_days       NUMERIC(5, 2) GENERATED ALWAYS AS (allocated_days - used_days) STORED,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_allocation_emp_type_year UNIQUE (employee_id, leave_type_id, year)
);

COMMENT ON TABLE leave_allocation IS
  'Yearly leave credits allocated to an employee with real-time balance tracking.';

-- ---------------------------------------------------------------------------
-- 6. Leave Applications & Approval Workflow
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leave_request (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  leave_type_id        UUID NOT NULL REFERENCES leave_type(id) ON DELETE RESTRICT,
  start_date           DATE NOT NULL,
  end_date             DATE NOT NULL,
  total_days           NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
  reason               TEXT NOT NULL,
  status               VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'cancelled'
  approved_by          UUID REFERENCES employee(id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE leave_request IS
  'Employee leave applications requiring supervisor/HR approval.';

-- ---------------------------------------------------------------------------
-- 7. Row-Level Security (RLS) & Permissions
-- ---------------------------------------------------------------------------

ALTER TABLE holiday_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_shift ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_request ENABLE ROW LEVEL SECURITY;

-- holiday_calendar
CREATE POLICY holiday_tenant_isolation ON holiday_calendar FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

-- attendance_shift
CREATE POLICY shift_tenant_isolation ON attendance_shift FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

-- attendance_record (Employees see own records, managers/admins see tenant)
CREATE POLICY attendance_read ON attendance_record FOR SELECT
  USING (
    employee_id = app.current_employee_id()
    OR org_id = app.current_org_id()
    OR app.is_platform_superadmin()
  );

CREATE POLICY attendance_modify ON attendance_record FOR ALL
  USING (
    employee_id = app.current_employee_id()
    OR org_id = app.current_org_id()
    OR app.is_platform_superadmin()
  )
  WITH CHECK (
    org_id = app.current_org_id()
    OR app.is_platform_superadmin()
  );

-- leave_type
CREATE POLICY leave_type_tenant_isolation ON leave_type FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

-- leave_allocation
CREATE POLICY leave_allocation_read ON leave_allocation FOR SELECT
  USING (
    employee_id = app.current_employee_id()
    OR org_id = app.current_org_id()
    OR app.is_platform_superadmin()
  );

CREATE POLICY leave_allocation_modify ON leave_allocation FOR ALL
  USING ((org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin())
  WITH CHECK ((org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin());

-- leave_request
CREATE POLICY leave_request_read ON leave_request FOR SELECT
  USING (
    employee_id = app.current_employee_id()
    OR org_id = app.current_org_id()
    OR app.is_platform_superadmin()
  );

CREATE POLICY leave_request_modify ON leave_request FOR ALL
  USING (
    employee_id = app.current_employee_id()
    OR org_id = app.current_org_id()
    OR app.is_platform_superadmin()
  )
  WITH CHECK (
    org_id = app.current_org_id()
    OR app.is_platform_superadmin()
  );

-- ---------------------------------------------------------------------------
-- 8. Grant Permissions to hr_app
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON holiday_calendar TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_shift TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_record TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_type TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_allocation TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_request TO hr_app;

COMMIT;
