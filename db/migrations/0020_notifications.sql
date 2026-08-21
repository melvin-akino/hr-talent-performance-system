-- 0020_notifications.sql
-- Phase 5, part 2: notification templates, outbox, and per-user preferences.
--
-- The outbox pattern, deliberately (decisions.md D-005 — no Redis, no broker):
-- a notification is enqueued in the SAME transaction as the business change
-- that caused it. Either the goal is approved and the email is queued, or
-- neither happened. Sending from the request thread instead would mean a slow
-- or dead SMTP relay taking down goal approval, and a rolled-back transaction
-- still emailing the employee.
--
-- On-prem context: the office SMTP relay will be unavailable sometimes. Retry
-- with backoff and a visible failure state are not optional here, because there
-- is no provider dashboard to check.

BEGIN;

-- ---------------------------------------------------------------------------
-- Templates (versioned, like every other definition in this system)
-- ---------------------------------------------------------------------------

CREATE TABLE notification_template (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organization(id),
  code          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  description   TEXT,
  subject       TEXT NOT NULL,
  -- Plain text and HTML bodies. Placeholders are {{dotted.path}} resolved
  -- against the outbox payload; rendering is done in the worker, not here.
  body_text     TEXT NOT NULL,
  body_html     TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  supersedes_id UUID REFERENCES notification_template(id),
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  UNIQUE (org_id, code, version),
  CONSTRAINT notification_template_active_is_published
    CHECK (NOT is_active OR published_at IS NOT NULL)
);

CREATE UNIQUE INDEX notification_template_active_uq
  ON notification_template (org_id, code) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------

-- immediate -- send as soon as the worker picks it up
-- digest    -- hold and batch into one periodic email
-- off       -- do not send at all
CREATE TYPE notification_mode AS ENUM ('immediate', 'digest', 'off');

CREATE TABLE notification_preference (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organization(id),
  employee_id   UUID NOT NULL REFERENCES employee(id),
  -- NULL template_code = the employee's default for everything not overridden.
  template_code TEXT,
  mode          notification_mode NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  CONSTRAINT notification_preference_same_org
    FOREIGN KEY (employee_id, org_id) REFERENCES employee (id, org_id)
);

CREATE UNIQUE INDEX notification_preference_uq
  ON notification_preference (employee_id,
                              COALESCE(template_code, '*'));

-- ---------------------------------------------------------------------------
-- Outbox
-- ---------------------------------------------------------------------------

CREATE TYPE notification_state AS ENUM
  ('pending', 'held_for_digest', 'sending', 'sent', 'failed', 'suppressed');

CREATE TABLE notification_outbox (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organization(id),
  recipient_employee_id UUID NOT NULL REFERENCES employee(id),
  -- Snapshot of the template version, so a queued mail renders as it was
  -- written even if the template is superseded before it is sent.
  template_id          UUID REFERENCES notification_template(id),
  template_code        TEXT NOT NULL,
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  state                notification_state NOT NULL DEFAULT 'pending',
  -- Idempotency. "Your check-in is overdue" must not arrive nine times because
  -- a scheduler ran nine times; the unique index below enforces it.
  dedupe_key           TEXT,
  attempts             SMALLINT NOT NULL DEFAULT 0,
  last_error           TEXT,
  available_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at              TIMESTAMPTZ,
  -- Recorded at enqueue time. An employee who leaves must not receive mail at a
  -- work address that has been reassigned.
  recipient_email      CITEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_same_org
    FOREIGN KEY (recipient_employee_id, org_id) REFERENCES employee (id, org_id)
);

