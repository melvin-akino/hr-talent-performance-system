-- ===========================================================================
-- Migration 0051: Philippine Statutory & Multi-Branch Payroll Engine
--
-- Adds:
-- 1. Multi-branch & subsidiary corporate structure under 1 organization
-- 2. Employee compensation profiles (TIN, SSS, PhilHealth, Pag-IBIG, bank details)
-- 3. Payroll periods & batch runs (Quindena bi-monthly, monthly, 13th month)
-- 4. Granular Philippine statutory line items & employee payslips (TRAIN tax,
--    SSS regular + WISP, PhilHealth 5% split, Pag-IBIG HDMF, de minimis)
-- 5. 13th Month Pay annual accrual ledger
-- 6. Strict RLS tenant isolation and hr_app grants
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Multi-Branch & Subsidiary Structure
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS branch (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  code                    VARCHAR(32) NOT NULL,
  name                    VARCHAR(255) NOT NULL,
  region                  VARCHAR(64) NOT NULL DEFAULT 'NCR',
  address                 TEXT,
  bir_rdo_code            VARCHAR(16),
  sss_branch_code         VARCHAR(32),
  philhealth_employer_no  VARCHAR(32),
  pagibig_employer_no     VARCHAR(32),
  is_head_office          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_branch_org_code UNIQUE (org_id, code)
);

COMMENT ON TABLE branch IS
  'Branches and regional subsidiaries operating under one corporate roof (e.g. Makati HQ, Cebu Hub, Davao Regional Office).';

