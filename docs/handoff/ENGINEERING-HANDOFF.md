# Engineering handoff

For whoever picks this up next — human or agent. Written to be read cold, in
order. If you read only one section, read §2 (the rules) — every one of them
exists because breaking it caused real damage that surfaced late.

---

## 0. Read these first, in this order

| # | File | Why |
|---|---|---|
| 1 | [../../README.md](../../README.md) | What the product is, how to run it |
| 2 | [../decisions.md](../decisions.md) | 14 ADRs. The *why* behind everything below |
| 3 | [../../CONTRIBUTING.md](../../CONTRIBUTING.md) | The rules, stated as rules |
| 4 | [../architecture.md](../architecture.md) | Entity map and schema principles |
| 5 | [../client-requirements.md](../client-requirements.md) | The work queue — new client requirements, gap analysis, phased plan |
| 6 | [../demo-logins.md](../demo-logins.md) | Accounts for clicking around |

---

## 1. Source control — read before your first commit

```
origin  https://github.com/melvin-akino/hr-talent-performance-system.git
main    117641f  Import HR talent & performance system   (217 files)
```

The repository was initialised and pushed at handoff time, so there is **one
commit and no history before it**. Everything that came before — every fix
described in §6, every decision in the ADRs — happened before version control
existed and is recorded in the documents rather than in the log. Treat
`docs/decisions.md` as the history for anything older than that commit.

### What is deliberately not committed

