# HR System — Architecture & Data Model

Status: DRAFT (v0.1, 2026-08-13). Not yet approved.
Scope: Performance & Talent Management. Payroll, timekeeping, and statutory
filing are explicitly OUT of scope (see decisions.md, D-002).

---

## 1. Design principles

These are load-bearing. Violating any of them creates rework that is expensive
to unwind after the first live review cycle.

1. **Definitions are versioned; instances snapshot the version.**
   Rating scales, competency frameworks, form templates, and KPI definitions
   all change year over year. A 2026 review must render under the 2026
   definitions forever, even after 2027 redefines them. Every instance row
   carries the `*_version_id` it was authored against. Never mutate a version
   that has been referenced by an instance — supersede it instead.

2. **Authorization is relationship-aware and lives in the database.**
   "Who may see this goal" is a function of the org hierarchy at a point in
   time, not a static role flag. Enforced via Postgres RLS so that no
   application code path can bypass it. Application-layer checks are a UX
   convenience, never the security boundary.

3. **The org hierarchy is temporal.**
   Reporting lines, positions, and departments are effective-dated. A review
   written in March must resolve the supervisor who held the line in March,
   not today's. All hierarchy tables are `(effective_from, effective_to)`.

4. **Soft delete only for employee-facing records.** Performance data is
   evidence. Hard deletes are reserved for pre-submission drafts.

5. **Every state transition is audited.** Append-only `audit_log`, written by
   trigger, not by application code.

---

## 2. Entity map

```
                       ┌──────────────┐
                       │ organization │
                       └──────┬───────┘
                              │
     ┌────────────────────────┼────────────────────────┐
     │                        │                        │
┌────▼─────┐          ┌───────▼────────┐        ┌──────▼──────┐
│ employee │◄─────────┤ employment     │        │ department  │
└────┬─────┘          │ (eff-dated)    ├───────►│ (eff-dated) │
     │                └───────┬────────┘        └─────────────┘
     │                        │
     │                 ┌──────▼──────┐
     │                 │  position   │
     │                 └──────┬──────┘
     │                        │
┌────▼──────────────┐  ┌──────▼──────────────────┐
│ reporting_line    │  │ position_competency_map │
│ (eff-dated edges) │  └─────────────────────────┘
└───────────────────┘

  PHASE 1 CORE ──────────────────────────────────────────────
┌──────────────────┐      ┌──────────────────┐
│ kpi_definition   │      │  goal_period     │
│ (library, v'd)   │      │ (FY/H/Q window)  │
└────────┬─────────┘      └────────┬─────────┘
         │                         │
         └──────────┬──────────────┘
                    │
             ┌──────▼───────┐        ┌──────────────┐
             │    goal      │◄───────┤ goal_checkin │
             │ (instance)   │        └──────────────┘
             └──────┬───────┘
                    │ parent_goal_id (self-ref: cascade)
             ┌──────▼───────┐
             │ goal_target  │  (measure, baseline, target, actual)
             └──────────────┘
```

---

## 3. Core schema (Phase 0 + Phase 1)

Abbreviated DDL. Types shown are Postgres. `id` columns are `uuid` with
`gen_random_uuid()` default. All tables carry
`created_at, created_by, updated_at, updated_by`.

### 3.1 Foundation (Phase 0)

```sql
organization(id, name, code, timezone, fiscal_year_start_month)

employee(
  id, org_id, employee_no UNIQUE, first_name, last_name,
  work_email UNIQUE, personal_email, status, hired_on, separated_on)

employment(                      -- effective-dated employment facts
  id, employee_id, position_id, department_id,
  employment_type_id,            -- drives form template resolution
  employment_status,             -- regular / probationary / project / consultant
  effective_from, effective_to)  -- effective_to NULL = current

employment_type(id, org_id, code, name, is_eligible_for_review)

department(id, org_id, parent_department_id, code, name,
           effective_from, effective_to)

position(id, org_id, title, job_level, job_family, department_id)

reporting_line(                  -- the authorization backbone
  id, employee_id, supervisor_employee_id,
  line_type,                     -- primary | dotted | matrix
  effective_from, effective_to)
```

`reporting_line` is queried through a recursive CTE exposed as a
`SECURITY DEFINER` function `reports_to(subject uuid, ancestor uuid, as_of date)`
so RLS policies stay readable and the recursion is written once.

### 3.2 Authorization (Phase 0)

```sql
app_role(id, org_id, code, name)          -- hr_admin, hr_partner, manager, employee
role_assignment(id, employee_id, role_id, scope_department_id NULL,
                effective_from, effective_to)

access_grant(                              -- what a role may reach
  id, role_id, resource_type,              -- goal | review | pip | feedback | ...
  action,                                  -- read | write | approve
  scope_type,                              -- self | direct_reports | subtree
                                           -- | department | org
  subtree_depth NULL)                      -- NULL = unlimited
```

Rationale for `access_grant` as data rather than code: the notes call for
"viewing access — customizable" and "user level related access". Hard-coding
role checks makes every future access tweak a deploy. This makes it config.

### 3.3 KPI & Goals — the Phase 1 core

