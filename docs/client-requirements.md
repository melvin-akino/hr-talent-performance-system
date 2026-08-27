# Client requirements — cross-match and gap plan

**Sources:**

1. Client requirements received 2026-08-20 (5 pages: performance management
   types, KPI scoring, general features, user access, peer-review rules,
   promotion programmes, upload fields). Referred to below as **the 5-pager**.
2. `20260819 hcm kpi only.xlsx` — five sheets: `HCM TO`, `nomenclature`,
   `20260616`, `hcm kpi`, `timeline`. Referred to below as **the workbook**. It
   is the HCM department's own KPI system worked out in detail, and it supersedes
   the 5-pager wherever the two disagree (see §0).

**Purpose:** the working tracker for closing the distance between what this system
does today and what the client described. Every requirement below carries a
status, the evidence for that status, and the specific gap. Update the status as
work lands; the phase checklists in §10 are the progress view.

**Status legend**

| | Meaning |
|---|---|
| **Have** | Works today; configuration at most |
| **Partial** | The mechanism exists but does not meet the requirement as written |
| **Missing** | Nothing in the system does this |
| **Blocked** | Cannot be built until a question in §9 is answered or a decision is made |

---

## 0. Update from the workbook (2026-08-19)

The workbook is a working document, not a summary: it contains the HCM
department's actual scorecards, staff names, targets and routing rules. It is
more concrete than the 5-pager and disagrees with it in three places. Where they
conflict, assume the workbook is current and confirm.

### What it settles

| Was | Now known |
|---|---|
| Q3 — "score conversion" unreproducible | The weights **1 / 1.5 / 2 are the nature of the task**: Administrative 1, Field 1.5, Technical 2. Conversion is a banded lookup on the quarterly tally: 71–80 → 10, 81–90 → 20, 91–100 → 30, 100 up → 35. |
| Peer selection rules, sketchy | Tier matrix per section (`HCM TO` rows 34–50): Tier 1 immediate supervisor, Tiers 2–3 peers, Tiers 4–5 client. Plus "Superior (up to 2 ranks above)". |
| "What if too few reviewers respond?" | Notify **HCM C&B** — "for insufficient evaluation data gathered". |
| Ranks as free text | Ranks are **numbered 6–11**. Rank 6 Dept Manager, 7 Asst Dept Manager, 10 Jr Supervisor, 11 Team Leader / Associate. An ordered ladder already exists in their world. |
| Cadence unclear | Monthly task scores → quarterly tally (M1+M2+M3) → **PIP coaching at end of Q1** → two quarters averaged = the 40%. Whole evaluation runs **every 6 months**. |

### What it changes

- **The org taxonomy is six levels, not four.** `nomenclature` gives
  Holdings → Group → Division → Departments/Area → Branch/Brands → **Region**,
  with real values (AnyAuto, Motorcycle, Mobile Phone, Los Pedritos, TMHTC Hotel,
  Excelsior Land, Shared Services) and coded areas `R1-A`…`R7-A`, `MP1`–`MP5`
  carrying province coverage. Region reads as a cross-cutting attribute rather
  than a parent of branch. §5.3 was written against the 5-pager and is too
  shallow.
- **The 40 points are composed differently.** The 5-pager says 40 = performance
  from the competency library. The workbook says 40 = **30 task indicators + 10
  manager's assessment**, and names the three dimensions Commitment (30,
  attendance) / Competency (40) / Character (30, peer).
- **Peer review is 360.** The `20260616` sheet routes to "peer, subordinate,
  superior", and `HCM TO` T47 notes evaluating "the possibility of allowing
  his/her subordinates to perform the evaluation". The 5-pager described peers
  only.
- **Peer count is now 2** ("2 colleagues will be required for averaging"),
  against 3 on page 2 and 3–5 on page 4 of the 5-pager. Three figures now.

### The arithmetic, and where it breaks

The band table runs 71–100 while scorecards total 25–37 points. Those reconcile
if the band is applied to the **quarterly tally**, which the sheet states: a
33-point scorecard × 3 months ≈ 99 → band 91–100 → 30 points. That is why targets
cluster near 33 and why "100 up" exists at all.

It does not hold across the fifteen scorecards:

| Scorecard | Target | × 3 months | Band | Score |
|---|---|---|---|---|
| Onboarding 1 | 37 | 111 | 100 up | 35 |
| Screening | 33 | 99 | 91–100 | 30 |
| **Onboarding 2** | **25** | **75** | 71–80 | **10** |
| **Area Coordinator** | **81.5** | **244.5** | off the table | — |

Identical performance against one's own target earns 35, 30 or 10 depending only
on how the scorecard was drawn, and the Area Coordinators fall off the scale.
Either the raw total is **normalised against each role's target** before the band
lookup, or the scorecards need rebalancing to ~33. **Everything numeric in Type V
depends on which** — it is the first question in the round-2 list.

### Directly importable

The workbook is not just specification; it is data we can load:

