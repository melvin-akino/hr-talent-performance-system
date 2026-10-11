# Where we are — 2026-10-07

A resume point, written so that a **person or an agent arriving cold** can carry
on without this session's context. The plan lives in
[../client-requirements.md](../client-requirements.md) and is the authority on
what to build next; this file is what the repository cannot tell you by itself.

Read in this order:

1. this file — state, environment traps, what to do next;
2. [../client-requirements.md](../client-requirements.md) — the tracker, phase
   by phase, with every requirement cross-matched to their spec;
3. [ENGINEERING-HANDOFF.md](ENGINEERING-HANDOFF.md) — architecture and the
   decisions behind it;
4. [../demo-logins.md](../demo-logins.md) — tenants, logins, how to rebuild them.

---

## Build status

**Phases 0–7 complete.** 998 automated tests: 818 API against a real PostgreSQL
via Testcontainers, 180 web, plus 14 Playwright journeys (not run this session).
Every screen listed in the README is built.

**Deployed vs built are different, and today they differ:** the live demo host
is at F3 (migration 0046). **F2, F4, B3b and F6 — migrations 0047, 0048, 0049 —
are built, tested and committed, and NOT deployed.** See "The live demo" below
for what a deploy needs.

Delivered beyond the original phases, most recent first:

| | |
|---|---|
| **F6** | December 2025 **PIP form**: four signatures, the form's sections, scored initial/final reviews (0049, D-019). Also fixes two bugs that predate it |
| **B3b** | December 2025 **Performance Evaluation Form** is the standard — three classifications, per-rating descriptors, per-part results. **Weights are provisional** (D-018) |
| **F4** | Request-and-approval flow; approving records a decision, never the change (0048, D-017) |
| **F2** | Report builder over one shared evaluation-event union with the history screen (0047) |
| **F3** | Unit dashboard for Department/Area/Regional Heads, and `hr grant-role` (0046) |
| **A5** | ADR D-015: attendance crosses as a count, never a record |
| **F0c** | Employee lifecycle: add, correct, record a change, end employment (0045) |
| **F0a** | 201 import from the UI — template, preview, apply (migration 0044) |
| **F0b** | `POST /ranks`, `POST /positions` — the ladder is creatable, not only importable |
| **F5b** | Deadline scanner: hourly, dedupes per milestone (0043) |
| **F5** | 21 notification events, emitters audited by test (0042) |
| **D1–D3** | Peer review: rules, sampling, eligibility gate, 30-point instrument (0039–0041) |
| **C1** | Five evaluation types as data, with anchors and averaging (0036) |
| **C3** | Department Head review step (0038) |
| **C5** | HCM target approval, second gate (0037) |
| **F1** | Per-employee timeline (0035) |

**Still open, in the order I would take them:**

| | | Blocked on |
|---|---|---|
| **B3b follow-up** | Real per-indicator weights replace the provisional equal ones: flip `WEIGHTS_ARE_PROVISIONAL`, issue **v2** of the three templates (versions are immutable) | **R12** |
| **B3c** | Whether the new forms replace the 40/30/30 composite or sit beside it; what to do with the peer engine | **R13** |
| **F6 follow-up** | Whether all four signatures are required before a PIP counts, and where that gate lives | **R23** |
| **C2** | Employee-relative scheduling + averaging execution | **Q7** |
| **D4 / D5** | Peer averaging, min/max; anonymity model | **Q4 / Q5** |
| **B4–B6** | The KPI composite, incentive bands, competency scoring | **R1, Q1, Q2, Q3** |
| **E1–E2** | Attendance aggregates | **Q8** — the boundary itself is decided (D-015) |

**There are no unblocked items left in the tracker.** Everything open waits on
HCM, and the question count has grown, not shrunk: 21 sent in August, plus **13
raised by the December 2025 forms (R12–R24)** that are in the tracker's §9 but
not yet in any document sent to them.

**Do not trust a stale "next" in this file.** B3 was listed here as the next
item for weeks after it had shipped; the tracker had it as `[x]` and this file
did not. `docs/client-requirements.md` is the authority — check the checkbox
there before starting anything.

---

## Invariants — things that look arbitrary and are not

Breaking any of these produces a system that still passes a casual demo.

- **Row-level security is the authorization boundary, not a helper.** No service
  may re-implement visibility in TypeScript. Tests must connect as a
  **non-superuser** or every deny-assertion is vacuous; each suite asserts this
  about itself.
- **`withAdminContext` bypasses RLS and must never be reached from a request
  path.** It is for the operator CLI. The HTTP importer passes the caller
  (`opts.as`) and runs under their own policies instead — see 0044.
