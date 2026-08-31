-- 0040_peer_review_sampling.sql
-- D3: drawing reviewers, and the record of who was drawn and why (§6.2, §6.6).
--
-- D2 decided who is ELIGIBLE. This decides who is ASKED, and keeps the trail:
--
--   drawn → accepted
--         → declined  → (a replacement is drawn, and linked to it)
--         → withdrawn
--
-- Their §6.6 is the reason the trail matters. A reviewer is asked "have you had
-- any direct or indirect interaction with X in the last six months?", and a No
-- means thank them and draw somebody else. Without a record, a panel of three
-- that took nine attempts to assemble is indistinguishable from one that took
-- three -- and the difference is exactly what tells HCM a rule is drawing from
-- people who do not actually work together.
--
-- WHY A SOLICITATION IS NOT A REVIEW INSTANCE.
--
-- Most people asked will never write a review: they decline, or they are
-- replaced, or the cycle closes first. A review_instance carries a form version
-- and appears in everybody's queue, and manufacturing one for every person
-- merely ASKED would put unanswerable work in front of them and pollute the
-- sign-off gate, which refuses while any instance is unsubmitted.
--
-- The instance is created when somebody ACCEPTS. That is D1's job -- the
-- instrument does not exist yet -- so this stops at the accepted state and
-- records it.
--
-- WHAT IS NOT HERE.
--
--   * The 30-point instrument itself is D1 (§6.1).
--   * Averaging, and enforcing the minimum, are D4 -- and the minimum is Q4,
--     which is why the count lives on the rule (D2) rather than here.
--   * Anonymity is Q5 / D5. A solicitation names its reviewer because the draw
--     cannot work otherwise: replacements have to avoid asking twice. What is
--     never recorded here is what anybody SAID.

BEGIN;

CREATE TYPE peer_solicitation_state AS ENUM (
  'drawn', 'accepted', 'declined', 'withdrawn'
);

/*
 * Why somebody said no.
 *
 * `no_interaction` is the client's own gate question and is the one that
 * matters: a rule producing many of these is drawing from the wrong pool, which
 * is a fact about the rule rather than about the people.
 */
CREATE TYPE peer_decline_reason AS ENUM (
  'no_interaction', 'unavailable', 'other'
);

CREATE TABLE peer_review_solicitation (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,

  review_cycle_id     UUID NOT NULL REFERENCES review_cycle(id) ON DELETE CASCADE,
  subject_employee_id UUID NOT NULL,
  reviewer_employee_id UUID NOT NULL,

  /*
   * The pool that produced this person. This is the "why" half of the audit
   * trail: not merely that they were drawn, but that they were drawn as, say,
   * a Branch Head in the same Area.
   *
   * Nullable and ON DELETE SET NULL because a rule may be rewritten later, and
   * losing the rule must not erase the record of a draw that already happened.
   */
  source_id UUID REFERENCES peer_review_rule_source(id) ON DELETE SET NULL,
  /* Kept as text too, so the label survives the source being deleted. */
  source_label TEXT,

  state peer_solicitation_state NOT NULL DEFAULT 'drawn',

  decline_reason peer_decline_reason,
  note           TEXT,

  /* The solicitation this one replaces, so a chain of declines is followable. */
  replaces_id UUID REFERENCES peer_review_solicitation(id) ON DELETE SET NULL,

  drawn_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  drawn_by     UUID,
  responded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,

  CONSTRAINT peer_solicitation_subject_same_org
    FOREIGN KEY (subject_employee_id, org_id) REFERENCES employee (id, org_id),
  CONSTRAINT peer_solicitation_reviewer_same_org
    FOREIGN KEY (reviewer_employee_id, org_id) REFERENCES employee (id, org_id),

  -- Nobody reviews themselves. Enforced here as well as in the draw, because
  -- the draw is not the only way a row can be written.
  CONSTRAINT peer_solicitation_not_self
    CHECK (reviewer_employee_id <> subject_employee_id),

  -- A response records when it happened; an outstanding one has not happened.
  CONSTRAINT peer_solicitation_response_complete CHECK (
    (state = 'drawn') = (responded_at IS NULL)
  ),
  -- A reason belongs to a decline and nowhere else. Without this, a reason left
  -- behind by a correction would read as the explanation for an acceptance.
  CONSTRAINT peer_solicitation_reason_only_on_decline CHECK (
    decline_reason IS NULL OR state = 'declined'
  ),

  /*
   * One ask per person per subject per cycle, WHATEVER the outcome.
   *
   * The important half is that it covers declines: somebody who said they had
   * not worked with the subject must not be drawn again as their own
   * replacement, which is precisely what an unconstrained random draw would do.
   */
  UNIQUE (review_cycle_id, subject_employee_id, reviewer_employee_id)
);

