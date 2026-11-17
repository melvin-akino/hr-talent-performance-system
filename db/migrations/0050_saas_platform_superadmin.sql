-- 0050_saas_platform_superadmin.sql
-- Phase 1 SaaS Modernisation:
--   1. Superadmin control plane & audit logging
--   2. Multi-tenant feature licensing flags (including Philippine Payroll toggle)
--   3. Native email/password credentials to decouple from on-premise LDAP

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tenant Lifecycle & Organization Licensing Columns
-- ---------------------------------------------------------------------------

ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trial', 'past_due', 'suspended', 'cancelled')),
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan_tier IN ('starter', 'professional', 'enterprise')),
  ADD COLUMN IF NOT EXISTS max_employees INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

-- Backfill slugs for existing organizations if any exist without one
UPDATE organization
   SET slug = lower(regexp_replace(code, '[^a-zA-Z0-9]+', '-', 'g'))
 WHERE slug IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Tenant Feature Entitlements (Toggles)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.tenant_features (
  org_id                     UUID PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  feature_core_hr            BOOLEAN NOT NULL DEFAULT TRUE,
  feature_performance        BOOLEAN NOT NULL DEFAULT TRUE,
  feature_kpis               BOOLEAN NOT NULL DEFAULT TRUE,
  feature_peer_reviews       BOOLEAN NOT NULL DEFAULT FALSE,
  feature_competencies_pip   BOOLEAN NOT NULL DEFAULT FALSE,
  feature_leave_management   BOOLEAN NOT NULL DEFAULT FALSE,
  feature_time_attendance    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Philippine Payroll Suite (Superadmin-activatable per client)
  feature_ph_payroll         BOOLEAN NOT NULL DEFAULT FALSE,
  feature_bank_disbursement  BOOLEAN NOT NULL DEFAULT FALSE,
  feature_bir_statutory_gen  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                 TEXT
);

COMMENT ON TABLE app.tenant_features IS
  'Per-tenant module licenses. Governs which capabilities are visible and executable.';

-- Automatically create feature record for every existing organization
INSERT INTO app.tenant_features (
  org_id,
  feature_core_hr,
  feature_performance,
  feature_kpis,
  feature_peer_reviews,
  feature_competencies_pip,
  feature_leave_management,
  feature_time_attendance,
  feature_ph_payroll,
  feature_bank_disbursement,
  feature_bir_statutory_gen
)
SELECT
  id,
  TRUE,  -- core HR
  TRUE,  -- performance
  TRUE,  -- KPIs
  TRUE,  -- peer reviews (enabled for legacy on-prem)
  TRUE,  -- competencies & PIP
  FALSE, -- leave management
  FALSE, -- attendance
  FALSE, -- Philippine payroll default is false until licensed
  FALSE,
  FALSE