- **Any predicate that reads `access_grant` must be `SECURITY DEFINER`.**
  That table is itself protected — only `hr_admin` holds `access_grant:read` —
  so a caller cannot read their own grants. Written inline, such a check answers
  "no" for exactly the people it should pass. This has now cost a debug session
  twice: `app.has_org_grant` (0044) and `app.has_scope_wider_than_self` (0046).
  The tell is a check that denies somebody whose grant you can see in psql.
- **`app.can_access(resource, action, target)` is target-scoped.** Migration
  0015 put a tenant guard in front of it, so it returns **false for a NULL
  target, always**. For a row that does not exist yet use
  `app.has_org_grant(resource, action)`. This cost hours; do not rediscover it.
- **Migrations are immutable once merged** and checksum-enforced by the runner.
  A new fact means a new migration. If the guard fires on a file that matches
  HEAD, repair the recorded checksum — never the file.
- **A lower rank number is more senior** (their numbering, 6–11).
  `app.ranks_above(subject, evaluator)` is positive when the evaluator is
  senior. Every rank rule goes through it.
- **Definitions are versioned; instances snapshot the version.** A cycle pins
  the rules it was issued under, so changing a type next year never rewrites
  last year's results.
- **The staff file is not the authority on org structure.** The importer reports
  differences and changes nothing.
- **A correction is not a change** (D-016). A correction amends a row that was
  always wrong; a change closes the current period and opens a new one. Collapse
  them and a transfer silently re-parents every past review.
  `app.record_employment_event` refuses `event_type = 'correction'` outright.
- **Every `withContext` is its own connection and its own transaction.** A read
  from inside another `withContext` is a second connection and cannot see the
  first one's uncommitted writes. `POST /pips` and `withdraw()` both created a row
  and then answered 404 for it, because they read it back from inside the
  transaction. Read back **after** the transaction commits.
- **A route with no HTTP test has not been shown to work.** An employee could
  never acknowledge their own PIP, and `POST /pips` always answered 404 — both
  shipped, both live, both found only by writing the first test over HTTP of a path
  nothing had called. Unit tests of the arithmetic do not exercise the wiring.
- **A published form version is immutable, so a new standard arrives as new
  templates, never an edit.** The December 2025 evaluation form is
  `GGC-PEF-SALES / -SERVICE / -ADMIN`; `GGC-TOF` / `GGC-ADMIN` are retired by
  `provision-org` only where nothing uses them. Re-provisioning must never issue a v2.
- **Where a form prints a number, use it exactly; where it does not, make the
  smallest assumption, isolate it, and label everything it touches.** The evaluation
  form never says what each indicator is worth, so indicators are weighted equally
  and every template says PROVISIONAL. Scores from it are estimates. The passing
  floors are not affected: each is exactly 60% of its part, so rating every
  indicator 3 lands on it under any weighting (asserted by test).
- **A form's wording is transcribed verbatim, defects included.** The form has gaps
  (three scales with no worst-case band, an indicator whose header contradicts its
  layout). They are raised with HCM — R16, R17, R20 — not patched, because an
  invented band is a scoring rule nobody agreed.
- **Who may sign a PIP as whom lives in one SQL function**
  (`app.pip_signable_parties`), read by the INSERT policy and by the screen. The
  screen renders what the server says it may offer and never works it out.

---

## The live demo

**https://hr.summitlogicsolutions.com** — one tenant, **GGCHCM**, 28 invented
people on the client's real structure. Never load real employee data: the logins
share a password that is committed to this repository.

| | |
|---|---|
| AWS account | `354454790410`, IAM user `hr-demo`, region `ap-southeast-2` |
| Instance | `i-01e4f6f20a9044b00` — t3.micro, 30 GB gp3 encrypted |
| Elastic IP | `54.79.210.29` |
| SSH | `~/.ssh/hr-system-demo.pem`, restricted to the deploying machine's IP |
| Secrets | `/home/ubuntu/hr-system/.env` on the instance — **not backed up anywhere** |
| HR admin login | `alonzo.dimalanta` / `test1234` |

Redeploy, destroy, and the free-tier limits: [../aws-free-tier-deployment.md](../aws-free-tier-deployment.md).

```bash
AWS_PROFILE=hr-demo ./ops/deploy/aws-demo.sh --host hr.summitlogicsolutions.com --acme-email melvin.aquino@summitlogicsolutions.com
AWS_PROFILE=hr-demo ./ops/deploy/aws-demo.sh --destroy    # releases the IP too
```

**Up to date as of 2026-09-13** (through F3 / migration 0046) — everything through F0a/F0b is deployed,
including migration 0044 and the UI importer. Verified after the deploy rather
than assumed: `/api/import/template` and `/api/import/columns` answer 401 while
a bogus route answers 404, so the routes exist and are guarded; `app.has_org_grant`
is present; the web bundle contains the Import staff tab; 622 MB of 909 in use
with 538 MB of swap, unchanged by the new code.

