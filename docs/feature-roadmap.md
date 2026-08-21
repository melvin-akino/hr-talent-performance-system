# From performance system to full HR platform

An assessment of what this application covers today, what a Philippine company
expects from "an HR system", and what it would take to close the gap.

---

## The headline

What exists is a **complete, production-grade performance and talent management
system**. That is roughly **20–25% of what a Philippine company means by "HR
system"**, and it is the quarter with the least regulatory exposure.

The other three quarters — timekeeping, leave, payroll, and employee relations —
are where the Labor Code, BIR, SSS, PhilHealth, Pag-IBIG and DOLE actually bite.
Building them is not more of the same work. It is a different risk class.

**The decision that gates everything else is [D-009](decisions.md).** This system
deliberately stores no TIN, SSS, PhilHealth, Pag-IBIG, address, birthdate, or
salary — there is a test that scans every text column and fails the build if any
appears. That was the right call for a performance tool and it is a real part of
why the security story is clean.

Payroll cannot be built without every one of those fields. So the roadmap below
has a hard fork in it, and it should be an explicit, dated decision rather than
something that erodes one migration at a time.

---

## What exists today

| Capability | State |
|---|---|
| Goal & KPI management, weighted attainment, check-in cadence | Complete |
| Goal monitoring, escalation, off-track detection | Complete |
| Performance Improvement Plans | Complete |
| Review cycles: self → supervisor → calibration → sign-off | Complete |
| Dynamic review forms (versioned, snapshot at issue) | Complete |
| Competency frameworks, assessments, gap reports | Complete |
| Peer feedback (request and give) | Complete |
| Learning library, career paths, development plans | Complete |
| Analytics: nine-box, rating distribution, rater bias, calibration movement | Complete |
| Notifications (in-app + email, durable outbox) | Complete |
| Multi-tenancy, RLS, audit trail, effective-dated org chart | Complete |
| Employee master data (performance-relevant fields only) | Partial by design |
| Org chart / positions / departments | Complete |

Supporting: Keycloak SSO with AD federation, 201-file importer, operator CLI,
pre-flight readiness checks, one-command install.

---

## Tier 1 — required before anyone calls this an HR system

These are the modules a PH company will ask about in the first meeting.

### 1. Time & attendance
Daily Time Record, biometric device integration (ZKTeco and similar are near
universal here), shift scheduling, overtime and undertime, official business and
field-work filing, night differential tracking.

Feeds payroll. Without it, payroll is manual data entry and the whole value
proposition collapses.

*Estimate: 8–12 weeks.*

### 2. Leave management
Statutory minimum is not optional and is more than most systems assume:

- Service Incentive Leave — 5 days (Labor Code Art. 95)
- Maternity — 105 days, +15 solo parent (RA 11210)
- Paternity — 7 days (RA 8187)
- Solo Parent — 7 days (RA 8972, expanded by RA 11861)
- VAWC — 10 days (RA 9262)
- Special Leave for Women — up to 2 months (RA 9710)
- Company vacation/sick leave on top, with accrual, carryover and monetisation

Plus approval routing that follows the reporting line this system already
models correctly.

*Estimate: 6–8 weeks.*

### 3. Payroll
The big one, and the one with real liability.

- Semi-monthly cycles (the PH norm), cut-offs, off-cycle runs
- BIR withholding under the TRAIN tables; Forms 2316, 1601-C, and the alphalist
- SSS (RA 11199), PhilHealth (RA 11223), Pag-IBIG — contributions **and** loans
- 13th month pay (PD 851) and de minimis benefits
- Overtime 25%/30%, night differential 10%, regular holiday 100%/200%, special
  holiday 30%
- Final pay within 30 days (DOLE Labor Advisory 06-20), COE within 3 days
- Payslips, bank files, payroll register

**This is where D-009 breaks.** Payroll requires the full statutory identifier
set and salary data, which changes the system's risk profile completely: NPC
registration obligations, a named Data Protection Officer, breach notification
duties, and encryption-at-rest expectations that the current design does not
carry because it never needed to.