CREATE INDEX peer_solicitation_subject_idx
  ON peer_review_solicitation (review_cycle_id, subject_employee_id);
CREATE INDEX peer_solicitation_outstanding_idx
  ON peer_review_solicitation (reviewer_employee_id) WHERE state = 'drawn';

COMMENT ON TABLE peer_review_solicitation IS
  'Who was asked to review whom, from which pool, and what they said. The '
  'record of a panel that took nine attempts to assemble, which is what tells '
  'HCM a routing rule is drawing from people who do not work together.';

/*
 * The state machine.
 *
 * A response is final. Letting a decline be reopened would mean a reviewer who
 * said they had no interaction with somebody could be talked into reviewing
 * them anyway, which is the one thing the gate exists to prevent.
 */
CREATE FUNCTION app.peer_solicitation_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;

  IF OLD.state <> 'drawn' THEN
    RAISE EXCEPTION 'A % solicitation cannot change state', OLD.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'declined' AND NEW.decline_reason IS NULL THEN
    RAISE EXCEPTION 'A declined solicitation must record why'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.responded_at := COALESCE(NEW.responded_at, now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER peer_solicitation_state_machine
  BEFORE UPDATE ON peer_review_solicitation
  FOR EACH ROW EXECUTE FUNCTION app.peer_solicitation_transition();

-- ---------------------------------------------------------------------------
-- Drawing
-- ---------------------------------------------------------------------------

/*
 * Draws reviewers for one subject, at random, from the pool their rule defines.
 *
 * Excludes anybody already asked in this cycle, in any state -- see the unique
 * constraint above for why declines must be excluded too.
 *
 * `p_seed` fixes the ordering of a given candidate set, which is what makes a
 * draw reproducible: "show me how this panel was picked" is a fair question
 * from somebody disputing their score. It does NOT make two subjects draw the
 * same people -- each is excluded from their own pool, so their candidate sets
 * differ. Passing NULL is the ordinary random case.
 *
 * Returns the solicitations created, which may be FEWER than asked for when the
 * pool is exhausted. That is not an error and must not be treated as one: a
 * short panel is a fact about the rule, and D4 is where the minimum is enforced.
 */
CREATE FUNCTION app.draw_peer_reviewers(
  p_cycle    UUID,
  p_subject  UUID,
  p_count    SMALLINT DEFAULT NULL,
  p_as_of    DATE DEFAULT CURRENT_DATE,
  p_seed     DOUBLE PRECISION DEFAULT NULL,
  p_replaces UUID DEFAULT NULL
) RETURNS TABLE (solicitation_id UUID, reviewer_employee_id UUID, source_label TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_org   UUID;
  v_rule  UUID;
  v_want  SMALLINT;
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

  -- Default to the rule's minimum: the target is a panel of that size, and
  -- declines are replaced one at a time rather than by over-asking up front.
  SELECT COALESCE(p_count, min_reviewers) INTO v_want
    FROM peer_review_rule WHERE id = v_rule;

  IF p_seed IS NOT NULL THEN
    PERFORM setseed(p_seed);
  END IF;

  RETURN QUERY
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
            peer_review_solicitation.source_label;
END;
$$;

COMMENT ON FUNCTION app.draw_peer_reviewers IS
  'Draws reviewers at random from the pool D2 defines, skipping anyone already '
  'asked in this cycle. May return fewer than asked when the pool is exhausted; '
  'that is a fact about the rule, not an error.';

/*
 * Records a decline and draws one replacement, in a single statement.
 *
 * Their §6.6 is "No, thank them, draw a replacement", and doing the two apart
 * leaves a window in which a panel is quietly one short -- the state nobody
 * notices until the cycle closes.
 */
CREATE FUNCTION app.decline_and_replace(
  p_solicitation UUID,
  p_reason       peer_decline_reason DEFAULT 'no_interaction',
  p_note         TEXT DEFAULT NULL,
  p_as_of        DATE DEFAULT CURRENT_DATE,
  p_seed         DOUBLE PRECISION DEFAULT NULL
) RETURNS TABLE (solicitation_id UUID, reviewer_employee_id UUID, source_label TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_cycle   UUID;
  v_subject UUID;
BEGIN
  UPDATE peer_review_solicitation
     SET state = 'declined', decline_reason = p_reason, note = p_note
   WHERE id = p_solicitation AND state = 'drawn'
  RETURNING review_cycle_id, subject_employee_id INTO v_cycle, v_subject;

  IF v_cycle IS NULL THEN
    RAISE EXCEPTION 'That invitation is not outstanding, or not yours to answer';
  END IF;

  RETURN QUERY
  SELECT * FROM app.draw_peer_reviewers(
    v_cycle, v_subject, 1::SMALLINT, p_as_of, p_seed, p_solicitation);
END;
$$;

/*
 * How a subject's panel stands: asked, accepted, still outstanding, declined.
 *
 * `accepted` against the rule's minimum is the number HCM is actually watching,
 * and `declined` is the number that says whether the rule is any good.
 */
CREATE FUNCTION app.peer_panel_status(p_cycle UUID, p_subject UUID)
RETURNS TABLE (
  asked SMALLINT, accepted SMALLINT, outstanding SMALLINT, declined SMALLINT,
  minimum SMALLINT, maximum SMALLINT
)
LANGUAGE sql STABLE AS $$
  SELECT count(*)::SMALLINT,
         count(*) FILTER (WHERE s.state = 'accepted')::SMALLINT,
         count(*) FILTER (WHERE s.state = 'drawn')::SMALLINT,
         count(*) FILTER (WHERE s.state = 'declined')::SMALLINT,
         MAX(r.min_reviewers)::SMALLINT,
         MAX(r.max_reviewers)::SMALLINT
    FROM peer_review_solicitation s
    LEFT JOIN peer_review_rule r ON r.id = app.peer_review_rule_for(p_subject)
   WHERE s.review_cycle_id = p_cycle AND s.subject_employee_id = p_subject;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- A reviewer sees their own invitations, because they have to answer them.
-- HCM and the subject's line see the panel, because they have to know whether
-- it is complete.
--
-- The SUBJECT deliberately does NOT see their own panel. Knowing who was asked
-- to assess you, before they have written anything, is the part of peer review
-- most likely to change what gets written. Q5 will decide what they may see
-- afterwards; until then the safe answer is the narrow one, because a link
-- disclosed cannot be undisclosed.

ALTER TABLE peer_review_solicitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE peer_review_solicitation FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON peer_review_solicitation TO hr_app;

CREATE POLICY peer_solicitation_select ON peer_review_solicitation FOR SELECT
  USING (
    org_id = app.current_org_id()
    AND (
      reviewer_employee_id = app.current_employee_id()
      OR app.can_access('review', 'approve', subject_employee_id)
    )
  );

CREATE POLICY peer_solicitation_insert ON peer_review_solicitation FOR INSERT
  WITH CHECK (
    org_id = app.current_org_id()
    AND app.can_access('review', 'approve', subject_employee_id)
  );

/*
 * A reviewer may answer their own invitation; HCM may withdraw one. Neither can
 * rewrite an answer -- the state machine sees to that.
 */
CREATE POLICY peer_solicitation_update ON peer_review_solicitation FOR UPDATE
  USING (
    reviewer_employee_id = app.current_employee_id()
    OR app.can_access('review', 'approve', subject_employee_id)
  );

CREATE TRIGGER peer_solicitation_audit
  AFTER INSERT OR UPDATE OR DELETE ON peer_review_solicitation
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
CREATE TRIGGER peer_solicitation_touch
  BEFORE UPDATE ON peer_review_solicitation
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

COMMIT;
