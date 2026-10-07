# Architecture Decision Record

Format: ID / Status / Decision / Rationale / Consequences.
Status: PROPOSED until the user approves. Approved entries must not be
violated without raising a conflict first.

---

## D-001 — Deployment target: on-premise office server
**Status:** ACCEPTED (user-confirmed, 2026-08-13)

**Decision:** The system deploys to a physical/virtual server inside the office
network. No cloud dependency in the runtime path.

**Rationale:** This is the reason the vendor (Sprout) was rejected — their notes
record "on premise storage — not available". Data residency/control is a hard
requirement, not a preference.

**Consequences (these are the real costs, and they are not small):**
- No managed database. Backup, restore, patching, and point-in-time recovery
  are now *our* responsibility, and an untested backup is not a backup.
- No provider redundancy. A dead disk, a failed aircon, or a long brownout is
  an outage. UPS and a tested restore path are launch blockers, not polish.
- TLS certificates must be issued internally (private CA) or via a split-horizon
  public cert. Self-signed certs train users to click through warnings — avoid.
- Remote access (WFH staff reaching the system) needs VPN or a reverse proxy in
  the DMZ. This must be decided before Phase 1 ships or the pilot can't be used.
- The Supabase MCP connector available in this environment is **not usable** for
  the production path. Plain PostgreSQL only.

**Mitigations required before go-live:** nightly `pg_dump` + WAL archiving to a
separate physical device, a *rehearsed* restore, UPS on the host, and an offsite
(or at minimum off-machine) encrypted backup copy.

---

## D-002 — Scope: performance & talent only; payroll excluded
**Status:** PROPOSED

**Decision:** Build competency, goals/KPI, reviews, PIP, IDP, feedback, and the
document library. Do not build payroll, timekeeping, biometrics, leave, or
statutory remittance (BIR / SSS / PhilHealth / Pag-IBIG / 13th month / alphalist).

**Rationale:** Every feature in the source meeting notes is performance/talent.
PH payroll carries continuous regulatory change, real money, and audit
liability — the worst possible thing to maintain as a side effort. Buying payroll
and building performance is the defensible split.

**Consequences:** An integration boundary is required for employee master data
(see Q3 in architecture.md). If payroll stays with a vendor, employee records
likely originate there and sync inbound.

---

## D-003 — Authorization enforced in the database via RLS
**Status:** PROPOSED

**Decision:** Row-level security policies in PostgreSQL are the security
boundary. Application checks are UX only.

**Rationale:** The notes require customizable viewing access, user-level related
access, and three distinct feedback visibility channels. Relationship-derived
visibility enforced only in application code will eventually leak through a
report, an export, or an admin screen.

**Consequences:** Requires a per-request DB session identity
(`SET LOCAL app.current_employee_id`). Connection pooling must be transaction-
scoped, never session-scoped, or identity bleeds between requests. This is a
known footgun and is called out in the Phase 0 validation checklist.

---

## D-004 — Language and framework: TypeScript end to end
**Status:** ACCEPTED (user-confirmed, 2026-08-14)

**Decision:** NestJS (backend) + React/Vite (frontend), one language, one
package manager, shared types.

**Rationale:** The global rules mandate strongly typed code, modular services,
and low coupling — NestJS's module/provider model maps to that directly. A
single language halves the hiring and context-switching cost for a small
in-house team maintaining an on-prem box.

**Alternative considered:** Python/FastAPI + SQLAlchemy. Equally valid, and
better if the existing team is Python-first.

**Confirmed 2026-08-14.** The stack stands. Note for whoever reads this later:
the decision was made on the basis that day-to-day maintenance would not fall
to a Python-first in-house team. If that changes, the SQL migrations (all
business rules, RLS, and state machines) port unchanged — only the NestJS
service layer would need rewriting.

---

## D-005 — No Redis, no Kafka; PostgreSQL is the queue
**Status:** PROPOSED

**Decision:** Background jobs and email notifications run through a DB-backed
outbox (`pg-boss`), not a separate broker.