*Estimate: 16–24 weeks, plus ongoing maintenance every time a contribution table
changes — which is most years.*

### 4. Full 201 file & document management
Contracts, clearances, NBI, PEME, disciplinary records, certificates — with
retention rules and access controls. Today the importer deliberately drops all
of this.

*Estimate: 4–6 weeks.*

---

## Tier 2 — expected by mid-sized companies

### 5. Employee relations & discipline
Notice to Explain, the twin-notice rule, administrative hearings, sanctions,
case history. Due process here is statutory; getting the workflow wrong exposes
the customer to illegal-dismissal claims. Natural adjacency to the existing PIP
module.

*Estimate: 4–6 weeks.*

### 6. Recruitment / ATS
Requisitions, postings, applicant pipeline, interview scheduling, offers,
pre-employment checks. Feeds onboarding, which feeds the 201 file.

*Estimate: 8–10 weeks.*

### 7. Onboarding & offboarding
201 checklists, asset issuance, clearance routing, exit interviews, quitclaims,
COE generation. Regularisation tracking against the 6-month probationary period
(Art. 296) is genuinely valuable and cheap — the employment data already exists.

*Estimate: 4–6 weeks.*

### 8. Benefits administration
HMO enrolment and dependants, government benefit claims (sickness, maternity,
Pag-IBIG MP2), loan tracking.

*Estimate: 4–6 weeks.*

---

## Tier 3 — differentiators

- **Compliance calendar & DOLE reporting** — Rule 1020, OSH under RA 11058,
  incident reporting. Low effort, high trust.
- **Data Privacy Act (RA 10173) tooling** — consent, data-subject requests,
  retention schedules, breach register. The architecture is already unusually
  well placed for this; it would be a credible differentiator against Sprout.
- **Safe Spaces Act (RA 11313)** — committee, confidential reporting channel.
- **Engagement surveys**, pulse checks, eNPS.
- **Succession planning** — the nine-box already exists; this is the layer above.
- **Mobile app / PWA** — timekeeping and leave filing are phone-first here.
- **Employee self-service kiosk** for factory or field staff without laptops.

---

## Two credible strategies

### A. Stay a performance specialist
Do not build payroll. Integrate with the payroll systems companies already run
(Sprout, PayrollHero, local providers) via export and API. Add Tier 1 items 2
and 4, plus Tier 2 items 5 and 7 — all of which stay within the current data
model and risk posture.

Keeps D-009 intact, keeps the security story clean, ships in months not years.
Sells as "the performance layer your payroll system does not have".

### B. Become a full HRIS
Build Tiers 1 and 2 in order. Roughly **12–18 months** of sustained work and a
different compliance posture from day one: NPC registration, a DPO, encryption
at rest, and a standing obligation to track statutory table changes.

Larger market, much larger liability, and a permanent maintenance tail.

**Recommendation: A, then reassess.** The performance module is genuinely
strong and nothing comparable is sold on-premise here. Payroll is a commodity
with entrenched incumbents and an annual compliance treadmill. Winning on
"your data never leaves your building" is a better wedge than competing with
Sprout on the feature they have had for a decade.

If the customer's real requirement is payroll, that is worth knowing now — the
answer changes the architecture, not just the backlog.

---

## Sequencing, if we proceed

Each phase ends with a working, tested, deployable system. No phase begins
before the previous one is validated.

| Phase | Scope | Weeks |
|---|---|---|
| 8 | Leave management | 6–8 |
| 9 | Full 201 & document management | 4–6 |
| 10 | Employee relations & discipline | 4–6 |
| 11 | Onboarding / offboarding / regularisation | 4–6 |
| 12 | Time & attendance | 8–12 |
| — | **Decision point on D-009 and payroll** | — |
| 13+ | Payroll, if approved | 16–24 |
