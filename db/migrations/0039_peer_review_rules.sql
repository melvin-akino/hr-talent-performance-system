-- 0039_peer_review_rules.sql
-- D2: who may review whom, as a table (requirements §6.3–6.5).
--
-- Their page 4 is unusually precise about this, and every line of it is data:
--
--   Bookkeeper / Cashier          → CM, FM
--   FS / CI                       → CSS
--   Parts Custodian / Technician  → ASM
--   Branch Head                   → Branch Heads in the same Area, back-office
--                                   Supervisors, AH, DH, GM
--   all other branch staff        → colleagues, BH, AH
--
-- plus rank distance (§6.3: same rank, one up, two up) and main-office variants
-- (§6.5). Written as code, that is a function nobody but us can change. Written
-- as rows, HCM maintains it — which matters because R2 and Q4 are still open and
-- their own routing matrix is still being revised.
--
-- TWO TABLES, BECAUSE ONE SUBJECT DRAWS FROM SEVERAL POOLS.
--
-- "Branch Head" above is one subject with five different sources of reviewer.
-- A single flat table would need five near-duplicate rows per subject and no way
-- to say they belong together, so the subject side is `peer_review_rule` and each
-- pool is a `peer_review_rule_source`.
--
-- WHAT IS NOT HERE.
--
--   * Drawing reviewers, the eligibility question and the re-draw (§6.2, §6.6)
--     are D3. This decides who is ELIGIBLE; D3 decides who is asked.
--   * The minimum and maximum are stored here as configuration, defaulted to
--     3 and 5, because Q4 and R2 disagree (2, 3, and "3–5" across four sources).
--     Whichever way that lands it is an UPDATE.
--   * Anonymity is Q5 and belongs to D5. Nothing here records a response.

BEGIN;

/*
 * How a reviewer's unit must relate to the subject's.
 *
 * Expressed as "share an ancestor of this level" rather than as named units,
 * because that is what their rules actually say -- "Branch Heads from the same
 * Area" is true of any area, and a rule naming one area would need rewriting for
 * every area they open.
 */
CREATE TYPE peer_unit_relation AS ENUM (
  'same_unit',        -- the same org unit row: colleagues on the same branch
  'same_area',
  'same_department',
  'same_division',
  'anywhere'          -- the whole tenant, for GM and DH-level reviewers
);

CREATE TABLE peer_review_rule (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  code    TEXT NOT NULL,
  name    TEXT NOT NULL,
  description TEXT,

  -- --- which employees this rule describes -------------------------------
  -- Every selector is optional and they AND together. All NULL is the catch-all
  -- rule, which is their "all other branch staff" line.
  subject_job_family TEXT,
  subject_rank_id    UUID,
  /*
   * Which kind of unit the subject sits in -- 'branch' for their branch rules,
   * 'section' for the main-office variants of §6.5. Matched against the unit
   * the person is actually in, or any ancestor of it, so somebody filed under a
   * branch still matches a rule written for branches.
   */
  subject_unit_type  org_unit_type,

  /*
   * Scopes the rule to one part of the organisation. NULL is org-wide.
   *
   * This is §6.8: a Department Manager may set target parameters for their own
   * people. A department-scoped rule beats an org-wide one, so a DM can override
   * the default without editing it -- and without being able to change the rules
   * for anybody else's department.
   */
  department_id UUID,

  /*
   * Which rule wins when two could apply. LOWER runs first.
   *
   * The selectors below can easily describe the same person twice -- two rules
   * for R10 in a branch differing only in their sources is a realistic thing for
   * HCM to write while revising the matrix. Without an explicit order the answer
   * falls to whichever code sorts first, which is arbitrary and produces a pool
   * nobody can account for. Left at the default, the specificity ordering in
   * app.peer_review_rule_for() still decides, so this only has to be touched
   * when a genuine tie needs settling.
   */
  priority SMALLINT NOT NULL DEFAULT 100,

  -- --- how many are wanted ------------------------------------------------
  min_reviewers SMALLINT NOT NULL DEFAULT 3,
  max_reviewers SMALLINT NOT NULL DEFAULT 5,

  is_active  BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,

  UNIQUE (org_id, code),
  UNIQUE (id, org_id),

  CONSTRAINT peer_review_rule_rank_same_org
    FOREIGN KEY (subject_rank_id, org_id) REFERENCES job_rank (id, org_id),
  CONSTRAINT peer_review_rule_dept_same_org
    FOREIGN KEY (department_id, org_id) REFERENCES department (id, org_id),

  CONSTRAINT peer_review_rule_counts_sane CHECK (
    min_reviewers >= 1 AND max_reviewers >= min_reviewers
  )
);

COMMENT ON COLUMN peer_review_rule.min_reviewers IS
  'Defaulted to 3 and 5. Q4 and R2 disagree -- page 1 says 2, page 2 says 3, '
  'page 4 says 3 to 5, and the workbook says 2. Settling it is an UPDATE.';

