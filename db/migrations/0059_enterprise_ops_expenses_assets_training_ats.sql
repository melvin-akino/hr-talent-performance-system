-- ===========================================================================
-- Migration 0059: Expenses, Company Assets, Training/Certifications & ATS
-- ===========================================================================

BEGIN;

-- 1. Expense & Reimbursement Claims
CREATE TABLE IF NOT EXISTS expense_claim (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  claim_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  category    VARCHAR(48) NOT NULL DEFAULT 'travel', -- 'travel', 'meal', 'lodging', 'supplies', 'client_entertainment', 'communication', 'other'
  description TEXT NOT NULL,
  amount      NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  receipt_ref VARCHAR(128),
  status      VARCHAR(24) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'paid'
  reviewed_by UUID REFERENCES employee(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Company Asset & Equipment Inventory
CREATE TABLE IF NOT EXISTS company_asset (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  asset_tag   VARCHAR(64) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  category    VARCHAR(48) NOT NULL DEFAULT 'laptop', -- 'laptop', 'mobile', 'vehicle', 'sim_card', 'access_badge', 'uniform', 'equipment'
  serial_no   VARCHAR(128),
  assigned_to UUID REFERENCES employee(id) ON DELETE SET NULL,
  assigned_on DATE,
  returned_on DATE,
  condition   VARCHAR(32) NOT NULL DEFAULT 'good', -- 'good', 'fair', 'damaged', 'lost'
  status      VARCHAR(32) NOT NULL DEFAULT 'available', -- 'available', 'assigned', 'maintenance', 'retired'
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_asset_org_tag UNIQUE (org_id, asset_tag)
);

-- 3. Training, Seminars & Certification Expiry Tracking
CREATE TABLE IF NOT EXISTS employee_training (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  provider      VARCHAR(255) NOT NULL DEFAULT 'Internal HR',
  training_type VARCHAR(32) NOT NULL DEFAULT 'seminar', -- 'seminar', 'workshop', 'certification', 'license', 'compliance'
  completed_on  DATE,
  expires_on    DATE,
  hours         NUMERIC(6, 1) NOT NULL DEFAULT 0.0,
  credential_no VARCHAR(128),
  status        VARCHAR(24) NOT NULL DEFAULT 'completed', -- 'enrolled', 'completed', 'expired'
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Recruitment (ATS) — Job Requisitions & Applicants
CREATE TABLE IF NOT EXISTS job_requisition (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  title            VARCHAR(255) NOT NULL,
  department_id    UUID REFERENCES department(id) ON DELETE SET NULL,
  branch_id        UUID REFERENCES branch(id) ON DELETE SET NULL,
  employment_type  VARCHAR(48) NOT NULL DEFAULT 'Full-time Regular',
  headcount_target INTEGER NOT NULL DEFAULT 1,
  salary_range     VARCHAR(128),
  status           VARCHAR(24) NOT NULL DEFAULT 'open', -- 'open', 'paused', 'filled', 'closed'
  description      TEXT,
  created_by       UUID REFERENCES employee(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_applicant (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  requisition_id  UUID NOT NULL REFERENCES job_requisition(id) ON DELETE CASCADE,
  full_name       VARCHAR(255) NOT NULL,
  email           VARCHAR(255) NOT NULL,
  phone           VARCHAR(64),
  source          VARCHAR(64) NOT NULL DEFAULT 'LinkedIn / JobStreet',
  stage           VARCHAR(32) NOT NULL DEFAULT 'applied', -- 'applied', 'screening', 'interview', 'offer', 'hired', 'rejected'
  expected_salary NUMERIC(12, 2),
  interview_date  DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS Policies & Grants
ALTER TABLE expense_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_claim FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_claim_tenant ON expense_claim FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

ALTER TABLE company_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_asset FORCE ROW LEVEL SECURITY;
CREATE POLICY company_asset_tenant ON company_asset FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

ALTER TABLE employee_training ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_training FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_training_tenant ON employee_training FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

ALTER TABLE job_requisition ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_requisition FORCE ROW LEVEL SECURITY;
CREATE POLICY job_requisition_tenant ON job_requisition FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

ALTER TABLE job_applicant ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applicant FORCE ROW LEVEL SECURITY;
CREATE POLICY job_applicant_tenant ON job_applicant FOR ALL
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin())
  WITH CHECK (org_id = app.current_org_id() OR app.is_platform_superadmin());

GRANT SELECT, INSERT, UPDATE, DELETE ON expense_claim TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON company_asset TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_training TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON job_requisition TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON job_applicant TO hr_app;

COMMIT;
