-- 0021_notification_defaults.sql
-- Default notification templates.
--
-- Shipped as a migration, not runtime seed data, for the same reason as the
-- baseline role matrix: an on-prem restore must come back able to send mail
-- without someone re-typing eight templates from memory.
--
-- These are defaults. HR can publish new versions through the app; doing so
-- retires the version below rather than editing it.

BEGIN;

CREATE FUNCTION app.seed_notification_templates(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT * FROM (VALUES
      ('feedback.received',
       'Someone gave you feedback, or replied to a thread you are part of',
       'New feedback: {{title}}',
       E'Hello,\n\n'
       'There is new feedback in the thread "{{title}}".\n\n'
       'Open the HR system to read and reply.\n\n'
       '-- This is an automated message.'),

      ('goal.approval_requested',
       'An employee submitted a goal for the manager to approve',
       'Goal awaiting your approval: {{goalTitle}}',
       E'Hello,\n\n'
       '{{employeeName}} submitted a goal for your approval:\n\n'
       '  {{goalTitle}} (weight {{weight}}%)\n\n'
       'Open the HR system to review and approve it.\n\n'
       '-- This is an automated message.'),

      ('goal.approved',
       'A manager approved an employee goal',
       'Your goal was approved: {{goalTitle}}',
       E'Hello,\n\n'
       'Your goal "{{goalTitle}}" was approved by {{approverName}} and is now '
       'active.\n\n'
       '-- This is an automated message.'),

      ('goal.checkin_overdue',
       'A goal has gone past its check-in cadence',
       'Check-in overdue: {{goalTitle}}',
       E'Hello,\n\n'
       'Your goal "{{goalTitle}}" has not had a check-in for {{daysOverdue}} '
       'days.\n\n'
       'A check-in takes a minute and keeps the record honest.\n\n'
       '-- This is an automated message.'),

      ('review.assigned',
       'A review was assigned to a reviewer',
       'Review to complete: {{subjectName}}',
       E'Hello,\n\n'
       'A review has been assigned to you as part of "{{cycleName}}":\n\n'
       '  Subject: {{subjectName}}\n'
       '  Closes:  {{closesOn}}\n\n'
       'Open the HR system to complete it.\n\n'
       '-- This is an automated message.'),

      ('review.returned',
       'A submitted review was returned for revision',
       'Review returned for revision: {{subjectName}}',
       E'Hello,\n\n'
       'Your review of {{subjectName}} has been returned for revision.\n\n'
       'Reason: {{reason}}\n\n'
       '-- This is an automated message.'),

      ('review.released',
       'A review was signed off and released to the employee',
       'Your review is available: {{cycleName}}',
       E'Hello,\n\n'
       'Your review for "{{cycleName}}" has been signed off and is now '
       'available for you to read and acknowledge.\n\n'
       '-- This is an automated message.'),

      ('pip.created',
       'A performance improvement plan was activated',
       'Performance improvement plan: {{employeeName}}',
       E'Hello,\n\n'
       'A performance improvement plan has been activated.\n\n'
       '  Period: {{startsOn}} to {{endsOn}}\n\n'
       'Open the HR system to read the plan and its milestones.\n\n'
       '-- This is an automated message.'),

      ('digest',
       'Periodic summary of everything held for digest delivery',
       'HR system: {{itemCount}} update(s)',
       E'Hello,\n\n'
       'You have {{itemCount}} update(s) waiting in the HR system.\n\n'
       'Open it to see the detail.\n\n'
       '-- This is an automated summary.')
    ) AS t(code, description, subject, body_text)
  LOOP
    INSERT INTO notification_template (
      org_id, code, version, description, subject, body_text,
      is_active, published_at
    ) VALUES (
      p_org_id, v_row.code, 1, v_row.description, v_row.subject, v_row.body_text,
      TRUE, now()
    )
    ON CONFLICT (org_id, code, version) DO NOTHING;
  END LOOP;
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organization LOOP
    PERFORM app.seed_notification_templates(v_org);
  END LOOP;
END $$;

COMMIT;