/*
 * One pool a rule draws from. A subject rule has as many as it needs.
 */
CREATE TABLE peer_review_rule_source (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES peer_review_rule(id) ON DELETE CASCADE,

  label   TEXT NOT NULL,

  /*
   * How far above the subject the reviewer sits, in ranks.
   *
   * 0 is a peer, 1 is one rank up, 2 is two up -- the client's own §6.3 wording.
   * NULL means rank does not matter for this pool.
   *
   * The direction is the trap. The client numbers ranks 6 to 11 with a LOWER
   * number MORE senior, so "one rank up" is rank_no - 1. app.ranks_above()
   * (0028) encodes that once, and this column is in its terms, so no reader has
   * to hold the inversion in their head.
   *
   * Negative is allowed and means BELOW the subject: that is subordinate
   * review, which R5 has not settled. Expressible, and used by nothing.
   */
  rank_delta SMALLINT,

  relation   peer_unit_relation NOT NULL DEFAULT 'same_unit',
  /* Restricts the pool to one job family -- "back-office Supervisors". */
  job_family TEXT,
  /* Restricts it to people sitting in a kind of unit -- CSS, ASM, a section. */
  unit_type  org_unit_type,

  sequence   SMALLINT NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,

  CONSTRAINT peer_review_rule_source_rule_same_org
    FOREIGN KEY (rule_id, org_id) REFERENCES peer_review_rule (id, org_id),
  CONSTRAINT peer_review_rule_source_delta_sane
    CHECK (rank_delta IS NULL OR (rank_delta BETWEEN -5 AND 5))
);

CREATE INDEX peer_review_rule_source_rule_idx
  ON peer_review_rule_source (rule_id, sequence);

-- ---------------------------------------------------------------------------
-- Resolving a rule to actual people
-- ---------------------------------------------------------------------------

/*
 * The nearest org unit of a given level at or above one.
 *
 * "Branch Heads from the same Area" needs to know which area a branch belongs
 * to, which is a walk up the tree. Effective-dated like everything else about
 * the chart, so a reorganisation does not rewrite last year's eligibility.
 */
CREATE FUNCTION app.unit_ancestor_of_type(
  p_unit UUID, p_type org_unit_type, p_as_of DATE DEFAULT CURRENT_DATE
) RETURNS UUID
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT d.id, d.parent_department_id, d.unit_type, 1 AS depth
      FROM department d
     WHERE d.id = p_unit
       AND d.effective_from <= p_as_of
       AND (d.effective_to IS NULL OR p_as_of < d.effective_to)
    UNION ALL
    SELECT p.id, p.parent_department_id, p.unit_type, up.depth + 1
      FROM up
      JOIN department p ON p.id = up.parent_department_id
       AND p.effective_from <= p_as_of
       AND (p.effective_to IS NULL OR p_as_of < p.effective_to)
     WHERE up.depth < 32
  )
  SELECT id FROM up WHERE unit_type = p_type ORDER BY depth LIMIT 1;
$$;

COMMENT ON FUNCTION app.unit_ancestor_of_type IS
  'The nearest unit of a given level at or above one. "Same Area" is this, '
  'compared between two people.';

/*
 * Which rule governs a person.
 *
 * Explicit priority first, then most specific, and the ordering says what
 * "specific" means: a rule scoped to their department beats an org-wide one
 * (§6.8, the DM override), then rank, then job family, then unit type. The
 * catch-all -- every selector NULL -- is last, which is their "all other branch
 * staff" line.
 *
 * Priority leads because specificity cannot break every tie. Two rules with the
 * same selectors and different sources are a realistic thing to write, and
 * without an explicit order the winner would be whichever code sorted first.
 */
CREATE FUNCTION app.peer_review_rule_for(
  p_employee UUID, p_as_of DATE DEFAULT CURRENT_DATE
) RETURNS UUID
LANGUAGE sql STABLE AS $$
  WITH subject AS (
    SELECT em.department_id, p.job_family, p.rank_id
      FROM employment em
      LEFT JOIN position p ON p.id = em.position_id
     WHERE em.employee_id = p_employee
       AND em.effective_from <= p_as_of
       AND (em.effective_to IS NULL OR p_as_of < em.effective_to)
     LIMIT 1
  )
  SELECT r.id
    FROM peer_review_rule r, subject s
   WHERE r.is_active
     AND (r.subject_job_family IS NULL OR r.subject_job_family = s.job_family)
     AND (r.subject_rank_id    IS NULL OR r.subject_rank_id = s.rank_id)
     AND (r.subject_unit_type  IS NULL
          OR app.unit_ancestor_of_type(s.department_id, r.subject_unit_type,
                                       p_as_of) IS NOT NULL)
     AND (r.department_id IS NULL
          OR app.department_in_subtree(s.department_id, r.department_id, p_as_of))
   ORDER BY r.priority,
            (r.department_id      IS NOT NULL) DESC,
            (r.subject_rank_id    IS NOT NULL) DESC,
            (r.subject_job_family IS NOT NULL) DESC,
            (r.subject_unit_type  IS NOT NULL) DESC,
            r.code
   LIMIT 1;
