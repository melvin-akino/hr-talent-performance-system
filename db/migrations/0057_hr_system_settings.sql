-- ===========================================================================
-- Migration 0057: Comprehensive HR & Payroll Settings Engine
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS hr_settings (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                              UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  
  -- Company Profile & Statutory Registration Identifiers
  company_registered_name             TEXT,
  company_trade_name                  TEXT,
  tin                                 TEXT DEFAULT '000-000-000-000',
  rdo_code                            TEXT DEFAULT '044',
  sss_employer_no                     TEXT DEFAULT '03-0000000-0',
  philhealth_employer_no              TEXT DEFAULT '12-000000000-0',
  pagibig_employer_no                 TEXT DEFAULT '1234-0000-0000',
  sec_dti_reg_no                      TEXT,
  official_business_address           TEXT,
  contact_number                      TEXT,
  official_hr_email                   TEXT,

  -- Core HR & Workforce Governance Policies
  standard_working_days_per_week      NUMERIC(3, 1) NOT NULL DEFAULT 5.0,
  standard_hours_per_day              NUMERIC(3, 1) NOT NULL DEFAULT 8.0,
  probationary_months                 INTEGER NOT NULL DEFAULT 6,
  retirement_age                      INTEGER NOT NULL DEFAULT 65,
  required_201_documents              TEXT[] NOT NULL DEFAULT ARRAY[
    'NBI Clearance',
    'Pre-employment Medical (Fit-to-Work)',
    'BIR Form 1902 / 2316',
    'SSS / PhilHealth / Pag-IBIG Numbers Proof',
    'Employment Contract',
    'Transcript of Records (TOR) or Diploma',
    'Government Issued IDs'
  ],

  -- Time, Shifts & Attendance Policies
  default_shift_code                  TEXT NOT NULL DEFAULT 'DAY',
  grace_period_mins                   INTEGER NOT NULL DEFAULT 15,
  tardiness_monthly_threshold         INTEGER NOT NULL DEFAULT 3,
  overtime_approval_required          BOOLEAN NOT NULL DEFAULT TRUE,
  enable_kiosk_camera                 BOOLEAN NOT NULL DEFAULT TRUE,
  require_kiosk_passcode              BOOLEAN NOT NULL DEFAULT TRUE,
  allow_mobile_attendance             BOOLEAN NOT NULL DEFAULT TRUE,

  -- Payroll, Tax & Philippine Statutory Settings
  pay_frequency                       TEXT NOT NULL DEFAULT 'semi_monthly', -- semi_monthly, monthly, weekly
  cutoff_1_start                      INTEGER NOT NULL DEFAULT 1,
  cutoff_1_end                        INTEGER NOT NULL DEFAULT 15,
  cutoff_2_start                      INTEGER NOT NULL DEFAULT 16,
  cutoff_2_end                        INTEGER NOT NULL DEFAULT 0, -- 0 = last day of month
  payout_day_quindena_1               INTEGER NOT NULL DEFAULT 20,
  payout_day_quindena_2               INTEGER NOT NULL DEFAULT 5,
  train_tax_active                    BOOLEAN NOT NULL DEFAULT TRUE,
  sss_wisp_active                     BOOLEAN NOT NULL DEFAULT TRUE,
  thirteenth_month_tax_exempt_ceiling NUMERIC(10, 2) NOT NULL DEFAULT 90000.00,
  service_charge_enabled              BOOLEAN NOT NULL DEFAULT FALSE,
  service_charge_staff_share_pct      NUMERIC(5, 2) NOT NULL DEFAULT 85.00,
  default_currency                    TEXT NOT NULL DEFAULT 'PHP',

  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_hr_settings_org UNIQUE (org_id)
);

COMMENT ON TABLE hr_settings IS
  'Comprehensive enterprise configuration for Philippine HR core, attendance, leaves, and payroll.';

-- RLS Enforcement
ALTER TABLE hr_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY hr_settings_tenant_isolation ON hr_settings FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_settings TO hr_app;

-- Seed default settings for all existing organizations
INSERT INTO hr_settings (
  org_id,
  company_registered_name,
  company_trade_name,
  tin,
  rdo_code,
  sss_employer_no,
  philhealth_employer_no,
  pagibig_employer_no,
  official_business_address
)
SELECT
  o.id,
  o.name,
  o.name,
  '248-192-340-000',
  '044 - Taguig / Pateros',
  '03-9182374-5',
  '12-050293847-1',
  '1020-3948-2910',
  '26th Street corner 5th Avenue, Bonifacio Global City, Taguig City, Metro Manila'
FROM organization o
ON CONFLICT (org_id) DO NOTHING;

COMMIT;