-- One live notification per (recipient, dedupe_key). Sent and failed rows are
-- excluded so a genuinely new occurrence can be queued later.
CREATE UNIQUE INDEX notification_outbox_dedupe_uq
  ON notification_outbox (recipient_employee_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND state IN ('pending', 'held_for_digest', 'sending');

-- The worker's claim query. Partial index keeps it cheap as sent rows pile up.
CREATE INDEX notification_outbox_claim_idx
  ON notification_outbox (available_at)
  WHERE state = 'pending';

CREATE INDEX notification_outbox_digest_idx
  ON notification_outbox (recipient_employee_id)
  WHERE state = 'held_for_digest';

CREATE INDEX notification_outbox_recipient_idx
  ON notification_outbox (recipient_employee_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Enqueue
-- ---------------------------------------------------------------------------

/*
 * Queue a notification, honouring the recipient's preference.
 *
 * SECURITY DEFINER because business flows enqueue mail for OTHER people --
 * a manager approving a goal notifies the employee -- and the caller has no
 * general right to write rows about that employee. The function is narrow: it
 * decides the recipient, resolves the template, and returns an id. Callers
 * cannot set state, attempts, or the recipient's address.
 *
 * Returns NULL when the recipient has switched this notification off, or has no
 * work email to send to. Callers must treat NULL as normal, not as an error.
 */
CREATE FUNCTION app.enqueue_notification(
  p_recipient     UUID,
  p_template_code TEXT,
  p_payload       JSONB DEFAULT '{}'::jsonb,
  p_dedupe_key    TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public AS $$
DECLARE
  v_org       UUID;
  v_email     CITEXT;
  v_status    employee_status;
  v_deleted   TIMESTAMPTZ;
  v_mode      notification_mode;
  v_template  UUID;
  v_state     notification_state;
  v_id        UUID;
BEGIN
  SELECT org_id, work_email, status, deleted_at
    INTO v_org, v_email, v_status, v_deleted
    FROM employee WHERE id = p_recipient;

  IF v_org IS NULL OR v_deleted IS NOT NULL OR v_status = 'separated' THEN
    RETURN NULL;
  END IF;
  IF v_email IS NULL THEN
    RETURN NULL;   -- nothing to send to; not an error
  END IF;

  -- Most specific preference wins: per-template, then the employee default,
  -- then 'immediate'.
  SELECT mode INTO v_mode
    FROM notification_preference
   WHERE employee_id = p_recipient
     AND (template_code = p_template_code OR template_code IS NULL)
   ORDER BY (template_code IS NOT NULL) DESC
   LIMIT 1;
  v_mode := COALESCE(v_mode, 'immediate');

  IF v_mode = 'off' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_template
    FROM notification_template
   WHERE org_id = v_org AND code = p_template_code AND is_active;

  v_state := (CASE WHEN v_mode = 'digest' THEN 'held_for_digest'
                  ELSE 'pending' END)::notification_state;

  INSERT INTO notification_outbox (
    org_id, recipient_employee_id, template_id, template_code, payload,
    state, dedupe_key, recipient_email
  ) VALUES (
    v_org, p_recipient, v_template, p_template_code, COALESCE(p_payload, '{}'::jsonb),
    v_state, p_dedupe_key, v_email
  )
  -- A duplicate live notification is a no-op, not a failure: the caller should
  -- not have to know whether one is already queued.
  ON CONFLICT (recipient_employee_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL
      AND state IN ('pending', 'held_for_digest', 'sending')
    DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION app.enqueue_notification(UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enqueue_notification(UUID, TEXT, JSONB, TEXT) TO hr_app;

-- ---------------------------------------------------------------------------
-- Worker claim
-- ---------------------------------------------------------------------------

/*
 * Claim up to p_limit due notifications for delivery.
 *
 * FOR UPDATE SKIP LOCKED is what makes this safe to run from more than one
 * worker without a broker: each claims a disjoint set and neither blocks.
 * Marking them 'sending' means a crashed worker leaves rows visibly stuck
 * rather than silently unsent -- see app.requeue_stalled_notifications().
 */
CREATE FUNCTION app.claim_notifications(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id UUID, recipient_email CITEXT, template_code TEXT, payload JSONB,
  subject TEXT, body_text TEXT, body_html TEXT, attempts SMALLINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = app, public AS $$
  WITH claimed AS (
    SELECT o.id
      FROM notification_outbox o
     WHERE o.state = 'pending'
       AND o.available_at <= now()
     ORDER BY o.available_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), marked AS (
    UPDATE notification_outbox o
       SET state = 'sending', attempts = o.attempts + 1
      FROM claimed c
     WHERE o.id = c.id
   RETURNING o.id, o.recipient_email, o.template_code, o.payload,
             o.template_id, o.attempts
  )
  SELECT m.id, m.recipient_email, m.template_code, m.payload,
         t.subject, t.body_text, t.body_html, m.attempts
    FROM marked m
    LEFT JOIN notification_template t ON t.id = m.template_id;
$$;

REVOKE ALL ON FUNCTION app.claim_notifications(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_notifications(INT) TO hr_app;

/*
 * Exponential backoff, capped. Gives up after 6 attempts and leaves the row in
 * 'failed' with the last error -- on-prem there is no provider dashboard, so a
 * dead letter must be queryable.
 */
CREATE FUNCTION app.fail_notification(p_id UUID, p_error TEXT) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = app, public AS $$
  UPDATE notification_outbox
     SET state = (CASE WHEN attempts >= 6 THEN 'failed'
                       ELSE 'pending' END)::notification_state,
         last_error = left(p_error, 2000),
         -- attempts is already incremented by claim_notifications, so the
         -- delays are 2, 4, 8, 16, 32, 64 minutes.
         available_at = now() + (power(2, LEAST(attempts, 6)) * INTERVAL '1 minute')
   WHERE id = p_id;
$$;

CREATE FUNCTION app.sent_notification(p_id UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = app, public AS $$
  UPDATE notification_outbox
     SET state = 'sent', sent_at = now(), last_error = NULL
   WHERE id = p_id;
$$;

/* A worker killed mid-send leaves rows in 'sending' forever. Reclaim them. */
CREATE FUNCTION app.requeue_stalled_notifications(p_older_than INTERVAL DEFAULT '10 minutes')
RETURNS INT
LANGUAGE sql SECURITY DEFINER SET search_path = app, public AS $$
  WITH stalled AS (
    UPDATE notification_outbox
       SET state = 'pending', available_at = now()
     WHERE state = 'sending'
       AND created_at < now() - p_older_than
   RETURNING 1
  ) SELECT count(*)::int FROM stalled;
$$;

REVOKE ALL ON FUNCTION app.fail_notification(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sent_notification(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.requeue_stalled_notifications(INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fail_notification(UUID, TEXT) TO hr_app;
GRANT EXECUTE ON FUNCTION app.sent_notification(UUID) TO hr_app;
GRANT EXECUTE ON FUNCTION app.requeue_stalled_notifications(INTERVAL) TO hr_app;

/*
 * Collapse everything held for one recipient into a single digest, and mark the
 * held rows as sent so they are not delivered twice.
 */
CREATE FUNCTION app.build_digests() RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public AS $$
DECLARE
  v_row RECORD;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT recipient_employee_id,
           org_id,
           count(*) AS item_count,
           jsonb_agg(jsonb_build_object('templateCode', template_code,
                                        'payload', payload)
                     ORDER BY created_at) AS items
      FROM notification_outbox
     WHERE state = 'held_for_digest'
     GROUP BY recipient_employee_id, org_id
  LOOP
    INSERT INTO notification_outbox (
      org_id, recipient_employee_id, template_id, template_code, payload, state
    )
    SELECT v_row.org_id, v_row.recipient_employee_id,
           (SELECT id FROM notification_template
             WHERE org_id = v_row.org_id AND code = 'digest' AND is_active),
           'digest',
           jsonb_build_object('itemCount', v_row.item_count, 'items', v_row.items),
           'pending'::notification_state;

    UPDATE notification_outbox
       SET state = 'sent', sent_at = now()
     WHERE recipient_employee_id = v_row.recipient_employee_id
       AND state = 'held_for_digest';

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION app.build_digests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.build_digests() TO hr_app;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_template', 'notification_preference',
                           'notification_outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO hr_app', t);
  END LOOP;
END $$;

CREATE POLICY notification_template_select ON notification_template FOR SELECT
  USING (org_id = app.current_org_id());
CREATE POLICY notification_template_insert ON notification_template FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('notification', 'write', app.current_employee_id()));
CREATE POLICY notification_template_update ON notification_template FOR UPDATE
  USING (org_id = app.current_org_id()
         AND app.can_access('notification', 'write', app.current_employee_id()))
  WITH CHECK (org_id = app.current_org_id()
              AND app.can_access('notification', 'write', app.current_employee_id()));

-- Preferences are personal: an employee manages their own, HR can inspect.
CREATE POLICY notification_preference_select ON notification_preference FOR SELECT
  USING (org_id = app.current_org_id()
         AND (employee_id = app.current_employee_id()
              OR app.can_access('notification', 'write', app.current_employee_id())));
CREATE POLICY notification_preference_insert ON notification_preference FOR INSERT
  WITH CHECK (org_id = app.current_org_id()
              AND employee_id = app.current_employee_id());
CREATE POLICY notification_preference_update ON notification_preference FOR UPDATE
  USING (org_id = app.current_org_id() AND employee_id = app.current_employee_id())
  WITH CHECK (org_id = app.current_org_id() AND employee_id = app.current_employee_id());

-- The outbox holds message payloads about people, so it is NOT world-readable:
-- your own mail, or HR's with the grant. The worker reads through the
-- SECURITY DEFINER claim function, not through this policy.
CREATE POLICY notification_outbox_select ON notification_outbox FOR SELECT
  USING (org_id = app.current_org_id()
         AND (recipient_employee_id = app.current_employee_id()
              OR app.can_access('notification', 'write', app.current_employee_id())));

CREATE FUNCTION app.seed_phase5_notification_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_hr_admin UUID;
BEGIN
  SELECT id INTO v_hr_admin FROM app_role WHERE org_id=p_org_id AND code='hr_admin';
  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  VALUES (p_org_id, v_hr_admin, 'notification', 'write', 'org')
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organization LOOP
    PERFORM app.seed_phase5_notification_grants(v_org);
  END LOOP;
END $$;

COMMIT;