$$;

/*
 * Everyone eligible to review a person, and which pool put them there.
 *
 * The subject is never in their own pool. Beyond that this applies only what
 * the rules say -- it does not decide who is ASKED, which is D3, nor whether
 * they have actually worked together, which is the §6.6 question D3 puts to
 * them.
 */
CREATE FUNCTION app.peer_review_pool(
  p_employee UUID, p_as_of DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (employee_id UUID, source_id UUID, source_label TEXT)
LANGUAGE sql STABLE AS $$
  WITH subject AS (
    SELECT em.employee_id, em.department_id, p.job_family, jr.rank_no
      FROM employment em
      LEFT JOIN position p ON p.id = em.position_id
      LEFT JOIN job_rank jr ON jr.id = p.rank_id
     WHERE em.employee_id = p_employee
       AND em.effective_from <= p_as_of
       AND (em.effective_to IS NULL OR p_as_of < em.effective_to)
     LIMIT 1
  ),
  rule AS (SELECT app.peer_review_rule_for(p_employee, p_as_of) AS id)
  SELECT DISTINCT cand.employee_id, src.id, src.label
    FROM peer_review_rule_source src
    JOIN rule ON rule.id = src.rule_id
    CROSS JOIN subject s
    JOIN LATERAL (
      SELECT em.employee_id, em.department_id, p.job_family, jr.rank_no
        FROM employment em
        LEFT JOIN position p ON p.id = em.position_id
        LEFT JOIN job_rank jr ON jr.id = p.rank_id
       WHERE em.effective_from <= p_as_of
         AND (em.effective_to IS NULL OR p_as_of < em.effective_to)
         AND em.employee_id <> s.employee_id
    ) cand ON TRUE
   WHERE
     -- Rank distance, in app.ranks_above()'s terms: how many ranks above the
     -- subject the candidate is. Both must be on the ladder for this to mean
     -- anything, so an unranked person is out of a rank-specific pool.
     (src.rank_delta IS NULL
      OR (s.rank_no IS NOT NULL AND cand.rank_no IS NOT NULL
          AND app.ranks_above(s.rank_no, cand.rank_no) = src.rank_delta))
     AND (src.job_family IS NULL OR src.job_family = cand.job_family)
     AND (src.unit_type IS NULL
          OR app.unit_ancestor_of_type(cand.department_id, src.unit_type,
                                       p_as_of) IS NOT NULL)
     AND CASE src.relation
           WHEN 'anywhere'        THEN TRUE
           WHEN 'same_unit'       THEN cand.department_id = s.department_id
           WHEN 'same_area'       THEN
             app.unit_ancestor_of_type(cand.department_id, 'area', p_as_of)
               IS NOT DISTINCT FROM
             app.unit_ancestor_of_type(s.department_id, 'area', p_as_of)
             AND app.unit_ancestor_of_type(s.department_id, 'area', p_as_of)
               IS NOT NULL
           WHEN 'same_department' THEN
             app.unit_ancestor_of_type(cand.department_id, 'department', p_as_of)
               IS NOT DISTINCT FROM
             app.unit_ancestor_of_type(s.department_id, 'department', p_as_of)
             AND app.unit_ancestor_of_type(s.department_id, 'department', p_as_of)
               IS NOT NULL
           WHEN 'same_division'   THEN
             app.unit_ancestor_of_type(cand.department_id, 'division', p_as_of)
               IS NOT DISTINCT FROM
             app.unit_ancestor_of_type(s.department_id, 'division', p_as_of)
             AND app.unit_ancestor_of_type(s.department_id, 'division', p_as_of)
               IS NOT NULL
         END;
$$;

COMMENT ON FUNCTION app.peer_review_pool IS
  'Everyone eligible to review a person under their rule, with the pool that '
  'admitted them. Eligibility only -- D3 decides who is actually asked.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Readable by everyone in the tenant: a person is entitled to know the rule
-- that decides who assesses them. Writable with `review_cycle:write` -- the
-- grant that already means "sets up how evaluation runs here".

DO $do$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['peer_review_rule','peer_review_rule_source'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (
         app.current_employee_id() IS NOT NULL AND org_id = app.current_org_id())',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (
         org_id = app.current_org_id()
         AND app.can_access(''review_cycle'', ''write'', app.current_employee_id()))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (
         app.can_access(''review_cycle'', ''write'', app.current_employee_id()))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (
         app.can_access(''review_cycle'', ''write'', app.current_employee_id()))',
      t || '_delete', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO hr_app', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.audit_row()', t || '_audit', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $do$;

COMMIT;
