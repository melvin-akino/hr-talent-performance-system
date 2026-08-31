# Where we are — 2026-08-27

A resume point. The plan lives in [../client-requirements.md](../client-requirements.md);
this is only what a reader cannot reconstruct from the repo.

## Build status

**Phase A — foundations: complete except A5 and the two importer mappings.**

| | |
|---|---|
| A1 | Org unit levels (`unit_type`, migration 0027) — done |
| A2 | Rank ladder (`job_rank`, 0028), client's own 6–11 numbering — done |
| A3 | Line roles (`dept_head`, `area_head`, `gm`, `scoring_admin`, 0030), seeded **unassigned** — done |
| A4 | Employment events + milestones (0029) — done |
| **A1b** | Map Division/Area/Branch in the 201 importer — **not started**, deliberately: waiting to see a real staff file rather than guessing column names |
| **A2b** | Same for the rank column — **not started**, same reason |
| **A5** | ADR D-015 on inbound attendance aggregates — **not started**. A decision document, ours to write, needed before any Phase E code |

**Phase B — scoring engine: the engine exists, nothing uses it yet.**

| | |
|---|---|
| B1 | Points on form fields + authoring-time validation — done |
| B2 | Computed scores stored with their inputs (0031) — done |
| **B3** | Seed the two real 100-point templates — **next, and recommended** |
| B4 | Composite 40/30/30 — needs Phases D and E first |
| B5 | Incentive bands — blocked on Q1, Q2 |
| B6 | Competency weight × accomplishment — blocked on Q3 |

Phases C–G untouched.

## Local environment facts that bite

- **PostgreSQL is on 15432**, not 55432. Windows reserved 55417–55516 for
  Hyper-V/WinNAT, so Docker could not bind the old port and the container ran
  with it unpublished — a healthy database that nothing could reach. Ranges
  shift on reboot; check `netsh int ipv4 show excludedportrange protocol=tcp`.
- Dev stack: web 5273, API 3100 (`/api` prefix), Keycloak 8080, Mailpit 8025.
  The API moved off 3000 deliberately: that port is contested, and a
  collision is not a clean failure -- Vite proxies `/api` to whatever
  answers it. Override with `API_PROXY_TARGET` if 3100 is taken too.
- **Do not run `pnpm add` or `pnpm install` while `pnpm dev` is running.** It
  re-links `node_modules` under the running API, which dies mid-request; it
  once produced an e2e failure that looked like a product bug.
- Three tenants: **GGCHCM** (28, the client's structure anonymised — start
  here), DEVCORE (27, simulated), ACME (8, the test fixture). Password
  `test1234`. See [../demo-logins.md](../demo-logins.md).

## Known problem, not yet fixed

The API suite has failed **twice in five full runs** with
`Worker exited unexpectedly` at teardown. It passes on re-run, files already run
sequentially (`fileParallelism: false`), and no containers leak — so it looks
like memory pressure from 21 Testcontainers. Left alone deliberately rather than
papered over, but it will read as a flaky build if it reaches CI.

## Waiting on the client

Round 1 (Q1–Q10) and round 2 (R1–R9) are with them. **R1 blocks the most**:
whether the quarterly task tally is normalised against each role's own target.
As their scorecards are drawn, identical performance scores 35, 30 or 10
depending only on how the scorecard was written, and Area Coordinators fall off
the scale entirely.

**They have not answered yet.** What they sent instead is a new request — see
below.

## The client's latest message (unanswered questions still outstanding)

> Can you work on it na meron option:
> - just load the metrics for the staff for later use
> - load KPI and evaluate

Read as: separate **defining/loading a staff member's metrics** from **running
an evaluation on them**, and let HCM choose which they are doing. It matches
their own Steps 2–3 (set the performance items and the timeline) versus Step 4
(evaluate), and it is largely **unblocked** — loading metrics needs no answer to
R1, because R1 only governs how a tally converts to a score.