**NOT on the host as of 2026-10-07: F2 (0047), F4 (0048), B3b and F6 (0049).**
Probed, not assumed: `/api/reports/evaluations` and `/api/requests` answer 404.
A deploy needs, in this order:

1. the normal redeploy, which applies 0047–0049. 0049 seeds the signature grants
   for existing organisations itself;
2. **`hr provision-org --org GGCHCM …` re-run.** The new evaluation formats are
   published by provisioning, not by a migration, so without this the host has
   migrations 0047–0049 and none of the new templates. Re-running also retires
   `GGC-TOF` / `GGC-ADMIN` where nothing uses them, and says so where it declines;
3. verify the two routes now answer 401 rather than 404, and that an employee can
   acknowledge a PIP — which they could not before;
4. **the site root is now the public landing page, not the application** (D-020).
   `/` serves `apps/web/landing.html`; the application's home is `/home`. This ships
   in the `web` image, so the same redeploy carries it. Caddy and Keycloak are
   unchanged (`/callback` did not move). After deploying, check `/` shows the
   landing page with both logos and that signing in from it lands on `/home`.

**The employee-acknowledge and `POST /pips` bugs are live on the host until then.**
The demo's PIP screen cannot create a plan without showing an error for it.

A redeploy is ~8 minutes of build plus a 307 MB upload. It reuses the security
group, key pair, instance and address, and leaves `.env` alone, so secrets and
seeded activity survive.

**Cost note:** an Elastic IP is free only while attached to a *running*
instance. Stopping the instance and keeping the address costs about
$3.60/month. Use `--destroy`, which releases it.

---

## Environment traps

Each of these has already cost an afternoon.

- **Avast intercepts TLS on the development machine.** The tell is
  `SSLKEYLOGFILE` pointing at `\\.\aswMonFltProxy\...`. Its root is trusted
  machine-wide so browsers work, but tools carrying their own CA bundle do not:
  the AWS CLI, `curl`, and `pip` all fail with
  `CERTIFICATE_VERIFY_FAILED`. A combined bundle lives at
  `~/.aws/ca-bundle.pem` — the AWS CLI profile points at it, `pip` needs
  `--cert`, and `curl` needs `--cacert`. **Never use `--no-verify-ssl`**:
  verification is the only thing distinguishing the AV from anyone else.
- **`ssh` in Git Bash is MSYS's, not Windows OpenSSH.** `which -a ssh` finds
  `/usr/bin/ssh` first. The deploy script deliberately uses
  `/c/Windows/System32/OpenSSH/ssh.exe`, converts paths with `cygpath`, and
  locks the key with `icacls` — `chmod 600` writes a mode Windows OpenSSH never
  reads.
- **Line endings matter.** `core.autocrlf=true` plus no `.gitattributes` once
  shipped a CRLF `00-roles.sh` into a Linux container, where the cluster
  initialised with no roles and *then reported healthy*. `.gitattributes` now
  pins `*.sh`, `*.sql`, `*.yml`, `*.csv` and friends to LF. Git Bash tolerates
  CRLF scripts, which is exactly why this is worth pinning.
- **PostgreSQL is on 15432**, not 55432: Windows reserves 55417–55516 for
  Hyper-V. Ranges shift on reboot — `netsh int ipv4 show excludedportrange
  protocol=tcp`.
- Dev ports: web 5273, API **3100** (`/api` prefix), Keycloak 8080, Mailpit
  8025. The API moved off 3000 because a collision there is not a clean
  failure — Vite proxies `/api` to whatever answers.
- **Do not run `pnpm install` while `pnpm dev` is running.** It re-links
  `node_modules` under the running API, which dies mid-request and once looked
  like a product bug.
- **`python` on PATH is the Windows Store stub** (permission denied). The real
  one is `~/AppData/Local/Programs/Python/Python39/python.exe`, and it is **3.9**
  — too old for tooling that uses `match`. For those, run a container:
  `docker run --rm -v "C:/path:/w" -w /w python:3.12-slim ...`.

---

## Local tenants

`test1234` for everyone. Full roster in [../demo-logins.md](../demo-logins.md).

| Tenant | | |
|---|---|---|
| **GGCHCM** | 28 | The client's structure, anonymised — **start here** |
| DEVCORE | 27 | Simulated, generic. Removed from the live demo, still local |
| ACME | 8 | Test fixture |

Rebuilding GGCHCM is documented in `demo-logins.md`. Two traps in it: use
**`hr import-201`**, not `hr import-employees` — only the former builds the rank
ladder; and `seed-activity` refuses to run under `NODE_ENV=production`, which is
correct and should stay.

---

## Known problem, not fixed

