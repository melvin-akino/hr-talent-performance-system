# HR Talent & Performance System

Goals, KPIs, reviews, competencies and development — for Philippine companies
that need their employee data to stay on their own server.

Built as an on-premise alternative to SaaS HR platforms. The entire stack runs
inside the office LAN: PostgreSQL, Keycloak, the API and the SPA, behind Caddy.
Nothing leaves the building.

**Payroll, timekeeping and statutory filing are deliberately out of scope**
([D-002](docs/decisions.md), [D-014](docs/decisions.md)). This system stores no
TIN, SSS, PhilHealth, Pag-IBIG number, address, birthdate or salary — and a test
scans every text column on every build to keep it that way
([D-009](docs/decisions.md)).

---

## Status

Phases 0–7 complete. **783 automated tests** — 654 against a real PostgreSQL via
Testcontainers, 129 component and content tests, plus 14 Playwright journeys
covering sign-in, the goal lifecycle, sign-off gating and responsive layout. RLS
policies are the security boundary and cannot be verified against mocks.

| Area | State |
|---|---|
| Goals, KPIs, weighted attainment, check-ins | Complete |
| Monitoring, escalation, Performance Improvement Plans | Complete |
| Review cycles: self → supervisor → calibration → sign-off | Complete |
| Versioned review forms, rating scales, competency frameworks | Complete |
| Peer feedback, learning library, career paths | Complete |
| Analytics: nine-box, distribution, rater bias, calibration movement | Complete |
| Notifications (in-app + email, durable outbox) | Complete — 17 events; deadline reminders pending |
| Multi-tenancy, audit trail, effective-dated org chart | Complete |
| One-command install (on-prem and AWS demo) | Complete |
| Task metrics: catalogue, scorecards, effective-dated assignment | Complete |
| Evaluation against a scorecard, with snapshotted lines | Complete |
| Opening a period for a whole section, with a dry run | Complete |
| Per-employee history across reviews, evaluations, PIPs and employment | Complete |
| Evaluation types as configuration — probationary, annual, semi-annual, project, KPI | Complete |
| HCM target approval, and the Department Head review step | Complete |
| Peer review: routing, sampling, the eligibility gate and the 30-point instrument | Complete; averaging and anonymity await answers |
| UI on the Industry design system, grouped navigation | Complete — all 24 screens |
| In-app help — 14 bundled articles, role- and route-aware | Complete |
| HR-authored help content, published from Setup | Complete |
| Active Directory federation | Configured, untested against a real directory |

---

## Quick start (local development)

Requires Docker, Node 22 and pnpm 10.

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm --filter @hr/api hr seed-demo
pnpm dev
```

Sign in at `http://localhost:5273` as `maria` / `test1234` (CEO and HR admin).

Other demo users: `jose`, `ana`, `paolo`, `grace`, `ramon`.

The dev server deliberately uses **5273**, not Vite's default 5173. That port is
shared by every Vite project on a machine, and a PWA that once ran there leaves
a service worker registered for the whole origin — which then serves its cached
shell here instead of this app.

Mail is captured by Mailpit at `http://localhost:8025` — notifications are
verifiable end to end without a real relay.

---

## Deployment

One command, on any Linux server:

```bash
./ops/deploy/install.sh --host hr.office.local \
  --org ACME --org-name "Acme Corporation" \
  --staff-csv ./staff.csv --hr-admin 00001
```

It checks the host, generates secrets, builds, starts the stack, applies
migrations, provisions the Keycloak realm, imports staff, derives roles from the
org chart, opens a goal period, and finishes with a 19-point readiness check.
Idempotent — safe to re-run.

For the hosted demo on AWS:

```bash
./ops/deploy/aws-demo.sh --host demo.example.com --acme-email you@example.com
```

Full procedure, including Active Directory: **[docs/pilot-runbook.md](docs/pilot-runbook.md)**.

---

## Architecture

- **PostgreSQL 16** — Row-Level Security is *the* authorization boundary, forced
  on every table. The API connects as a role that is neither superuser nor table
  owner, so it cannot bypass policy even by accident.
- **NestJS + TypeScript** — identity is set per transaction with `SET LOCAL`,
  never per session, so a pooled connection cannot leak one user's identity to
  the next request.
- **React 19 + Vite + Tailwind v4** — single-page app, same origin as the API.
- **Keycloak** — OIDC, federating to Active Directory. Employees are resolved by
  token subject, never by an email claim.
- **Caddy** — one origin for SPA, API and Keycloak; TLS terminated at the edge.

Two principles run through the schema: **definitions are versioned and instances
snapshot the version they were issued under** (a review cannot silently change
because HR edited the form), and **the org chart is effective-dated** (last
year's review is calibrated against last year's reporting line).

### Documentation

