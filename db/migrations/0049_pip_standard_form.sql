-- 0049_pip_standard_form.sql
-- F6: the December 2025 Performance Improvement Plan form becomes the standard.
--
-- HCM's revised PIP form carries things the plan did not: a document control
-- number, the evaluation result that triggered it, a target score and a review
-- schedule with scores, three free-text sections beyond the reason and expected
-- outcome, and FOUR signatories instead of one. This adds them. Nothing is
-- removed and no existing plan changes meaning.
--
-- WHAT MAPS WHERE, because the form and the plan do not share vocabulary:
--
--   Area of concern(s)          -> reason            (already there)
--   Expected outcome            -> expected_outcome  (already there)
--   Action/s to be taken, and
--   Timeline (date completed)   -> pip_milestone     (a step and its due date:
--                                  the structured form of those two boxes)
--   Session coach officer and
--   Reporting officer           -> supervisor_id     (see R21: one person, or two?)
--
-- Everything else on the form is new, below.

BEGIN;

CREATE TYPE pip_party AS ENUM (
  'employee', 'reporting_officer', 'department_head', 'hcm_representative'
);

-- Initial and final are the two reviews the form's Review Schedule names, each
-- with a score. 'interim' is every other conversation, as before.
CREATE TYPE pip_review_kind AS ENUM ('interim', 'initial', 'final');

-- ---------------------------------------------------------------------------
-- The plan
-- ---------------------------------------------------------------------------

-- The composite key the acknowledgement table's tenancy foreign key needs.
ALTER TABLE pip_plan ADD CONSTRAINT pip_plan_id_org_uq UNIQUE (id, org_id);

ALTER TABLE pip_plan
  -- Document control. Free text and optional: the form prints a "Series No." and
  -- nothing says how it is numbered, so we do not invent a scheme.
  ADD COLUMN series_no TEXT,
  ADD COLUMN evaluated_on DATE,

  -- Personal evaluation results. TYPED by the officer, as on the paper form, and
  -- not computed — two things are deliberately NOT enforced here:
  --   * that overall = part 1 + part 2. The evaluation form shows an overall
  --     alongside quarterly points, and if overall is an average across quarters
  --     it need not equal the latest quarter's two parts (R18). A constraint
  --     here would reject real data on a guess.
  --   * that these match any evaluation on record. The form's own references
  --     below are text, because our evaluations carry no series number yet.
  ADD COLUMN latest_evaluation_on DATE,
  ADD COLUMN evaluation_part1_score   NUMERIC(6,2),
  ADD COLUMN evaluation_part2_score   NUMERIC(6,2),
  ADD COLUMN evaluation_overall_score NUMERIC(6,2),
  ADD COLUMN pef_reference TEXT,
  ADD COLUMN pip_reference TEXT,
  ADD COLUMN record_of_infractions TEXT,

  -- Improvement goals.
  ADD COLUMN target_score NUMERIC(6,2),
  ADD COLUMN initial_review_on DATE,
  ADD COLUMN final_review_on DATE,

  -- Action plan.
  ADD COLUMN skills_to_improve TEXT,
  ADD COLUMN officer_responsibility TEXT,
  ADD COLUMN additional_remarks TEXT,

  ADD CONSTRAINT pip_series_not_blank
    CHECK (series_no IS NULL OR btrim(series_no) <> ''),
  ADD CONSTRAINT pip_evaluation_scores_in_range CHECK (
    (evaluation_part1_score   IS NULL OR evaluation_part1_score   BETWEEN 0 AND 100)
    AND (evaluation_part2_score   IS NULL OR evaluation_part2_score   BETWEEN 0 AND 100)
    AND (evaluation_overall_score IS NULL OR evaluation_overall_score BETWEEN 0 AND 100)),
  ADD CONSTRAINT pip_target_in_range
    CHECK (target_score IS NULL OR target_score BETWEEN 0 AND 100),
  -- An initial review that falls after the final one is a schedule that cannot
  -- be followed, and it would read like a typo for a month before anyone tried.
  ADD CONSTRAINT pip_review_dates_ordered CHECK (
    initial_review_on IS NULL OR final_review_on IS NULL
    OR initial_review_on <= final_review_on);

-- One series number per organisation, compared without case or padding, so
-- "PIP-001" and "pip-001 " cannot both exist as different documents.
CREATE UNIQUE INDEX pip_plan_series_uq
  ON pip_plan (org_id, lower(btrim(series_no))) WHERE series_no IS NOT NULL;