**Rationale:** Load is trivial except at review-cycle close, and that spike is
measured in hundreds of jobs, not millions. On-prem, every additional stateful
service is another thing to back up, monitor, patch, and restore at 2am. The
cheapest infra is infra that doesn't exist.

**Consequences:** If throughput ever genuinely exceeds Postgres, the outbox
interface is narrow enough to swap. Do not pre-build for that.

---

## D-006 — Sizing held at current estimates
**Status:** ACCEPTED (user-confirmed, 2026-08-14)

**Decision:** Keep the ≤1,000-employee assumption in infra.md (8 vCPU, 32 GB,
RAID-1 SSD). Revisit when real headcount is known.

**Consequences — two known items deferred, recorded so they are not forgotten:**
- `ReviewsService.generateInstances` issues per-employee round trips. Acceptable
  at this scale; becomes a batch insert above roughly 2,000 staff.
- The PIP list endpoint has no pagination. Same threshold.

Neither is a correctness problem, only a throughput one. Both are cheap to fix
when the number is known; neither is worth building for speculatively.

---

## D-007 — Compensation deferred
**Status:** ACCEPTED (user-confirmed, 2026-08-14)

**Decision:** Do not design or build compensation features. Revisit only if the
vendor quote makes buying unattractive.

**Rationale:** Compensation is where performance data starts touching money and
audit exposure. Deferring costs nothing today — no other phase depends on it.

---

## D-008 — Multi-tenant
**Status:** ACCEPTED and IMPLEMENTED (migration 0015, verified 2026-08-14).
The leak described below is FIXED; 25 tenancy tests assert mutual invisibility
in both directions. The description is kept as the record of what was wrong.

**Decision:** The system hosts multiple organizations in one database, isolated
by `org_id` and enforced by RLS.

**Rationale:** Every table already carries `org_id` defensively, so the data
model needs no change. What DOES need to change is enforcement.

**CRITICAL — the current build does NOT isolate tenants.** Verified empirically
on 2026-08-14 against a two-org database: an HR admin in org B, using the
non-superuser app role with RLS enforced, could read org A's employees (8),
departments (4), and KPI definitions (4). Two root causes:

1. `app.can_access()` resolves `scope_type = 'org'` to a bare `TRUE`. It never
   compares the target's organization to the actor's, so "org-wide" means
   "every organization".
2. Reference-data policies (`department`, `position`, `employment_type`,
   `goal_period`, `kpi_definition`, `app_role`, `form_template`, `rating_scale`,
   `review_cycle`) use `USING (app.current_employee_id() IS NOT NULL)` — any
   authenticated employee of any tenant.

This was harmless while exactly one organization existed. It is a
cross-tenant data breach the moment a second one is created.

**Resolved by migration 0015:** `app.current_org_id()` derives the tenant from
the authenticated employee (not from any client-supplied value); a tenant guard
sits inside `can_access` ahead of every scope; org predicates were added to all
ten reference tables plus `access_grant` and `audit_log`; and composite foreign
keys `(employee_id, org_id)` make cross-org rows impossible to write even with
RLS bypassed.

**Standing requirement:** any new table carrying `org_id` needs both a policy
and a case in `test/tenancy.spec.ts`. Every other suite seeds a single
organization, which is exactly why this leak survived 107 passing tests.

---

## D-009 — Employee master data: performance-relevant fields only
**Status:** ACCEPTED (user-confirmed, 2026-08-14)

**Decision:** The system stores only the subset of the 201 file it actually
uses: employee number, name, work email, hire date, department, position, job
family/level, employment type and status, and reporting line.

It does NOT store: TIN, SSS, PhilHealth, Pag-IBIG, address, birthdate, gender,
civil status, contact numbers, emergency contacts, dependents, leave balances,
or NBI/PEME/contract status. Those stay in the existing 201 file.

**Rationale:** Government identifiers this system never processes would enlarge
the blast radius of a breach on an on-prem server for no functional gain. Leave
and payroll are already out of scope (D-002).

