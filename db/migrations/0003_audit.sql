-- 0003_audit.sql
-- Append-only audit log, written by TRIGGER rather than application code
-- (architecture.md principle 5).
--
-- Trigger-based is not a style preference: an application-level audit call is
-- one forgotten line away from an unlogged mutation, and the CSV importer,
-- future admin scripts, and manual psql fixes all bypass it entirely.

BEGIN;

CREATE TYPE audit_operation AS ENUM ('INSERT', 'UPDATE', 'DELETE');

CREATE TABLE audit_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  table_name    TEXT NOT NULL,
  record_id     UUID,
  operation     audit_operation NOT NULL,
  -- Who. NULL only for system paths (import, migration), which is itself
  -- meaningful and must remain distinguishable from a real user.
  actor_employee_id UUID,
  -- Correlates a row change back to the HTTP request that caused it.
  request_id    TEXT,
  old_data      JSONB,
  new_data      JSONB,
  -- Only the columns that actually changed. Makes the log readable without
  -- diffing two large JSON blobs by eye.
  changed_columns TEXT[]
);

CREATE INDEX audit_log_record_idx ON audit_log (table_name, record_id, occurred_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_employee_id, occurred_at DESC);
CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);

-- Append-only enforcement. Without this, "audit log" is just a table.
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- Generic trigger function
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.audit_row() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_changed TEXT[];
  v_record_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_record_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_record_id := NEW.id;
    SELECT array_agg(key ORDER BY key) INTO v_changed
      FROM jsonb_each(v_old) o
     WHERE o.value IS DISTINCT FROM v_new -> o.key
       -- Bookkeeping columns change on every write; logging them as "changes"
       -- makes every diff look identical and hides the real edit.
       AND o.key NOT IN ('updated_at', 'updated_by');
    -- Nothing of substance changed -- do not write a noise row.
    IF v_changed IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    v_old := to_jsonb(OLD);
    v_record_id := OLD.id;
  END IF;

  INSERT INTO audit_log (
    table_name, record_id, operation, actor_employee_id,
    request_id, old_data, new_data, changed_columns
  ) VALUES (
    TG_TABLE_NAME,
    v_record_id,
    TG_OP::audit_operation,
    app.current_employee_id(),
    NULLIF(current_setting('app.request_id', true), ''),
    v_old,
    v_new,
    v_changed
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Keeps updated_at honest regardless of what the application sends.
CREATE FUNCTION app.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(app.current_employee_id(), NEW.updated_by);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Attach to every mutable table
-- ---------------------------------------------------------------------------
-- Loop rather than 10 copy-pasted blocks: later phases add tables to this list
-- and must not have to remember the exact trigger boilerplate.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization', 'employment_type', 'department', 'position',
    'employee', 'employment', 'reporting_line',
    'app_role', 'role_assignment', 'access_grant'
  ] LOOP
    -- The suffix is concatenated BEFORE %I quotes it. `%I_audit` would emit
    -- "organization"_audit -- a syntax error, because %I closes the quotes.
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;

COMMIT;