```sql
goal_period(
  id, org_id, name,               -- "FY2026", "FY2026-Q3"
  period_type,                    -- annual | semi | quarterly
  starts_on, ends_on,
  state)                          -- draft | open | locked | closed

kpi_definition(                   -- reusable library entry
  id, org_id, code, name, description,
  category,                       -- financial | customer | process | people
  measure_type,                   -- numeric | percentage | currency
                                  -- | ratio | milestone | boolean
  direction,                      -- higher_is_better | lower_is_better
  unit, default_weight,
  version, supersedes_id, is_active)

goal(                             -- an instance assigned to an employee
  id, org_id, goal_period_id,
  employee_id,
  kpi_definition_id NULL,         -- NULL = free-form goal, not from library
  kpi_definition_version INT NULL,-- snapshot; frozen at creation
  parent_goal_id NULL,            -- cascade: dept goal -> individual goal
  title, description,
  weight NUMERIC(5,2),            -- validated to sum to 100 per employee/period
  due_on,
  state,                          -- draft | pending_approval | active
                                  -- | achieved | missed | cancelled
  approved_by, approved_at)

goal_target(                      -- a goal may have >1 measure
  id, goal_id, sequence,
  measure_name, measure_type, unit,
  baseline_value, target_value, stretch_value,
  actual_value, actual_as_of,
  attainment_pct)                 -- GENERATED, direction-aware

goal_checkin(                     -- the KPI monitoring trail
  id, goal_id, checked_in_by,
  reported_value, progress_pct,
  status_flag,                    -- on_track | at_risk | off_track
  comment, evidence_url,
  period_ending, created_at)      -- append-only; never updated
```

**Weight validation** is a deferred constraint at the
`(employee_id, goal_period_id)` level, checked on period lock rather than on
each insert — otherwise a manager cannot ever save a partial goal set.

**`attainment_pct`** is generated, not stored by the app, because
`higher_is_better` vs `lower_is_better` inverts the formula and that logic
must not be duplicated across API, reports, and exports.

### 3.4 Deferred to later phases (shape only)

```sql
-- Phase 2
pip_plan(id, employee_id, initiated_by, reason, starts_on, ends_on,
         state, outcome)
pip_milestone(id, pip_plan_id, description, due_on, met, assessed_by)

-- Phase 3
review_cycle(id, org_id, goal_period_id, name, state)
review_cycle_phase(id, review_cycle_id, phase_type, opens_on, closes_on)
                                 -- self | supervisor | calibration | signoff
review_instance(id, review_cycle_id, subject_employee_id,
                reviewer_employee_id, reviewer_role, form_version_id, state)
form_template(id, org_id, name, applies_to_employment_type_id,
              applies_to_role_id, is_active)
form_version(id, form_template_id, version, schema_json, published_at)
form_response(id, review_instance_id, field_key, value_json)

-- Phase 4
competency_framework(id, org_id, name, version, published_at)
competency(id, framework_id, code, name, category)
competency_level(id, competency_id, level_no, label, behavioral_indicator)
position_competency_map(id, position_id, competency_id, required_level)

-- Phase 5
feedback_thread(id, org_id, subject_employee_id, visibility)
                                 -- ee_only | ee_and_supervisor | supervisor_only
feedback_message(id, thread_id, author_employee_id, body, created_at)

-- Phase 6
development_plan(id, employee_id, goal_period_id, state)
dev_action(id, development_plan_id, description, competency_id NULL,
           target_date, status)
learning_resource(id, org_id, title, resource_type, url, competency_id NULL)
```

---

## 4. Cross-cutting concerns

| Concern | Approach |
|---|---|
| AuthN | OIDC against corporate IdP; no local passwords |
| AuthZ | Postgres RLS, policies derived from `access_grant` + `reports_to()` |
| Audit | Append-only `audit_log`, populated by trigger on all mutable tables |
| Notifications | Outbox table + worker; email templates versioned. Never send from request thread |
| Background work | Durable queue (DB-backed outbox), idempotent handlers, retry with backoff |
| Config | Single typed config module, env-validated at boot; fail fast on missing keys |
| Observability | Structured JSON logs w/ correlation id; metrics on cycle completion rates |
| Migrations | Forward-only, reviewed, reversible-by-compensation |

---

## 5. Open questions

Resolved as of 2026-08-14:

| # | Question | Answer |
|---|---|---|
| Q1 | On-prem or cloud? | **On-prem first, hosted SaaS later** — D-001, D-011 |
| Q2 | Single org or multi-tenant? | **Multi-tenant**, implemented and tested — D-008 |
| Q3 | Source of truth for employee master data? | **This system**, performance-relevant fields only — D-009 |
| Q5 | Does compensation stay with a vendor? | **Deferred** — D-007 |
| Q6 | Remote access for off-site staff? | **VPN into the LAN** — D-013 |
| — | Identity model for the hosted product | **One realm, per-tenant IdPs** — D-012 |

Still open:

| # | Question | Blocks |
|---|---|---|
| Q4 | Real headcount and concurrent users at cycle close | Infra sizing; the two deferred N+1s in D-006 |

| Q7 | Who owns the on-prem server — patching, backups, certificate renewal? | Go-live; see infra.md §4 |
| Q8 | Real staff CSV with reporting lines | Verifying the org chart is clean and cycle-free |