**Consequences:**
- `Ph201ImportService` maps a fixed subset and reports the columns it skipped.
- A test scans every text column of every table for 201-only values (TIN, SSS,
  address, personal email) and fails if any are found — so a future widening of
  the mapping breaks a test rather than surfacing in a breach notification.
- Making this system the full 201 repository would need its own decision, new
  tables, encryption at rest, and a retention policy. It is not a small change.

---

## D-010 — Department codes are derived on import, then editable
**Status:** ACCEPTED (user-confirmed, 2026-08-14)

**Decision:** The 201 importer derives department codes from names
(Operations → OPS, Human Resources → HR) and creates the departments. HR can
then correct codes, names, and hierarchy through an admin screen.

**Rationale:** Requiring departments to exist before the first import is
circular — the department list comes from the file. Deriving gets the first
import through; the CRUD fixes whatever the derivation got wrong.

**Consequences:**
- Editing a code is safe: every foreign key is on the UUID, and the code is only
  a human-facing key used to match import rows.
- Guards added in migration 0018, because CRUD without them is how reference
  data quietly breaks historical queries:
  a department with people cannot be closed; an employment type people hold
  cannot be deactivated; department hierarchies cannot form cycles; and only one
  ACTIVE department may hold a given code.
- `is_eligible_for_review` is HR-editable — it decides who a review cycle picks
  up, and should not be left as whatever the importer inferred.

---

## D-011 — On-premise first, SaaS later
**Status:** ACCEPTED (user-confirmed, 2026-08-14)

**Decision:** The first deployment is a single-customer on-premise installation
(D-001). The product is later offered as a hosted multi-tenant service.

**Rationale:** The on-prem requirement is real and immediate; the SaaS ambition
is real but not yet funded by a customer. Building SaaS machinery now would be
speculative work against unvalidated assumptions.

**What this does NOT change.** The expensive parts of a SaaS transition are
already done and tested, which is the main reason this sequencing is safe:
- Tenant isolation enforced in RLS (D-008, migration 0015), with 25 tests
  asserting mutual invisibility in both directions
- Composite foreign keys making cross-tenant rows unwritable even with RLS
  bypassed
- Versioned definitions (KPIs, forms, rating scales, competency frameworks,
  notification templates) — required for a record that must stay readable for
  years across many customers
- `org_id` on the audit log
- A stack with no per-seat licence cost at any scale

**One-way doors — decide before they harden:**
1. **Identity.** `employee.idp_subject` is globally unique and there is no
   tenant selector at login, so a person belongs to exactly one tenant.
   Recommended path: keep ONE Keycloak realm and add a per-customer identity
   provider with home-IdP discovery by email domain. That preserves the current
   model unchanged and still gives each customer their own SSO. Per-tenant
   realms would force `idp_subject` to become unique per `(org_id, subject)`
   and require a tenant hint at login — a far uglier migration later.
2. **Single-tenant restore.** With every tenant in one database, restoring one
   customer's data means restoring to a scratch instance and copying rows by
   `org_id`. That procedure needs to exist and be rehearsed BEFORE the second
   customer, not after the first incident.
3. **Per-tenant export.** Needed for customer data portability, for on-prem →
   cloud migration, and for exit. Cheap to build now against 22 tables;
   expensive to retrofit across 40.

**Consequences:** the on-prem install is effectively single-tenant. Tenant
isolation still applies and is still tested — it is not dead code, it is the
foundation the hosted product stands on.

---

## D-012 — Identity model for the hosted product
**Status:** ACCEPTED (user-confirmed, 2026-08-14). Direction only — nothing to
build until there is a paying tenant. Recorded now because it is the hardest
choice to reverse later (see D-011).

**Decision:** One Keycloak realm for the whole hosted service. Each customer
gets their own **identity provider** inside that realm, with home-IdP discovery
by email domain. `employee.idp_subject` stays globally unique.

Login flow: user enters their work email → Keycloak matches the domain to that
customer's IdP → redirects to the customer's Azure AD / Google Workspace → the
token comes back with a subject unique across the whole service →
`app.resolve_employee_by_subject()` resolves it to exactly one employee row,
and that row's `org_id` IS the tenant.

