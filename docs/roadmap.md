# Phased Build Plan

Status: PROPOSED (v0.1, 2026-08-13).
Execution model: phases are sequential. Each ends with a STOP for validation and
explicit approval. Do not begin a phase before its predecessor is signed off.
Do not build features from later phases early, even when convenient.

Priority directive from the user: **KPI/goal functionality ships first.**
Phase 0 exists only because KPIs cannot be assigned, scoped, or secured without
identities and a reporting hierarchy. It is kept deliberately thin.

---

## Phase 0 — Foundation (thin slice)

**Goal:** The minimum substrate a KPI can legally and safely hang from.

**In scope**
- Repo, Docker Compose (Postgres, API, web, Keycloak, Caddy), CI
- Schema: `organization`, `employee`, `employment`, `employment_type`,
  `department`, `position`, `reporting_line`
- Employee CSV import (bulk onboarding of existing staff)
- `reports_to(subject, ancestor, as_of)` recursive function
- Keycloak/OIDC login federated to AD; session → `app.current_employee_id`
- `app_role`, `role_assignment`, `access_grant` + RLS scaffolding
- `audit_log` trigger framework
- Backup + **rehearsed restore**

**Explicitly NOT in scope:** any goal, review, competency, or form logic.

**Validation checklist** — verified 2026-08-13, 28/28 tests passing against a
real PostgreSQL 16 via Testcontainers.
- [x] Restore from backup to a clean host succeeds; RTO recorded (**4s**, DB
      layer only — excludes container rebuild and cert/DNS time)
- [x] Transaction-scoped pooling verified — identity cannot bleed across
      requests (`test/rls-identity.spec.ts`, incl. a reproduction of the leak
      `SET LOCAL` prevents)
- [x] `reports_to()` returns correct ancestry for a date in the past after a
      supervisor change (temporal correctness)
- [x] An employee row is unreachable via RLS by an unrelated employee
- [x] Audit rows written on every mutation, by trigger, not app code
- [x] Import is idempotent, all-or-nothing, and rejects reporting cycles
- [ ] Org chart import reconciles against HR's headcount exactly
      — **blocked: needs the real staff CSV**

**Exit criteria:** Real employee data loaded; a manager logs in with an AD
account and sees exactly their own reports and no one else's.

**Status: met against seed data, pending a live AD login.** Verified through
the `hr_app` role with RLS enforced: an engineering manager saw self + 2 direct
reports; a director saw the full subtree including skip-level; an IC saw only
themselves. The Keycloak/AD leg cannot be exercised until the realm exists on
the office server.

**Defects found and fixed during validation** (each would have been silent):
1. `format('%I_audit', t)` emitted `"organization"_audit` — quoting closes
   before the suffix. All audit triggers and the reference-data policy loop
   failed to create. Suffix must be concatenated before `%I` quoting.
2. `ON CONFLICT` cannot target an EXCLUSION constraint, only a unique index.
   The importer's overlap guards were silently wrong; rewritten as `NOT EXISTS`.
3. `position` upsert used `ON CONFLICT DO NOTHING` with no matching unique
   index — every re-import would have duplicated every position.
4. Login and bulk import were denied by their own RLS policies (no identity
   exists at either point). Fixed with one narrow `SECURITY DEFINER` function
   for login and a separate `BYPASSRLS` connection for the CLI.
5. The operator CLI required OIDC config it never uses; an on-prem import would
   have failed on an irrelevant missing variable.

---

## Phase 1 — KPI & Goals core ★ PRIORITY

**Goal:** Assign, approve, track, and monitor KPIs for a live goal period. This
is the ship-first deliverable and should be usable standalone.

**In scope**
- `goal_period` lifecycle (draft → open → locked → closed)
- `kpi_definition` library: CRUD, categories, measure types, versioning
- `goal` instances: from library or free-form; weights; due dates
- `goal_target`: baseline / target / stretch / actual; direction-aware
  `attainment_pct` as a generated column
- Cascading via `parent_goal_id` — department goal → individual goals, with
  a visual of contribution
- Approval workflow: employee drafts → supervisor approves → active
- **`goal_checkin`** — the KPI monitoring trail. Append-only, with
  on_track / at_risk / off_track flags and evidence attachment
- Weight-sum validation, deferred to period lock
- Three dashboards, matching the notes' HR / EE / Manager split:
  - Employee: my goals, my progress, check-in due
  - Manager: team roll-up, at-risk goals, pending approvals
  - HR: org-wide completion rates, unapproved goals, coverage gaps
