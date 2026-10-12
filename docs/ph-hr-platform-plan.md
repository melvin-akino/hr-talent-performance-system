# Plan: a complete HR and payroll platform for the Philippine market, on AWS

Status: **PROPOSED**. Nothing here is approved or built. Four accepted decisions
(D-001, D-002, D-009, D-014) are reversed by it, so it needs your explicit sign-off
before Phase 0 starts. Written 2026-10-12.

---

## 1. Objective

Turn the current performance-and-talent system into a hosted, multi-company HR
platform that a Philippine employer can run the whole employee lifecycle on:
hire, time, leave, pay, comply, evaluate, separate. Payroll is the centrepiece.
It runs on AWS as a SaaS, not on a customer's premises.

Today's product is roughly a quarter of what a Philippine company means by "an HR
system" ([feature-roadmap.md](feature-roadmap.md)). The other three quarters are
where the Labor Code, BIR, SSS, PhilHealth, Pag-IBIG and DOLE apply.

## 2. Scope boundaries

**In scope**
- Full employee master (201 file) including the statutory identifiers
- Time and attendance, holidays, schedules, overtime, night differential
- Leave (statutory and company), with balances and accruals
- Payroll: gross-to-net, 13th month, loans, final pay, payslips, bank files
- Statutory contributions, withholding tax, and the government reports and files
  that come out of them
- Separation, clearance, certificate of employment
- Employee relations and the due-process paper trail
- AWS hosting, tenant onboarding, billing, security and compliance programme

**Out of scope for this plan** (each is its own later decision)
- Recruitment and applicant tracking
- Benefits administration (HMO enrolment, insurance)
- Direct filing with BIR/SSS/PhilHealth/Pag-IBIG, unless an API exists. Until then
  the system produces the exact files and the customer uploads them
- Expense and travel management
- Countries other than the Philippines
- A native mobile app. The web app must be good on a phone first

**Kept as is:** everything in the current system. Performance, goals, reviews, PIPs,
competencies, feedback and analytics are the differentiator and sit alongside payroll.

## 3. Conflicts with accepted decisions

The architecture rules say to name a conflict and get approval before proceeding.
These are the conflicts, and the lowest-risk way through each.

| Decision | What it says | What this plan needs | Proposed resolution |
|---|---|---|---|
| **D-001** on-premise | No cloud in the runtime path | AWS SaaS | Supersede. Keep the existing install supported for current customers; **payroll is AWS-only**. Never ship payroll on a customer's server (see risks) |
| **D-002 / D-014** no payroll, "will not" | Payroll excluded; revisit "if a customer makes it a condition of sale… priced and staffed as one" | Payroll | Supersede, and honour the clause that governs the reversal: treat payroll as a separate product line with its own team, budget, compliance owner and price, not as a few more migrations |
| **D-009** no statutory IDs, salary, birthdate, address | A build-failing test forbids them in text columns | Required for payroll | Replace the blanket ban with a **data classification registry** (see 5.4). Sensitive fields are allowed only in a dedicated schema, application-level encrypted, with their own access path. The test is kept and rewritten to enforce the registry |
| **D-015** attendance enters as a count | Refuses raw time records | System now owns attendance | Supersede for customers using our timekeeping. Keep the count interface for customers who keep an outside timekeeping system |
| **D-007** compensation deferred | No compensation features | Salary and pay structures | Supersede |
| **D-005** no queue, Postgres only | PG is the job queue | Payroll runs are long, burst-heavy and must not double-run | Keep it. Payroll runs are per-company batches in the hundreds-to-thousands of employees. Revisit only if measured contention appears |
| **D-011 / D-012 / D-008** SaaS later, one Keycloak realm, multi-tenant RLS | | | **Consistent.** This plan is the "later". The three one-way doors (identity, single-tenant restore, per-tenant export) become Phase 1 work |
| **D-013** VPN remote access | | Public SaaS | Not applicable on AWS |

If you approve, I will record these as D-021 onward and mark D-001, D-002, D-007,
D-009, D-014, D-015 as superseded, rather than editing them silently.

## 4. Target architecture on AWS

