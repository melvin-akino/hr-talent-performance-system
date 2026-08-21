-- 0019_feedback.sql
-- Phase 5, part 1: continuous feedback with the three channels from the
-- meeting notes -- "feedback - messaging — EE | EE+Sup | Sup".
--
-- Those three channels mean three genuinely different privacy promises, and the
-- labels have to be true:
--
--   employee_only          author + subject. Nobody else -- NOT the supervisor,
--                          NOT HR. If HR could read it, "employee only" would
--                          be a lie, and people would find out eventually.
--   employee_and_supervisor  author + subject + direct supervisor + HR.
--   supervisor_only        author + direct supervisor + HR. The subject CANNOT
--                          see it. This is the sensitive one.
--
-- The asymmetry is deliberate. See the note above the SELECT policy before
-- changing any of it.

BEGIN;

CREATE TYPE feedback_visibility AS ENUM
  ('employee_only', 'employee_and_supervisor', 'supervisor_only');

CREATE TYPE feedback_kind AS ENUM
  ('praise', 'coaching', 'concern', 'request', 'general');

CREATE TABLE feedback_thread (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organization(id),
  subject_employee_id UUID NOT NULL REFERENCES employee(id),
  created_by          UUID NOT NULL REFERENCES employee(id),
  visibility          feedback_visibility NOT NULL,
  kind                feedback_kind NOT NULL DEFAULT 'general',
  title               TEXT NOT NULL,
  -- Continuous feedback is not tied to a cycle; the link is optional and exists
  -- only so feedback can be surfaced alongside a review when it is relevant.
  goal_id             UUID REFERENCES goal(id) ON DELETE SET NULL,
  review_cycle_id     UUID REFERENCES review_cycle(id) ON DELETE SET NULL,
  is_closed           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID,
  CONSTRAINT feedback_same_org
    FOREIGN KEY (subject_employee_id, org_id) REFERENCES employee (id, org_id),
  -- Feedback about yourself is a journal entry, not feedback. It would also
  -- make the supervisor_only channel incoherent.
  CONSTRAINT feedback_not_self CHECK (subject_employee_id <> created_by)
);

CREATE INDEX feedback_thread_subject_idx
  ON feedback_thread (subject_employee_id, created_at DESC);
CREATE INDEX feedback_thread_author_idx
  ON feedback_thread (created_by, created_at DESC);

CREATE TABLE feedback_message (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_thread_id UUID NOT NULL REFERENCES feedback_thread(id) ON DELETE CASCADE,
  author_employee_id UUID NOT NULL REFERENCES employee(id),
  body               TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID
);

CREATE INDEX feedback_message_thread_idx
  ON feedback_message (feedback_thread_id, created_at);

-- Append-only, like every other contemporaneous record in this system. Feedback
-- that can be edited after the fact is worthless in a disagreement.
CREATE RULE feedback_message_no_update AS
  ON UPDATE TO feedback_message DO INSTEAD NOTHING;
CREATE RULE feedback_message_no_delete AS
  ON DELETE TO feedback_message DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------

/*
 * True when the caller may see a thread with this subject and visibility.
 *
 * Extracted into a function because the same rule governs both the thread and
 * its messages; stating it twice would let the two drift, and a drift here
 * means private feedback becoming readable.
 */
CREATE FUNCTION app.can_see_feedback(
  p_subject UUID, p_author UUID, p_visibility feedback_visibility
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT CASE
    WHEN app.current_employee_id() IS NULL THEN FALSE
    -- The author always sees what they wrote.
    WHEN p_author = app.current_employee_id() THEN TRUE
    -- The subject sees everything except the supervisor-only channel.
    WHEN p_subject = app.current_employee_id()
      THEN p_visibility <> 'supervisor_only'
    -- The DIRECT supervisor sees everything except the employee-only channel.
    -- Direct, not subtree: a skip-level manager has no automatic claim on a
    -- conversation between someone and their own manager.
    WHEN app.reports_to(p_subject, app.current_employee_id(),
                        CURRENT_DATE, 1::smallint)
      THEN p_visibility <> 'employee_only'
    -- HR, per their grant -- but never into the employee-only channel, because
    -- that channel's whole value is that it is private.
    ELSE p_visibility <> 'employee_only'
         AND app.can_access('feedback', 'read', p_subject)
  END;
$$;

COMMENT ON FUNCTION app.can_see_feedback IS
  'Feedback visibility. employee_only is private to author and subject — not '
  'the supervisor, not HR. Weakening that makes the channel name a lie.';

ALTER TABLE feedback_thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_thread FORCE ROW LEVEL SECURITY;
ALTER TABLE feedback_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_message FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON feedback_thread TO hr_app;
GRANT SELECT, INSERT, UPDATE ON feedback_message TO hr_app;

CREATE POLICY feedback_thread_select ON feedback_thread FOR SELECT
  USING (org_id = app.current_org_id()
         AND app.can_see_feedback(subject_employee_id, created_by, visibility));

-- Anyone may give feedback to anyone in their tenant, but only as themselves.
CREATE POLICY feedback_thread_insert ON feedback_thread FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND created_by = app.current_employee_id());

-- Only the author may close or retitle a thread. Notably a subject cannot
-- close a supervisor_only thread they cannot even see.
CREATE POLICY feedback_thread_update ON feedback_thread FOR UPDATE
  USING (org_id = app.current_org_id() AND created_by = app.current_employee_id())
  WITH CHECK (org_id = app.current_org_id() AND created_by = app.current_employee_id());

-- Messages inherit the thread's visibility by re-entering its RLS.
CREATE POLICY feedback_message_select ON feedback_message FOR SELECT
  USING (EXISTS (SELECT 1 FROM feedback_thread t
                  WHERE t.id = feedback_message.feedback_thread_id));

CREATE POLICY feedback_message_insert ON feedback_message FOR INSERT
  WITH CHECK (
    author_employee_id = app.current_employee_id()
    AND EXISTS (SELECT 1 FROM feedback_thread t
                 WHERE t.id = feedback_message.feedback_thread_id
                   AND NOT t.is_closed)
  );

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['feedback_thread'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;

CREATE TRIGGER feedback_message_audit
  AFTER INSERT ON feedback_message
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.seed_phase5_feedback_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_hr_partner UUID; v_hr_admin UUID;
BEGIN
  SELECT id INTO v_hr_partner FROM app_role WHERE org_id=p_org_id AND code='hr_partner';
  SELECT id INTO v_hr_admin   FROM app_role WHERE org_id=p_org_id AND code='hr_admin';

  -- Deliberately no 'feedback' grant for employee or manager roles: their
  -- access comes from being the author, the subject, or the direct supervisor,
  -- which app.can_see_feedback() handles. A grant would widen it wrongly.
  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  VALUES
    (p_org_id, v_hr_partner, 'feedback', 'read', 'department'),
    (p_org_id, v_hr_admin,   'feedback', 'read', 'org')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organization LOOP
    PERFORM app.seed_phase5_feedback_grants(v_org);
  END LOOP;
END $$;

COMMIT;