- RLS policies for `goal`, `goal_target`, `goal_checkin`
- Full audit on all goal state transitions
- CSV/XLSX export of goals and attainment

**Explicitly NOT in scope:** PIP, review forms, competencies, ratings,
compensation linkage, email notifications (Phase 5).

**Validation checklist** — verified 2026-08-13, 33 Phase 1 tests passing
(61 total across the suite) against real PostgreSQL 16.
- [x] `lower_is_better` KPIs compute attainment correctly — cost cut 100→80
      achieved at 80 scores 100%, beaten at 70 scores 150%, missed at 90
      scores 50%. Degenerate denominators return NULL, not an error.
- [x] Weights not summing to 100 block period lock, but do not block drafts
- [x] A manager cannot read a peer's goals; an outsider sees nothing of
      another team — verified against a real DB as the non-superuser app role
- [x] Check-ins are immutable once written
- [x] Deleting a parent goal does not orphan or silently delete children
      (`ON DELETE RESTRICT` — fails loudly)
- [x] A goal referencing KPI definition v1 still renders v1 after v2 publishes
- [x] Period lock freezes the goal SET while check-ins and actuals continue;
      close freezes everything
- [x] Goal state machine rejects invalid transitions, activation without an
      approver, and self-approval
- [x] Cascade cycles rejected; targets and check-ins inherit goal visibility
- [ ] Exit criteria below — **blocked: needs a live department**

**Exit criteria:** One real department runs a full goal-setting and one
monitoring cycle end to end in the system, with no spreadsheet fallback.

**Status: built and verified; awaiting a live pilot.** API boots, all
endpoints require auth, health checks green.

**Critical defect found during validation:** the Phase 1 test pool was
connecting as a **superuser**, because Testcontainers defaults its username to
`test` and the credential swap silently no-opped. Superusers bypass RLS
unconditionally, so every deny-assertion in the file was passing while testing
nothing. Both RLS suites now assert `current_user = hr_app` and
`usesuper = false` before running. Any future security suite must do the same —
a vacuous security test is worse than no test, because it reports safety.

---

## Phase 2 — KPI monitoring depth + PIP

- Scheduled check-in cadences and overdue tracking
- Trend/history view per goal; attainment over time
- `pip_plan` / `pip_milestone` / `pip_review`: initiation, milestones, outcome
- PIP visibility restricted to employee, supervisor, and HR only
- At-risk escalation rules

**Validation checklist** — verified 2026-08-13, 24 Phase 2 tests passing
(85 total) against real PostgreSQL 16.
- [x] Cadence-based overdue detection; never-checked-in goals count from
      creation, so an ignored goal still surfaces
- [x] Per-goal cadence overrides the period default
- [x] `goal_checkin_status` view respects RLS (`security_invoker = true`)
- [x] Escalation: 2+ consecutive bad check-ins; a single one is ignored, a
      recovery resets the streak
- [x] **PIP confidentiality** — subject and direct supervisor can read; a
      SKIP-LEVEL manager cannot, *even though they can see the same person's
      goals*; peers and other departments cannot; HR can
- [x] Milestones and reviews inherit plan confidentiality
- [x] A PIP cannot be activated without milestones, self-initiated,
      self-supervised, or completed without an outcome
- [x] PIP reviews are append-only and require an active plan
- [x] Only the subject can acknowledge their own plan
- [ ] **Exit criteria below — blocked: needs a live PIP**

**Exit:** A PIP runs start to finish with a recorded outcome.

**Status: built and verified; awaiting live use.** API boots, all Phase 2
endpoints require auth, UI shipped.

**Design note worth preserving:** PIP visibility is deliberately NARROWER than
goal visibility. Managers hold `subtree` scope on goals but only
`direct_reports` on PIPs, so a director sees a skip-level report's goals and
not their improvement plan. This asymmetry is intentional and tested — do not
"fix" it for consistency.

---

## Phase 3 — Review cycles + form template engine

The largest single phase. Do not underestimate the form builder.

- `review_cycle` and phases: self → supervisor → calibration → sign-off
- Self-review (explicit requirement in the notes)
- `form_template` / `form_version` with `schema_json`; resolution by
  **employment type AND role**, per the notes
- Form builder UI; publish/version workflow
- Rating scales, versioned
- Pulling Phase 1 goal attainment into the review as scored input
- Sign-off and locking

**Validation checklist** — verified 2026-08-13, 22 Phase 3 tests passing
(107 total) against real PostgreSQL 16.
- [x] **An employee cannot read their supervisor's review before release** —
      the instance and its answers are both invisible