**Region.** ap-southeast-1 (Singapore). AWS has no Philippine region. The Data
Privacy Act allows transfer abroad where the controller stays accountable, but
some customers will ask: it goes in the sales material and the data processing
agreement, and needs a lawyer's confirmation.

```
Users ─► Route 53 ─► CloudFront + WAF ─┬─► S3 (web bundle, landing page)
                                        └─► ALB ─► ECS Fargate
                                                    ├─ api   (NestJS)
                                                    ├─ worker (jobs: payroll runs, emails, imports)
                                                    └─ keycloak
                                                 RDS PostgreSQL (Multi-AZ, PITR)
                                                 S3 (documents, payslips, BIR files; SSE-KMS)
                                                 KMS (per-tenant data keys)
                                                 SES · Secrets Manager · CloudWatch
```

| Concern | Choice | Why / note |
|---|---|---|
| Compute | ECS Fargate, `api` and `worker` as separate services | No servers to patch. Workers scale independently of the web tier |
| Database | RDS PostgreSQL 16, Multi-AZ, point-in-time recovery | Keeps **RLS** (D-003), which is the whole authorization model. Do not move to a database that cannot do it |
| Identity | Keep Keycloak (on Fargate, own RDS) for now | Avoids rewriting `idp_subject` and the per-customer IdP model from D-012. Reassess Cognito once there are many tenants and someone is paged for Keycloak |
| Documents | S3 with SSE-KMS, versioning, Object Lock on payroll records | Payslips, 2316s and files must be tamper-evident and retained (period to confirm with counsel; the Labor Code and the tax code differ) |
| Sensitive columns | **Application-level envelope encryption** with a KMS key per tenant | A database administrator or a leaked snapshot then does not expose TIN, SSS, bank account or salary |
| Email | SES | Already an outbox pattern in place |
| Network | Private subnets, VPC endpoints, one NAT | NAT is a real monthly cost; budget it |
| Accounts | Separate prod, staging, shared-services and log-archive accounts | Production data never reaches staging. Staging uses synthetic data only |
| IaC and delivery | Terraform (or CDK), CI/CD with migrations gated | Migrations are immutable and checksummed already, which suits this |
| Detection | CloudTrail, GuardDuty, Config, Security Hub, alarms on payroll jobs | Payroll failing silently is the worst failure mode |
| Backups | RDS PITR plus a snapshot copy into a separate backup account | Include a **rehearsed single-tenant restore** (D-011 door 2) |

**Order of magnitude, to be replaced by a real estimate in Phase 1:** a minimal
production environment (Multi-AZ database, two small Fargate tasks, ALB, NAT, WAF,
logging) is in the low hundreds of US dollars per month, before data transfer.
Staging adds roughly half again. The free-tier demo host is not a production shape.

## 5. Domain design

### 5.1 Modules, in dependency order

1. **Employee master.** Personal data, addresses, dependents (for tax and benefits),
   government IDs, employment history, contract type, regularization date, pay
   group. Effective-dated, like the org chart is today.
2. **Time and attendance.** Schedules and shifts, web and mobile clock-in with
   geofence option, biometric device import, official business, overtime and
   undertime filing, rest days, holiday calendar. Approvals reuse the request flow
   (D-017).
3. **Leave.** Statutory and company leave types, accrual rules, balances, carry-over
   and conversion, approval, calendar.
4. **Payroll.** See 5.2.
5. **Statutory reporting.** See 5.3.
6. **Separation.** Resignation and termination workflows, clearance, final pay,
   certificate of employment, exit data into the tax annualization.
7. **Employee relations.** Notice to explain and the two-notice rule, incident and
   grievance records, case files with restricted visibility.

### 5.2 Payroll engine design

- **A pure function.** `(employee facts, period inputs, rule set version) → payslip
  lines`. No clock, no database reads inside. That makes it testable against
  golden cases and re-runnable.
- **Rules are data, effective-dated and versioned**, never constants in code:
  contribution tables, tax tables, rates and divisors, holiday premiums, wage
  orders by region. A rule change is a new row with an effectivity date, reviewed
  by a named compliance owner. This is the main defence against the "chasing
  regulation" cost in D-014.