**Rationale — this changes nothing that is already built.** The current model
already assumes one globally-unique subject per person
(migration 0015). Under this decision that assumption stays true forever, so:
- `app.resolve_employee_by_subject()` needs no change
- the `employee.idp_subject UNIQUE` constraint needs no change
- the tenant is still derived from the authenticated employee, never from a
  client-supplied value — which is what makes it unspoofable
- customers still get their own SSO, which is table stakes for selling to any
  company with an IT department

**Alternatives considered and rejected:**

1. **One Keycloak realm per tenant.** Better blast-radius isolation, and the
   obvious choice if you think about it for five minutes. Rejected because
   subjects are only unique WITHIN a realm, so `idp_subject` would have to
   become unique per `(org_id, idp_subject)`. That in turn means the API must
   know which realm issued a token before it can resolve anybody, which means a
   tenant hint at login — a subdomain, a tenant picker, or a token claim. Every
   one of those is a migration across the auth path plus a UX change, and all of
   them are far cheaper to avoid than to perform once customers exist.

2. **Shared realm, local passwords only (no customer SSO).** Simplest, and
   what the dev realm does today. Rejected as a destination: enterprise buyers
   expect SSO, and retrofitting federation after customers have local passwords
   means an account-migration exercise per tenant.

3. **Per-tenant subdomain (acme.hrsystem.ph) carrying the tenant.** Viable, and
   compatible with either realm model. Deferred rather than rejected — it is a
   routing and branding decision, not an identity one, and it can be added later
   without touching the auth model.

**Consequences — accept these knowingly:**

- **A person belongs to exactly one tenant.** A consultant genuinely working for
  two customer organisations needs two IdP accounts with different email
  addresses. This is normal (your work identity belongs to one employer) but it
  is a real constraint, and it is the price of not needing a tenant selector.
- **Email domain must map to a tenant.** Customers sharing a domain (unlikely)
  or using many domains (common after an acquisition) need the IdP mapping to
  support multiple domains per tenant. Keycloak handles this; the provisioning
  UI must expose it.
- **One realm is a shared failure domain.** A realm-level misconfiguration
  affects every customer. Mitigate with configuration-as-code for the realm and
  a staging realm that mirrors it — not by splitting realms, which reintroduces
  problem (1).
- **Still to build when the time comes** (none of it now): per-tenant IdP
  registration in the provisioning flow, domain-to-tenant mapping UI, and a
  fallback for customers with no IdP at all (local accounts within the shared
  realm).

**Revisit this decision if:** a customer requires their user records to be
physically separated from other tenants' at the identity layer (some regulated
buyers do), or if a single realm becomes an operational bottleneck. Both are
signals to move to per-tenant realms — at which point the migration described in
alternative (1) has to be paid for deliberately, not discovered.

---

## D-013 — Remote access via VPN
**Status:** ACCEPTED (user-confirmed, 2026-08-14)

**Decision:** Off-site staff reach the system by VPN into the office LAN. The
application is NOT published to the public internet.

**Rationale:** Resolves the open item flagged in D-001. It keeps the attack
surface at the VPN concentrator — a device built for that job and patched by the
network vendor — instead of at an application server sitting in the office with
no WAF, no DDoS protection, and a small team's patch cadence.

**Consequences:**
- Caddy's `tls internal` stays viable: certificates never need to be publicly
  trusted, only trusted by managed machines. The internal CA root must still be
  distributed by Group Policy, or staff learn to click through TLS warnings.
- The VPN becomes a dependency of the review cycle. If it is down during a close,
  nobody off-site can submit. Worth knowing before the first cycle, not during.
- Personal or unmanaged devices are effectively excluded unless the VPN client is
  installed on them. That is a policy decision for HR/IT, not a technical one —
  but it will surface as "I can't do my review from home".
- This changes for the hosted product (D-011), which is internet-facing by
  definition and will need its own perimeter decisions.