| Asset | Sheet | Becomes |
|---|---|---|
| Org taxonomy with real units, areas, regions | `nomenclature` | The A1 org-unit tree — real values instead of a guess |
| Rank ladder 6–11 | `HCM TO` | A2, with the client's own numbering |
| Task-indicator library — ~57 indicators, 3 natures | `hcm kpi` rows 26–57 | The indicator catalogue behind scoring |
| 15 role scorecards with points and written acceptance criteria | `hcm kpi` rows 61–481 | Role templates; the criteria are the evidence standard |
| Tier 1–5 routing matrix | `HCM TO` rows 34–50 | The D2 peer-routing rules for the pilot |
| Section / team structure, 27 staff | `HCM TO` | The pilot tenant's org chart |

**Recommendation: make HCM the pilot.** The workbook is a near-complete
specification for one department, with named people and real targets. Build for
it, prove it against their own numbers, then generalise — materially lower risk
than building the abstract system and discovering the mismatch at rollout.

### Timeline

`timeline` runs March–July in weeks: Concept Mapping (Mar W2) → Dissem 1
(Mar W2–3) → Info Collation 1 (Mar W3–4) → Initial Drafts (Apr W1) → Program
Prep 1 (Apr W3–May W2), with Dissem 2 and Info Collation 2 in parallel (Mar
W3–Apr W2). **Testing & Devt, Initial Run and Program Prep 2 carry no bars**, so
the back half is undated, and the sheet names no year.

---

## 1. The short version

The client is not describing a variant of what we built. They are describing **two
scoring systems we do not have**, **a peer-review engine we do not have**, and **an
organisational structure we model only one level of** — on a foundation that
does fit: RLS, effective-dated org chart, versioned forms, notifications,
competencies, PIP, help.

Four things dominate the work:

1. **Point-weighted scoring.** Every evaluation in the client's world produces a
   number out of 100, computed from weighted line items. Our forms collect answers
   and take an overall rating as a *typed-in* number. Nothing computes a score.
   This is the largest gap, and most other items depend on it.
2. **Peer review by randomised sampling.** Drawn from rules that depend on rank
   distance and org unit, with an eligibility question and an automatic re-draw on
   decline. Our feedback feature is named, voluntary and unsampled — a different
   thing that happens to share a word.
3. **A six-level org taxonomy** (§0): Holdings, Group, Division, Departments/Area,
   Branch/Brands, Region. Peer-review routing, branch ranking and Area Head
   scoping all depend on it. We have a single `department` tree with no notion of
   what level a node sits at.
4. **Attendance from payroll.** 30 of the 100 KPI points come from tardiness and
   absence data owned by the payroll system. This touches D-002 and D-014 and
   needs an explicit decision before anything is built (§5.4).

**Arithmetic check.** The client's point tables are internally consistent, which
suggests they are settled and should be implemented exactly as written:

- Default template, Technical/Ops/Field: Part 1 `10+15+15+10+20 = 70`,
  Part 2 `10+5+5+10 = 30` → **100**
- Default template, Admin: Part 1 `10+10+10+10+20 = 60`,
  Part 2 `10+10+10+10 = 40` → **100**
- Peer review: `5+5+5+10+5 = 30`, matching the 30-point peer component of the KPI
  model exactly

Note these are **two different scoring models**, not one. Types I–III use the
100-point default template; Type V (KPI) uses 40 performance + 30 attendance + 30
peer review. Both must exist side by side.

---

## 2. Evaluation types

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 2.1 | **Type I — Probationary**, 3rd & 4th month, averaged | **Missing** | `review_cycle` has no type and no employee-relative trigger. Needs per-person cycles derived from `employee.hired_on`, plus averaging of two instances into one result. |
| 2.2 | **Type II — Annual**, drives year-end bonuses and branch ranking | **Partial** | Annual cycles exist (`review_cycle` + phases). Bonus qualification bands are missing, and branch does not exist (§5.3). |
| 2.3 | **Type III — Semi-annual**, midyear + year-end averaged, drives rank promotions | **Missing** | Same averaging machinery as 2.1; promotion linkage in §8. |
| 2.4 | **Type IV — Project / term based** (special, behavioural, corrective, promotion) | **Missing** | Ad-hoc evaluation of a named subset, outside the calendar. Generation today is org-wide by employment type. |
| 2.5 | **Type V — KPI**, settable quarterly / semi-annual / annual | **Partial** | Goals + KPIs with weighted attainment exist; the 40/30/30 composite does not (§3.4). |
| 2.6 | Type selectable by HCM per employee or group | **Missing** | No type field, no per-employee assignment. |

**Design note.** Types I–V are not five features. They are one *evaluation
definition* — type, scoring model, period basis (calendar or employee-relative),
participants, averaging rule — with five configurations. Building five separate
flows is the mistake to avoid.

---