- **A run is immutable once released.** Corrections are new adjusting lines in the
  next run or a reversal run, never edits. Same principle as published form
  versions.
- **Maker-checker.** The person who prepares a run cannot release it. Release needs
  step-up authentication. Every release writes to the audit log.
- **Components:**
  - Earnings: basic, overtime (regular, rest day, holiday), night differential,
    holiday pay, paid leave, allowances (taxable and de minimis kept separate),
    commissions, bonuses, 13th month
  - Deductions: absences, tardiness, undertime, statutory contributions, loans
    (SSS, Pag-IBIG, company), cash advances, other
  - Tax: withholding on compensation with annualization, minimum-wage-earner
    handling, substituted filing, year-end adjustment
  - Outputs: payslip PDFs, payroll register, journal entry export, bank
    disbursement files in each bank's format
- **Cycles:** semi-monthly, monthly and weekly pay groups, with off-cycle runs for
  final pay and corrections.
- **Time to pay bridge.** The attendance module produces approved quantities per
  employee per period. Payroll consumes only approved quantities, so a disputed
  punch cannot silently change a payslip.

### 5.3 Statutory scope, and the discipline for numbers

What the system must cover. The legal basis is listed so a compliance reviewer can
check each row. **Rates, brackets, ceilings and form versions change; none of the
values should be taken from this document.** They come from the current issuances
at build time, are entered as effective-dated rule rows, and are signed off by the
compliance owner.

| Area | Basis | What it drives |
|---|---|---|
| Wages, overtime, night differential, holiday and rest-day pay, service incentive leave, 13th month | Labor Code (PD 442), PD 851, regional wage orders, annual holiday proclamations | Earnings rules, minimum-wage checks per region |
| SSS | Social Security Act of 2018 (RA 11199) | Employee and employer share, EC, loans, reporting |
| PhilHealth | Universal Health Care Act (RA 11223) | Premium with floor and ceiling, split |
| Pag-IBIG / HDMF | RA 9679 | Contribution, loans |
| Income tax withholding | NIRC as amended by TRAIN (RA 10963), later issuances | Withholding tables, annualization, 13th month and de minimis exclusions |
| Government forms | BIR (1601-C, 1604-C and alphalist, 2316 and others), SSS, PhilHealth, Pag-IBIG | Generated files in the agencies' formats, filing calendar, reminders |
| Leaves | EMLA (RA 11210), Paternity (RA 8187), Solo Parents (RA 8972), VAWC leave (RA 9262), Magna Carta of Women special leave (RA 9710), SIL | Leave types with eligibility rules |
| Final pay, separation, retirement | Labor Code, RA 7641, DOLE advisories | Final pay computation and deadline tracking |
| Privacy | Data Privacy Act (RA 10173) and NPC rules | Section 6 below |
| Workplace | OSH law (RA 11058), Safe Spaces Act (RA 11313) | Records and reports in employee relations |
| Filing and compliance changes | Ease of Paying Taxes Act (RA 11976) | Check what changed for filing and penalties |

Items that need counsel or a payroll specialist before build, because they are
judgement calls and not lookups: how holiday pay interacts with monthly-paid
versus daily-paid employees and the pay divisor, treatment of de minimis benefits,
substituted filing eligibility, and the retention period for each record class.

### 5.4 Data classification

Replace the one-line ban in D-009 with a registry: every column is classified
`public`, `internal`, `personal`, or `sensitive`. Sensitive means government IDs,
bank accounts, salary, tax data, medical and disciplinary records.

- Sensitive columns live in a separate schema, encrypted at the application level.
- Reads of them are audited, and the audit log records who looked, not only who
  changed.
- Access needs a distinct permission. Being someone's manager does not grant it.
- The existing test that scans every column is kept. It is rewritten to fail the
  build when a column is **unclassified**, so the safety property survives the
  change of policy.
- Row-level security continues to be the boundary. Payroll tables follow the same
  `app.can_access` pattern, with a stricter predicate (HR payroll role only).

## 6. Compliance and operating model

