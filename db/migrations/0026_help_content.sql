-- 0026_help_content.sql
-- HR-authored help, alongside the help that ships with the product.
--
-- The bundled articles in apps/web/src/help/content describe THE PRODUCT: how a
-- weight works, what calibration is for. They are versioned with the code and
-- reviewed in pull requests, which is right for text that must match behaviour.
--
-- This table is for the other kind: COMPANY POLICY. "Our review cycle opens in
-- November", "escalate PIPs to the HR business partner first", "our scale is
-- 1-6, not 1-5". HR must be able to write that without waiting for a release,
-- and it must never be mistaken for product documentation — so the two are kept
-- in separate stores and labelled differently in the drawer.
--
-- Deliberately NOT versioned with snapshots, unlike form_version or
-- competency_framework. Those are snapshotted because an issued review must not
-- change under the person answering it. Nothing depends on the text of a help
-- article, so a published/draft flag plus the audit trail is the honest amount
-- of machinery.

BEGIN;

CREATE TABLE help_article (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organization(id),

  -- Stable, human-readable identifier. Scoped per tenant so two customers can
  -- both have a 'review-timetable' without collision.
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL,

  -- Mirrors the frontmatter contract of the bundled content (help/schema.ts) so
  -- the drawer can merge the two without special-casing either.
  section     TEXT NOT NULL,
  audience    TEXT[] NOT NULL DEFAULT ARRAY['everyone'],
  routes      TEXT[] NOT NULL DEFAULT '{}',
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  sort_order  INTEGER NOT NULL DEFAULT 500,

  -- Markdown, rendered by the same subset renderer as the bundled content. That
  -- renderer returns React elements and cannot emit HTML, which is what makes it
  -- safe to point at text typed into a form by a person.
  body        TEXT NOT NULL,

  -- Draft until published. HR writes policy over several sittings and should not
  -- be publishing half a sentence to the whole company in the meantime.
  published_at TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID,

  CONSTRAINT help_article_slug_uq UNIQUE (org_id, slug),
  CONSTRAINT help_article_slug_format
    CHECK (slug ~ '^[a-z][a-z0-9-]*$'),
  CONSTRAINT help_article_section_known
    CHECK (section IN ('basics', 'goals', 'reviews', 'growth', 'managing',
                       'administering', 'reference')),
  -- Every audience entry must be a real role, or the article addresses nobody
  -- and silently never appears.
  CONSTRAINT help_article_audience_known
    CHECK (audience <@ ARRAY['everyone', 'employee', 'manager',
                             'hr_admin', 'hr_partner']::TEXT[]),
  CONSTRAINT help_article_audience_not_empty
    CHECK (cardinality(audience) > 0),
  CONSTRAINT help_article_body_not_empty
    CHECK (length(btrim(body)) > 0)
);

CREATE INDEX help_article_org_published_idx
  ON help_article (org_id, published_at)
  WHERE published_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Read is tenant-wide and does not check a role: the audience field is a
-- relevance filter applied in the interface, not an authorization boundary.
-- Making it one would be misleading — help is not secret, and treating it as
-- though it were invites someone to put a secret in it.
--
-- Write requires the 'help' resource, which only HR holds.

ALTER TABLE help_article ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_article FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON help_article TO hr_app;

CREATE POLICY help_article_select ON help_article FOR SELECT
  USING (org_id = app.current_org_id());

CREATE POLICY help_article_insert ON help_article FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('help', 'write', app.current_employee_id()));

CREATE POLICY help_article_update ON help_article FOR UPDATE
  USING (org_id = app.current_org_id()
         AND app.can_access('help', 'write', app.current_employee_id()))
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('help', 'write', app.current_employee_id()));

-- Deleting is allowed because an article written in error has no history worth
-- keeping, and the audit trigger records the deletion either way.
CREATE POLICY help_article_delete ON help_article FOR DELETE
  USING (org_id = app.current_org_id()
         AND app.can_access('help', 'write', app.current_employee_id()));

-- Audit and updated_at, following the established pattern. The suffix is
-- concatenated before %I quotes it — `%I_audit` emits "help_article"_audit,
-- which is a syntax error (see 0003_audit.sql).
DO $$
DECLARE t TEXT := 'help_article';
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
END $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.seed_help_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_hr_admin   UUID;
  v_hr_partner UUID;
BEGIN
  SELECT id INTO v_hr_admin FROM app_role
   WHERE org_id = p_org_id AND code = 'hr_admin';
  SELECT id INTO v_hr_partner FROM app_role
   WHERE org_id = p_org_id AND code = 'hr_partner';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  VALUES (p_org_id, v_hr_admin, 'help', 'write', 'org'),
         -- An HR partner maintains their own department's policy notes. The
         -- scope is 'org' because an article is not attached to a department;
         -- restricting it further would need a column the design does not have.
         (p_org_id, v_hr_partner, 'help', 'write', 'org')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organization LOOP
    PERFORM app.seed_help_grants(v_org);
  END LOOP;
END $$;

COMMIT;
