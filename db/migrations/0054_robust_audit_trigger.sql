-- 0054_robust_audit_trigger.sql
-- Update app.audit_row() to extract record_id safely from JSONB
-- so tables with primary keys other than "id" (such as employee_compensation) do not fail.

BEGIN;

CREATE OR REPLACE FUNCTION app.audit_row() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_changed TEXT[];
  v_record_id UUID;
  v_id_str TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_id_str := COALESCE(v_new ->> 'id', v_new ->> 'employee_id');
    IF v_id_str IS NOT NULL AND v_id_str ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_record_id := v_id_str::uuid;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_id_str := COALESCE(v_new ->> 'id', v_new ->> 'employee_id');
    IF v_id_str IS NOT NULL AND v_id_str ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_record_id := v_id_str::uuid;
    END IF;
    SELECT array_agg(key ORDER BY key) INTO v_changed
      FROM jsonb_each(v_old) o
     WHERE o.value IS DISTINCT FROM v_new -> o.key
       AND o.key NOT IN ('updated_at', 'updated_by');
    IF v_changed IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    v_old := to_jsonb(OLD);
    v_id_str := COALESCE(v_old ->> 'id', v_old ->> 'employee_id');
    IF v_id_str IS NOT NULL AND v_id_str ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_record_id := v_id_str::uuid;
    END IF;
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

COMMIT;
