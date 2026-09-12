# Where we are — 2026-09-11

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

**Phases 0–7 complete.** 838 automated tests: 708 API against a real PostgreSQL
via Testcontainers, 129 web, plus 14 Playwright journeys. Every screen listed in
the README is built.

Delivered beyond the original phases, most recent first:

| | |
|---|---|
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
| **F2** | Report builder: by name, type, period, PIP results (§7.2) | nothing — the eval types it needed arrived with C1 |
| **F3** | Department Head and Area/Regional Head dashboards (§7.3) | nothing |
| **F4** | Request-and-approval flow: extra competency, special eval, scoring adjustment (§7.9) | nothing |
| **C2** | Employee-relative scheduling + averaging execution | **Q7** |
| **D4 / D5** | Peer averaging, min/max; anonymity model | **Q4 / Q5** |
| **B4–B6** | The KPI composite, incentive bands, competency scoring | **R1, Q1, Q2, Q3** |
| **E1–E2** | Attendance aggregates | **Q8** — the boundary itself is decided (D-015) |

**F2** and **F4** are the remaining unblocked items. Everything else waits on
the 21 questions.

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

---

## Waiting on the client

**21 questions — Q1–Q10 and R1–R11 — and not one has been answered.** They are
written up and ready to send:
[../Guanzon-HCM-Open-Questions-2026-08-28.docx](../Guanzon-HCM-Open-Questions-2026-08-28.docx).

**Sending that document is the highest-value action available and it is not
code.** Most of the remaining build is blocked behind it.

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

**One thing to say out loud in a demo, rather than let someone notice.** Alonzo
now holds `employee`, `manager`, `hr_admin` **and** `dept_head`. That is
organisationally correct — in their structure the HCM Department Head *is* the
Department Manager — but it means the Department Head approval and the HCM
approval are the same person on this demo, so the four-role story on slide 3–6
of the role pack cannot be walked as four logins. Either say so, or grant
`hr_admin` to a second person (Beatriz, HCM-002, is the Assistant Department
Manager) so Alonzo reads as DH-only.

`hr_partner`, `area_head`, `gm` and `scoring_admin` still have no holders. Only
`area_head`/`gm` would change what a demo can show, and neither maps onto a
single-department tenant.

The client deck in [../client/](../client/) is built only from requirements

marked **Have** in the tracker, and closes on both of these honestly.
`demo-deck-build.js` regenerates it (`node demo-deck-build.js`, needs
`pptxgenjs`).