| Document | Contents |
|---|---|
| [architecture.md](docs/architecture.md) | Entity map, schema, principles |
| [decisions.md](docs/decisions.md) | 14 ADRs — what was decided and why |
| [roadmap.md](docs/roadmap.md) | Phases 0–7 with validation checklists |
| [pilot-runbook.md](docs/pilot-runbook.md) | Install, AD federation, first login |
| [feature-roadmap.md](docs/feature-roadmap.md) | Gap analysis for a full PH HR platform |
| [design-handoff.md](docs/design-handoff.md) | UI redesign brief |
| [client-requirements.md](docs/client-requirements.md) | Client requirements cross-matched to the build, with the gap plan |
| [client-questions.md](docs/client-questions.md) | Open questions sent to the client (round 1) |
| [client-questions-round2.md](docs/client-questions-round2.md) | Round 2 — what the HCM workbook answered, and what it raised |
| [handoff/ENGINEERING-HANDOFF.md](docs/handoff/ENGINEERING-HANDOFF.md) | Onboarding for a new engineer or agent — rules, gotchas, work queue |
| [handoff/CURRENT-STATE.md](docs/handoff/CURRENT-STATE.md) | Resume point — what is done, what is next, what bites locally |
| [demo-logins.md](docs/demo-logins.md) | Dev logins for walkthroughs, and which tenant has which data |

---

## Importing a Philippine 201 file

```bash
pnpm --filter @hr/api hr import-201 --org ACME --file ./201.csv --dry-run
```

Reads a 201 file under its own column names. Two columns must be added to a
standard export:

| Column | Why |
|---|---|
| `Division` / `Section` / `Area` / `Branch` | Optional. Given, the importer builds the org tree and files the person in the deepest unit named — which is what makes an Area Head's grant reach a branch. A file with only `Department` still imports as a flat list. A row naming both a Section and an Area is rejected: they sit at the same level but are different in kind. |
| `Rank` | Optional. The ladder position, where a **lower number is more senior**. Creates the rank and puts the position on it; `Rank_Title` names it. Must be a number — if your file uses `Rank` for a text grade, rename it to `Job_Level`. |
| `Supervisor_ID` | Another row's `Employee_ID`. **This is the org chart** — without it no manager sees a team, no goal is approved, no review is assigned. Exactly one person (the top) leaves it blank. |
| `Work_Email` | Binds the person to their AD account at first login. The personal `Email` column is not imported. |

It derives department codes, creates missing departments and employment types,
and maps Philippine employment terms (Regular, Probationary, Project-based,
Contractual, Casual, Seasonal, OJT, Consultant).

**Always dry-run first.** The dry run reports every column it will *not* import,
anyone missing a work email or supervisor, and validates the whole file before a
single row is written. It rejects an unrecognised employment status rather than
guessing.

A worked example with a 27-person org chart lives in
[`db/seeds/devcore-201.csv`](db/seeds/devcore-201.csv).

---

## Operator CLI

Run on the host; never exposed over HTTP. Requires `ADMIN_DATABASE_URL`.

| Command | Purpose |
|---|---|
| `provision-org` | Create a tenant with roles, grants, templates, starter form, and the two 100-point prepared formats |
| `import-201` / `import-employees` | Load staff |
| `sync-roles` | Derive `employee` / `manager` from the reporting lines |
| `grant-admin` | Bootstrap the first HR administrator |
| `open-goal-period` | Open a period so goals can be filed |
| `preflight` | 22 readiness checks across security, identity, data and configuration |
| `seed-demo` | Development data. Refuses `NODE_ENV=production`, and any organisation holding employees it did not create |
| `seed-activity` | Demo activity for an org whose staff are already imported. Requires `--yes-i-mean-it` |

---

## Testing

```bash
pnpm test
```

Every suite starts a real PostgreSQL, applies all migrations, and connects as
the unprivileged application role — with a guard that fails the run if it ever
finds itself connected as a superuser, because every deny-assertion would then
be silently vacuous.

The HTTP suites boot the real application behind a real OIDC signature check,
signing genuine RS256 tokens against a local JWKS. Nothing about the security
boundary is mocked.

End-to-end tests run separately, because they need the dev stack, Keycloak and
seeded data:

```bash
pnpm e2e
```

They are deliberately few — they exist to prove the paths that span browser,
OIDC, API, RLS and Postgres still connect, which no unit test can. Everything
cheaper to test elsewhere is tested elsewhere.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Two rules matter more than the rest:

1. **Migrations are immutable once merged.** Checksums are enforced by the
   migration runner and by CI. Write a new one.
2. **Any table carrying `org_id` needs an RLS policy and a case in
   `test/tenancy.spec.ts`** ([D-008](docs/decisions.md)).

Security issues: see [SECURITY.md](SECURITY.md).