- **Data Privacy Act:** appoint a Data Protection Officer, register processing with
  the NPC where required, keep a privacy impact assessment and a breach response
  runbook (72-hour notification), and sign a data processing agreement with every
  customer. Payroll data makes this mandatory in practice, not optional.
- **Security:** annual penetration test, vulnerability management, least-privilege
  IAM, MFA for all staff, step-up for payroll release. Plan for ISO 27001 or SOC 2
  once there are paying tenants. Large employers will ask for one.
- **Regulatory watch:** one named person owns "what changed this quarter". Without
  that, payroll rots silently.
- **Support:** payroll customers expect help on pay day. That means an on-call
  rotation and a stated service level, which is a staffing cost, not a feature.
- **Audit trail:** payroll, time and leave all write to the audit log with the
  rule-set version used.

## 7. Phases

Each phase ends with a stop. Per the phased-development rule, nothing in the next
phase starts until the current one is validated and approved. Effort figures are
engineer-months for a team of about 4–6, are rough, and should be re-estimated at
the end of Phase 0.

| Phase | Content | Exit criteria | Effort |
|---|---|---|---|
| **0. Decide and prepare** | Approve this plan and write the superseding ADRs. Engage a PH labor and tax advisor and a payroll compliance owner. Pick the first payroll customer. Name the DPO. Legal review of cross-border hosting. Data classification registry design | ADRs approved; advisor and owner named; first customer committed to a parallel run; written scope per module | 1 |
| **1. AWS foundation and tenancy** | Accounts, IaC, network, RDS Multi-AZ, Fargate, CI/CD, observability, backups with rehearsed restore, per-tenant export, tenant onboarding, per-customer SSO, KMS envelope encryption, cost estimate | Current product runs on it unchanged; a second synthetic tenant is provisioned by script and cannot see the first; single-tenant restore rehearsed and timed; pen-test findings triaged | 3–4 |
| **2. Employee master (full 201)** | Sensitive schema, classification registry and test, statutory IDs, addresses, dependents, employment history, document handling, import of existing data | Registry test enforces classification; sensitive reads audited; encrypted at rest verified from a raw snapshot | 2 |
| **3. Time, attendance and leave** | Schedules, clock-in, biometric import, holidays, OT filing, leave types and accruals, approvals | Approved quantities for a real period reproduce the customer's own timesheet within agreed tolerance | 4 |
| **4. Payroll core** | Rule tables, engine, runs, maker-checker, payslips, register, journal export, loans, 13th month, bank files | **Parallel run:** three consecutive real cycles for the pilot customer match their current payroll to the centavo, with every difference explained | 6–7 |
| **5. Statutory reporting** | Contribution reports and remittance files, BIR files and annualization, 2316, alphalist, filing calendar | Files accepted by each agency's validation tool for the pilot customer, including one year-end | 3 |
| **6. Separation and final pay** | Resignation and termination flows, clearance, final pay, COE, exit tax adjustment | Final pay for sample separations verified by the advisor | 2 |
| **7. Employee relations** | Notices and two-notice rule, case files, restricted visibility, DOLE reports | Case access restricted by RLS and tested | 2 |
| **8. Commercial readiness** | Billing, self-service onboarding, support tooling, status page, SOC 2 or ISO 27001 readiness, pricing | First paying customer beyond the pilot | 2–3 |

Roughly **25–30 engineer-months, or 12–18 calendar months** with the team above, and
that excludes the advisor, the DPO, certification and on-call support.
Payroll (Phases 4 and 5) is the long pole and the one that cannot be compressed by
adding people, because it is gated on real pay cycles. Three parallel-run cycles
alone take at least six weeks on a semi-monthly calendar.

**Suggested early value:** Phase 3 (time and leave) can go live for customers before
payroll exists, and starts producing the attendance data payroll needs.

## 8. Files and areas affected

New, not yet created:
- `docs/decisions.md`: new ADRs D-021 onward; mark the superseded ones
- `docs/architecture.md`, `docs/infra.md`: AWS target architecture
- `infra/` (Terraform or CDK), new top-level directory
- `db/migrations/`: classification registry, sensitive schema, then module tables
- `apps/api/src/`: new modules `payroll/`, `time/`, `leave/`, `statutory/`,
  `separation/`, `relations/`; a pure `payroll-engine/` package with no I/O