## 3. Scoring

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 3.1 | Form fields carry **point values** (Mastery 10, Efficiency 15, …) | **Missing** | `formField` in `apps/api/src/reviews/forms.service.ts` is `key, label, type, required, helpText, options, maxLength` — no points, no weight. |
| 3.2 | Score computed as Σ (rating ÷ scale max × field points) | **Missing** | `review_instance.overall_rating` is supplied by the reviewer, not calculated. |
| 3.3 | Different point maps per classification (Admin vs Technical/Ops/Field) | **Partial** | `form_template_assignment` targets `employment_type_id` and `app_role_id`; classification is neither. |
| 3.4 | **KPI composite**: 30 Commitment (attendance) + 40 Competency (30 task + 10 manager) + 30 Character (peer) = 100, every 6 months | **Missing** | Composition per §0, which supersedes the 5-pager’s “40 from the competency library”. No composite entity; the three inputs live in three places and one does not exist. |
| 3.5 | Task scoring: nature multiplier (Admin 1 / Field 1.5 / Technical 2) × accomplishment | **Missing** | Resolved by §0: the multiplier is the **nature of the task**, not an arbitrary weight. Needs a task-indicator catalogue with a nature, and per-role scorecards — both importable from the workbook. |
| 3.6 | Conversion of task points to the KPI score | **Partial** | §0 gives the banded lookup (71–80 → 10, 81–90 → 20, 91–100 → 30, 100 up → 35) applied to the quarterly tally. Still blocked on whether the tally is **normalised against each role’s target** — see R1. |
| 3.7 | Incentive bands (<70 nil, 71–80 → 20%, 81–90 → …, 91–100 → 50%) | **Blocked** | Two defects in the source: nothing covers exactly **70**, and the 81–90 row reads "80% or 30%" — Q1, Q2. |
| 3.8 | Only HCM DM & CB PW may set/reset scoring parameters | **Missing** | Roles today are `employee`, `manager`, `hr_partner`, `hr_admin`. This is narrower than `hr_admin` and needs its own capability. |

---

## 4. The evaluation workflow (client Steps 1–6)

| # | Step | Status | Evidence / gap |
|---|---|---|---|
| 4.1 | HCM notifies DH that an employee needs a KPI set | **Partial** | Outbox and templates exist (9 today); this event does not. |
| 4.2 | Supervisor/DH selects performance items from the competency library with weights | **Partial** | Library exists and is versioned; per-evaluation weight selection does not. |
| 4.3 | HCM sets timeline, approves targets, revises | **Partial** | Periods and cycles carry timelines; approval of *targets* by HCM does not exist — goals are approved by the supervisor. |
| 4.4 | System notifies evaluators on the timeline | **Have** | `notification_outbox` with durable retry; `review.assigned`. |
| 4.5a | Supervisor fills evaluation and recommendation | **Have** | `review_instance` with `reviewer_role='supervisor'`; recommendation is a textarea field. |
| 4.5b | DH revises / approves / disapproves | **Missing** | Our chain is self → supervisor → calibration → sign-off. No DH step; `reviewer_role` has no `dept_head`. |
| 4.5c | HCM supplies attendance figures | **Blocked** | §5.4. |
| 4.6 | HCM & DH set the peer-review population | **Missing** | §6. |
| 4.7 | System shows the result split 40 / 30 / 30 | **Missing** | Follows from 3.4. |

---

## 5. Organisation, people and data

### 5.1 Employee fields

| Field (client) | Status | Notes |
|---|---|---|
| Name (Last, First, Middle) | **Have** | `employee.first_name / middle_name / last_name` |
| Job Title | **Have** | `position.title` |
| **Rank** — numbered **6–11** in the workbook (6 Dept Manager, 7 Asst Dept Manager, 10 Jr Supervisor, 11 Team Leader / Associate); named in the 5-pager (Associate, Branch Head/OIC, Jr/Sr Supervisor, Dept Head, GM) | **Missing** | `position.job_level` is free text. Peer review needs the **ordered** ladder to express "1 rank up, 2 ranks up". The client already numbers ranks, so adopt their numbering rather than inventing one — confirm how the two schemes line up (R4). |
| Status (Probationary, Regular) | **Have** | `employment_type` |
| **Division** (MC, MP, Admin, Hosp-LP, Hosp-Hotel, AnyAuto, ES) | **Missing** | §5.3 |
| Department | **Have** | `department` |
| **Area** | **Missing** | §5.3 |
| Date hired | **Have** | `employee.hired_on` |
| **Date regularised** | **Partial** | Derivable from `employment.effective_from` + `change_reason`, but not first-class. Probationary timing depends on it. |
| **Date promoted** | **Partial** | Same — derivable, needs surfacing. |
| Evaluation records (period, date, evaluator, type, result, recommendation) | **Partial** | All present per cycle; no consolidated per-employee history (§7.1). |
| ~~Employee type~~ | — | Struck out by the client. We keep `employment_type` for review eligibility, which is a different use. |

### 5.2 User levels

Client: **HCM**, **DH**, **Supervisor**, **RH/AH**, plus **GM** and the restricted
**HCM DM / CB PW**. We have four roles — `employee`, `manager`, `hr_partner`,
`hr_admin` — where `manager` is derived from the reporting line rather than granted.