---

## D-014 — No payroll; integrate instead
**Status:** ACCEPTED (user-confirmed, 2026-08-15)

**Decision:** This product does not implement payroll, and will not. It remains a
performance and talent system, exchanging data with whatever payroll system the
customer already runs.

**Rationale:** Payroll requires the complete statutory identifier set — TIN, SSS,
PhilHealth, Pag-IBIG — plus salary, birthdate and address. Every one of those is
forbidden by D-009, which is enforced by a test that scans each text column and
fails the build if any appears. Payroll is therefore not an increment on this
architecture; it is the deletion of the constraint the security model is built
around.

Beyond the data: payroll carries obligations this system currently does not have
to meet at all — NPC registration, a named Data Protection Officer, breach
notification, encryption at rest — and an annual maintenance tail chasing BIR,
SSS, PhilHealth and Pag-IBIG table changes. The market is also well served by
entrenched incumbents.

**Consequences:**
- **D-009 becomes permanent** rather than provisional. The data-protection test
  is now a load-bearing architectural constraint, not a phase-scoping decision.
- Roadmap is Strategy A in docs/feature-roadmap.md: leave management, full 201 and
  document handling, employee relations, and on/offboarding — all of which fit
  inside the existing data model and risk posture.
- An export/integration surface for payroll systems becomes a real requirement,
  and should be designed as a first-class boundary rather than a CSV afterthought.
- The commercial position is "your data never leaves your building", not feature
  parity with Sprout.

**Revisit this decision if:** a customer makes payroll a condition of sale. That
is a different product with a different compliance posture, and it should be
priced and staffed as one — not absorbed into this codebase by degrees.

---

## D-015 — Attendance crosses the boundary as a count, never as a record
**Status:** ACCEPTED (2026-09-13)

**Decision:** This system accepts, per employee and per period, an **aggregate**:
an absence count, a tardiness count, or a pre-computed 0–15 score for each. It
refuses raw time records, biometric logs, leave balances, schedules, and
anything else from which those aggregates could be recomputed.

The exchange unit is one row per employee per period, carrying the counts, the
source that supplied them, when it was supplied, and who accepted them. Nothing
else.

