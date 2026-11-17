-- ===========================================================================
-- Migration 0056: Prevent Overlapping Leave Applications & Data Integrity Trigger
-- ===========================================================================

BEGIN;

-- 1. Deduplicate any existing duplicate leave records (retain approved over pending, newer over older)
DELETE FROM leave_request a
 USING leave_request b
 WHERE a.employee_id = b.employee_id
   AND a.id <> b.id
   AND a.status IN ('pending', 'approved')
   AND b.status IN ('pending', 'approved')
   AND a.start_date <= b.end_date
   AND a.end_date >= b.start_date
   AND (
     (a.status = 'pending' AND b.status = 'approved')
     OR (a.status = b.status AND a.created_at < b.created_at)
     OR (a.status = b.status AND a.created_at = b.created_at AND a.id < b.id)
   );

-- 2. Trigger function to enforce no overlapping leaves for an employee
CREATE OR REPLACE FUNCTION app.check_leave_request_overlap()
RETURNS TRIGGER AS $$
DECLARE
  v_conflict RECORD;
BEGIN
  -- We only restrict active leaves: pending or approved
  IF NEW.status IN ('pending', 'approved') THEN
    IF NEW.start_date > NEW.end_date THEN
      RAISE EXCEPTION 'Leave start date (%) cannot be after end date (%)',
        NEW.start_date, NEW.end_date
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.total_days <= 0 THEN
      RAISE EXCEPTION 'Leave total days must be greater than zero'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT r.id, r.start_date, r.end_date, r.status, t.name AS leave_name
      INTO v_conflict
      FROM leave_request r
      JOIN leave_type t ON t.id = r.leave_type_id
     WHERE r.org_id = NEW.org_id
       AND r.employee_id = NEW.employee_id
       AND r.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND r.status IN ('pending', 'approved')
       AND r.start_date <= NEW.end_date
       AND r.end_date >= NEW.start_date
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'Overlapping leave request: Employee already has an active (%) leave (%) from % to %',
        v_conflict.status, v_conflict.leave_name, v_conflict.start_date, v_conflict.end_date
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_leave_request_overlap ON leave_request;
CREATE TRIGGER trg_check_leave_request_overlap
  BEFORE INSERT OR UPDATE OF start_date, end_date, status, employee_id
  ON leave_request
  FOR EACH ROW
  EXECUTE FUNCTION app.check_leave_request_overlap();

GRANT EXECUTE ON FUNCTION app.check_leave_request_overlap() TO hr_app;

COMMIT;
