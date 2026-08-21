# Pilot runbook

Standing up a new organisation, from empty database to first login. Every step
is idempotent — re-running is always safe.

Set `ADMIN_DATABASE_URL` to the `hr_migrator` (BYPASSRLS) connection first. It is
needed only for these operator commands; the API itself must never use it.

## 0. Bring up the stack (on-prem)

```bash
cp .env.example .env   # then fill in every password
docker compose build
docker compose up -d
```

Wait for all five services to report healthy:

```bash
docker compose ps
```

The passwords in `.env` are consumed **on first cluster init only**. If the
postgres volume is created before they are set, the cluster comes up healthy
containing nothing but a superuser, and every service fails with "password
authentication failed". There is no in-place repair — `docker compose down -v`
and start over.

Keycloak is built from `ops/keycloak/Dockerfile`, not pulled. `KC_DB` and
`KC_HTTP_RELATIVE_PATH` are build-time options: setting them as environment
variables against the stock image under `start --optimized` is silently ignored.

## 1. Schema

Nothing in the stack runs migrations — applying them is a deliberate operator
act, not a side effect of deploying. The runtime image has no `tsx`, so invoke
the compiled runner directly:

```bash
docker compose exec -e DATABASE_URL="postgres://hr_migrator:PASSWORD@postgres:5432/hr" api node dist/db/migrate.js
```

Migrations are immutable once applied — the runner verifies a checksum per file
and refuses to continue if one changed.

The operator CLI runs the same way, with `ADMIN_DATABASE_URL` set to the same
migrator connection:

```bash
docker compose exec -e ADMIN_DATABASE_URL="..." api node dist/cli/hr.js preflight --org DEVCORE
```

The `pnpm hr …` forms below are the host/development equivalents.

## 2. Provision the organisation

```bash
pnpm hr provision-org --org DEVCORE --name "Devcore Solutions Inc."
```

Creates the org and everything a tenant cannot function without: baseline roles
and every phase's grants, notification templates, employment types
(REG/PROB/CONS), a published 1–5 rating scale, and a starter review form
assigned as the organisation default.

**When a new phase adds a per-org seeder, add it to `SEEDERS` in
`apps/api/src/cli/provision-org.ts`.** Phase migrations backfill orgs that exist
at migration time only; an org provisioned later gets nothing else.

Departments are *not* created here — the importer derives them from the staff
file.

## 3. Load people

```bash
pnpm hr import-201 --org DEVCORE --file ./staff.csv --dry-run
pnpm hr import-201 --org DEVCORE --file ./staff.csv
```

Always dry-run first. It reports the departments and employment types it would
create, anyone missing a work email or supervisor, and every column it will
**not** import. Nothing is written unless the whole file is valid.

Read the "not imported" list. Statutory identifiers, addresses, birthdates,
contact numbers, dependants and leave balances are deliberately dropped
([D-009](decisions.md)) — they stay in your 201 file.

Two things to check in the output:

- **reporting lines** should be headcount minus one.
- **missing supervisors** should list exactly one person: the top of the chart.
  More than one means those people are invisible to every manager.

## 4. Derive roles

```bash
pnpm hr sync-roles --org DEVCORE --dry-run
pnpm hr sync-roles --org DEVCORE
```

The importer writes no roles, so without this step every employee has zero
grants and cannot see their own goals. `sync-roles` grants `employee` to all
active staff and `manager` to anyone with a current direct report, and closes
the grant for anyone who no longer qualifies. Re-run it after every re-org.

`hr_admin` and `hr_partner` are judgement calls and stay manual:

```bash
pnpm hr grant-admin --org DEVCORE --employee-no DEV-023
```

This is the one bootstrap that cannot happen in the app: `role_assignment`
forbids self-granting, so the first admin has to come from the host.

## 5. Verify

```bash
pnpm hr preflight --org DEVCORE
```

Nineteen checks across security, schema, people, configuration and
notifications. Exits non-zero on any FAIL. Warnings that are normal before
launch:

| Warning | Why it is fine |
|---|---|
| Identity links: 0 signed in | Each link is created on that person's first login |
| No open goal period | HR opens one in the console as their first act |
| SMTP relay not set | Only if you have not configured the API service yet |

`Tenants: 2` on an on-prem box is **not** fine — confirm the extra org is
intentional.

Security checks (RLS enabled, RLS forced, `hr_app` non-superuser without
BYPASSRLS) must be green. A FAIL there means the database is not enforcing
isolation and no application-level fix compensates for it.

## 6. Keycloak realm

A freshly built Keycloak has no realm — `/auth/realms/hr` returns 404 and nobody
can sign in. Create it:

```bash
docker run --rm --network hr-system_default -v "$PWD/ops/keycloak:/s" \
  --env-file .env -e KEYCLOAK_URL=http://keycloak:8080/auth \
  node:22-alpine node /s/provision-realm.mjs
```

Idempotent — re-run it to change the realm, the client, or the LDAP settings.

It creates the realm (brute-force protection on, self-registration and password
reset off, duplicate emails refused) and the SPA client: public, PKCE `S256`,
implicit flow off, an audience mapper so tokens carry `aud: hr-system`, and the
`basic` client scope kept — Keycloak 24+ carries the `sub` claim there, and
without it the API cannot map a token to an employee.

Verify:

```bash
curl -s https://hr.office.local/auth/realms/hr/.well-known/openid-configuration | head -c 200
```

The `issuer` **must** read `https://…/auth/realms/hr`. If `/auth` is missing,
`KC_HOSTNAME` has lost its path: it must be `${KEYCLOAK_PUBLIC_URL}/auth`, not a
bare origin. A bare origin makes Keycloak advertise endpoints Caddy does not
route, and the issuer will not match what the API asserts.

### Active Directory federation

Add these to `.env` and re-run the same command:

```
LDAP_URL=ldaps://dc01.office.local:636
LDAP_BIND_DN=CN=svc-keycloak,OU=Service,DC=office,DC=local
LDAP_BIND_CREDENTIAL=…
LDAP_USERS_DN=OU=Staff,DC=office,DC=local
LDAP_EMAIL_ATTRIBUTE=mail
```

The provider is created `READ_ONLY` — this system is not the system of record
for identity, and nobody should be able to change a directory password through
the HR app. A full sync is triggered on each run.

The `email` mapper is the whole integration: **every synced user's email must
match a `Work_Email` in the 201 file**, or their first login authenticates and
then resolves no employee.

### Two things not to leave on

`KC_ENABLE_PASSWORD_GRANT=true` enables the resource-owner password grant, which
mints tokens from a username and password alone, bypassing the browser flow and
any MFA. It is useful for smoke-testing a pilot and must be off before staff use
the system — re-run the script without it.

`ops/keycloak/realm-hr.json` is the **development** realm. It contains hardcoded
test users and must never be imported into a production deployment. The same
goes for `seed-users.mjs`: it exists so a simulated org can be signed into
before AD is connected.

`hr preflight` fails on both — any account in the realm that is not federated
from the directory, and the password grant being enabled on either the client or
the environment. Give it the Keycloak admin credentials or it will report those
two as `skip` and check neither.

## 7. First login

Production federates to Active Directory. First login binds the IdP subject to
an employee record **by matching work email**, so directory addresses and the
`Work_Email` column must agree exactly — a mismatch authenticates the person and
then fails to find them, which reads like a broken account.

For a local simulation, create matching Keycloak users from the same CSV:

```bash
node ops/keycloak/seed-users.mjs db/seeds/devcore-201.csv
```

Dev only. Password `test1234`.

## 8. HR's first session

1. Open a goal period (HR console → Setup).
2. Confirm or replace the starter review form in the form builder.
3. Create the competency framework, then publish it — publishing freezes it.
4. Create the review cycle and generate reviews.

## Simulated org

`db/seeds/devcore-201.csv` is a 27-person IT development company — CEO through
junior developers and QA, plus DevOps, product, HR, sales and finance. All data
is synthetic. It exercises the paths a two-row sample cannot: a four-level
reporting chain, managers with and without reports, probationary hires, and
seven departments derived from the file.
