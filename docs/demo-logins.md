# Demo logins

Accounts on the **local development stack** for walkthroughs and manual testing.

> **These are throwaway fixtures on a local container.** The password below is
> shared by every account and is committed to this repository. None of these
> accounts may exist on a real deployment, where staff sign in through Active
> Directory instead ([pilot-runbook.md](pilot-runbook.md)).
>
> **This is enforced.** `hr preflight` fails when the realm still holds any
> locally-created account — the six below, and the 27 that
> `ops/keycloak/seed-users.mjs` creates — and fails again if the SPA client or
> `KC_ENABLE_PASSWORD_GRANT` still allows the password grant. Both read
> Keycloak's admin API, so preflight needs `KEYCLOAK_URL`, `KEYCLOAK_REALM`,
> `OIDC_AUDIENCE`, `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD`; run without
> them it reports `skip`, which is not a pass. `install.sh` supplies them.

Sign in at **http://localhost:5273**. Password for every account below:
**`test1234`**

---

## Which organisation to demo

The dev database holds **two tenants**, and the account you sign in with decides
which one you land in — the employee is resolved from the token subject, never
from a form. That makes it a genuine multi-tenancy demo, but it also means the
two are not interchangeable:

| Tenant | People | Data | Use it for |
|---|---|---|---|
| **DEVCORE** | 27 | 69 goals, 110 check-ins, 54 competency assessments, 53 review instances (20 rated, 3 moved in calibration), 6 feedback threads, 5 development plans, 1 PIP | **Face-to-face walkthroughs.** A realistic IT company at realistic size. |
| **ACME** | 8 | The same shape, smaller: 7 goals, one review cycle, 5 assessments | The small fixture the automated tests and `seed-demo` build. |

Prefer **DEVCORE** for a demo. It is the 27-person IT-company simulation (CEO →
CTO → tech leads → engineers, QA, DevOps, product, sales, HR, finance), and its
numbers are large enough that the analytics screens mean something — a nine-box
with people spread across it, a rating distribution with shape, a rater-bias
table where the outliers are visible.

Both tenants are deliberately incomplete in the same way, because a demo where
everything is finished has nothing to show:

- Roughly a fifth of reviews are **not submitted**, so "waiting on you" is not empty
  and the sign-off gate can be seen refusing.
- Every third employee has **no competency assessment**, which is the honest state
  of a real rollout and what the coverage figure is for.
- One person's goal weights total **80%**, so the HR console flags them and the
  period-lock refusal can be demonstrated.
- Some goals have **never been checked in**; others have two consecutive bad
  check-ins, which puts them on the escalation list.

---

## ACME — the walkthrough accounts

| Login | Person | Role in the app | What they can show |
|---|---|---|---|
| `maria` | Maria Reyes, CEO | `hr_admin`, `manager`, `employee` | **Start here.** Everything: HR console, Review cycles, Analytics, KPI library, Setup, Help authoring. 3 goals of her own, 4 reviews to write. |
| `ana` | Ana Villanueva, Engineering Manager | `manager`, `employee` | The manager view — Team, Monitoring, approving goals, logging check-ins on Paolo and Grace, 3 reviews to write. |
| `paolo` | Paolo Mendoza, Senior Software Engineer | `employee` | **The employee view, richest one.** 2 goals, 3 competency assessments (so the gap table is populated), 2 feedback threads about him, 2 reviews of him. |
| `grace` | Grace Aquino, Software Engineer | `employee` | A second employee — 2 goals, 2 competency assessments. Good for showing that one employee cannot see another's records. |
| `jose` | Jose Bautista, Engineering Director | `manager`, `employee` | A manager one level up — Ana reports to him, so the org chart depth is visible. No goals of his own. |
| `ramon` | Ramon Navarro, HR Business Partner | `hr_partner`, `employee` | **Scoped HR access** — an HR partner is not an HR admin. Useful for showing that the two differ. |

### Showing the security model

The point that lands best in a face-to-face session, because the database
enforces it rather than the UI:

1. Sign in as `paolo` — he sees his own goals, his own PIP, his own assessments.
2. Note he **cannot** open Ana's records, and the HR console is not in his nav.
3. Sign in as `ana` — the same records now appear, plus her team's.
4. `grace` cannot see `paolo`'s anything, though they are peers under the same manager.

Row-Level Security is the boundary, not the UI — hiding a nav item is a
convenience. Reading a record you may not see returns **404**, because the policy
filters the row out and a 403 would confirm it exists. A *write* the policy
refuses surfaces as **403** (mapped from SQLSTATE 42501), which is why the two
codes both appear.

---

## DEVCORE — the 27-person org

Username is the local part of the work email: `first.last@devcore.ph` →
`first.last`. All 27 exist in Keycloak with the same password.