- [x] An employee can always read their own self-review
- [x] Once released, the employee CAN read the supervisor review and summary
- [x] Peers can read neither; HR can read regardless of release
- [x] Answers freeze on submit; there is no quiet un-submit — only an explicit,
      reasoned return
- [x] Ratings are final after sign-off; sign-off implies release
- [x] Published form versions are immutable; a review keeps rendering the
      version it was created against
- [x] One active version per template; assignments cannot double-claim a
      (employment type, role) combination
- [x] Template resolution precedence verified at all four levels:
      type+role > type > role > org default
- [x] Weight-weighted goal attainment feeds the review (70%@100 + 30%@50 = 85%)
- [x] Review-ineligible employment types excluded from generation
- [ ] **Exit criteria below — blocked: needs a live department**

**Exit:** A full review cycle completes for one department, forms versioned.

**Status: built and verified; awaiting a live cycle.** API boots, all Phase 3
endpoints require auth, UI shipped (reviewer inbox, form filler, HR cycle
console with calibration and sign-off).

**Scope note:** the form builder was the risk flagged at planning time. It
shipped as a JSON-schema-backed engine with server-side validation and versioned
publishing, but **there is no drag-and-drop visual builder** — HR composes a
template by posting its schema. That was the timebox call; a visual builder is a
worthwhile Phase 7 addition, not a blocker for running a cycle.

---

## Phase 4 — Competency mapping

- `competency_framework` (versioned), competencies, behavioral levels
- `position_competency_map`: required level per position
- Competency assessment inside the review form
- Gap analysis: required vs assessed

**Validation checklist** — verified 2026-08-14, 21 Phase 4 tests passing
(153 total) against real PostgreSQL 16.
- [x] Published frameworks are immutable — competencies and levels frozen too
- [x] One active framework version per code; active implies published
- [x] Assessments snapshot the framework version
- [x] Required and assessed levels validated against the competencys own scale
- [x] Assessments are append-only; re-assessment adds a row
- [x] **"Never assessed" is distinct from a gap of zero** — the classic
      conflation, and the one that would blame employees for HRs backlog
- [x] Gap uses the LATEST assessment, and respects an as-of date
- [x] Nobody can assess themselves; assessments cannot be misattributed;
      employees cannot assess anyone
- [x] **An assessment made inside a review inherits the release rule** —
      invisible to the subject before sign-off, visible after
- [x] Tenant isolation extended to all five Phase 4 tables
- [x] Job family gap report aggregates across the family

**Exit:** Gap report produced for one job family. **MET** — verified live in
the UI for the Engineering family (3 people mapped, per-competency below /
meeting / not-assessed counts and average level).

**Scope addition:** `position.job_family` had no writer — the CSV format never
carried it, so the family report had no data source. Added `job_family` and
`job_level` as OPTIONAL import columns (existing files still import unchanged)
and populated them in the example CSV.

---

## Phase 5 — Feedback, messaging & notifications

- `feedback_thread` with the three visibility scopes from the notes:
  employee-only, employee+supervisor, supervisor-only
- Continuous feedback, not tied to a cycle
- Notification outbox + versioned email templates
- Digest emails; per-user notification preferences

**Exit:** Notifications deliver reliably through the office SMTP relay; a
supervisor-only thread is provably invisible to the employee.

---

## Phase 6 — IDP, career path & library

- `development_plan` / `dev_action`, linked to competency gaps from Phase 4
- Career path definitions between positions
- `learning_resource` library; per-employee assignment and completion
- The "HR library per employee" from the notes

---

## Phase 7 — Analytics & (conditionally) compensation

- Cross-cycle analytics; distribution, calibration, trend
- Nine-box grid
- **Compensation: build only if the vendor quote (rates due Monday) justifies
  it.** Merit-increase modeling tied to ratings is where performance data starts
  touching money and audit exposure — treat as a separate decision, not an
  automatic continuation.

---

## Sequencing risks

| Risk | Impact | Mitigation |
|---|---|---|
| Permission model treated as Phase 5 polish | Retrofit touches every table and query | RLS built in Phase 0, tested in Phase 1 |
| Form builder scope explosion in Phase 3 | Slips the whole plan | Timebox; ship a fixed-schema review first if needed |
| Versioning added later | Historical reviews silently rewrite themselves | Version columns exist from Phase 1 |
| No email until Phase 5 | Phase 1 pilot has no nudges | Accepted — pilot department is coordinated manually |
| On-prem ops unowned | Data loss with no provider fallback | Named owner + tested restore before Phase 1 ships |
| Payroll scope creep | Regulatory liability | D-002 holds; escalate any request to expand |