The API suite has failed a handful of times in many full runs with
`Worker exited unexpectedly` at teardown. It passes on re-run, files already run
sequentially (`fileParallelism: false`), and no containers leak — it looks like
memory pressure from the Testcontainers count. Left alone deliberately rather
than papered over, but it will read as a flaky build if it reaches CI.

It is worse when the machine is running other Docker stacks (this one is): in the
last session **every** full run lost exactly one spec file to it, a different one
each time, and each passed when run alone with
`--pool=forks --poolOptions.forks.singleFork=true`. Run the full suite with
`--poolOptions.forks.maxForks=2`, and treat "N−1 files passed plus one worker
crash" as "re-run that file", not as a failure. Do not treat it as a pass until the
missing file has actually been run.

---

## Waiting on the client

**21 questions — Q1–Q10 and R1–R11 — and not one has been answered.** They are
written up and ready to send:
[../Guanzon-HCM-Open-Questions-2026-08-28.docx](../Guanzon-HCM-Open-Questions-2026-08-28.docx).

**Sending that document is the highest-value action available and it is not
code.** Most of the remaining build is blocked behind it.

**13 more questions (R12–R24) have not been written up for them.** They came from
the December 2025 evaluation and PIP forms and are in the tracker's §9. The
blocking ones: **R12** (what each indicator is worth — nothing on the evaluation
form can be scored for real until this is answered), **R13** (do these forms
replace the 40/30/30 composite, which decides whether the peer engine has a home)
and **R14** (Admin is 70/30 here and was 60/40 in the 5-pager). The rest are the
form's own defects and small confirmations. They should be added to the document
rather than sent separately: one list, one reply.

Numbering trap, already hit once: **R10 and R11 already exist** (round-2: a formula
in `hcm kpi` missing two lines; six tasks spelled two ways), and "R10"/"R11" also
appear everywhere as **rank labels**. New questions start at R12.

**R1 blocks the most**: whether the quarterly task tally is normalised against
each role's own target. As their scorecards are drawn, identical performance
scores 35, 30 or 10 depending only on how the scorecard was written, and Area
Coordinators fall off the scale entirely.

Their latest message asked for two modes — *load the metrics for staff for later
use*, and *load KPI and evaluate*. Read as separating **defining** a person's
metrics from **running an evaluation** on them. Largely unblocked: R1 only
governs how a tally converts to a score, not how metrics are stored.

---

## Two things that must not be oversold to the client

- **The KPI composite is not built** — the 30/40/30 split, the task nature
  multipliers, the banded conversion. Deliberate: three details in their
  workbook read two ways, and guessing would be worse than asking.
- **Scores from the December 2025 evaluation form are estimates.** The form
  prints what each part is worth but not what each indicator is, so indicators are
  weighted equally until R12 is answered. Do not present a score from it as a
  figure to act on. (The pass/fail line for an evaluation rated all "meets" is
  unaffected — see the invariants.)
- **Active Directory federation has never been tested against a real
  directory.** Keycloak OIDC works with its own realm; pointing it at their AD
  is untested. A successful demo proves nothing about it.

## Roles, and what the demo cannot show

Only three roles are assigned in GGCHCM: `employee` (28), `manager` (5, derived
from the reporting lines by `hr sync-roles`) and `hr_admin` (1, Alonzo).
**`dept_head` is now held by HCM-001 (Alonzo Dimalanta), scoped to HCM** — done
2026-09-13 with `hr grant-role`, which refuses an unscoped assignment for a
department-scoped role rather than granting something powerless. Verified by
suspending his `hr_admin` assignment and re-asking: the `dept_head` grant alone
confers `review:approve`, so it is doing the work rather than being masked.

```bash
hr grant-role --org GGCHCM --employee-no HCM-001 --role dept_head --department HCM
```

**Alonzo holds `employee`, `manager`, `hr_admin` and `dept_head`, and the demo
says so out loud.** Decided 2026-09-13: *say it, do not grant `hr_admin` to a
second person.* Granting it to Beatriz would have made the four-role story
cleaner and would have invented a role assignment their org chart does not
state, which is not ours to invent.

The overlap is organisationally correct — in their structure the HCM Department
Head *is* the Department Manager — and the role pack now carries it: slide 5's
`who` line names it, its speaker note says to state it plainly, and the
walkthrough is four sign-ins ending on Alonzo, where the presenter explains that
the Department Head approval and the HCM approval are the same person *here* and
would be two people in a branch. **Do not silently fix this by granting the role
elsewhere** — the deck now depends on it being said.

`hr_partner`, `area_head`, `gm` and `scoring_admin` still have no holders. Only
`area_head`/`gm` would change what a demo can show, and neither maps onto a
single-department tenant.

The client deck in [../client/](../client/) is built only from requirements

marked **Have** in the tracker, and closes on both of these honestly.
`demo-deck-build.js` regenerates it (`node demo-deck-build.js`, needs
`pptxgenjs`).