**Rationale:** 30 of the 100 KPI points are "15 no tardiness, 15 no absences",
and their source is the payroll system. That is a real requirement and it points
inward across a boundary two earlier decisions drew:
[D-002](#d-002--scope-performance--talent-only-payroll-excluded) put
timekeeping, biometrics and leave out of scope, and
[D-014](#d-014--no-payroll-integrate-instead) made "no payroll" permanent while
anticipating exactly this — *an export/integration surface for payroll systems
becomes a real requirement, and should be designed as a first-class boundary.*

A count is a fact about a period. A time record is a fact about a person's day,
and once a day's records are here, the next request is the one that needs
yesterday's, and then the roster that explains it. **That is how a performance
system becomes a timekeeping system: not by decision, but by accretion.** The
boundary has to be drawn where it can be defended by inspection — "does this row
describe a period or a moment?" — rather than by judgement each time.

**Note what this decision does NOT depend on.** Q8 asks which payroll system
they run, what it can export, and at what grain. That answer changes the
*adapter*; it does not change what we accept. Waiting for it would be waiting
for permission to draw our own boundary.

**Consequences:**

- **A missing feed is not perfect attendance.** The most dangerous failure here
  is silent: a period with no aggregate must read as *unknown*, never as zero
  absences. Zero is a score of 30, so a broken feed would quietly award every
  employee full marks on a third of their KPI — and it would look like unusually
  good attendance rather than like a bug. The column is therefore nullable, the
  composite refuses to finalise a period with an unknown, and it says whose
  figures are missing.
- **Counts are stored, not just the score.** The 15 + 15 conversion is a rule
  that may change; the counts are the evidence it was applied to. Storing only
  the derived score would make a recalculation unreproducible, and "why was I
  scored 22" unanswerable.
- **Aggregates are snapshotted on release**, like every other input. A revised
  figure arriving after sign-off does not silently restate a released result; it
  is a correction with its own trail (the same reasoning as
  [D-016](#d-016--editing-an-employee-is-four-operations-not-one)).
- **HCM accepts them, and may override with a reason** — their §4.5c has HCM
  supplying the figures, and a feed is not an authority. The override is audited
  because a hand-adjusted attendance score is exactly what a disputed appraisal
  turns on.
- **`test/ph201.spec.ts` keeps passing unchanged.** Its data-protection case
  asserts the system imports no statutory identifiers or personal data, and an
  aggregate carries none — which is the cheapest available proof that this
  boundary holds.
- **Salary stays out**, which also answers the shape of R7: "selection of
  subject by salary level" cannot be honoured with an amount, because
  [D-009](#d-009--employee-master-data-performance-relevant-fields-only) stores
  none. A pay *grade* is a rank, and the rank ladder already exists.
- The adapter is deliberately unwritten. Until Q8 names the system, a CSV of
  counts and a screen to accept them cover every case, and both are E1's job.

**Revisit this decision if:** the client asks for tardiness *reasons* or
excused-absence handling. That is leave management, it lives on the other side
of this line, and it should be priced as an integration with their payroll
system rather than absorbed here.

---

## D-016 — Editing an employee is four operations, not one
**Status:** ACCEPTED (2026-09-13), implemented in migration 0045

**Decision:** The employee screens expose four distinct operations, and there is
deliberately **no generic Edit button**:

| | | Writes |
|---|---|---|
| **Add** | A person who is not in the system yet | `employee` + first `employment` (`event_type = 'hire'`) + `reporting_line` |
| **Correct** | Fix something that was always wrong — a misspelt surname, a mistyped hire date | Amends the existing row in place |
| **Record a change** | Something happened in the real world — regularisation, promotion, transfer, demotion | **Closes** the current `employment` row and **opens** a new one, in one transaction |
| **End employment** | They left | Closes the open row, sets `employee.status` and `separated_on` |

**Rationale:** Employment is effective-dated, and `employment` /
`reporting_line` each carry a GiST exclusion constraint forbidding overlapping
periods. So "changing a person" is not one operation in the data even though it
is one word in English:

- A **correction** rewrites history, because the old value was never true.
- A **change** appends to history, because the old value *was* true until a date.

Collapse them into one form and a transfer overwrites the row it should have
closed. Nothing errors. But every goal, review and evaluation that pointed at
the old department silently re-parents itself to the new one, and the answer to
"which section was this person in when they were rated" quietly changes for
every past cycle. That is the kind of defect nobody finds until an appraisal is
disputed a year later.

The vocabulary already exists: migration **0029** added `employment.event_type`
with `hire`, `regularization`, `promotion`, `lateral_transfer`, `demotion`,
`rehire` and `correction`, and its own comment already draws this distinction —
*"a row fixing a typo in last month's transfer is not itself a transfer"*.
`app.employment_milestones()` reads the 201 sheet's three dates back out of
those events rather than storing them separately, and it depends on corrections
not counting: it takes the **earliest** regularisation (probation extended
twice still became regular once) and the **latest** promotion.

**Phase 3 therefore exposes a model that already exists rather than inventing
one.** If the API had been built with a single `PATCH /employees/:id`, 0029's
event vocabulary would have had nothing to write into it.

**Consequences:**
- Four endpoints, not one. Each names its event, and `change_reason` is
  required on a change — an undated, unexplained transfer is not auditable.
- **A change is one transaction.** Close-then-open must be atomic or the
  exclusion constraint rejects the second statement and leaves the first
  committed, which is worse than failing: the person now has a gap.
- **Recording a change in the past is legitimate** and must be supported —
  HCM learns about a transfer after it happened. Recording one in the future is
  also legitimate. Both are ordinary effective-dating, not edge cases.
- A correction to an already-closed row is allowed, and does **not** shift the
  rows around it. Re-dating a boundary is a change, not a correction.
- **Nothing is deleted.** Separation closes a row and sets a date; the person
  stays queryable, because their past reviews still reference them.
- The supervisor role is derived from reporting lines by `hr sync-roles`, so a
  transfer moves access on its own — but only once the reporting line is
  written, which makes the reporting line part of the same transaction rather
  than a follow-up screen.

**Revisit this decision if:** a customer asks for bulk edits across many people
at once. That is the importer's job — `POST /import/employees` already upserts
idempotently — and a bulk path through these four operations would need its own
preview, which is what the importer already has.

---

## D-017 — Approving a request records a decision; it does not apply the change

**Status:** accepted (F4, migration `0048_change_request.sql`)

The request-and-approval flow (§7.9) lets a Department Head ask for an extra
competency, a special evaluation or a scoring adjustment. The obvious next step
is to have approval carry it out: add the competency, open the evaluation,
write the new score. It does not.

**Why.** A score that moves as a side effect of an approval is a score that
changed with no separate act behind it. The audit trail would show a request,
an approval, and then a different number — with no row saying who changed it,
on what screen, against which version of the form. "Who changed this score" is
a question that has to have an answer, and the only way to guarantee one is to
make the change where it is already audited as a change.

There is a second reason, less obvious and probably more important in practice:
an approval is frequently **conditional**. "Yes, but only for the branch staff",
"yes, once the cycle reopens", "yes at 3.6 rather than 3.8". A flow that applies
the request verbatim has nowhere to put any of that, so the approver either
declines something they meant to allow, or approves something they did not
quite mean.

**Consequences:**
- `change_request` has no write path into any other table, and a test asserts
  that approving one changes nothing about the subject's records.
- The screen and the decision email both say so, in as many words. People read
  an approval as the thing being done, and then nobody does it — saying it
  once in a migration comment would not have been enough.
- The cost is a second step, and it is a real cost. If the client tells us the
  step is being skipped in practice, the answer is a link from the decided
  request to the screen that applies it — not an automatic write.

**Revisit this decision if:** the client asks for it explicitly, with the audit
question answered. A "create the assessment from the approval" button that
lands on the competency screen with the fields filled in would honour both
halves; an approval that writes the row would not.

---

## D-018 — The December 2025 forms are the standard; per-indicator weights are provisional

**Status:** accepted (B3b)

HCM supplied their revised Performance Evaluation Form and Performance
Improvement Plan (both "Revised December 2025") and asked that they be the
official templates. They supersede the instrument built from page 3 of the
5-pager, and they are not an edit of it: different indicators, three
classifications instead of two, and the 60/40 split moved from Admin to Service.

**Decision.** Build to the forms. Where the form prints a number, use it exactly
and say where it came from. Where it does not, make the smallest assumption,
isolate it in one place, and mark everything it touches as provisional.

The one thing the form does not print is what each *indicator* is worth. It gives
each part's total (70/30, 60/40, 70/30) and a passing floor, and shows five
indicators and a 1–5 grid. We weight indicators equally within their part: 14 each
in Part 1 and 6 in Part 2 for Sales and Admin, 12 and 8 for Service. That is the
assumption that invents the least emphasis. It is very probably wrong in detail —
the old instrument gave the supervisor's assessment 20 of 70 — which is why every
published template is labelled **PROVISIONAL** and a test fails if the label and
the `WEIGHTS_ARE_PROVISIONAL` switch ever disagree.

**Why the assumption is tolerable.** It does not touch the passing floors. Each
printed floor is exactly 60% of its part, and a rating scores as value ÷ scale
maximum, so an evaluator who rates every indicator 3 lands on the floor under
*any* weighting. Scores are estimates; the pass/fail line for an
all-"meets" evaluation is not.

**Consequences:**
- Three single-column templates (`GGC-PEF-SALES`, `-SERVICE`, `-ADMIN`), not one
  three-column form. Which classification applies to a person is recorded nowhere
  (R15), and a three-column form cannot score until somebody says. Three
  templates are assigned through the existing assignment table and score alone.
  `combinedTemplate()` builds the single form for the day R15 is answered.
- **Forms are versioned and immutable, so the old instrument is retired, not
  edited**, and re-provisioning must never issue a v2. `provision-org` retires
  `GGC-TOF` / `GGC-ADMIN` only where nothing is assigned to them or issued from
  them, and says so where it declines.
- Each rating's descriptor is carried on the field (`anchors`) and rendered as a
  rubric. A bare 1–5 would let two supervisors rate the same person differently
  while both following the form.
- Passing floors are per **part**, because that is what the form prints. Whether
  failing one part fails the evaluation is not printed (R19), so nothing decides it.
- Wording is transcribed verbatim, grammar slips included ("Sometimes exhibit
  exceptional efficiency"). An official template should read as the form HCM
  signed off. The form's defects are raised with HCM (R16, R17, R20), not
  patched by us: inventing a band that the form does not have would be a scoring
  rule nobody agreed.

**Revisit this decision when** HCM answers R12. The weights become data, the
switch flips, the descriptions stop saying PROVISIONAL, and — because published
versions are immutable — a v2 of each template is issued and assigned. That is
the intended path, not a failure of this one.

---

## D-019 — The PIP form: four signatures, and what the plan already held

**Status:** accepted (F6)

HCM's revised Performance Improvement Plan (December 2025) is the standard. It
adds a document control number, the evaluation result that triggered the plan, a
target score, a review schedule with scores, three free-text sections, and four
signatories where there had been one.

**Decision.** Add what the form carries; remove nothing; change no existing plan's
meaning. Reuse what already did the job: "area of concern" is `reason`, and
"action/s to be taken" with its "timeline" is the milestone list — a step and the
date it is due is those two boxes, structured.

**Signatures are a table, not four columns,** because each is a fact about a person
and a moment, and "who signed as what" is the point of having four. The table is
append-only and audited: a signature that can be edited is not evidence.

**Who may sign as whom is defined once,** in `app.pip_signable_parties()`, and read
by both the INSERT policy and the screen. The alternative — the policy in SQL and
a second copy of the rule in the browser deciding which buttons to show — is the
authorization boundary re-implemented where anyone can read it and nobody enforces
it. The screen renders what the server says it may offer and never works it out.

- **Two resources, not one action.** `pip_dh_ack` and `pip_hcm_ack` (the precedent
  is `goal_target` in 0037). Riding one `approve` would let HR sign as the
  department head.
- **Never as someone else's role on your own plan.** The employee line is the only
  one a person may hold about themselves.
- **One person may hold two lines on someone else's plan.** In HCM the department
  head and the HCM representative are the same person (see the role overlap decision
  in the handoff). Forbidding it would make the form unsignable for the unit that
  wrote it; recording who signed as what is the control.
- **Only while active.** A draft can still change and a signature on terms that may
  yet change attests to nothing; a closed plan cannot be signed into retroactively.
- **Nothing is gated on signatures** (R23) and **none of the new sections is
  mandatory.** The form marks none required, and inventing a rule would change what
  raising a plan takes for every organisation at once.

**Two things were deliberately NOT enforced:** that overall = part 1 + part 2 (the
evaluation form shows an overall beside quarterly points, and if it is an average
across quarters it need not equal the latest quarter's parts — R18), and that the
typed scores match any evaluation on record (the form's "PEF reference" is text
because our evaluations have no series number — R22). A constraint on either would
reject real data on a guess.

**Why two existing bugs surfaced here, and what that says.** Employees could never
acknowledge their own plan (the update policy filtered their row out), and
`POST /pips` answered 404 after creating the plan (it read back on a second
connection that could not see the uncommitted insert). Both shipped and were live.
Both were found only by writing the first HTTP test of a path nothing had called.
**A route with no test over HTTP has not been shown to work**, whatever its unit
tests say; the PIP screen was the second route in a week with this failure.

**Revisit this decision when** R21–R24 are answered. In particular R23: if all four
signatures are required before a plan counts, that becomes a gate on activation or
on use, and it should be a database rule rather than a screen convention.