FROM organization
ON CONFLICT (org_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Native User Credentials (Decoupled from LDAP/Active Directory)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.user_credential (
  employee_id          UUID PRIMARY KEY REFERENCES employee(id) ON DELETE CASCADE,
  org_id               UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email                CITEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  is_verified          BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.user_credential IS
  'Native email and hashed password authentication for cloud SaaS users.';

-- ---------------------------------------------------------------------------
-- 4. Platform Superadmin Control Plane
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.platform_superadmin (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.platform_superadmin IS
  'SaaS platform operators who onboard companies, configure licenses, and toggle modules.';

CREATE TABLE IF NOT EXISTS app.superadmin_audit_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  superadmin_id      UUID REFERENCES app.platform_superadmin(id) ON DELETE SET NULL,
  superadmin_email   TEXT NOT NULL,
  action             TEXT NOT NULL,
  target_org_id      UUID REFERENCES organization(id) ON DELETE CASCADE,
  details            JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. Helper Functions & RLS Policies
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.is_platform_superadmin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT NULLIF(current_setting('app.is_superadmin', true), '') = 'true';
$$;

CREATE OR REPLACE FUNCTION app.is_security_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM role_assignment ra
      JOIN app_role r ON r.id = ra.role_id
     WHERE ra.employee_id = app.current_employee_id()
       AND ra.org_id = app.current_org_id()
       AND r.is_security_admin = TRUE
       AND ra.effective_from <= CURRENT_DATE
       AND (ra.effective_to IS NULL OR CURRENT_DATE < ra.effective_to)
  );
$$;

CREATE OR REPLACE FUNCTION app.is_feature_enabled(check_org_id UUID, feature_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, public AS $$
DECLARE
  is_active BOOLEAN;
BEGIN
  EXECUTE format(
    'SELECT COALESCE(%I, FALSE) FROM app.tenant_features WHERE org_id = $1',
    feature_key
  ) INTO is_active USING check_org_id;
  RETURN COALESCE(is_active, FALSE);
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION app.current_employee_features()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT to_jsonb(tf)
    FROM app.tenant_features tf
   WHERE tf.org_id = app.current_org_id();
$$;

-- Pre-Auth helper functions (SECURITY DEFINER runs before employee session exists)
CREATE OR REPLACE FUNCTION app.lookup_user_for_auth(p_email CITEXT)
RETURNS TABLE (
  employee_id   UUID,
  org_id        UUID,
  password_hash TEXT,
  is_verified   BOOLEAN,
  first_name    TEXT,
  last_name     TEXT,
  employee_no   TEXT,
  work_email    TEXT,
  org_name      TEXT,
  org_code      TEXT,
  org_slug      TEXT,
  org_status    TEXT,
  org_plan_tier TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT uc.employee_id, uc.org_id, uc.password_hash, uc.is_verified,
         e.first_name, e.last_name, e.employee_no, e.work_email,
         o.name AS org_name, o.code AS org_code, o.slug AS org_slug,
         o.status AS org_status, o.plan_tier AS org_plan_tier
    FROM app.user_credential uc
    JOIN employee e ON e.id = uc.employee_id
    JOIN organization o ON o.id = uc.org_id
   WHERE uc.email = p_email
     AND e.deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION app.get_user_roles_for_auth(p_employee_id UUID, p_org_id UUID)
RETURNS TABLE (code TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT DISTINCT r.code::text
    FROM role_assignment ra
    JOIN app_role r ON r.id = ra.role_id
   WHERE ra.employee_id = p_employee_id
     AND ra.org_id = p_org_id
     AND ra.effective_from <= CURRENT_DATE
     AND (ra.effective_to IS NULL OR CURRENT_DATE < ra.effective_to);
$$;

CREATE OR REPLACE FUNCTION app.get_tenant_features_for_auth(p_org_id UUID)
RETURNS TABLE (
  feature_core_hr           BOOLEAN,
  feature_performance       BOOLEAN,
  feature_kpis              BOOLEAN,
  feature_peer_reviews      BOOLEAN,
  feature_competencies_pip  BOOLEAN,
  feature_leave_management  BOOLEAN,
  feature_time_attendance   BOOLEAN,
  feature_ph_payroll        BOOLEAN,
  feature_bank_disbursement BOOLEAN,
  feature_bir_statutory_gen BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT tf.feature_core_hr, tf.feature_performance, tf.feature_kpis,
         tf.feature_peer_reviews, tf.feature_competencies_pip,
         tf.feature_leave_management, tf.feature_time_attendance,
         tf.feature_ph_payroll, tf.feature_bank_disbursement, tf.feature_bir_statutory_gen
    FROM app.tenant_features tf
   WHERE tf.org_id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION app.record_user_login(p_employee_id UUID)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = app, public AS $$
  UPDATE app.user_credential
     SET last_login_at = now()
   WHERE employee_id = p_employee_id;
$$;

-- RLS on organization (Superadmin access)
DROP POLICY IF EXISTS organization_select ON organization;
CREATE POLICY organization_select ON organization FOR SELECT
  USING (id = app.current_org_id() OR app.is_platform_superadmin());

CREATE POLICY organization_superadmin_write ON organization FOR ALL
  USING (app.is_platform_superadmin())
  WITH CHECK (app.is_platform_superadmin());

-- RLS on employee (Superadmin provisioning)
DROP POLICY IF EXISTS employee_superadmin ON employee;
CREATE POLICY employee_superadmin ON employee FOR ALL
  USING (app.is_platform_superadmin())
  WITH CHECK (app.is_platform_superadmin());

-- RLS on role_assignment (Superadmin provisioning)
DROP POLICY IF EXISTS role_assignment_superadmin ON role_assignment;
CREATE POLICY role_assignment_superadmin ON role_assignment FOR ALL
  USING (app.is_platform_superadmin())
  WITH CHECK (app.is_platform_superadmin());

-- RLS on app_role & access_grant (Superadmin provisioning)
DROP POLICY IF EXISTS app_role_superadmin ON app_role;
CREATE POLICY app_role_superadmin ON app_role FOR ALL
  USING (app.is_platform_superadmin())
  WITH CHECK (app.is_platform_superadmin());

DROP POLICY IF EXISTS access_grant_superadmin ON access_grant;
CREATE POLICY access_grant_superadmin ON access_grant FOR ALL
  USING (app.is_platform_superadmin())
  WITH CHECK (app.is_platform_superadmin());

-- RLS on tenant_features
ALTER TABLE app.tenant_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_features_read ON app.tenant_features;
CREATE POLICY tenant_features_read ON app.tenant_features
  FOR SELECT
  USING (org_id = app.current_org_id() OR app.is_platform_superadmin());

DROP POLICY IF EXISTS tenant_features_modify ON app.tenant_features;
CREATE POLICY tenant_features_modify ON app.tenant_features
  FOR ALL
  USING ((org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin())
  WITH CHECK ((org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin());

-- RLS on user_credential
ALTER TABLE app.user_credential ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_credential_read ON app.user_credential;
CREATE POLICY user_credential_read ON app.user_credential
  FOR SELECT
  USING (employee_id = app.current_employee_id() OR (org_id = app.current_org_id() AND app.is_security_admin()) OR app.is_platform_superadmin());

DROP POLICY IF EXISTS user_credential_self_update ON app.user_credential;
CREATE POLICY user_credential_self_update ON app.user_credential
  FOR UPDATE
  USING (employee_id = app.current_employee_id());

DROP POLICY IF EXISTS user_credential_superadmin_write ON app.user_credential;
CREATE POLICY user_credential_superadmin_write ON app.user_credential
  FOR ALL
  USING (app.is_platform_superadmin())
  WITH CHECK (app.is_platform_superadmin());

-- ---------------------------------------------------------------------------
-- 6. Permissions and Role Grants for hr_app
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA app TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO hr_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hr_app;

COMMIT;
