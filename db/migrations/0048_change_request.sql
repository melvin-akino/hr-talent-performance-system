-- 0048_change_request.sql
-- F4: the request-and-approval flow (requirements §7.9).
--
-- Their sentence is "DH requests an extra competency, a special evaluation, or
-- a scoring adjustment". Today there is no request entity anywhere in the
-- system, so all three happen by message: somebody asks HCM in chat, HCM says
-- yes, and the only record is the change itself with nobody's name on the
-- reason for it.
--
-- WHY THREE TYPES IN ONE TABLE AND NOT THREE TABLES.
--
-- They are one workflow — somebody with a unit asks somebody with authority,
-- and the answer is yes or no with a reason. Three tables would be three state
-- machines, three sets of policies and three notification paths that have to
-- be kept in step, to model a difference that is entirely in WHAT is being
-- asked for. The difference sits in typed columns with a CHECK per type, not
-- in a JSONB payload: a blob would let a scoring adjustment be filed with no
-- score in it, and the first time anybody noticed would be when a report
-- summed a column of nulls.
--
-- APPROVING A REQUEST DOES NOT APPLY IT, DELIBERATELY.
--
-- The obvious next step is to have approval add the competency, open the
-- evaluation, write the new score. It does not, and this is a decision rather
-- than an omission (D-017). A scoring adjustment that lands by side effect of
-- an approval is a changed score with no separate act behind it: the audit
-- trail would show the request, and then a score that moved on its own. The
-- request records WHAT WAS DECIDED and by whom; somebody then makes the change
-- through the screen that owns it, where it is audited as the change it is.
-- The cost is one extra step. The alternative is a system where the sentence
-- "who changed this score" has no answer.
--
-- WHO MAY SEE A REQUEST, WHICH IS THE PART WORTH ARGUING ABOUT.
--
-- Not the subject. A request to adjust somebody's score, or to evaluate them
-- specially, is assessment in motion — the same category as a draft evaluation
-- (0033) and an unreleased review (0014), both of which are invisible to their
-- subject for the same reason: a judgement that is still being formed is not a
-- judgement yet, and showing it produces an argument about a decision nobody
-- has made. What the subject sees is the RESULT, through the screen that owns
-- it, once somebody applies it. That is the point of the paragraph above.

BEGIN;

/*
 * The composite keys this table's foreign keys need.
 *
 * Every cross-table reference here is (id, org_id) rather than (id), which is
 * how 0015 onward stops a row borrowing another tenant's record — a request
 * pointing at somebody else's review cycle would otherwise be a perfectly
 * valid row. department got its composite key in 0032 for the same reason;
 * review_cycle never needed one until now.
 *
 * `competency` is the exception and cannot have one: it carries no org_id at
 * all (0016), because its tenancy runs through competency_framework. So its
 * reference below is a plain FK and the tenancy check is a trigger instead —
 * see app.change_request_tenancy(). Leaving it as a plain FK with no check
 * would have been the quiet kind of hole: valid, enforced, and wrong.
 */
ALTER TABLE review_cycle ADD CONSTRAINT review_cycle_id_org_uq UNIQUE (id, org_id);

CREATE TYPE change_request_type AS ENUM (
  'extra_competency',
  'special_evaluation',
  'scoring_adjustment'
);

/*
 * 'withdrawn' is the requester taking it back, which is distinct from
 * 'declined' — somebody else saying no. Collapsing them would make "how many
 * of my requests were refused" unanswerable, and that number is the one that
 * tells you whether a process is working.
 */
CREATE TYPE change_request_state AS ENUM (
  'draft', 'submitted', 'approved', 'declined', 'withdrawn'
);