**Status: Partial.** The grant machinery is right: `access_grant` supports `self`,
`subtree` (optionally depth-limited), `department` subtree, and org-wide. What is
missing is the role set, and for AH/RH a scope anchored to an **Area**.

### 5.3 Holdings → Group → Division → Departments/Area → Branch/Brands (+ Region)

**Status: Missing — and structural.**

> Revised by §0. The 5-pager implied four levels; the workbook's `nomenclature`
> sheet gives **six**, with real values, and Region behaving as a cross-cutting
> attribute rather than a parent of branch. Sizing below is unchanged — it is the
> same `unit_type` change — but the enum and the import mapping are larger.

The good news: `department` is already a self-referencing, effective-dated tree,
and `access_grant` scoping is **subtree-aware** (`db/migrations/0002_authorization.sql`).
So the four levels can be one tree, and Area Head scoping then works with no new
authorization code.

What is missing is a **level label** per node (`division` / `department` / `area` /
`branch`). Without it, peer-review parameters ("Branch Heads from the same Area",
"Dept Head of CSS") cannot be expressed, branch ranking has nothing to group by,
and the UI cannot name a node correctly.

**Recommended:** add `unit_type` to `department`, with a constraint that a node
sits below its parent's level; rename the concept to "org unit" in the UI; keep
the table name. Small migration, large payoff, and it does not disturb the RLS
predicate.

### 5.4 Attendance from payroll — decision required

**Status: Blocked.**

30 of the 100 KPI points are "15 No tardiness, 15 No absences", sourced from the
payroll system. Today [D-002](decisions.md) puts timekeeping out of scope and
[D-014](decisions.md) makes "no payroll" permanent — but D-014 also states that
*an export/integration surface for payroll systems becomes a real requirement, and
should be designed as a first-class boundary*. This requirement is that boundary,
pointing inward.

The distinction that keeps the architecture intact:

- **Accept**: a per-employee, per-period **aggregate** — absence count, tardiness
  count, or a pre-computed 0–15 score.
- **Refuse**: raw time records, biometric logs, leave balances — anything that
  makes this a timekeeping system by accretion.

This needs a new ADR (proposed **D-015**) before implementation, because it
modifies the boundary D-002 drew. `test/ph201.spec.ts` must keep passing
unchanged: an aggregate carries no forbidden field, so it should.

---

## 6. Peer review

**Status: Missing.** A new subsystem, not an extension of feedback.

> Revised by §0: this is **360**, not peer-only — the workbook routes to peer,
> **subordinate** and **superior** (up to 2 ranks above), and supplies a Tier 1–5
> routing matrix for HCM that is directly importable as the rules table.

| # | Requirement | Notes |
|---|---|---|
| 6.1 | 30 points: Mastery 5, Demeanor A (phone/messaging) 5, Demeanor B (in person) 5, Customer Service 10, Promptness 5 | A fixed instrument; straightforward once §3 exists. |
| 6.2 | Reviewers drawn **randomly** from a parameter set | New: a sampling engine with an audit trail of who was drawn and why. |
| 6.3 | Rank distance: same rank, 1 up, 2 up | Depends on the ordered rank ladder (§5.1). |
| 6.4 | Rules by job family and unit — Bookkeeper/Cashier → CM, FM; FS/CI → CSS; Parts Custodian/Technician → ASM; Branch Head → same-Area Branch Heads, back-office Supervisors, AH, DH, GM; all other branch staff → colleagues, BH, AH | A rules table, not code. Depends on §5.3. |
| 6.5 | Main-office variants (Associate; Jr/Sr Supervisor) | Same table. |
| 6.6 | Eligibility gate: *"Have you had any direct/indirect interaction with X in the last 6 months?"* — No ⇒ thank them, draw a replacement | Needs a solicitation state machine: drawn → accepted → declined → replaced. |
| 6.7 | Minimum 3, maximum 5, averaged | **Conflicts with page 1's "min. 2 personnel"** — Q4. |
| 6.8 | Department Manager may specify target parameters, included in randomisation | An override on the rules table. |
| 6.9 | Anonymity | **Not stated in the requirements.** Averaging implies it, but it must be explicit — it shapes the data model and what HR can see. Q5. |

---

## 7. Reporting, history, dashboards, messaging

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 7.1 | Employee history: evaluation results and actions taken | **Partial** | Data exists across `review_summary`, `pip_plan`, `competency_assessment`, `goal`; no single per-employee timeline. |
| 7.2 | Reports by name / eval type / period / PIP results | **Partial** | Analytics endpoints exist (distribution, nine-box, rater comparison, calibration movement, progress, trend) plus CSV export. No filtered report builder; "by eval type" needs types first. |
| 7.3 | Dashboards per user level (HCM, DH, Supervisor, RH/AH) | **Partial** | HR console, Team and Monitoring cover the HCM and Supervisor shapes. DH and AH/RH do not exist. |
| 7.4 | Form creation **plus** prepared formats by employee type | **Have** | Versioned `form_template` / `form_version` with assignment; the §3 defaults become seeded prepared formats. |
| 7.5 | Defaults shown automatically, manual override by evaluator level | **Partial** | Resolution exists (`app.resolve_form_version`); the override path and its permission do not. |
| 7.6 | System walkthrough guide | **Have** | In-app help: 14 bundled articles, route- and role-aware, plus HR-authored content from Setup. |
| 7.7 | Integrates PIP and goal/target setting | **Have** | Both exist, linked to periods and cycles. |
| 7.8 | Messaging: reminders, acknowledgement, results, eval notifications | **Partial** | Durable outbox with retry, 9 templates, in-app + email, per-user preferences. Needs the new events. |
| 7.9 | Requests: DH asks for extra competency / special eval / scoring adjustment | **Missing** | No request-and-approval entity anywhere in the system. |

