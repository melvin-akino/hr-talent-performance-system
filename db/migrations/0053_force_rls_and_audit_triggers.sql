-- 0053_force_rls_and_audit_triggers.sql
-- Ensure FORCE ROW LEVEL SECURITY and audit triggers across Phase 2 and Phase 3 tables
-- to comply with preflight security checks and enterprise audit requirements.

BEGIN;

-- 1. Force Row Level Security for schema owner
ALTER TABLE branch FORCE ROW LEVEL SECURITY;
ALTER TABLE employee_compensation FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll_run FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll_line_item FORCE ROW LEVEL SECURITY;
ALTER TABLE thirteenth_month_accrual FORCE ROW LEVEL SECURITY;

ALTER TABLE holiday_calendar FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_shift FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_record FORCE ROW LEVEL SECURITY;
ALTER TABLE leave_type FORCE ROW LEVEL SECURITY;
ALTER TABLE leave_allocation FORCE ROW LEVEL SECURITY;
ALTER TABLE leave_request FORCE ROW LEVEL SECURITY;

-- 2. Attach audit triggers to all new mutable tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'branch',
    'employee_compensation',
    'payroll_run',
    'payroll_line_item',
    'thirteenth_month_accrual',
    'holiday_calendar',
    'attendance_shift',
    'attendance_record',
    'leave_type',
    'leave_allocation',
    'leave_request'
  ] LOOP
    -- Drop existing trigger if any to be idempotent
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', tbl || '_audit', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.audit_row()', tbl || '_audit', tbl
    );
  END LOOP;
END;
$$;

COMMIT;
