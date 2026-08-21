# Infrastructure & Tech Stack — On-Premise

Status: PROPOSED (v0.1, 2026-08-13). See decisions.md D-001, D-004, D-005.
Deployment target: single office server, no cloud runtime dependency.

---

## 1. Stack

| Layer | Choice | Why this one for on-prem |
|---|---|---|
| Database | **PostgreSQL 16** | RLS is the authorization boundary (D-003). Mature, self-hostable, excellent backup tooling. Non-negotiable given the model. |
| Backend | **NestJS (TypeScript, Node 22 LTS)** | Module/DI structure matches the "modular services, low coupling" rule. Strong typing end to end. |
| ORM / SQL | **Drizzle ORM** + raw SQL for reporting | Thin, typed, generates readable migrations. Does not hide the SQL — important when RLS is doing the security work and you must reason about the actual query. |
| Migrations | **Drizzle Kit**, forward-only, checked in | Every schema change reviewed and versioned. |
| Frontend | **React 19 + Vite + TypeScript** | Standard, hireable, no SSR needed for an internal LAN app. |
| UI | **Tailwind + shadcn/ui** + TanStack Table | Dense data grids are the bulk of this UI (goal lists, cycle status boards). |
| Server state | **TanStack Query** | Cache invalidation for a heavily cross-linked domain. |
| Forms | **React Hook Form + Zod** | Zod schemas shared with backend validation — one source of truth. |
| Auth | **Keycloak** (self-hosted OIDC) | Runs on-prem, federates to Active Directory so staff use existing office credentials. Avoids building password reset, MFA, lockout — all of which are liabilities to hand-roll. |
| Jobs / email | **pg-boss** (Postgres-backed) | No extra broker to operate (D-005). |
| Email delivery | Office **SMTP relay** / Exchange connector | Notifications must work without internet egress. |
| File storage | **MinIO** (S3-compatible, on-prem) or a plain mounted volume | Evidence attachments, IDP documents, library materials. MinIO if attachments matter; volume if volume is small. |
| Reverse proxy / TLS | **Caddy** | Automatic cert management; can run an internal CA cleanly. |
| Packaging | **Docker Compose** | Single-host orchestration. Kubernetes here would be self-harm. |
| Logs | **Pino** → JSON → **Loki** (or rotated files) | Structured logging is a hard rule; Loki only if someone will actually read it. |
| Metrics | **Prometheus + Grafana** | Optional at launch. Add when there's an owner. |
| Backups | **pgBackRest** → NAS + offsite encrypted copy | The single highest-value component on this page. |
| Tests | **Vitest** (unit) + **Testcontainers** (integration, real Postgres) | RLS policies **must** be tested against a real database. Mocks cannot verify a security policy. |

---

## 2. Host sizing (starting point)

Assumes ≤1,000 employees, spike concurrency at cycle close.

- 8 vCPU, 32 GB RAM, 500 GB SSD (RAID-1 mirrored — a single disk is a single
  point of failure holding all performance history)
- Ubuntu Server 24.04 LTS
- UPS with automated graceful shutdown — a hard power cut mid-write on an
  unprotected box is the most likely cause of data loss in an office server room

Revisit sizing once headcount (Q4) is answered.

---

## 3. Topology

```
        Office LAN
            │
      ┌─────▼─────┐   :443
      │   Caddy   │  TLS termination, internal CA cert
      └─────┬─────┘
            │
   ┌────────┼──────────┬──────────────┐
   │        │          │              │
┌──▼───┐ ┌──▼──────┐ ┌─▼────────┐ ┌───▼─────┐
│ web  │ │ api     │ │ keycloak │ │ minio   │
│(SPA) │ │(NestJS) │ │  (OIDC)  │ │(files)  │
└──────┘ └──┬──────┘ └─┬────────┘ └─────────┘
            │          │
        ┌───▼──────────▼───┐
        │   PostgreSQL 16   │──► pgBackRest ──► NAS ──► offsite (encrypted)
        └───────────────────┘
```

Remote/WFH access: **VPN into the LAN** is the recommended default. Exposing
this to the public internet requires a DMZ, hardened reverse proxy, and a
patching commitment — decide before Phase 1 pilot (see risks).

---

## 4. On-prem operational requirements (launch blockers)

These are not optional polish. On-prem means the failure modes below have no
provider safety net.

1. **Tested restore.** Perform a full restore to a scratch host before go-live.
   Record the elapsed time — that number is your real RTO.
2. **Off-machine backup.** Backups on the same box protect against nothing.
3. **UPS + graceful shutdown** wired and verified.
4. **Disk mirroring** (RAID-1 minimum).
5. **Patch cadence** owned by a named person — OS, Postgres, Node, Keycloak.
6. **Certificate renewal** owned and calendared; an expired internal cert takes
   the whole system down and always at the worst time.
7. **Monitoring that pages someone** — at minimum disk-full and backup-failed
   alerts. Disk-full on the DB volume is the classic on-prem outage.

---

## 5. What was deliberately NOT chosen

| Rejected | Reason |
|---|---|
| Supabase / any cloud BaaS | Violates D-001. The MCP connector in this environment is unusable for production. |
| Kubernetes | Single host. Operational cost vastly exceeds benefit. |
| Redis / RabbitMQ / Kafka | Postgres handles this load. Fewer stateful services to operate (D-005). |
| Microservices | Modular monolith is correct at this size. Module boundaries in code, one deployable. |
| Next.js / SSR | Internal LAN app behind auth. No SEO, no cold-start concern. |
| Hand-rolled auth | Never build password storage, MFA, and lockout yourself when Keycloak exists. |
| MongoDB / document store | The domain is deeply relational and requires row-level authorization. Wrong tool. |