`.gitignore` excludes `.env`, `node_modules/`, `dist/`, database dumps, and
`.auth/` (Playwright's saved session state — a real token, not a fixture). The
root `.env` holds generated secrets for the production compose stack and exists
only on the machine that ran the installer; a fresh clone has no `.env` at all,
which is why `ops/deploy/install.sh` generates one.

Two deliberate exceptions, both verified before the import commit:

- **`apps/api/.env.development` and `apps/web/.env.development` are committed.**
  Every value in them is a throwaway credential for the containers in
  `docker-compose.dev.yml`, already in plain text there. They are committed so
  `pnpm dev` works from a clean checkout instead of failing with a configuration
  error each new contributor has to debug once. Never add a real secret to either.
- **`db/seeds/devcore-201.csv` is force-included.** `/db/seeds/*.csv` is ignored
  because operator CSVs can hold real employee data, but this one is the
  27-person *simulated* org the README cites as a worked example, and the link
  would otherwise break in a fresh clone.

**Before any commit that touches configuration**, confirm the real `.env` is not
staged:

```bash
git status --short | grep -E "\.env$" && echo "STOP: .env is staged"
```

The dev fixture passwords in `ops/keycloak/realm-hr.json` and
`docker-compose.dev.yml` are committed by design — they are local container
credentials, and the files say so. If the repository is public they are visible to
anyone, which is acceptable for exactly that category and nothing else. Anything
outside it does not belong in the repository at all.

---

## 2. The rules that must not be broken

These are enforced by tests and CI, not by convention. Each has a reason that is
not obvious from the code.

### 2.1 Row-Level Security is *the* authorization boundary

Not a second layer behind application checks — the boundary itself
([D-003](../decisions.md)). Every table has `ENABLE` **and** `FORCE ROW LEVEL
SECURITY`, and policies route through one predicate:

```sql
app.can_access(resource_type, action, target_employee_id, as_of)
```

- Any new table carrying `org_id` needs a policy **and** a case in
  `apps/api/test/tenancy.spec.ts` ([D-008](../decisions.md)).
- The API connects as `hr_app`: not a superuser, owns nothing, `NOBYPASSRLS`. The
  migrator role must never appear in the API's `DATABASE_URL`.
- Every RLS suite asserts it is *not* connected as a superuser. Do not remove that
  guard — without it, every deny-assertion passes while testing nothing.

### 2.2 Identity is transaction-scoped

`SET LOCAL app.current_employee_id`, never `SET`. A session-scoped GUC persists on
a pooled connection and hands the next request the previous user's identity, with
no error and no log line. `apps/api/test/rls-identity.spec.ts` exists solely to
catch this.

### 2.3 Migrations are immutable once applied

The runner checksums every applied file and refuses to continue if one changed;
CI rejects any PR that modifies or deletes a file under `db/migrations/`. If a
migration is wrong, write another that corrects it. 26 migrations exist today.

### 2.4 No statutory identifiers or personal data

No TIN, SSS, PhilHealth, Pag-IBIG number, address, birthdate, gender, civil
status, contact number, emergency contact, dependant or salary
([D-009](../decisions.md), made permanent by [D-014](../decisions.md)).

`apps/api/test/ph201.spec.ts` scans every text column on every build and fails if
any appears. If a feature seems to need one, that is an architecture discussion
(a new ADR), not a migration.

### 2.5 Definitions are versioned; instances snapshot the version

A review cannot silently change because HR edited the form. A goal snapshots the
KPI definition version it was issued under. **Any new scoring work must follow
this** — see §5.

### 2.6 The org chart is effective-dated

`employment`, `reporting_line` and `department` all carry
`effective_from`/`effective_to`. Last year's review is calibrated against last
year's reporting line. Queries take an `as_of` date rather than assuming today.

### 2.7 UI: one accent colour, no invented hues

Status is carried by icon and word, never by a new colour — no green for good, no
red for bad. Component tests fail if green, red or amber reappear. Two further
rules, both enforced in `apps/web/test/styling-vocabulary.spec.ts`:

- No hard-coded greys (`text-slate-*`, `bg-white`). Use the helpers in
  `industry.css`: `t-muted`, `t-faint`, `t-mono`, `panel-tint`, `bg-surface`,
  `border-divider`, `input-sm`.
- **Two states must never render identically** — the suite fails a ternary whose
  class branches are the same string, and a `Record` map whose entries all
  collapse to one value. Both shipped in the past: a selected tab that looked
  unselected, a met PIP milestone identical to a failed one.

Every route page renders a `<PageHead>`; the Setup tab bodies under
`src/pages/admin/` deliberately do not (Setup supplies it). Also enforced.

---

## 3. Running it

Requires Docker, Node 22, pnpm 10. On Windows, Git Bash or PowerShell both work.

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm --filter @hr/api hr seed-demo            # ACME, 8 people
pnpm dev                                       # API :3000 and web :5273
```

| Service | URL | Notes |
|---|---|---|
| App | http://localhost:5273 | **Not 5173** — see §6 |
| API | http://localhost:3000/api | Global prefix is `/api`; unauthenticated calls return 401 |
| Keycloak | http://localhost:8080 | realm `hr` |
| Mailpit | http://localhost:8025 | catches all outbound email |
| PostgreSQL | localhost:55432 | user `postgres` / `postgres`, db `hr` |

Sign in with any account in [../demo-logins.md](../demo-logins.md); password
`test1234` for all of them.

### Seeding

```bash
# ACME: creates the org and imports its own 8-person CSV
pnpm --filter @hr/api hr seed-demo

# For an org whose staff are ALREADY imported (e.g. DEVCORE, 27 people):
pnpm --filter @hr/api hr seed-activity --org DEVCORE --yes-i-mean-it
```

Both refuse `NODE_ENV=production`. `seed-demo` also refuses an org holding
employees it did not create; `seed-activity` requires the confirmation flag every
time, because pre-existing staff are its whole premise and it writes ratings,
feedback and a PIP against named people.

### Tests

```bash
pnpm test          # 522: 401 API (real PostgreSQL via Testcontainers) + 121 web
pnpm typecheck
pnpm e2e           # 14 Playwright journeys — needs the dev stack running
```

The API suites start a real PostgreSQL per file, apply all migrations, and boot
the real app behind a real OIDC signature check. Nothing about the security
boundary is mocked, because mocks cannot verify RLS.

---

## 4. Repo map

```
apps/api/          NestJS. Modules: auth, employees, goals, reviews, competencies,
                   development, feedback, pip, analytics, notifications, help,
                   import, admin, cli, db, common, config, health
  src/cli/         Operator CLI (hr.ts dispatches): provision-org, import-201,
                   sync-roles, grant-admin, open-goal-period, preflight,
                   seed-demo, seed-activity
  test/            19 spec files, all against real PostgreSQL
apps/web/          React 19 + Vite + Tailwind v4
  src/components/ds.tsx      The design system as React (Card, Btn, Tag, Stat,
                             PageHead, GoalStateTag, ReviewStateTag, …)
  src/styles/industry.css    Tokens and the helper classes
  src/pages/                 18 route pages; admin/ holds the Setup tab bodies
  src/help/content/          Bundled help articles (markdown + frontmatter)
  test/                      5 spec files
db/migrations/     26 immutable SQL files
e2e/               Playwright: auth.setup.ts, golden-paths, responsive
ops/               deploy scripts, keycloak realm + provisioning, caddy, postgres init
docs/              See §9
```

---

## 5. What is built, and what is next

**Built and tested:** goals with weighted attainment and check-ins, monitoring and
escalation, PIPs, review cycles (self → supervisor → calibration → sign-off),
versioned forms and rating scales, competency frameworks with gap analysis,
peer feedback, learning library, career paths, development plans, analytics
(nine-box, distribution, rater bias, calibration movement), notifications
(durable outbox, in-app + email), multi-tenancy, audit trail, effective-dated org
chart, in-app help, one-command install.

**Not built:** everything in the new client requirements. The work queue is
[../client-requirements.md](../client-requirements.md) — read §10 (the phase plan)
and §13 (what is unblocked right now).

The four dominant gaps, in dependency order:

1. **Point-weighted scoring.** Form fields carry no points; `overall_rating` is
   typed in, not computed. Most other requirements sit on top of this. When you
   build it, store a **snapshot of the point map** with each computed score (§2.5)
   — a template edited in March must not change a January evaluation.
2. **Peer review by randomised sampling** — distinct from the existing named
   feedback feature.
3. **Division / Department / Area / Branch.** `department` is already a
   self-referencing effective-dated tree and grant scoping is subtree-aware, so
   this is a `unit_type` label plus a hierarchy constraint, not a new structure.
4. **Attendance from payroll** — blocked on a decision (proposed ADR D-015) about
   what may cross the boundary: aggregates per employee per period, never raw time
   records.

Ten questions are with the client ([../client-questions.md](../client-questions.md)).
Five block work. Q3 (a worked scoring example) unlocks the most.

---

## 6. Gotchas — hard-won, mostly invisible in the code

**Environment**

- **Port 5273, not Vite's 5173.** 5173 is shared by every Vite project on a
  machine, and a PWA that once ran there leaves a service worker registered for
  the whole origin, which then serves *its* cached shell instead of this app. The
  dev realm's redirect URIs are registered for 5273 with `strictPort`.
- `pnpm dev` runs a real `tsc --watch`, not `tsx`. esbuild-based transforms do not
  emit `design:paramtypes`, and without that metadata **NestJS constructor
  injection silently resolves every dependency to `undefined`**. Same reason the
  test runner uses SWC (`apps/api/vitest.config.ts`).
- `VITE_API_BASE_URL` must be `/api` (relative), not `http://localhost:3000/api`.
  The absolute form bypasses the Vite proxy and fails CORS — the API has no CORS
  by design, being same-origin in production.
- `.env` edited on Windows can pick up a BOM and CRLF; `install.sh` normalises on
  read.

**Database**

- **Actor joins under RLS silently drop rows.** `JOIN employee ON e.id =
  record.some_actor_id` looks correct and is not: a report cannot read their own
  manager's employee row, so the join removes the whole record. Nothing errors —
  the person is simply told they have no PIP, no assessment, no check-in. Project
  the name through `app.display_name(uuid)` instead. Three real instances were
  found and fixed; `apps/api/test/own-records.spec.ts` guards the class.
- Postgres cannot infer the type of a parameter used inside `CASE`. `x = $4` is
  fine; `CASE WHEN $4 IS NULL` in the same statement fails with "could not
  determine data type of parameter". Cast explicitly.
- Same-day grant-and-revoke violates `effective_to > effective_from`. `sync-roles`
  handles this by deleting same-day grants rather than closing them.
- Completion pairs are constraints: `dev_action.status='completed'` and
  `completed_on` must agree, likewise `learning_assignment`.
- Table naming is not always what you would guess: `dev_action` (not
  `development_action`, and it has no `org_id`), `pip_plan` (not `pip`),
  `form_response` (not `review_answer`). The attainment function is
  `app.review_goal_attainment`.

**Frontend / testing**

- Playwright `storageState` does **not** persist sessionStorage, where
  oidc-client-ts keeps the user. `e2e/auth.setup.ts` drives the real Keycloak
  login form deliberately — the redirect leg is where this app has broken before
  (missing `/callback` route, dropped `basic` scope, issuer without its path).
- Deep links were lost on sign-in twice: once for want of a `state` capture, once
  because a `<Route path="/callback">` redirect overrode the restored URL.
- RLS denials must map to 403, not 500 — an exception filter translates SQLSTATE
  `42501` and RLS `23514`. Reads of invisible rows return **404**, deliberately: a
  403 would confirm the record exists.
- Writing a deny-test? Send a payload that **passes validation**. A 400 means the
  request was rejected before authorization ran, so it proves nothing while
  reading as coverage.

---

## 7. Conventions

- **Comments explain why, not what.** The codebase is written so a reader can
  reconstruct the reasoning behind a non-obvious choice. Match that density.
- **Tests assert behaviour and its rationale.** Several suites carry a header
  explaining the failure mode they exist to catch. New guards should say what went
  wrong before.
- **Non-vacuity matters.** Several tests assert their own premise (that the source
  files were found, that the regex matched something) so they cannot pass by
  scanning nothing. Keep that habit.
- **One subsystem per change.** Unrelated fixes belong in their own commit.
- **Anything that changes a boundary gets an ADR** in `docs/decisions.md` with
  rationale, consequences, and what should cause it to be revisited.

---

## 8. Known risks and untested areas

| Item | State |
|---|---|
| **Single-commit history** | The repo starts at the import commit; anything older lives in the docs, not the log (§1). |
| Active Directory federation | Configured, **never tested against a real directory**. Blocks pilot; needs LDAP values from customer IT. |
| `ops/deploy/aws-demo.sh` | Written, shellcheck-clean, **never run** — needs AWS credentials and a domain. |
| Mobile layout | Verified via Playwright at 375/390px, not by eye on a device. |
| Demo accounts on a real install | `preflight` now checks for them, but the check is only as good as its Keycloak credentials — it reports `skip` without them, which is not a pass. |
| Bundle size | ~580 kB JS, no code splitting. Fine on a LAN; would matter over WAN. |

---

## 9. Document index

| Document | Contents |
|---|---|
| [../architecture.md](../architecture.md) | Entity map, schema, principles |
| [../decisions.md](../decisions.md) | 14 ADRs (D-015 pending, see §5) |
| [../roadmap.md](../roadmap.md) | Phases 0–7 with validation checklists |
| [../feature-roadmap.md](../feature-roadmap.md) | Earlier PH-market gap analysis |
| [../client-requirements.md](../client-requirements.md) | **The current work queue** |
| [../client-questions.md](../client-questions.md) | Open questions sent to the client |
| [../pilot-runbook.md](../pilot-runbook.md) | Install, AD federation, first login |
| [../demo-logins.md](../demo-logins.md) | Accounts and seeded data |
| [../design-handoff.md](../design-handoff.md) | UI redesign brief |
| [Performance-Management-Requirements-Review.docx](Performance-Management-Requirements-Review.docx) | Client-facing review and questions |

---

## 10. First hour checklist

- [ ] `git clone`, then read §1 on what is deliberately not committed
- [ ] Bring the stack up and sign in as `grace.ilagan` (§3)
- [ ] `pnpm test` — expect 522 passing
- [ ] Read `docs/decisions.md`, then `CONTRIBUTING.md`
- [ ] Read `docs/client-requirements.md` §10 and §13 — that is the queue
- [ ] Confirm which client answers have arrived; they change what is buildable