-- ---------------------------------------------------------------------------
-- 2. Employee Compensation Profile
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_compensation (
  employee_id             UUID PRIMARY KEY REFERENCES employee(id) ON DELETE CASCADE,
  org_id                  UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  branch_id               UUID REFERENCES branch(id) ON DELETE SET NULL,
  monthly_rate            NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  daily_rate              NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  hourly_rate             NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  pay_type                VARCHAR(32) NOT NULL DEFAULT 'monthly', -- 'monthly', 'daily'
  pay_frequency           VARCHAR(32) NOT NULL DEFAULT 'semi_monthly', -- 'semi_monthly' (15th/30th), 'monthly'
  is_minimum_wage         BOOLEAN NOT NULL DEFAULT FALSE, -- RA 10963 Statutory MWE exemption
  tin                     VARCHAR(32),
  sss_no                  VARCHAR(32),
  philhealth_no           VARCHAR(32),
  pagibig_no              VARCHAR(32),
  bank_name               VARCHAR(64) NOT NULL DEFAULT 'BPI', -- 'BPI', 'BDO', 'METROBANK', 'UNIONBANK', 'OTHER'
  bank_account_no         VARCHAR(64),
  bank_account_name       VARCHAR(255),
  -- Non-taxable De Minimis Allowances under Philippine Tax Law:
  rice_subsidy            NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- Cap: PHP 2,000/mo
  clothing_allowance      NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- Cap: PHP 500/mo (PHP 6,000/yr)
  laundry_allowance       NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- Cap: PHP 300/mo
  medical_allowance       NUMERIC(10, 2) NOT NULL DEFAULT 0.00, -- Cap: PHP 833.33/mo (PHP 10,000/yr)
  taxable_allowance       NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE employee_compensation IS
  'Statutory government identification, salary rates, bank disbursement details, and tax-exempt de minimis allowances.';

-- ---------------------------------------------------------------------------
-- 3. Payroll Period & Batch Run
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_run (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  branch_id               UUID REFERENCES branch(id) ON DELETE SET NULL, -- NULL = consolidated all-branch run
  code                    VARCHAR(64) NOT NULL, -- e.g. 'PAY-2026-10-Q1'
  title                   VARCHAR(255) NOT NULL,
  period_start            DATE NOT NULL,
  period_end              DATE NOT NULL,
  payout_date             DATE NOT NULL,
  run_type                VARCHAR(32) NOT NULL DEFAULT 'quindena_1', -- 'quindena_1', 'quindena_2', 'monthly', 'thirteenth_month'
  status                  VARCHAR(32) NOT NULL DEFAULT 'draft', -- 'draft', 'computed', 'approved', 'disbursed', 'cancelled'
  -- Consolidated Totals:
  total_gross             NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
  total_taxable           NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
  total_withholding_tax   NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
  total_sss_ee            NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
  total_sss_er            NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
  total_philhealth_ee     NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
  total_philhealth_er     NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
  total_pagibig_ee        NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
  total_pagibig_er        NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
  total_net_pay           NUMERIC(16, 2) NOT NULL DEFAULT 0.00,
  employee_count          INTEGER NOT NULL DEFAULT 0,
  approved_by             UUID REFERENCES employee(id) ON DELETE SET NULL,
  approved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_run_org_code UNIQUE (org_id, code)
);

COMMENT ON TABLE payroll_run IS
  'Batch payroll runs (bi-monthly quindenas, monthly, or 13th-month distributions).';

-- ---------------------------------------------------------------------------
-- 4. Individual Payroll Line Items & Payslips
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_line_item (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id          UUID NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
  org_id                  UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id             UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  branch_id               UUID REFERENCES branch(id) ON DELETE SET NULL,
  -- Earnings breakdown:
  basic_pay               NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  overtime_pay            NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  night_diff_pay          NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  holiday_pay             NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  de_minimis_allowances   NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  taxable_allowances      NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  gross_pay               NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  -- Employee Deductions:
  tardiness_undertime     NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  absences_unpaid         NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  sss_ee                  NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  sss_wisp_ee             NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  philhealth_ee           NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  pagibig_ee              NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  taxable_income          NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  withholding_tax         NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  loans_deductions        NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  other_deductions        NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  total_deductions        NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  -- Employer Statutory Contributions:
  sss_er                  NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  sss_wisp_er             NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  sss_ec_er               NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  philhealth_er           NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  pagibig_er              NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  -- Net Disbursable Take-Home Pay:
  net_pay                 NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  -- DOLE 13th Month Accrual for this cut-off:
  thirteenth_month_accrual NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  -- Bank Disbursement:
  bank_name               VARCHAR(64),
  bank_account_no         VARCHAR(64),
  disbursement_status     VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'paid'
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_item_run_emp UNIQUE (payroll_run_id, employee_id)
);

COMMENT ON TABLE payroll_line_item IS
  'Itemized employee payslips detailing TRAIN tax, SSS/WISP, PhilHealth 5%, Pag-IBIG HDMF, and take-home pay.';

-- ---------------------------------------------------------------------------
-- 5. 13th Month Pay Annual Accrual Ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS thirteenth_month_accrual (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id             UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  payroll_run_id          UUID REFERENCES payroll_run(id) ON DELETE CASCADE,
  year                    INTEGER NOT NULL,
  basic_earned            NUMERIC(14, 2) NOT NULL,
  accrual_amount          NUMERIC(14, 2) NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE thirteenth_month_accrual IS
  'Running accumulation of basic earnings across calendar year for DOLE 13th-month formula (Basic / 12).';

-- ---------------------------------------------------------------------------
-- 6. Row Level Security (RLS) & Permissions
-- ---------------------------------------------------------------------------

ALTER TABLE branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_line_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE thirteenth_month_accrual ENABLE ROW LEVEL SECURITY;

-- branch RLS
CREATE POLICY branch_tenant_isolation ON branch FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

-- employee_compensation RLS
CREATE POLICY compensation_tenant_read ON employee_compensation FOR SELECT
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY compensation_tenant_modify ON employee_compensation FOR ALL
  USING ((org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin())
  WITH CHECK ((org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin());

-- payroll_run RLS
CREATE POLICY payroll_run_tenant_isolation ON payroll_run FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

-- payroll_line_item RLS (Employees can read own payslips, HR can manage all)
CREATE POLICY payroll_line_item_read ON payroll_line_item FOR SELECT
  USING (
    employee_id = app.current_employee_id()
    OR org_id = app.current_org_id()
    OR app.is_platform_superadmin()
  );

CREATE POLICY payroll_line_item_modify ON payroll_line_item FOR ALL
  USING ((org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin())
  WITH CHECK ((org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin());

-- thirteenth_month_accrual RLS
CREATE POLICY thirteenth_month_read ON thirteenth_month_accrual FOR SELECT
  USING (
    employee_id = app.current_employee_id()
    OR org_id = app.current_org_id()
    OR app.is_platform_superadmin()
  );

CREATE POLICY thirteenth_month_modify ON thirteenth_month_accrual FOR ALL
  USING ((org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin())
  WITH CHECK ((org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin());

-- ---------------------------------------------------------------------------
-- 7. Grant Permissions to hr_app
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON branch TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_compensation TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_run TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_line_item TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON thirteenth_month_accrual TO hr_app;

COMMIT;
