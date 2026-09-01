-- 0042_notification_events.sql
-- F5: the messages the system was missing (requirements §7.8).
--
-- Their §7.8 asks for reminders, acknowledgement, results and evaluation
-- notifications. The outbox, the retry, the per-user preferences and the
-- rendering all exist; what is missing is the events themselves.
--
-- WHAT WAS ACTUALLY SILENT.
--
-- Auditing the emitters against the seeded templates turned up a gap wider than
-- "some new events": several templates were seeded and never emitted by
-- anything. `review.assigned` is the one that matters — review instances are
-- created by generateInstances() and the reviewer is simply never told. The
-- template has been sitting there since 0021 looking like a feature.
--
-- Everything built since is silent too. T3 opens a quarter of evaluations for a
-- whole section and nobody hears; D3 draws a peer panel and nobody is asked.
-- A workflow nobody is told about is a workflow that runs on somebody
-- remembering to look, which is the thing an outbox exists to replace.
--
-- REMINDERS ARE NOT HERE, AND THAT IS NOT AN OVERSIGHT.
--
-- "Reminders" needs something to notice that a deadline is near and fire on a
-- schedule. There is no such scanner: `goal.checkin_overdue` has been seeded
-- since 0021 and nothing has ever emitted it either. Adding the templates
-- without the scheduler would produce three more messages that never send —
-- exactly the state this migration is cleaning up. The scanner is its own
-- piece of work and is recorded as F5b.

BEGIN;