CREATE TABLE change_request (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,

  request_type change_request_type NOT NULL,
  state        change_request_state NOT NULL DEFAULT 'draft',

  requested_by UUID NOT NULL,
  /*
   * Who it is about. Nullable because an extra competency can be asked for a
   * whole unit ("my section needs Cash Handling assessed this cycle") as well
   * as for one person; the CHECK below makes it mandatory for the two types
   * that are meaningless without a person.
   */
  subject_employee_id UUID,
  -- The unit it concerns. Always recorded, because "which section asked for
  -- this" is the first question anybody reviewing a year of requests asks.
  department_id UUID,

  -- What period it applies to. Both nullable and at most one is expected: a
  -- scoring adjustment belongs to a review cycle, an extra competency to
  -- whatever is running.
  review_cycle_id UUID,
  goal_period_id  UUID,

  -- extra_competency only.
  competency_id UUID,

  -- scoring_adjustment only. Both sides recorded: "raise it" with no starting
  -- point is not a record of anything, and the current score at the time of
  -- asking is what the approver was actually looking at.
  current_score  NUMERIC(6,2),
  proposed_score NUMERIC(6,2),

  -- Why. NOT NULL on purpose: a request with no reason is a request the
  -- approver has to guess at, and the guess is what gets audited later.
  rationale TEXT NOT NULL,

  submitted_at TIMESTAMPTZ,
  decided_by   UUID,
  decided_at   TIMESTAMPTZ,
  -- Why it was refused, or what the approval was conditional on. Required for
  -- a decline by the trigger below — "no" with no reason produces the same
  -- request again next week.
  decision_note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,

  CONSTRAINT change_request_requester_same_org
    FOREIGN KEY (requested_by, org_id) REFERENCES employee (id, org_id),
  CONSTRAINT change_request_subject_same_org
    FOREIGN KEY (subject_employee_id, org_id) REFERENCES employee (id, org_id),
  CONSTRAINT change_request_department_same_org
    FOREIGN KEY (department_id, org_id) REFERENCES department (id, org_id),
  CONSTRAINT change_request_cycle_same_org
    FOREIGN KEY (review_cycle_id, org_id) REFERENCES review_cycle (id, org_id),
  -- Plain, because competency has no org_id. Tenancy is checked by trigger.
  CONSTRAINT change_request_competency_fk
    FOREIGN KEY (competency_id) REFERENCES competency (id),
  CONSTRAINT change_request_decider_same_org
    FOREIGN KEY (decided_by, org_id) REFERENCES employee (id, org_id),

  CONSTRAINT change_request_rationale_present CHECK (btrim(rationale) <> ''),

  -- Nobody requests anything about themselves. An extra competency for your
  -- own record, a special evaluation of yourself, a lift to your own score:
  -- each is self-dealing, and the constraint is in the database because the
  -- service is one of several ways a row can be written.
  CONSTRAINT change_request_not_about_self
    CHECK (subject_employee_id IS NULL OR subject_employee_id <> requested_by),

  -- Nobody approves their own request either, for the same reason a supervisor
  -- cannot approve their own goal (0008).
  CONSTRAINT change_request_decider_not_requester
    CHECK (decided_by IS NULL OR decided_by <> requested_by),

  -- The type decides which columns mean anything. Stated per type rather than
  -- left to the service: a scoring adjustment with no scores in it is a row
  -- nobody can act on, and it would be discovered by a report, months later.
  CONSTRAINT change_request_shape CHECK (
    CASE request_type
      WHEN 'extra_competency' THEN
        competency_id IS NOT NULL
        AND proposed_score IS NULL AND current_score IS NULL
      WHEN 'special_evaluation' THEN
        subject_employee_id IS NOT NULL
        AND competency_id IS NULL
        AND proposed_score IS NULL AND current_score IS NULL
      WHEN 'scoring_adjustment' THEN
        subject_employee_id IS NOT NULL
        AND proposed_score IS NOT NULL
        AND competency_id IS NULL
    END
  ),

  CONSTRAINT change_request_decision_complete CHECK (
    (decided_by IS NULL) = (decided_at IS NULL)
  ),
  -- A decided request carries its decider; an undecided one does not. This is
  -- what stops a row reaching 'approved' with nobody's name on it.
  CONSTRAINT change_request_decided_states CHECK (
    (state IN ('approved', 'declined')) = (decided_by IS NOT NULL)
  ),
  CONSTRAINT change_request_submitted_complete CHECK (
    (state = 'draft') = (submitted_at IS NULL)
  )
);