- `apps/web/src/pages/`: matching screens, payslip view, employee self-service
- Existing tests: the D-009 column test is rewritten, not deleted

Existing code is reused and not rebuilt: RLS and tenant model, request-and-approval
flow, audit log, versioned definitions, notification outbox, importer, help centre,
effective-dated org chart.

## 9. Validation checklist

- [ ] Every statutory value traces to a dated source and a named reviewer
- [ ] The payroll engine is covered by golden-case tests built with the advisor, and
      by property tests (net never exceeds gross, contributions within ceilings)
- [ ] Re-running a closed period with the same rule version reproduces it exactly
- [ ] A released run cannot be edited; corrections appear as new lines
- [ ] The preparer of a run cannot release it
- [ ] RLS tests: payroll data invisible to managers, peers, and other tenants, in
      both directions, including with RLS-bypassing connections for composite keys
- [ ] A raw RDS snapshot does not contain readable TIN, SSS, bank account or salary
- [ ] Every read of a sensitive field is audited
- [ ] Parallel run of three cycles matches the incumbent payroll
- [ ] Single-tenant restore rehearsed with a measured time
- [ ] Agency validation tools accept every generated file
- [ ] Every new route has an HTTP-level test (the lesson of D-019)
- [ ] Penetration test, and a breach-response drill, before the first real payroll

## 10. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Pay errors are real money and legal exposure** | A wrong deduction is an underpayment claim, and wrong remittances bring penalties | Parallel run, golden tests, maker-checker, immutable runs, advisor sign-off, errors-and-omissions insurance |
| **Regulatory drift** | Rates, forms and rules change several times a year | Data-driven rule tables, named owner, quarterly review, change log |
| **Breach impact rises sharply** | The system will hold the most sensitive data an employer has | Envelope encryption, classification registry, audited reads, DPO, breach drill, small blast radius per tenant key |
| **Accepted decisions reversed** | D-014 says payroll is "a different product" | Approve explicitly, and fund it as one (separate owner, budget, compliance function) |
| **Scope is much larger than the current product** | The current product is about 20–25% of the whole | Phase gates; ship time and leave first; refuse optional modules until payroll is stable |
| **One pilot customer shapes everything** | Their rules may not generalise | Make every company-specific rule configuration, not code; recruit a second design partner before Phase 4 ends |
| **Hosting abroad** | No Philippine AWS region | Legal review, DPA wording, disclose it, offer nothing on-prem for payroll |
| **Runaway AWS cost** | NAT, Multi-AZ and logging cost money before any revenue | Real estimate in Phase 1, budget alarms, one environment per purpose |
| **Key-person risk** | Payroll expertise is scarce | Advisor on retainer, documented rule provenance, no logic only in someone's head |
| **Existing on-prem customers** | They are on a path this plan stops extending | State a support policy; no payroll for them on-prem |
| **Estimates** | These are from the current codebase and public knowledge of PH payroll, not a spike | Re-estimate after Phase 0 and again after Phase 1 |

## 11. Decisions I need from you

1. **Approve the reversals** in section 3, or tell me which ones to keep.
2. **Who is the first payroll customer**, and will they do a three-cycle parallel
   run? Without one, Phase 4 cannot be validated.
3. **Is Guanzon that customer**, and do they want payroll from us, given they asked
   for performance and talent?
4. **Target segment and size:** employees per customer (for example 50–500)? That
   changes the pay-cycle, bank and support requirements.
5. **Who is the payroll compliance owner and the advisor?** Neither is something I
   can supply.
6. **On-prem policy** for existing installs: maintained as is, or migrated to AWS?
7. **Budget and team** assumptions: the effort estimates assume 4–6 engineers.

## 12. Next recommended step

Phase 0 only. On your approval I will:
1. write the superseding ADRs (D-021 onward) and mark the old ones superseded,
2. draft the data classification registry and the rewritten column test, and
3. produce a one-page scope per module for the advisor to review.

I will not start AWS work or payroll code until Phase 0 is signed off.