| Login | Person | Position | Reports to |
|---|---|---|---|
| `ramon.villanueva` | Ramon Villanueva | Chief Executive Officer | — |
| `teresa.aquino` | Teresa Aquino | Chief Technology Officer | Ramon Villanueva |
| `grace.ilagan` | Grace Ilagan | HR Manager (`hr_admin`) | Ramon Villanueva |
| `marco.bautista` | Marco Bautista | Engineering Manager | Teresa Aquino |
| `elena.santos` | Elena Santos | Tech Lead | Marco Bautista |
| `paolo.mendoza` | Paolo Mendoza | Senior Software Engineer | Elena Santos |
| `katrina.garcia` | Katrina Garcia | Senior Software Engineer | Elena Santos |
| `jomar.ramos` | Jomar Ramos | Software Engineer | Elena Santos |
| `bianca.fernandez` | Bianca Fernandez | Software Engineer | Elena Santos |
| `nathan.castillo` | Nathan Castillo | Software Engineer | Marco Bautista |
| `angelo.torres` | Angelo Torres | Junior Software Engineer | Paolo Mendoza |
| `cielo.navarro` | Cielo Navarro | Junior Software Engineer | Paolo Mendoza |
| `kim.delosreyes` | Kim Delos Reyes | Junior Software Engineer | Katrina Garcia |
| `rafael.pascual` | Rafael Pascual | Junior Software Engineer | Katrina Garcia |
| `liza.domingo` | Liza Domingo | QA Lead | Teresa Aquino |
| `miguel.salazar` | Miguel Salazar | Senior QA Engineer | Liza Domingo |
| `joy.rivera` | Joy Rivera | QA Engineer | Liza Domingo |
| `dennis.chua` | Dennis Chua | QA Engineer | Liza Domingo |
| `patricia.alvarez` | Patricia Alvarez | Junior QA Engineer | Miguel Salazar |
| `ferdinand.ocampo` | Ferdinand Ocampo | DevOps Engineer | Teresa Aquino |
| `hazel.bermudez` | Hazel Bermudez | DevOps Engineer | Ferdinand Ocampo |
| `andrea.enriquez` | Andrea Enriquez | Product Manager | Teresa Aquino |
| `luis.cabrera` | Luis Cabrera | UI/UX Designer | Andrea Enriquez |
| `monique.yulo` | Monique Yulo | Business Development Manager | Ramon Villanueva |
| `jerome.panganiban` | Jerome Panganiban | Account Executive | Monique Yulo |
| `christian.buenaflor` | Christian Buenaflor | HR Associate | Grace Ilagan |
| `rowena.sarmiento` | Rowena Sarmiento | Finance and Admin Officer | Ramon Villanueva |

`grace.ilagan` is the only DEVCORE HR administrator — **start there** for a
walkthrough; she is the one who sees the HR console, Review cycles, Analytics and
Setup. Note that **`christian.buenaflor` (HR Associate) has no HR role** — being
in the HR department grants nothing; access comes from a role assignment.

For the other views: `elena.santos` (Tech Lead) has four reports and is the
manager view; `jomar.ramos` is a plain engineer with three goals and three
assessments; `angelo.torres` is a junior two levels down. The PIP is on the third
person in the org-chart order with a supervisor, visible to them, their manager
and HR only.

Watch the two `ramon`s and two `paolo.mendoza`s: `ramon` is ACME's HR partner
while `ramon.villanueva` is DEVCORE's CEO, and there is a Paolo Mendoza in each
tenant. They are different people in different tenants and cannot see each other.

---

## First login binds the account

Most DEVCORE accounts have never signed in. On first sign-in the token subject is
bound to the employee whose **work email** matches, and from then on that binding
is what identifies them — the email claim is never trusted again.

If a login lands on "your account is not linked to an employee record", the work
email in the database does not match the account's email. That is the same
failure a real pilot hits when AD accounts and the 201 file disagree, so it is
worth seeing once deliberately.

---

## Seeding another tenant

`seed-demo` builds the ACME fixture from nothing — its own CSV, its own eight
people. For a tenant whose staff are **already loaded** (a 201 import, or a real
directory), use the other command, which leaves the people alone and adds only
the activity:

```bash
pnpm --filter @hr/api hr seed-activity --org DEVCORE --yes-i-mean-it
```

It derives everything from the org chart — reviewers come from the reporting
lines, competency requirements are banded from position titles, goals are themed
by department — so it works for any tenant without naming anybody. It is
idempotent: re-running adds nothing.

`--yes-i-mean-it` is **not optional**. Unlike `seed-demo`, this command cannot
tell a simulated org from a real one — pre-existing staff are its whole premise —
and it writes ratings, feedback and a performance improvement plan against named
individuals. The refusal names the headcount so a wrong `ADMIN_DATABASE_URL` is
obvious before anything is written.

## Resetting

```bash
pnpm --filter @hr/api hr seed-demo
```

Rebuilds the ACME fixture data. It writes to whatever `ADMIN_DATABASE_URL`
points at, so it inspects that target before writing anything and refuses:

- when `NODE_ENV=production` — no override, and the api service in
  `docker-compose.yml` sets it, so this holds on every deployed install;
- when the organisation holds employees seed-demo did not create, meaning it is
  somebody else's data. Overridable with `--yes-i-mean-it` for the one honest
  case, a dev database that has been hand-edited.

Most of its inserts are `WHERE NOT EXISTS` guarded, which makes it idempotent —
that was never the part that made it safe.