CREATE FUNCTION app.seed_workflow_event_templates(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_template (
    org_id, code, version, description, subject, body_text, is_active, published_at)
  VALUES
    -- ---- task evaluations (T2, T3) -------------------------------------
    (p_org_id, 'evaluation.assigned', 1,
     'An evaluator has a task evaluation to complete',
     'Evaluation to complete: {{subjectName}}',
     E'Hello,\n\n'
     'You have an evaluation to complete for {{subjectName}} covering '
     '{{periodStart}} to {{periodEnd}}, against the {{scorecardName}} '
     'scorecard.\n\n'
     'Open the HR system to score it.\n\n'
     '-- This is an automated message.',
     TRUE, now()),

    -- The subject learns the result, and only the result: a draft stays
    -- invisible to them, so this fires on submission and not before.
    (p_org_id, 'evaluation.result', 1,
     'A task evaluation was submitted and the subject may now read it',
     'Your evaluation for {{periodStart}} to {{periodEnd}}',
     E'Hello,\n\n'
     'Your evaluation against the {{scorecardName}} scorecard has been '
     'submitted.\n\n'
     '  Score: {{awarded}} out of {{target}}\n\n'
     'Open the HR system to read it line by line.\n\n'
     '-- This is an automated message.',
     TRUE, now()),

    (p_org_id, 'evaluation.acknowledged', 1,
     'The subject acknowledged their evaluation',
     '{{subjectName}} acknowledged their evaluation',
     E'Hello,\n\n'
     '{{subjectName}} has acknowledged the evaluation you submitted for '
     '{{periodStart}} to {{periodEnd}}.\n\n'
     '-- This is an automated message.',
     TRUE, now()),

    -- ---- peer review (D3, D1) -------------------------------------------
    --
    -- The subject is NOT named to the reviewer here -- they are, because the
    -- reviewer plainly has to know who they are being asked about. What this
    -- message must never do is travel the other way: nothing tells a subject
    -- who was asked. That is Q5, and the restrictive policy in 0041 holds it.
    (p_org_id, 'peer.invited', 1,
     'Somebody was drawn to take part in a peer review',
     'Can you take part in a review of {{subjectName}}?',
     E'Hello,\n\n'
     'You have been asked to take part in a peer review of {{subjectName}}.\n\n'
     'Before accepting, the system will ask whether you have had any direct or '
     'indirect interaction with them in the last six months. If you have not, '
     'say so -- somebody else will be asked instead, and that is the expected '
     'answer rather than a problem.\n\n'
     'Open the HR system to accept or decline.\n\n'
     '-- This is an automated message.',
     TRUE, now()),

    -- Addressed to HCM, not to the subject: a short panel is a fact about the
    -- routing rule, and the person who can fix it is the one who wrote it.
    (p_org_id, 'peer.panel_short', 1,
     'A peer panel could not be filled from the rule',
     'Peer panel short for {{subjectName}}',
     E'Hello,\n\n'
     'The peer panel for {{subjectName}} has {{accepted}} of a required '
     '{{minimum}} reviewers, and the pool their routing rule defines is '
     'exhausted.\n\n'
     'This usually means the rule is drawing from too narrow a group rather '
     'than that people are refusing.\n\n'
     '-- This is an automated message.',
     TRUE, now()),

    -- ---- reviews ---------------------------------------------------------
    (p_org_id, 'review.acknowledged', 1,
     'An employee acknowledged their released review',
     '{{employeeName}} acknowledged their review',
     E'Hello,\n\n'
     '{{employeeName}} has acknowledged their {{cycleName}} review.\n\n'
     '-- This is an automated message.',
     TRUE, now())
  ON CONFLICT (org_id, code, version) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_workflow_event_templates(r.id);
  END LOOP;
END $do$;

COMMIT;

BEGIN;

/*
 * Drawing reviewers now invites them.
 *
 * The invitation belongs in the same statement as the draw, not in a service
 * above it. D3's draw is called from SQL and will be called from the batch
 * screen and the CLI too; an invitation that depends on the caller remembering
 * is one that gets missed, and a peer panel nobody was told about is a panel
 * that never fills.
 *
 * Only the body changes -- the signature, the exclusion of people already asked
 * and the short-panel behaviour are all as 0040 left them.
 */
CREATE OR REPLACE FUNCTION app.draw_peer_reviewers(
  p_cycle    UUID,
  p_subject  UUID,
  p_count    SMALLINT DEFAULT NULL,
  p_as_of    DATE DEFAULT CURRENT_DATE,
  p_seed     DOUBLE PRECISION DEFAULT NULL,
  p_replaces UUID DEFAULT NULL
) RETURNS TABLE (solicitation_id UUID, reviewer_employee_id UUID, source_label TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_org     UUID;
  v_rule    UUID;
  v_want    SMALLINT;
  v_subject TEXT;
  r         RECORD;
BEGIN
  SELECT org_id INTO v_org FROM review_cycle WHERE id = p_cycle;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No such review cycle, or not visible to you';
  END IF;

  v_rule := app.peer_review_rule_for(p_subject, p_as_of);
  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'No peer-review rule covers that employee'
      USING HINT = 'Add a catch-all rule, or one matching their job family.';
  END IF;

  SELECT COALESCE(p_count, min_reviewers) INTO v_want
    FROM peer_review_rule WHERE id = v_rule;

  IF p_seed IS NOT NULL THEN
    PERFORM setseed(p_seed);
  END IF;

  v_subject := app.display_name(p_subject);

  FOR r IN
    WITH candidates AS (
      SELECT pool.employee_id, pool.source_id, pool.source_label
        FROM app.peer_review_pool(p_subject, p_as_of) AS pool
       WHERE NOT EXISTS (
         SELECT 1 FROM peer_review_solicitation s
          WHERE s.review_cycle_id = p_cycle
            AND s.subject_employee_id = p_subject
            AND s.reviewer_employee_id = pool.employee_id
       )
       ORDER BY random()
       LIMIT v_want
    )
    INSERT INTO peer_review_solicitation (
      org_id, review_cycle_id, subject_employee_id, reviewer_employee_id,
      source_id, source_label, drawn_by, replaces_id)
    SELECT v_org, p_cycle, p_subject, c.employee_id, c.source_id, c.source_label,
           app.current_employee_id(), p_replaces
      FROM candidates c
    RETURNING peer_review_solicitation.id,
              peer_review_solicitation.reviewer_employee_id,
              peer_review_solicitation.source_label
  LOOP
    /*
     * The reviewer is told who they are being asked about, because they cannot
     * answer the six-month question otherwise. Nothing travels the other way:
     * no message tells a subject who was asked, and the restrictive policy in
     * 0041 keeps it that way while Q5 is open.
     */
    PERFORM app.enqueue_notification(
      r.reviewer_employee_id, 'peer.invited',
      jsonb_build_object('subjectName', v_subject),
      'peer-invited:' || r.id::text);

    solicitation_id      := r.id;
    reviewer_employee_id := r.reviewer_employee_id;
    source_label         := r.source_label;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMIT;