CREATE INDEX change_request_open_idx
  ON change_request (org_id, state, created_at DESC)
  WHERE state = 'submitted';
CREATE INDEX change_request_requester_idx
  ON change_request (requested_by, created_at DESC);
CREATE INDEX change_request_subject_idx
  ON change_request (subject_employee_id, created_at DESC);

COMMENT ON TABLE change_request IS
  'A request from somebody with a unit to somebody with authority: an extra '
  'competency, a special evaluation, or a scoring adjustment (§7.9). '
  'Approving a request records a decision; it does not apply the change — see '
  'D-017 and the header of this migration.';

COMMENT ON COLUMN change_request.current_score IS
  'The score at the moment of asking. Recorded because it is what the approver '
  'was looking at, and the live one will have moved by the time anybody reads '
  'this back.';

COMMIT;

BEGIN;

/*
 * The state machine.
 *
 * A trigger rather than service code because a request can be written from the
 * API and the CLI, and a transition rule that only one caller enforces is a
 * rule that holds until the second caller exists.
 */
CREATE FUNCTION app.change_request_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_allowed change_request_state[];
BEGIN
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE OLD.state
    WHEN 'draft'     THEN ARRAY['submitted', 'withdrawn']::change_request_state[]
    -- Back to draft is deliberately absent. Once an approver has been asked,
    -- the request either gets an answer or is withdrawn; silently editing
    -- something somebody is already reading is how two people end up
    -- discussing different requests.
    WHEN 'submitted' THEN ARRAY['approved', 'declined', 'withdrawn']::change_request_state[]
    ELSE ARRAY[]::change_request_state[]   -- decided and withdrawn are terminal
  END;

  IF NOT (NEW.state = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Invalid request transition % -> %', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  /*
   * Withdrawal is the REQUESTER's act, and only theirs.
   *
   * Found by a test. The UPDATE policy lets an approver write a submitted
   * request — it has to, that is how a decision is recorded — and nothing
   * stopped an approver setting the state to 'withdrawn' instead of
   * 'declined'. That is not a refusal anybody has to justify: it leaves no
   * decider, needs no reason, and reads afterwards as though the requester
   * thought better of it. The distinction between "I took it back" and "they
   * said no" is the whole reason the two states exist.
   */
  IF NEW.state = 'withdrawn'
     AND OLD.requested_by IS DISTINCT FROM app.current_employee_id() THEN
    RAISE EXCEPTION 'Only the person who raised a request may withdraw it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- "No" with no reason produces the same request again next week, from
  -- somebody who still does not know what was wrong with it.
  IF NEW.state = 'declined' AND btrim(COALESCE(NEW.decision_note, '')) = '' THEN
    RAISE EXCEPTION 'A declined request must say why'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER change_request_transition
  BEFORE UPDATE ON change_request
  FOR EACH ROW EXECUTE FUNCTION app.change_request_transition();

/*
 * The tenancy check every other reference here gets from a composite key.
 *
 * competency carries no org_id (0016) — it belongs to a framework, and the
 * framework belongs to a tenant. A plain foreign key therefore accepts another
 * organisation's competency: a valid row, enforced by the database, and wrong.
 * RLS would stop the requester READING that competency, which is exactly why
 * this would not have been noticed: the request would simply show a blank
 * name.
 */
CREATE FUNCTION app.change_request_tenancy() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.competency_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM competency c
         JOIN competency_framework f ON f.id = c.framework_id
        WHERE c.id = NEW.competency_id AND f.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'That competency belongs to another organisation'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER change_request_tenancy
  BEFORE INSERT OR UPDATE ON change_request
  FOR EACH ROW EXECUTE FUNCTION app.change_request_tenancy();

COMMIT;

BEGIN;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- Two actions, and they are held by different people on purpose. 'write' is
-- asking; 'approve' is answering. A role that held both at the same scope
-- could ask itself and say yes, which is one gate wearing the costume of two.

CREATE FUNCTION app.seed_change_request_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_hr_admin   UUID;
  v_hr_partner UUID;
  v_dept_head  UUID;
  v_manager    UUID;
BEGIN
  SELECT id INTO v_hr_admin   FROM app_role WHERE org_id = p_org_id AND code = 'hr_admin';
  SELECT id INTO v_hr_partner FROM app_role WHERE org_id = p_org_id AND code = 'hr_partner';
  SELECT id INTO v_dept_head  FROM app_role WHERE org_id = p_org_id AND code = 'dept_head';
  SELECT id INTO v_manager    FROM app_role WHERE org_id = p_org_id AND code = 'manager';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  SELECT p_org_id, r.role_id, 'change_request', r.action, r.scope
    FROM (VALUES
      -- Asking. A Department Head over their section is the case §7.9 names;
      -- a line manager over their subtree is the same act one level down, and
      -- excluding them would push those requests back into chat.
      (v_dept_head,  'write'::grant_action,   'department'::grant_scope),
      (v_manager,    'write'::grant_action,   'subtree'::grant_scope),
      -- Answering.
      (v_hr_admin,   'approve'::grant_action, 'org'::grant_scope),
      (v_hr_partner, 'approve'::grant_action, 'org'::grant_scope),
      -- HR can also raise one, which is how a request originating in HCM gets
      -- recorded rather than done silently. They still cannot decide their own
      -- (change_request_decider_not_requester).
      (v_hr_admin,   'write'::grant_action,   'org'::grant_scope),
      (v_hr_partner, 'write'::grant_action,   'org'::grant_scope),
      -- Reading. Approvers need the list before they can act on it.
      (v_hr_admin,   'read'::grant_action,    'org'::grant_scope),
      (v_hr_partner, 'read'::grant_action,    'org'::grant_scope),
      (v_dept_head,  'read'::grant_action,    'department'::grant_scope),
      (v_manager,    'read'::grant_action,    'subtree'::grant_scope)
    ) AS r(role_id, action, scope)
   WHERE r.role_id IS NOT NULL
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_change_request_grants(r.id);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- THE SUBJECT IS NOT IN THE SELECT POLICY. See the migration header: a request
-- to adjust somebody's score is assessment in motion, the same category as a
-- draft evaluation, and what the subject is entitled to is the RESULT once
-- somebody applies it — not the argument about whether to.
--
-- can_access is target-scoped and needs a target. Where there is no subject
-- (an extra competency asked for a whole unit) the requester is the target,
-- which is correct: the question then is whether you may act on that unit's
-- affairs at all, and the requester is a member of it.

ALTER TABLE change_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_request FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON change_request TO hr_app;
-- No DELETE, for anybody. A request that can be deleted is a decision that can
-- be unmade without trace; 'withdrawn' is the supported way to take one back.

CREATE POLICY change_request_select ON change_request FOR SELECT
  USING (
    org_id = app.current_org_id()
    AND (
      requested_by = app.current_employee_id()
      OR app.can_access('change_request', 'read',
                        COALESCE(subject_employee_id, requested_by))
      OR app.can_access('change_request', 'approve',
                        COALESCE(subject_employee_id, requested_by))
    )
  );

CREATE POLICY change_request_insert ON change_request FOR INSERT
  WITH CHECK (
    org_id = app.current_org_id()
    -- You raise your own requests. A row filed in somebody else's name is a
    -- request nobody actually made, and it would carry their authority.
    AND requested_by = app.current_employee_id()
    AND app.can_access('change_request', 'write',
                       COALESCE(subject_employee_id, requested_by))
  );

/*
 * Two different writes share one policy, and they are separated by state.
 *
 * The requester may edit and withdraw while it is still theirs — USING allows
 * their own row, WITH CHECK keeps it theirs. An approver may act on a
 * submitted one. Without the state test in the requester's branch, somebody
 * could approve their own request by editing the row directly; the CHECK
 * constraint catches the decided_by, but the state would still have moved.
 */
CREATE POLICY change_request_update ON change_request FOR UPDATE
  USING (
    org_id = app.current_org_id()
    AND (
      (requested_by = app.current_employee_id() AND state IN ('draft', 'submitted'))
      OR (state = 'submitted'
          AND app.can_access('change_request', 'approve',
                             COALESCE(subject_employee_id, requested_by)))
    )
  )
  WITH CHECK (
    org_id = app.current_org_id()
    AND (
      requested_by = app.current_employee_id()
      OR app.can_access('change_request', 'approve',
                        COALESCE(subject_employee_id, requested_by))
    )
  );

CREATE TRIGGER change_request_audit
  AFTER INSERT OR UPDATE OR DELETE ON change_request
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
CREATE TRIGGER change_request_touch
  BEFORE UPDATE ON change_request
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

COMMIT;

BEGIN;

-- ---------------------------------------------------------------------------
-- Who to ask
-- ---------------------------------------------------------------------------

/*
 * Everyone who could decide this request.
 *
 * SECURITY DEFINER, and for the reason 0044 and 0046 both had to be: it reads
 * role_assignment joined to access_grant, and access_grant is itself protected
 * (0005). Written inline in a service it returns nobody for every caller who
 * is not hr_admin — which is every caller who would ever call it. That is now
 * three occurrences of the same trap; the shape to recognise is a predicate
 * over the grant tables that answers "no" for somebody you can see the grant
 * for as a superuser.
 *
 * Returns employees, not roles, because the caller wants to notify people.
 */
CREATE FUNCTION app.change_request_approvers(p_request UUID)
RETURNS TABLE (employee_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public AS $$
  SELECT DISTINCT ra.employee_id
    FROM change_request cr
    JOIN role_assignment ra ON ra.org_id = cr.org_id
    JOIN access_grant ag
      ON ag.role_id = ra.role_id AND ag.org_id = cr.org_id
   WHERE cr.id = p_request
     AND ag.resource_type = 'change_request'
     AND ag.action = 'approve'
     AND ra.effective_from <= CURRENT_DATE
     AND (ra.effective_to IS NULL OR CURRENT_DATE < ra.effective_to)
     -- Never the person who asked. They hold the grant in the HR case, and a
     -- notification telling you to approve your own request is the system
     -- suggesting something it will then refuse.
     AND ra.employee_id <> cr.requested_by;
$$;

COMMENT ON FUNCTION app.change_request_approvers IS
  'Who may decide this request, as employees. SECURITY DEFINER because '
  'access_grant is itself protected — the third time that has bitten; see the '
  'note in 0046. Excludes the requester.';

REVOKE ALL ON FUNCTION app.change_request_approvers(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.change_request_approvers(UUID) TO hr_app;

COMMIT;

BEGIN;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.seed_change_request_templates(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_template (
    org_id, code, version, description, subject, body_text, is_active, published_at)
  VALUES
    (p_org_id, 'request.submitted', 1,
     'Somebody with a unit has asked for a decision',
     'Request awaiting your decision: {{requestType}}',
     -- Real newlines inside plain literals, as 0021 and 0037 do. Adjacent
     -- E-literals are a syntax error, and a `\n` inside a plain literal is a
     -- backslash and an n — which is what every recipient would have read.
     '{{requesterName}} has raised a request that needs your decision:

  Type:    {{requestType}}
  About:   {{subjectName}}
  Reason:  {{rationale}}

Open Requests to approve or decline it.

-- This is an automated message.',
     TRUE, now()),

    (p_org_id, 'request.decided', 1,
     'A request was approved or declined',
     'Your request was {{decision}}: {{requestType}}',
     'Your {{requestType}} request about {{subjectName}} was {{decision}} by '
     '{{deciderName}}.

  {{note}}

'
     -- Said in the message because it is the part people get wrong: an
     -- approval is a decision, not the change itself.
     'An approval records the decision. The change still has to be made on '
     'the screen that owns it.

-- This is an automated message.',
     TRUE, now())
  ON CONFLICT (org_id, code, version) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_change_request_templates(r.id);
  END LOOP;
END $do$;

COMMIT;