COMMENT ON COLUMN pip_plan.acknowledged_at IS
  'SUPERSEDED by pip_acknowledgement (0049). Nothing writes it any more, and it '
  'could not be written by the person it was meant for: the update policy '
  'filtered the employee''s own row out, so an employee could never acknowledge '
  'their own plan. Kept so existing rows stay readable; read pip_acknowledgement.';

-- ---------------------------------------------------------------------------
-- The reviews: the form's Review Schedule carries a score for the initial and
-- the final one.
-- ---------------------------------------------------------------------------

ALTER TABLE pip_review
  ADD COLUMN kind  pip_review_kind NOT NULL DEFAULT 'interim',
  ADD COLUMN score NUMERIC(6,2),
  ADD CONSTRAINT pip_review_score_in_range
    CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  -- A scheduled review exists to record a score. An initial review with no
  -- score is the form's box left blank.
  ADD CONSTRAINT pip_review_scheduled_has_score
    CHECK (kind = 'interim' OR score IS NOT NULL);

-- One initial and one final per plan. pip_review is append-only (0011), so a
-- second "final" could never be corrected — better refused outright.
CREATE UNIQUE INDEX pip_review_one_initial_final
  ON pip_review (pip_plan_id, kind) WHERE kind <> 'interim';

COMMIT;

BEGIN;

-- ---------------------------------------------------------------------------
-- Four signatures
-- ---------------------------------------------------------------------------
--
-- The form is signed by the employee, the reporting officer, the department
-- manager or area head, and an HCM representative, and says why: the plan "may
-- be used as a metric in succeeding performance evaluation period", so every
-- clarification must be answered before it is signed.
--
-- A table, not four columns, because each signature is a fact about a person and
-- a moment, and "who signed as what" is the whole point of having four.
--
-- APPEND-ONLY, like pip_review. A signature that can be edited or removed is not
-- evidence of anything.

-- Before RLS is switched on, so the backfill below does not depend on who runs it.
CREATE TABLE pip_acknowledgement (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organization(id),
  pip_plan_id     UUID NOT NULL,
  party           pip_party NOT NULL,
  acknowledged_by UUID NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,

  CONSTRAINT pip_ack_plan_same_org
    FOREIGN KEY (pip_plan_id, org_id) REFERENCES pip_plan (id, org_id),
  CONSTRAINT pip_ack_signer_same_org
    FOREIGN KEY (acknowledged_by, org_id) REFERENCES employee (id, org_id),

  -- One signature per party per plan.
  UNIQUE (pip_plan_id, party)
);

CREATE INDEX pip_ack_plan_idx ON pip_acknowledgement (pip_plan_id);

-- The only signature the old column ever held was the employee's.
INSERT INTO pip_acknowledgement (org_id, pip_plan_id, party, acknowledged_by, acknowledged_at)
SELECT p.org_id, p.id, 'employee', p.employee_id, p.acknowledged_at
  FROM pip_plan p
 WHERE p.acknowledged_at IS NOT NULL;

CREATE RULE pip_ack_no_update AS ON UPDATE TO pip_acknowledgement DO INSTEAD NOTHING;
CREATE RULE pip_ack_no_delete AS ON DELETE TO pip_acknowledgement DO INSTEAD NOTHING;

CREATE TRIGGER pip_acknowledgement_audit
  AFTER INSERT ON pip_acknowledgement
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();

-- ---------------------------------------------------------------------------
-- Who may sign as whom
-- ---------------------------------------------------------------------------
--
-- ONE definition, used by the INSERT policy below and by the screen (to decide
-- which buttons to offer), so the two cannot disagree about who may sign.
--
-- SECURITY INVOKER: it reads pip_plan under the caller's own RLS, so a person
-- who cannot see a plan is offered nothing on it and cannot sign it.
--
--   employee            the person the plan is about.
--   reporting_officer   the plan's supervisor.
--   department_head     holds pip_dh_ack over the employee: department head and
--                       area head, scoped to their unit.
--   hcm_representative  holds pip_hcm_ack over the employee: HR.
--
-- Never as someone else's role on your OWN plan. A department head who is also
-- the subject of a plan cannot sign for the department; the employee party is the
-- only one you may hold about yourself.
--
-- One person MAY sign two parties on someone else's plan, and in HCM that is the
-- ordinary case: the department head and the HCM representative are the same
-- person there. Recording who signed what is the control; forbidding it would
-- make the form unsignable for the very unit it was written by.
--
-- Only while the plan is ACTIVE. A signature attests to the terms as they stood
-- when the plan began; a draft can still change, and a closed plan cannot be
-- signed into retroactively.
CREATE FUNCTION app.pip_signable_parties(p_plan UUID)
RETURNS TABLE (party pip_party)
LANGUAGE sql STABLE AS $$
  SELECT s.party
    FROM pip_plan p
   CROSS JOIN LATERAL (VALUES
     ('employee'::pip_party,
        p.employee_id = app.current_employee_id()),
     ('reporting_officer'::pip_party,
        p.supervisor_id = app.current_employee_id()),
     ('department_head'::pip_party,
        p.employee_id <> app.current_employee_id()
        AND app.can_access('pip_dh_ack', 'approve', p.employee_id)),
     ('hcm_representative'::pip_party,
        p.employee_id <> app.current_employee_id()
        AND app.can_access('pip_hcm_ack', 'approve', p.employee_id))
   ) AS s(party, permitted)
   WHERE p.id = p_plan
     AND p.state = 'active'
     AND s.permitted
     AND NOT EXISTS (SELECT 1 FROM pip_acknowledgement a
                      WHERE a.pip_plan_id = p.id AND a.party = s.party);