---

## 8. Promotion programmes

**Status: Missing.** Both are stage machines with dwell times.

| Programme | Stages |
|---|---|
| **MDP (Branch)** | Training scores & feedback → Branch immersion → Deployment: Rank & File → OIC (4–6 months), OIC → Branch Head (4–5 months) |
| **Back Office** | Evaluation history → Department training (1–3 months) → Deployment: RF → Jr Supervisor / Team Leader (1–3 months), TL / Jr Sup → Supervisor (4–6 months) |

Closest existing machinery: `career_path` (from/to position, `typical_months`) and
`development_plan` with actions. Those model an *aspiration*. This needs an
*enrolment*: stage, entry date, dwell-time tracking, exit criteria tied to
evaluation results.

---

## 9. Questions for the client — these block work

| # | Question | Blocks |
|---|---|---|
| **Q1** | The bands leave **exactly 70** uncovered ("Below 70 → not qualified", then "71–80"). Is 70 not qualified, or the bottom of the 20% band? | 3.7 |
| **Q2** | The 81–90 band reads **"80% or 30%"**. Given 71–80 → 20% and 91–100 → 50%, we read it as **30%** — please confirm. | 3.7 |
| ~~**Q3**~~ | **Largely answered by the workbook** (§0): the 1 / 1.5 / 2 are task natures, and the conversion is a banded lookup on the quarterly tally. What remains is whether the tally is normalised against each role’s target — reissued as **R1**. | 3.5, 3.6 |
| **Q4** | Peer-review minimum, now **three** conflicting figures: 5-pager p1 "min. 2", p2 "min 3", p4 "min 3, max 5" — and the workbook says **2 pax**. Reissued as **R2**. | 6.7 |
| **Q5** | Are peer reviews **anonymous** — to the subject, to their supervisor, to HCM? This shapes the data model and cannot be retrofitted quietly. | 6.9 |
| **Q6** | Confirm the exact roles and holders: **HCM DM**, **CB PW**, **RH vs AH**, **GM**. Which are individuals, which are groups? *Partly answered:* the workbook’s `HCM TO` names post-holders and numbers ranks 6–11. | 3.8, 5.2 |
| **Q7** | Probationary evaluations at the 3rd and 4th month — measured from **date hired**? What happens if regularisation moves? | 2.1 |
| **Q8** | Attendance feed: which payroll system, what can it export, at what grain (counts per period, or a pre-computed score)? | 5.4 |
| **Q9** | Branch ranking for annual bonuses — ranked on what? Average score of branch staff, or a branch-level scorecard? | 2.2 |
| **Q10** | Does Type IV (project/term) use the 100-point default template, or its own instrument? | 2.4 |
| **R1** | **Is the quarterly task tally normalised against each role’s own target before the band lookup?** As drawn, identical performance scores 35, 30 or 10 depending only on how the scorecard was written, and Area Coordinators (81.5 × 3) fall off the table entirely. | 3.6, all of Type V |
| **R2** | Peer/360 count — the workbook says 2, the 5-pager says 3 and 3–5. Which governs, and does it differ by population (HCM vs branch)? | 6.7 |
| **R3** | Which composition of the 40 governs: the 5-pager’s competency library, or the workbook’s 30 task indicators + 10 manager’s assessment? | 3.4 |
| **R4** | How do the numbered ranks (6–11) map to the named ranks (Associate … GM), and do the numbers run group-wide or per division? | 5.1, 6.3 |
| **R5** | Is **subordinate** evaluation in scope, or still under consideration? (`HCM TO` T47 reads as an open idea; `20260616` routes to it as settled.) | 6 |
| **R6** | Task natures are **A / F / T** in the workbook but Admin / Technical / **Ops** / Field in the 5-pager. Is Ops missing, merged, or dropped? | 3.5 |
| **R7** | "Selection of Subject … by **salary level**" — a pay grade, or an amount? We store no salary (D-009). | 5.4, D-009 |
| **R8** | The band table starts at 71 and stops at "100 up". What happens at **70 and below**, and does "100 up → 35" push a total past 100? | 3.6, 3.7 |
| **R9** | Timeline: which **year**, and what are the dates for Testing & Devt, Initial Run and Program Prep 2 (no bars drawn)? | planning |

---

## 10. Plan

