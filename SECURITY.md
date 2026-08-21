# Security

This system holds performance reviews, ratings and improvement plans — records
that are damaging when disclosed to the wrong colleague, not merely to the wrong
company. The security model is built accordingly.

## Reporting a vulnerability

Please report privately rather than opening a public issue. Use GitHub's
**Report a vulnerability** button under the Security tab, or contact the
repository owner directly.

Include what you did, what happened, and what you expected. A request id from a
response header (`x-request-id`) lets an operator find the exact log line.

Please do not test against a production deployment holding real employee data.

## How authorization works

**PostgreSQL Row-Level Security is the authorization boundary** — not a second
layer behind application checks. Every table has RLS `ENABLED` and `FORCED`, and
every policy routes through a single predicate, `app.can_access(resource_type,
action, target_employee_id, as_of)`.

This means a missing check in a controller cannot leak data: the database itself
refuses to return rows the caller may not see.

Supporting properties:

- The API connects as `hr_app`, which owns no tables and is `NOBYPASSRLS`.
  Superusers and table owners bypass RLS unconditionally, so the application
  role is neither.
- Identity is set with `SET LOCAL` inside the request transaction. A
  session-scoped setting would persist on a pooled connection and hand the next
  request the previous user's identity.
- Employees are resolved from the **token subject**, never from an email claim.
  Emails get reassigned; a rehire or a name change must not silently hand over
  someone else's record.
- Multi-tenancy is enforced by the same predicate, with composite foreign keys
  `(employee_id, org_id)` so a row cannot reference another tenant's record.
- Aggregates run under the caller's own RLS. A row you cannot read is not in
  your analytics — the nine-box and rating distribution use identical SQL for a
  manager and for HR.

## What this system deliberately does not store

No TIN, SSS, PhilHealth or Pag-IBIG number, address, birthdate, gender, civil
status, contact number, emergency contact, dependant, leave balance or salary.

This is enforced, not merely intended: a test scans every text column of every
table for these values and fails the build if any appears. The 201-file importer
reports every column it discards.

The reasoning is in [D-009](docs/decisions.md), made permanent by
[D-014](docs/decisions.md): the data you never collect cannot be breached.

## Deployment expectations

The reference deployment is on-premise, reached over VPN, and not published to
the internet ([D-013](docs/decisions.md)).

Operators are responsible for:

- **Backing up `.env`** — it holds the database and Keycloak credentials, and is
  generated once at install. It is `chmod 600` and gitignored.
- **Restricting the migrator role.** `hr_migrator` has `BYPASSRLS`. It is for
  migrations and the operator CLI only, and must never appear in the API's
  `DATABASE_URL`.
- **Distributing Caddy's root CA** to staff machines. A workforce trained to
  click through certificate warnings will click through a real one.
- **Disabling the password grant.** `KC_ENABLE_PASSWORD_GRANT` exists to smoke
  test a pilot; it bypasses the browser flow and any MFA.
- **Never running `seed-demo` or `seed-users.mjs` against a real deployment.**
  Both create shared-password accounts.

`hr preflight` checks the ones that can be checked automatically: that RLS is
enabled and forced on every table, that the application role holds neither
`SUPERUSER` nor `BYPASSRLS`, that the realm contains no locally-created accounts
(which is what both seeding scripts leave behind), and that neither the SPA
client nor `KC_ENABLE_PASSWORD_GRANT` still allows the password grant. The last
two read Keycloak's admin API, so preflight needs `KEYCLOAK_URL`,
`KEYCLOAK_REALM`, `OIDC_AUDIENCE`, `KEYCLOAK_ADMIN` and
`KEYCLOAK_ADMIN_PASSWORD`; without them it reports those checks as `skip` rather
than as passes. `install.sh` passes them for that one call.

`hr seed-demo` refuses to run when `NODE_ENV=production`, and refuses any
organisation holding employees it did not itself create unless
`--yes-i-mean-it` is given.

## Known limitations

- Active Directory federation is configured but has not been tested against a
  real directory.
- The audit trail does not cover a small number of pure child tables; `preflight`
  lists them explicitly rather than leaving the gap implicit.
- There is no rate limiting on the API. On a VPN-only LAN deployment this is a
  deliberate omission; it would need revisiting for an internet-facing host.