$$;

COMMENT ON FUNCTION app.pip_signable_parties(UUID) IS
  'The parties the caller may sign this plan as, right now. The single source '
  'for both the INSERT policy on pip_acknowledgement and the screen.';

GRANT EXECUTE ON FUNCTION app.pip_signable_parties(UUID) TO hr_app;

ALTER TABLE pip_acknowledgement ENABLE ROW LEVEL SECURITY;
ALTER TABLE pip_acknowledgement FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON pip_acknowledgement TO hr_app;

-- A signature is as visible as the plan it is on, and no more.
CREATE POLICY pip_ack_select ON pip_acknowledgement FOR SELECT
  USING (EXISTS (SELECT 1 FROM pip_plan p WHERE p.id = pip_acknowledgement.pip_plan_id));

CREATE POLICY pip_ack_insert ON pip_acknowledgement FOR INSERT
  WITH CHECK (
    org_id = app.current_org_id()
    -- You sign as yourself. A signature entered in somebody else's name is a
    -- signature nobody made.
    AND acknowledged_by = app.current_employee_id()
    AND EXISTS (SELECT 1 FROM app.pip_signable_parties(pip_acknowledgement.pip_plan_id) s
                 WHERE s.party = pip_acknowledgement.party));

-- ---------------------------------------------------------------------------
-- The grants that make department_head and hcm_representative real
-- ---------------------------------------------------------------------------
--
-- Two distinct resources rather than 'pip' + 'approve', for the reason 0037 gave
-- for goal_target: if both parties rode one action, anybody holding it could sign
-- as either, and a department head could sign as HCM.
--
-- Reading is NOT added here. dept_head, area_head and gm already read PIPs in
-- their unit (0030), which is what makes it possible for them to sign one.

CREATE FUNCTION app.seed_pip_signature_grants(p_org_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_dept_head  UUID;
  v_area_head  UUID;
  v_hr_admin   UUID;
  v_hr_partner UUID;
BEGIN
  SELECT id INTO v_dept_head  FROM app_role WHERE org_id = p_org_id AND code = 'dept_head';
  SELECT id INTO v_area_head  FROM app_role WHERE org_id = p_org_id AND code = 'area_head';
  SELECT id INTO v_hr_admin   FROM app_role WHERE org_id = p_org_id AND code = 'hr_admin';
  SELECT id INTO v_hr_partner FROM app_role WHERE org_id = p_org_id AND code = 'hr_partner';

  INSERT INTO access_grant (org_id, role_id, resource_type, action, scope_type)
  SELECT p_org_id, g.role_id, g.resource, 'approve'::grant_action, g.scope::grant_scope
    FROM (VALUES
      -- "Department Manager / Area Head" on the form: their own unit.
      (v_dept_head,  'pip_dh_ack',  'department'),
      (v_area_head,  'pip_dh_ack',  'department'),
      -- "HCM Representative". Mirrors how far each HR role already reads a PIP
      -- (0011): the administrator org-wide, the partner within their department.
      (v_hr_admin,   'pip_hcm_ack', 'org'),
      (v_hr_partner, 'pip_hcm_ack', 'department')
    ) AS g(role_id, resource, scope)
   WHERE g.role_id IS NOT NULL
  ON CONFLICT (role_id, resource_type, action, scope_type) DO NOTHING;
END;
$$;

DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organization LOOP
    PERFORM app.seed_pip_signature_grants(r.id);
  END LOOP;
END $do$;

COMMIT;