Sequenced by dependency, not by value — several later phases are cheap only
because earlier ones did the structural work. Sizes are relative (S/M/L), not
calendar commitments.

### Phase A — Foundations *(nothing else works without these)*

- [x] **A1** Org unit levels — DONE. Migration 0027 adds `unit_type`
      (holdings/group/division/department/section/area/branch) with a trigger that
      rejects inversion while permitting the nesting real data already has; API
      and Setup expose it. **Region is not a level** — see §0 and R4. Importer
      mapping is the remaining piece, tracked as A1b.
- [ ] **A1b** Map Division/Area/Branch columns in the 201 importer, so a real
      staff file lands with levels already set. **S**
- [x] **A2** Rank ladder — DONE. Migration 0028 adds `job_rank` (org-scoped,
      RLS, audited) and `position.rank_id` with a composite FK, so a position
      cannot borrow another tenant's rank. Adopts the client's own numbering,
      where **a lower number is more senior**; `app.ranks_above()` encodes that
      direction once so no call site has to. Verified against the real rule: for
      a Team Leader / Associate, "same rank" resolves to 19 colleagues, "1 rank
      up" to 2 Junior Supervisors, "2 ranks up" to 2 Area Coordinators.
- [ ] **A2b** Map the rank column in the 201 importer, so a real staff file
      lands already on the ladder. **S**
- [x] **A3** Line roles — DONE. Migration 0030 adds `dept_head`, `area_head`,
      `gm` and a narrow `scoring_admin`, each seeded **unassigned**: defining a
      role must not confer it, and who holds them is Q6.
      **`supervisor` was deliberately not added** — that is `manager`, derived
      from the reporting lines by `sync-roles`, and a parallel hand-assigned
      role would drift from the org chart. **Area Head needed no new
      authorization machinery**: an area is a `department` row (0027) and
      `scope_type='department'` already resolves its subtree, so `can_access()`
      was untouched. Proved both ways — an area head sees the branch beneath
      their area and not the people outside it.

- [x] **A4** Regularisation and promotion dates — DONE. Migration 0029 names
      what each employment row *is* (`event_type`), because the dates were not
      merely unexposed: `change_reason` was free text and NULL on every row in
      every tenant, and the importer writes one row per person. Milestones are
      read from history by `app.employment_milestones()` rather than copied
      onto `employee`, so a second promotion cannot lose the first.
      Regularisation takes the **earliest** such event (extended probation
      produces more than one); promotion takes the **latest**.

- [ ] **A5** ADR **D-015**: inbound attendance aggregates — what may cross the
      boundary and what may not. *Decision, not code.* **S** — §5.4

### Phase B — Scoring engine *(the core gap)*

- [x] **B1** Points on form fields — DONE. A field may carry a single point
      value or a map keyed by classification, which is the shape of the
      client's page-3 template: one list of metrics, two point columns
      (Technical/Ops/Field 70+30, Admin 60+40). A scored form declares the
      total it must reach and is refused at authoring time if any column
      misses it — the failure being prevented is a mistyped point value,
      invisible by eye, silently rescoring everyone on that form. Points are
      rejected on fields whose answers are stored elsewhere (goal_review,
      competency_review) or nowhere (free text). Their real template is a
      test fixture, so the instrument itself proves the abstraction fits.
- [x] **B2** Computed scores — DONE. A rating scores as its position on the
      scale times the line points; a submitted review stores the number with
      the inputs that produced it (points available, classification column,
      and the scale maximum). The point map was already safe via the pinned
      form version, but the **rating scale is not** — a tenant moving from
      1-5 to 1-6 would silently rescore every historical review on read.
      Proven: a submitted 92/100 stays 92 after the scale is extended.
      A multi-column form does **not** guess a classification (R6): it
      scores only when told which column, because a plausible number from
      the wrong allocation is worse than none.
- [ ] **B3** The two 100-point default templates (Admin; Technical/Ops/Field) seeded
      as prepared formats. **S** — §3.3
- [ ] **B4** Composite KPI score: 40 + 30 + 30, with the component breakdown
      visible. **M** — §3.4 *(depends on Phases D and E)*
- [ ] **B5** Incentive bands and qualification output. **S** — *blocked on Q1, Q2*
- [ ] **B6** Competency weight × accomplishment scoring. **M** — *blocked on Q3*

### Phase T — Task metrics *(the client's follow-up, 2026-08-27)*

While the ten open questions were outstanding the client asked for two things:
*"just load the metrics for the staff for later use"* and *"load KPI and
evaluate"*. They are separable, and the first is not blocked on any open
question, so it was built first.

