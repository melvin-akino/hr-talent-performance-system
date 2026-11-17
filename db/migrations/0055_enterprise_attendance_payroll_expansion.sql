-- 0055_enterprise_attendance_payroll_expansion.sql
-- Enterprise Expansion for Philippine Attendance & Payroll System:
--   1. Terminal Kiosk Passcode (PIN) Enrollment & Kiosk Punch Logging
--   2. Shift Rostering, Broken/Split Shifts, Shift Swapping & Comp-Off (CTO)
--   3. Employee Loan Amortization Ledger (SSS, Pag-IBIG, Company Loans)
--   4. Recurring & Ad-hoc Allowances / Deductions & Hospitality Service Charge
--   5. Salary Grade Matrix by Region / Rank & Retroactive Pay Adjustments
--   6. Official Business (OB) / Travel Orders & Timesheet Dispute Requests
--   7. Habitual Tardiness Monitoring & Disciplinary Memos (NTE)
--   8. 201 Document Vault & Merits/Commendations
--   9. Hotel Duty Meal Voucher Ledger

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Terminal Kiosk Passcode (PIN) Enrollment
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.terminal_credential (
  employee_id          UUID PRIMARY KEY REFERENCES employee(id) ON DELETE CASCADE,
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  kiosk_pin_hash       TEXT NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  enrolled_by          UUID REFERENCES employee(id) ON DELETE SET NULL,
  enrolled_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_punch_at        TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.terminal_credential IS
  'Secure hashed 4-6 digit passcodes for on-site wall tablet and kiosk punch terminal.';

-- Security Definer Lookup for Kiosk Terminal Punch (bypasses RLS prior to setting tenant context)
CREATE OR REPLACE FUNCTION app.lookup_kiosk_credential(p_employee_no TEXT)
RETURNS TABLE (
  employee_id    UUID,
  org_id         UUID,
  employee_no    TEXT,
  first_name     TEXT,
  last_name      TEXT,
  kiosk_pin_hash TEXT,
  is_active      BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT e.id AS employee_id,
         e.org_id,
         e.employee_no::TEXT,
         e.first_name::TEXT,
         e.last_name::TEXT,
         tc.kiosk_pin_hash,
         tc.is_active
    FROM employee e
    JOIN app.terminal_credential tc ON tc.employee_id = e.id
   WHERE UPPER(e.employee_no) = UPPER(p_employee_no)
     AND e.deleted_at IS NULL
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.lookup_kiosk_credential(TEXT) TO hr_app, hr_migrator;

-- Add broken/split shift columns to attendance_shift
ALTER TABLE attendance_shift
  ADD COLUMN IF NOT EXISTS is_broken_shift BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS second_start_time TIME,
  ADD COLUMN IF NOT EXISTS second_end_time TIME;

-- Add half-day and geofence tracking to attendance_record
ALTER TABLE attendance_record
  ADD COLUMN IF NOT EXISTS is_half_day BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS half_day_period VARCHAR(16) CHECK (half_day_period IN ('am', 'pm', 'first_half', 'second_half')),
  ADD COLUMN IF NOT EXISTS punch_source VARCHAR(32) NOT NULL DEFAULT 'web', -- 'kiosk', 'web', 'mobile', 'biometric'
  ADD COLUMN IF NOT EXISTS clock_in_latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS clock_in_longitude NUMERIC(10, 7);

-- ---------------------------------------------------------------------------
-- 2. Duty Rostering, Broken Shifts, Shift Swapping & Comp-Off (CTO)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_roster (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  shift_id             UUID REFERENCES attendance_shift(id) ON DELETE RESTRICT,
  roster_date          DATE NOT NULL,
  is_rest_day          BOOLEAN NOT NULL DEFAULT FALSE,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_roster_emp_date UNIQUE (employee_id, roster_date)
);

CREATE TABLE IF NOT EXISTS shift_swap_request (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  requester_employee_id  UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  target_employee_id     UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  requester_date         DATE NOT NULL,
  target_date            DATE NOT NULL,
  reason                 TEXT NOT NULL,
  target_consent         VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'declined'
  status                 VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'cancelled'
  approved_by            UUID REFERENCES employee(id) ON DELETE SET NULL,
  approved_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comp_off_ledger (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  earned_hours         NUMERIC(5, 2) NOT NULL,
  used_hours           NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  remaining_hours      NUMERIC(5, 2) GENERATED ALWAYS AS (earned_hours - used_hours) STORED,
  earned_date          DATE NOT NULL,
  expiry_date          DATE NOT NULL,
  source_ot_record_id  UUID REFERENCES attendance_record(id) ON DELETE SET NULL,
  reason               TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Employee Loan Amortization Ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_loan (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  loan_type            VARCHAR(64) NOT NULL, -- 'sss_salary', 'sss_calamity', 'pagibig_mpl', 'pagibig_housing', 'company_emergency', 'other'
  reference_no         VARCHAR(64) NOT NULL,
  principal_amount     NUMERIC(14, 2) NOT NULL,
  monthly_amortization NUMERIC(14, 2) NOT NULL,
  amortization_per_cutoff NUMERIC(14, 2) NOT NULL,
  total_terms_months   INTEGER NOT NULL DEFAULT 24,
  remaining_balance    NUMERIC(14, 2) NOT NULL,
  start_date           DATE NOT NULL,
  status               VARCHAR(32) NOT NULL DEFAULT 'active', -- 'active', 'paused', 'fully_paid'
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_amortization_payment (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  loan_id              UUID NOT NULL REFERENCES employee_loan(id) ON DELETE CASCADE,
  payroll_run_id       UUID NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
  amount_deducted      NUMERIC(14, 2) NOT NULL,
  remaining_balance_after NUMERIC(14, 2) NOT NULL,
  paid_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. Recurring & Ad-hoc Allowances / Deductions & Hospitality Service Charge
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_entry_item (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  entry_type           VARCHAR(32) NOT NULL, -- 'allowance', 'deduction'
  code                 VARCHAR(64) NOT NULL,
  name                 VARCHAR(128) NOT NULL,
  amount               NUMERIC(12, 2) NOT NULL,
  is_taxable           BOOLEAN NOT NULL DEFAULT FALSE,
  frequency            VARCHAR(32) NOT NULL DEFAULT 'every_cutoff', -- 'every_cutoff', 'first_cutoff_only', 'second_cutoff_only', 'one_off'
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to         DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_charge_pool (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  payroll_run_id         UUID NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
  total_pool_amount      NUMERIC(14, 2) NOT NULL, -- Total collections
  staff_share_amount     NUMERIC(14, 2) NOT NULL, -- 85% DOLE Article 96
  management_share_amount NUMERIC(14, 2) NOT NULL, -- 15%
  eligible_staff_count   INTEGER NOT NULL DEFAULT 0,
  per_employee_share     NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. Salary Grade Matrix & Retroactive Pay Adjustments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS salary_grade_matrix (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  job_rank_id          UUID NOT NULL REFERENCES job_rank(id) ON DELETE CASCADE,
  region               VARCHAR(64) NOT NULL DEFAULT 'NCR',
  min_salary           NUMERIC(12, 2) NOT NULL,
  mid_salary           NUMERIC(12, 2) NOT NULL,
  max_salary           NUMERIC(12, 2) NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_salary_rank_region UNIQUE (org_id, job_rank_id, region)
);

CREATE TABLE IF NOT EXISTS payroll_adjustment (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  payroll_run_id       UUID NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
  adjustment_type      VARCHAR(32) NOT NULL, -- 'retro_pay', 'tax_refund', 'bonus', 'salary_differential', 'attendance_correction'
  amount               NUMERIC(12, 2) NOT NULL,
  is_taxable           BOOLEAN NOT NULL DEFAULT TRUE,
  reason               TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 6. Official Business (OB) & Timesheet Dispute Requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS business_trip_request (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  destination          VARCHAR(255) NOT NULL,
  purpose              TEXT NOT NULL,
  start_date           DATE NOT NULL,
  end_date             DATE NOT NULL,
  per_diem_amount      NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  status               VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'cancelled'
  approved_by          UUID REFERENCES employee(id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timesheet_adjustment_request (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  work_date            DATE NOT NULL,
  requested_clock_in   TIMESTAMPTZ,
  requested_clock_out  TIMESTAMPTZ,
  reason               TEXT NOT NULL,
  status               VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  approved_by          UUID REFERENCES employee(id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 7. Habitual Tardiness Monitoring & Disciplinary Memos (NTE)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS disciplinary_memo (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id            UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  memo_number            VARCHAR(64) NOT NULL,
  memo_type              VARCHAR(32) NOT NULL, -- 'tardiness_nte', 'undertime_nte', 'awol_nte', 'written_reprimand'
  incident_period_start  DATE NOT NULL,
  incident_period_end    DATE NOT NULL,
  total_infractions      INTEGER NOT NULL DEFAULT 1,
  infraction_details     TEXT NOT NULL,
  issued_by              UUID REFERENCES employee(id) ON DELETE SET NULL,
  issued_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_due_date      DATE NOT NULL,
  employee_explanation   TEXT,
  explanation_submitted_at TIMESTAMPTZ,
  hr_resolution          TEXT,
  status                 VARCHAR(32) NOT NULL DEFAULT 'issued', -- 'issued', 'responded', 'resolved', 'closed'
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_memo_number_org UNIQUE (org_id, memo_number)
);

-- ---------------------------------------------------------------------------
-- 8. 201 Document Vault & Merits / Commendations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_document (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  doc_type             VARCHAR(64) NOT NULL, -- 'contract', 'nbi_clearance', 'medical', 'diploma', 'bir_form', 'certificate', 'other'
  title                VARCHAR(255) NOT NULL,
  file_url             TEXT NOT NULL,
  file_name            VARCHAR(255) NOT NULL,
  file_size_bytes      INTEGER NOT NULL DEFAULT 0,
  uploaded_by          UUID REFERENCES employee(id) ON DELETE SET NULL,
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_merit_award (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  award_title          VARCHAR(255) NOT NULL,
  award_type           VARCHAR(64) NOT NULL, -- 'merit', 'commendation', 'certification', 'training', 'safety_award'
  awarded_on           DATE NOT NULL DEFAULT CURRENT_DATE,
  issuer               VARCHAR(255) NOT NULL,
  description          TEXT,
  certificate_url      TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 9. Hotel Duty Meal Voucher Ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meal_voucher_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  voucher_code         VARCHAR(64) NOT NULL,
  issued_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  meal_type            VARCHAR(32) NOT NULL DEFAULT 'duty_meal', -- 'duty_meal', 'overtime_meal', 'banquet_meal'
  status               VARCHAR(32) NOT NULL DEFAULT 'issued', -- 'issued', 'redeemed', 'cancelled'
  redeemed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_voucher_code_org UNIQUE (org_id, voucher_code)
);

-- ---------------------------------------------------------------------------
-- 10. Enable Row Level Security (RLS) on all new tables
-- ---------------------------------------------------------------------------

ALTER TABLE app.terminal_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_swap_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE comp_off_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_loan ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_amortization_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_entry_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_charge_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_grade_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_adjustment ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_trip_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_adjustment_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary_memo ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_merit_award ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_voucher_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.terminal_credential FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_roster FORCE ROW LEVEL SECURITY;
ALTER TABLE shift_swap_request FORCE ROW LEVEL SECURITY;
ALTER TABLE comp_off_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE employee_loan FORCE ROW LEVEL SECURITY;
ALTER TABLE loan_amortization_payment FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll_entry_item FORCE ROW LEVEL SECURITY;
ALTER TABLE service_charge_pool FORCE ROW LEVEL SECURITY;
ALTER TABLE salary_grade_matrix FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll_adjustment FORCE ROW LEVEL SECURITY;
ALTER TABLE business_trip_request FORCE ROW LEVEL SECURITY;
ALTER TABLE timesheet_adjustment_request FORCE ROW LEVEL SECURITY;
ALTER TABLE disciplinary_memo FORCE ROW LEVEL SECURITY;
ALTER TABLE employee_document FORCE ROW LEVEL SECURITY;
ALTER TABLE employee_merit_award FORCE ROW LEVEL SECURITY;
ALTER TABLE meal_voucher_log FORCE ROW LEVEL SECURITY;

-- Tenant Isolation Policies
CREATE POLICY terminal_cred_tenant ON app.terminal_credential FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY roster_tenant ON attendance_roster FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY swap_tenant ON shift_swap_request FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY comp_off_tenant ON comp_off_ledger FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY loan_tenant ON employee_loan FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY loan_pay_tenant ON loan_amortization_payment FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY entry_item_tenant ON payroll_entry_item FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY service_charge_tenant ON service_charge_pool FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY salary_matrix_tenant ON salary_grade_matrix FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY payroll_adjustment_tenant ON payroll_adjustment FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY trip_tenant ON business_trip_request FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY timesheet_adj_tenant ON timesheet_adjustment_request FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY memo_tenant ON disciplinary_memo FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY doc_tenant ON employee_document FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY merit_tenant ON employee_merit_award FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY meal_voucher_tenant ON meal_voucher_log FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

-- Grants for application user
GRANT SELECT, INSERT, UPDATE, DELETE ON app.terminal_credential TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_roster TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON shift_swap_request TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON comp_off_ledger TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_loan TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON loan_amortization_payment TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_entry_item TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_charge_pool TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON salary_grade_matrix TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_adjustment TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON business_trip_request TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON timesheet_adjustment_request TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON disciplinary_memo TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_document TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_merit_award TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON meal_voucher_log TO hr_app;

COMMIT;
