# Contributing

## Getting set up

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm --filter @hr/api hr seed-demo
pnpm dev
```

`pnpm dev` runs a real `tsc --watch` rather than `tsx`. This is deliberate:
esbuild-based transforms do not emit `design:paramtypes`, and without that
metadata NestJS constructor injection silently resolves every dependency to
`undefined`. The same reason is why the test runner uses SWC — see
`apps/api/vitest.config.ts`.

## The rules that are not negotiable

These exist because breaking them causes damage that surfaces months later, on
someone else's production box.

### 1. Migrations are immutable once merged

The runner checksums every applied file and refuses to continue if one changed.
CI independently rejects any pull request that modifies or deletes a file under
`db/migrations/`. If a migration is wrong, write another one that corrects it.

Editing an applied migration means the schema on a running system no longer
matches the file that supposedly produced it — which is discovered during a
restore, at the worst possible moment.

### 2. New tables carrying `org_id` need a policy and a tenancy test

Row-Level Security is the authorization boundary, not a second layer behind
application checks ([D-003](docs/decisions.md)). A table without a policy is
readable by every tenant.

Every such table needs `ENABLE` **and** `FORCE ROW LEVEL SECURITY`, a policy
routing through `app.can_access(...)`, and a case in `test/tenancy.spec.ts`
([D-008](docs/decisions.md)).

### 3. The API never connects as a superuser or a BYPASSRLS role

Superusers and table owners bypass RLS unconditionally. `hr_app` owns nothing
and is `NOBYPASSRLS`; the migrator role is used only by migrations and the
operator CLI, and must never appear in the API's `DATABASE_URL`.

Every RLS suite asserts it is connected as `hr_app` and not a superuser. Do not
remove that guard — without it, a credential mistake makes every deny-assertion
in the project pass while testing nothing.

### 4. No statutory identifiers or personal data

The system stores no TIN, SSS, PhilHealth, Pag-IBIG number, address, birthdate,
gender, civil status, contact number, emergency contact, dependant or salary
([D-009](docs/decisions.md), made permanent by [D-014](docs/decisions.md)).

`test/ph201.spec.ts` scans every text column for these values and fails the
build if any appears. If a feature seems to need one of them, that is an
architecture discussion, not a migration.

### 5. Identity is transaction-scoped

`SET LOCAL`, never `SET`. A session-scoped GUC persists on a pooled connection
and hands the next request the previous user's identity — with no error and no
log line. `test/rls-identity.spec.ts` exists solely to catch this.

## Tests

Mocks cannot verify RLS, so suites run against a real PostgreSQL through
Testcontainers. A new feature is not done until the deny-cases are tested: a
test that only exercises the happy path proves the feature works, not that it is
protected.

When writing a deny-test, send a payload that **passes validation**. A 400 means
the request was rejected before authorization ran, so it proves nothing — and it
reads as coverage while providing none.

## The UI

The look comes from the Industry design system, ported to
`apps/web/src/styles/industry.css` and exposed as React in
`apps/web/src/components/ds.tsx`. Two rules there are load-bearing:

- **No invented colours.** One steel-blue accent and its ramp. Status is carried
  by icon and word, never by a new hue — no green for good, no red for bad. A
  component test fails if green, red or amber reappear.
- **Build on `ds.tsx`.** The old Tailwind primitives were deleted once every
  screen had moved. Two component vocabularies for the same job is how a
  redesign quietly half-reverts.
- **No hard-coded greys, and no `bg-white`.** `text-slate-500`, `bg-slate-50`,
  `border-slate-200`, `ring-slate-300` and `bg-white` do not follow the theme.
  Use the helpers in `industry.css`: `t-muted`, `t-faint`, `t-mono`,
  `panel-tint`, `bg-surface`, `border-divider`, `input-sm`.
  `test/styling-vocabulary.spec.ts` fails the build if any reappear. Every
  screen is converted; the ratchet list in that file is empty and must stay so.
- **Every route page renders a `PageHead`.** The sidebar names the current screen
  only while it is on screen — it collapses on narrow viewports and does not
  print, so a printed goal sheet or review had no title on it, and a screen
  reader had no landmark to jump to. The tab bodies under `src/pages/admin`
  deliberately do *not* have their own heading; Setup supplies it. Both halves
  are enforced in `test/styling-vocabulary.spec.ts`.
- **Two states must never render identically.** The same suite fails a ternary
  whose class branches are the same string, and a `Record` map whose entries all
  collapse to one value. Both shipped: a selected tab that looked unselected, a
  met PIP milestone identical to a failed one, `sent` and `failed` notifications
  indistinguishable, and three feedback visibilities rendered the same. If a
  state needs its own appearance, give it a component in `ds.tsx` — see
  `GoalStateTag` and `ReviewStateTag` — rather than a lookup table of classes.

## Help content

Articles live in `apps/web/src/help/content/` as markdown with frontmatter, and
are bundled at build time — the office LAN has no internet, and help that needs a
working server disappears exactly when it is wanted.

Adding one means adding frontmatter that the validation suite accepts: a `routes`
entry must exist in the app's route table, `audience` must be a real role, and
the body must render. Those tests exist because a mistyped route produces help
that silently never appears.

**Company policy is a different thing and lives in the database** (`help_article`,
authored from Setup → Help content). The two are merged in the drawer and
labelled differently on purpose: "self-reviews are due 30 November" is a local
rule HR can change, while "weights must total 100%" is how the software works,
and a reader must be able to tell which is which.

The markdown renderer (`help/markdown.tsx`) is hand-written and returns React
elements — it **cannot emit HTML**. That is what makes it safe to point at text
typed into a form, so do not replace it with a library that produces an HTML
string.

## Architecture decisions

Anything that changes a boundary — the data model, the security model, what the
system stores, how tenants are separated — belongs in
[docs/decisions.md](docs/decisions.md) as a numbered ADR with its rationale,
consequences, and the conditions that should cause it to be revisited.

If a change conflicts with an existing decision, say so explicitly and propose
the lowest-risk path rather than working around it quietly.

## Commits and pull requests

- One subsystem per change. Unrelated fixes belong in their own commit.
- Explain *why* in the message; the diff already shows what.
- CI must be green: typecheck, build, full test suite, and the migration guard.