- [x] **T1** Loading — DONE (migration `0032_task_metrics.sql`). Four tables:
      `task_indicator` (the controlled vocabulary, carrying the workbook's own
      nature weights — administrative 1, field 1.5, technical 2), `scorecard`,
      `scorecard_item` and the effective-dated `scorecard_assignment`. Reading
      is open inside the tenant, because a person must be able to see what they
      are measured on; writing needs `scorecard:write`, held org-wide by
      `hr_admin` and department-wide by `dept_head`.

      **The line is the unit of measurement, not the indicator.** The first
      schema carried `UNIQUE (scorecard_id, task_indicator_id)`, on the
      reasoning that scoring the same task twice would be a mistake. Loading the
      client's own sheet disproved it: Social Insurances lists *Claims
      Processing* three times — accident, maternity, sickness — and *Payments
      processing* eleven times, once per company, a point each. The constraint
      silently dropped fourteen lines and turned a 33-point scorecard into 19.
      The constraint is gone and a test pins the behaviour down.

      Loaded into the GGCHCM pilot from the workbook: **94 indicators, 15
      scorecards, 375 lines, 24 staff assigned.** Fourteen of the fifteen
      targets reproduce the sheet exactly; the fifteenth is the sheet's own
      defect, below.

      The API is `/task-indicators`, `/scorecards`, `/scorecards/:id`,
      `/scorecards/:id/items`, `/scorecards/:id/assignments` and
      `/employees/:id/scorecard?asOf=`. The screen is **Task metrics** under
      Company. Nothing in it evaluates anybody, and a test asserts that.

- [ ] **T2** Evaluating against a loaded scorecard — the client's second option.
      A period, a per-line claim of what was actually done, and a total against
      the target. **M** — *next*

#### A defect found in their sheet

`hcm kpi!D132` reads `=SUM(D133:D159)`, but the **Attendance Processing &
Payroll** block runs to row 161. Two lines — *Crafts Design* (2) and *Activity
Organizing* (2) — fall outside the range and are therefore missing from the
stated 33-point target. The lines total **37**. This is raised as **R10**; until
they answer, the loaded scorecard carries all 29 lines and a target of 37,
because dropping two real tasks to match a formula would be the wrong way round.


### Phase C — Evaluation types

- [ ] **C1** Evaluation definition entity: type, scoring model, period basis,
      participants, averaging rule. **L** — §2
- [ ] **C2** Employee-relative scheduling (probationary 3rd/4th month) and averaging
      of instances into one result. **M** — §2.1, §2.3 *(Q7)*
- [ ] **C3** DH revise/approve step; `reviewer_role` extended. **M** — §4.5b
- [ ] **C4** Type IV ad-hoc evaluation for a named subset. **M** — §2.4 *(Q10)*
- [ ] **C5** HCM target-approval step and timeline setting. **S** — §4.3

### Phase D — Peer review

- [ ] **D1** The fixed 30-point instrument. **S** — §6.1
- [ ] **D2** Parameter rules table: job family, rank distance, org unit. **L** — §6.3–6.5
- [ ] **D3** Sampling engine with audit trail: drawn → eligibility gate → accepted /
      declined → replacement draw. **L** — §6.2, §6.6
- [ ] **D4** Averaging, minimum and maximum enforcement. **S** — §6.7 *(Q4)*
- [ ] **D5** Anonymity model. **M** — §6.9 *(Q5 — must be settled before D1 ships)*

### Phase E — Attendance integration

- [ ] **E1** Inbound aggregate interface (file or API), per employee per period. **M** — §5.4 *(Q8, D-015)*
- [ ] **E2** Counts → the 15 + 15 split; HCM review and override, audited. **S**

### Phase F — Surfaces

- [ ] **F1** Per-employee evaluation history timeline. **M** — §7.1
- [ ] **F2** Report builder: by name, type, period; PIP results. **M** — §7.2
- [ ] **F3** DH and AH/RH dashboards. **M** — §7.3
- [ ] **F4** Request-and-approval flow (extra competency, special eval, scoring
      adjustment). **M** — §7.9
- [ ] **F5** New notification events; acknowledgement and results release. **S** — §7.8
- [ ] **F6** Branch ranking. **M** — §2.2 *(Q9)*

### Phase G — Promotion programmes

- [ ] **G1** Programme enrolment with stages and dwell times (MDP; Back Office). **L** — §8
- [ ] **G2** Readiness driven by evaluation history and training scores. **M**

---

## 11. What already carries over

Worth stating plainly, because it is most of the risk that is *not* in front of us:

- **Row-Level Security** as the authorization boundary, forced on every table. New
  roles and scopes plug into `app.can_access` rather than replacing it.
- **Effective-dated org chart** — last year's evaluation stays calibrated against
  last year's reporting line, which matters for a company that reorganises branches.
- **Versioned definitions with snapshotting** — a template edited in March cannot
  silently change a January evaluation. B2 must follow this principle exactly.
- **Durable notification outbox** with retry and per-user preferences.
- **Multi-tenancy**, audit trail, in-app help, PIP, goals, competency library.
- **522 automated tests**, including the data-protection scan that keeps statutory
  identifiers out of the database.

---

## 12. Handoff notes

| Thing | Where |
|---|---|
| Architecture and schema | [architecture.md](architecture.md) |
| Decisions D-001…D-014 (D-015 pending) | [decisions.md](decisions.md) |
| Earlier gap analysis (pre-dates this document) | [feature-roadmap.md](feature-roadmap.md) |
| Form field schema | `apps/api/src/reviews/forms.service.ts` |
| Authorization predicate and scopes | `db/migrations/0002_authorization.sql` |
| Review cycles and instances | `apps/api/src/reviews/` |
| Demo logins and seeded data | [demo-logins.md](demo-logins.md) |

