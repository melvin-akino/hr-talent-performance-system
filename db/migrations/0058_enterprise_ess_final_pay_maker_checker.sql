-- ===========================================================================
-- Migration 0058: Maker-Checker Payroll, Final Pay & Offboarding, ESS & Bulletins
-- ===========================================================================

BEGIN;

-- 1. Maker-Checker Payroll Tracking
ALTER TABLE payroll_run
  ADD COLUMN IF NOT EXISTS computed_by  UUID REFERENCES employee(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disbursed_by UUID REFERENCES employee(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disbursed_at TIMESTAMPTZ;

ALTER TABLE hr_settings
  ADD COLUMN IF NOT EXISTS enforce_payroll_maker_checker BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Offboarding & Final Pay Engine
CREATE TABLE IF NOT EXISTS offboarding_case (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id                UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  separation_date            DATE NOT NULL,
  separation_reason          TEXT NOT NULL DEFAULT 'resignation', -- 'resignation', 'retirement', 'end_of_contract', 'termination', 'redundancy'
  status                     VARCHAR(32) NOT NULL DEFAULT 'in_clearance', -- 'in_clearance', 'cleared', 'final_pay_computed', 'released'
  unpaid_basic_pay           NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  prorated_13th_month        NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  sil_monetization           NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  separation_pay             NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  other_additions            NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  outstanding_loans_deduction NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  other_deductions           NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  net_final_pay              NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  remarks                    TEXT,
  computed_by                UUID REFERENCES employee(id) ON DELETE SET NULL,
  released_by                UUID REFERENCES employee(id) ON DELETE SET NULL,
  released_at                TIMESTAMPTZ,
  created_by                 UUID REFERENCES employee(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offboarding_clearance_item (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  offboarding_case_id UUID NOT NULL REFERENCES offboarding_case(id) ON DELETE CASCADE,
  department_area     VARCHAR(64) NOT NULL, -- 'IT & Assets', 'Finance & Loans', 'Department Handover', 'HR Exit Interview'
  item_title          VARCHAR(255) NOT NULL,
  status              VARCHAR(24) NOT NULL DEFAULT 'pending', -- 'pending', 'cleared', 'waived'
  cleared_by          UUID REFERENCES employee(id) ON DELETE SET NULL,
  cleared_at          TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Company Announcements & HR Bulletins
CREATE TABLE IF NOT EXISTS company_announcement (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  title        VARCHAR(255) NOT NULL,
  category     VARCHAR(32) NOT NULL DEFAULT 'general', -- 'general', 'policy', 'hr_memo', 'holiday', 'event'
  body         TEXT NOT NULL,
  is_pinned    BOOLEAN NOT NULL DEFAULT FALSE,
  published_by UUID REFERENCES employee(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Employee Self-Service (ESS) Profile & Document Requests
CREATE TABLE IF NOT EXISTS ess_profile_request (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id       UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  request_type      VARCHAR(32) NOT NULL, -- 'contact_info', 'bank_account', 'government_id', 'coe_request'
  requested_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason            TEXT NOT NULL,
  status            VARCHAR(24) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  reviewed_by       UUID REFERENCES employee(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS Policies & Grants
ALTER TABLE offboarding_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE offboarding_case FORCE ROW LEVEL SECURITY;
CREATE POLICY offboarding_case_tenant ON offboarding_case FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

ALTER TABLE offboarding_clearance_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE offboarding_clearance_item FORCE ROW LEVEL SECURITY;
CREATE POLICY offboarding_clearance_tenant ON offboarding_clearance_item FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

ALTER TABLE company_announcement ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_announcement FORCE ROW LEVEL SECURITY;
CREATE POLICY company_announcement_tenant ON company_announcement FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

ALTER TABLE ess_profile_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE ess_profile_request FORCE ROW LEVEL SECURITY;
CREATE POLICY ess_profile_request_tenant ON ess_profile_request FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

GRANT SELECT, INSERT, UPDATE, DELETE ON offboarding_case TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON offboarding_clearance_item TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON company_announcement TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ess_profile_request TO hr_app;

COMMIT;