**Rules that constrain every phase above** — see [CONTRIBUTING.md](../CONTRIBUTING.md):
migrations are immutable once merged; any table carrying `org_id` needs an RLS
policy and a tenancy test; no statutory identifiers; identity is transaction-scoped.

---

## 13. What we can build while waiting for answers

Most of the plan is unblocked. The ten questions gate specific leaves — the bands,
the conversion arithmetic, two peer-review parameters, the attendance grain — not
the structures underneath them. Ordered so that each answer, when it lands, drops
into something already built.

### Now — nothing here depends on an answer

| Item | Why it is safe to build |
|---|---|
| **A1** Org unit levels (division / department / area / branch) | The structure is fully described: seven divisions on page 5, the branch and area relationships throughout page 4. No question touches it. |
| **A2** Rank ladder | Page 5 lists the five ranks outright. Needed before any peer-review rule can be expressed. |
| **A4** Regularisation and promotion dates | Q7 asks *when evaluations fire*, not what we store. The dates are needed either way. |
| **B1** Points on form fields | The point values are given exactly on page 3. Q3's ambiguity is about the *competency* conversion in the KPI model — a different calculation. |
| **B2** Computed scores with a snapshot of the point map | Same reason. This is also where the versioning principle has to hold: a template edited in March must not change a January evaluation. |
| **B3** The two 100-point default templates | Fully specified on page 3, and the arithmetic checks out. |
| **C1** Evaluation definition entity | The shape is clear from the five types; only two of the five have open questions, and both are configuration of this entity. |
| **C3** DH revise / approve step | Step 4b on page 3 is explicit. |
| **C5** HCM timeline and target approval | Steps 1–3 on page 3 are explicit. |
| **D2** Peer-review parameter rules | Page 4 specifies these in unusual detail — per job family, per unit, per rank distance. Depends on A1 and A2, not on any answer. |
| **D3** Sampling engine, eligibility gate, re-draw | The mechanism is fully described on page 4. Only the *count* is open (Q4), and that is a configuration value. |
| **F1** Employee evaluation history | Data already exists; this is a view. |
| **F4** Request-and-approval flow | Page 2 names the three request types precisely. |
| **F5** New notification events | Page 2's messaging list is unambiguous. |
| **G1** Promotion programme stages | Page 2 gives both programmes with their dwell times. |

### Hold — a plausible answer would change the work

| Item | Waiting on |
|---|---|
| **B5** Incentive bands | Q1, Q2 — but see below: build the *table*, wait for the *rows*. |
| **B6** Competency weight × accomplishment | Q3. Nothing to build until the arithmetic is known. |
| **B4** Composite KPI score | Depends on peer review and attendance both existing. |
| **E1, E2** Attendance interface | Q8 and the D-015 decision. |
| **C2** Probationary scheduling | Q7 — the machinery is C1's; only the trigger rule is open. |
| **C4** Type IV | Q10. |
| **F6** Branch ranking | Q9. |

### Design rule: make every answer data, not code

Each open question should land as a configuration change, not a rewrite. That is
a decision we make now, while building the unblocked parts:

- **Incentive bands** → a table of ranges and percentages, seeded when Q1/Q2
  arrive. The band edges are rows; nothing hard-codes 70 or 30%.
- **Peer reviewer count** → minimum and maximum as settings, defaulted to 3 and 5.
  Q4 changes two numbers.
- **Score conversion** → isolated behind a single function with the raw inputs
  stored alongside the result, so Q3's arithmetic can be applied and re-applied to
  evaluations already recorded.
- **Attendance** → the interface is defined as an aggregate per employee per
  period. Q8 only decides whether we receive counts or a score; both paths are the
  same shape, and the counts-to-points rule is a table.

### The one exception: anonymity (Q5) cannot be deferred by choosing a default

Anonymity is structural rather than configurable, and both defaults are wrong to
assume: building it anonymous discards the reviewer link, so "actually, they are
not anonymous" cannot be honoured retrospectively; building it named and
disclosing later breaks a promise made to the people who wrote the reviews.

**Recommended approach, which keeps both answers open:** record the reviewer link
— it is needed anyway for the re-draw, for preventing double submission, and for
investigating abuse — and treat *disclosure* as policy enforced in the database,
defaulting to nobody. Q5 then sets who may see it, and neither answer requires a
rebuild. The reviewers must still be told the truth up front, so the wording of
that screen waits for the answer.

### Worth doing in parallel

- **Draft ADR D-015** (inbound attendance aggregates). Ours to write, not the
  client's to answer — and it should be settled before E1 starts.
- **Demonstrate the scoring engine** once B1–B3 land. A working screen showing
  their own page-3 template computing a real score tends to shake loose an answer
  to Q3 faster than another email, because it gives them something concrete to
  correct.
