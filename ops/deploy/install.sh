#!/usr/bin/env bash
#
# One-command install. Runs on the target Linux server — on-prem or a cloud VM.
#
#   ./ops/deploy/install.sh --host hr.office.local \
#       --org DEVCORE --org-name "Devcore Solutions Inc." \
#       --staff-csv ./staff.csv --hr-admin DEV-023
#
# Idempotent by construction: every step either converges or is skipped, so a
# failed run is fixed by fixing the cause and running it again. Nothing here is
# destructive — it will refuse to touch an existing database rather than
# reinitialise one.
#
# What it does, in order:
#   1. checks the host has what it needs
#   2. writes .env with generated secrets (once — never regenerates)
#   3. builds and starts the stack, waits for health
#   4. applies migrations
#   5. creates the Keycloak realm and SPA client
#   6. provisions the organisation, imports staff, derives roles
#   7. grants the first HR admin and opens a goal period
#   8. runs preflight and prints what is left to do
#
# It deliberately does NOT: configure AD federation (needs values only the
# customer's IT has), configure SMTP, or open any firewall port.

set -euo pipefail

# --- defaults ---------------------------------------------------------------
PUBLIC_HOST=""
ORG_CODE=""
ORG_NAME=""
STAFF_CSV=""
HR_ADMIN=""
PERIOD_NAME="FY$(date +%Y)"
PERIOD_START="$(date +%Y)-01-01"
PERIOD_END="$(date +%Y)-12-31"
COMPOSE_FILES=(-f docker-compose.yml)
MODE="onprem"
ACME_EMAIL=""
SEED_DEMO_USERS="false"

usage() {
  cat >&2 <<'USAGE'
usage: install.sh --host <fqdn> --org <CODE> --org-name "<Name>" [options]

required
  --host <fqdn>          public hostname staff will use (must match DNS/TLS)
  --org <CODE>           short organisation code, e.g. DEVCORE
  --org-name "<Name>"    legal name

optional
  --staff-csv <path>     201 file to import
  --hr-admin <emp-no>    employee number of the first HR administrator
  --period-name <name>   goal period name         (default FY<current year>)
  --period-start <date>  goal period start        (default Jan 1 this year)
  --period-end <date>    goal period end          (default Dec 31 this year)
  --mode onprem|demo     demo enables public ACME TLS and demo logins
  --acme-email <email>   contact for Let's Encrypt (required with --mode demo)
  --seed-demo-users      create a Keycloak login per row in the staff CSV
                         (NEVER use on a system holding real employee data)
USAGE
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host)           PUBLIC_HOST="$2"; shift 2 ;;
    --org)            ORG_CODE="$2"; shift 2 ;;
    --org-name)       ORG_NAME="$2"; shift 2 ;;
    --staff-csv)      STAFF_CSV="$2"; shift 2 ;;
    --hr-admin)       HR_ADMIN="$2"; shift 2 ;;
    --period-name)    PERIOD_NAME="$2"; shift 2 ;;
    --period-start)   PERIOD_START="$2"; shift 2 ;;
    --period-end)     PERIOD_END="$2"; shift 2 ;;
    --mode)           MODE="$2"; shift 2 ;;
    --acme-email)     ACME_EMAIL="$2"; shift 2 ;;
    --seed-demo-users) SEED_DEMO_USERS="true"; shift ;;
    -h|--help)        usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

[ -n "$PUBLIC_HOST" ] || usage
[ -n "$ORG_CODE" ] || usage
[ -n "$ORG_NAME" ] || usage

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m  %s\n' "$*"; }
warn() { printf '    \033[33m!!\033[0m  %s\n' "$*"; }
die()  { printf '\n\033[31mFAILED:\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. host checks ---------------------------------------------------------
say "Checking the host"

command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is not available"
docker info >/dev/null 2>&1 || die "cannot talk to the docker daemon (is it running? are you in the docker group?)"
ok "docker $(docker version --format '{{.Server.Version}}')"

# Postgres, Keycloak, two images and a year of audit rows. 20 GB is the point
# below which this stops being a question of comfort.
AVAIL_KB="$(df -Pk . | awk 'NR==2 {print $4}')"
if [ "$AVAIL_KB" -lt 20971520 ]; then
  warn "only $((AVAIL_KB / 1048576)) GB free on $(pwd) — 20 GB recommended"
else
  ok "$((AVAIL_KB / 1048576)) GB free"
fi

if [ "$MODE" = "demo" ]; then
  [ -n "$ACME_EMAIL" ] || die "--mode demo requires --acme-email"
  COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.demo.yml)
  export ACME_EMAIL
  ok "demo mode — public TLS via Let's Encrypt"
fi

if [ -n "$STAFF_CSV" ] && [ ! -f "$STAFF_CSV" ]; then
  die "staff CSV not found: $STAFF_CSV"
fi

# --- 2. secrets -------------------------------------------------------------
say "Configuring"

gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; }

if [ -f .env ]; then
  ok ".env exists — leaving it alone"
  # Regenerating would rotate passwords the database was initialised with, and
  # those are only ever read on first cluster init. Every service would then
  # fail to authenticate against a cluster that cannot be repaired in place.
else
  cat > .env <<ENVEOF
PUBLIC_HOST=${PUBLIC_HOST}
PUBLIC_URL=https://${PUBLIC_HOST}
KEYCLOAK_PUBLIC_URL=https://${PUBLIC_HOST}

POSTGRES_DB=hr
POSTGRES_SUPERUSER=postgres
POSTGRES_SUPERUSER_PASSWORD=$(gen)
POSTGRES_APP_USER=hr_app
POSTGRES_APP_PASSWORD=$(gen)
POSTGRES_MIGRATOR_USER=hr_migrator
POSTGRES_MIGRATOR_PASSWORD=$(gen)

KEYCLOAK_DB=keycloak
KEYCLOAK_DB_USER=keycloak
KEYCLOAK_DB_PASSWORD=$(gen)
KEYCLOAK_ADMIN=kcadmin
KEYCLOAK_ADMIN_PASSWORD=$(gen)
KEYCLOAK_REALM=hr
OIDC_AUDIENCE=hr-system

LOG_LEVEL=info
ENVEOF
  chmod 600 .env
  ok ".env written with generated secrets (mode 600)"
fi

# .env is routinely edited on a Windows workstation and copied to a Linux
# server, which adds a UTF-8 BOM to the first line and CRLF to every line. The
# BOM makes `.` fail outright; the CRLF is worse — it silently appends \r to
# every value, so PUBLIC_HOST becomes "hr.office.local\r" and the certificate,
# the Keycloak issuer and the redirect URIs all quietly disagree with reality.
# Normalise into a temp file rather than editing the operator's .env.
ENV_NORMALISED="$(mktemp)"
trap 'rm -f "$ENV_NORMALISED"' EXIT
sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//' .env > "$ENV_NORMALISED"
set -a
# shellcheck source=/dev/null
. "$ENV_NORMALISED"
set +a

if [ "$PUBLIC_HOST" != "$(grep '^PUBLIC_HOST=' "$ENV_NORMALISED" | cut -d= -f2)" ]; then
  die "--host '$PUBLIC_HOST' disagrees with PUBLIC_HOST in the existing .env.
       Changing the public hostname requires rebuilding the web image (Vite
       inlines it) and updating the Keycloak client redirect URIs. Edit .env,
       then re-run with the matching --host."
fi

DB_URL="postgres://${POSTGRES_MIGRATOR_USER}:${POSTGRES_MIGRATOR_PASSWORD}@postgres:5432/${POSTGRES_DB}"

# --- 3. build and start -----------------------------------------------------
say "Building images"
docker compose "${COMPOSE_FILES[@]}" build
ok "images built"

say "Starting the stack"
docker compose "${COMPOSE_FILES[@]}" up -d

printf '    waiting for services to report healthy'
DEADLINE=$(( $(date +%s) + 300 ))
while :; do
  UNHEALTHY="$(docker compose "${COMPOSE_FILES[@]}" ps --format '{{.Service}} {{.Health}}' \
    | awk '$2 != "healthy" && $2 != "" {print $1}' || true)"
  [ -z "$UNHEALTHY" ] && break
  [ "$(date +%s)" -gt "$DEADLINE" ] && {
    printf '\n'
    die "timed out waiting for: $UNHEALTHY
       Inspect with:  docker compose logs $UNHEALTHY"
  }
  printf '.'
  sleep 5
done
printf '\n'
ok "all services healthy"

# --- 4. migrations ----------------------------------------------------------
say "Applying migrations"
docker compose "${COMPOSE_FILES[@]}" exec -T -e DATABASE_URL="$DB_URL" \
  api node dist/db/migrate.js
ok "schema up to date"

# --- 5. Keycloak realm ------------------------------------------------------
say "Provisioning the Keycloak realm"
# $k and $v below are Go template variables consumed by `docker inspect`, not
# shell variables — single quotes are required, not an oversight.
# shellcheck disable=SC2016
NETWORK="$(docker compose "${COMPOSE_FILES[@]}" ps --format '{{.Name}}' api \
  | head -1 | xargs -r docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
docker run --rm --network "$NETWORK" \
  -v "$ROOT/ops/keycloak:/s:ro" --env-file .env \
  -e KEYCLOAK_URL=http://keycloak:8080/auth \
  node:22-alpine node /s/provision-realm.mjs
ok "realm and client ready"

# --- 6. organisation and people --------------------------------------------
hr() {
  docker compose "${COMPOSE_FILES[@]}" exec -T -e ADMIN_DATABASE_URL="$DB_URL" \
    api node dist/cli/hr.js "$@"
}

say "Provisioning the organisation"
hr provision-org --org "$ORG_CODE" --name "$ORG_NAME" >/dev/null
ok "$ORG_CODE provisioned"

if [ -n "$STAFF_CSV" ]; then
  say "Importing staff"
  CSV_IN_CONTAINER="/tmp/$(basename "$STAFF_CSV")"
  docker compose "${COMPOSE_FILES[@]}" cp "$STAFF_CSV" "api:$CSV_IN_CONTAINER"

  # Dry run first, always. A 201 file that fails validation must not leave the
  # database half-populated, and the dry run is what proves it will not.
  hr import-201 --org "$ORG_CODE" --file "$CSV_IN_CONTAINER" --dry-run \
    | grep -Ev '^\{"level"' || die "staff import dry run failed — nothing was written"
  hr import-201 --org "$ORG_CODE" --file "$CSV_IN_CONTAINER" \
    | grep -Ev '^\{"level"' >/dev/null
  # `docker compose cp` writes as root while the container runs as `node`, and
  # /tmp is sticky — so the app user cannot delete its own input file. Remove it
  # as root and verify: this file holds the full 201 record, including the
  # statutory identifiers the database deliberately never stores. Leaving it on
  # a container filesystem would undo that.
  docker compose "${COMPOSE_FILES[@]}" exec -T --user root api rm -f "$CSV_IN_CONTAINER"
  if docker compose "${COMPOSE_FILES[@]}" exec -T --user root api test -e "$CSV_IN_CONTAINER"; then
    die "could not remove $CSV_IN_CONTAINER from the api container — it contains
       personal data and must not be left there. Remove it manually before
       putting this system into service."
  fi
  ok "staff imported (input file removed from the container)"

  say "Deriving roles from the org chart"
  hr sync-roles --org "$ORG_CODE" | grep -E 'granted'
fi

if [ -n "$HR_ADMIN" ]; then
  hr grant-admin --org "$ORG_CODE" --employee-no "$HR_ADMIN"
fi

say "Opening the goal period"
hr open-goal-period --org "$ORG_CODE" --name "$PERIOD_NAME" \
  --starts "$PERIOD_START" --ends "$PERIOD_END" | tail -2

# --- 7. demo logins (never on real data) -----------------------------------
if [ "$SEED_DEMO_USERS" = "true" ]; then
  [ -n "$STAFF_CSV" ] || die "--seed-demo-users requires --staff-csv"
  say "Creating demo logins"
  warn "these are shared-password accounts — never do this with real staff data"
  docker run --rm --network "$NETWORK" \
    -v "$ROOT:/w:ro" --env-file .env \
    -e KEYCLOAK_URL=http://keycloak:8080/auth \
    node:22-alpine node /w/ops/keycloak/seed-users.mjs "/w/${STAFF_CSV#./}"
fi

# --- 8. verify --------------------------------------------------------------
say "Pre-flight"
set +e
# The identity checks (leftover demo accounts, the password grant) read the
# realm, not the database, so preflight needs the admin credentials for this
# call only — they are deliberately not in the api service's environment.
docker compose "${COMPOSE_FILES[@]}" exec -T \
  -e ADMIN_DATABASE_URL="$DB_URL" \
  -e KEYCLOAK_URL=http://keycloak:8080/auth \
  -e KEYCLOAK_REALM="$KEYCLOAK_REALM" \
  -e OIDC_AUDIENCE="$OIDC_AUDIENCE" \
  -e KEYCLOAK_ADMIN="$KEYCLOAK_ADMIN" \
  -e KEYCLOAK_ADMIN_PASSWORD="$KEYCLOAK_ADMIN_PASSWORD" \
  -e KC_ENABLE_PASSWORD_GRANT="${KC_ENABLE_PASSWORD_GRANT:-}" \
  api node dist/cli/hr.js preflight --org "$ORG_CODE"
PREFLIGHT_RC=$?
set -e

# A demo install asked for shared-password logins, so the identity check is
# meant to refuse it. Say so plainly rather than failing the run — but do not
# pretend the result was clean.
if [ "$SEED_DEMO_USERS" = "true" ] && [ "$PREFLIGHT_RC" -ne 0 ]; then
  warn "pre-flight reported failures. --seed-demo-users created shared-password
       accounts, which the identity check refuses by design. This install is a
       demonstration and must never hold real employee data."
  PREFLIGHT_RC=0
fi

say "Done"
cat <<SUMMARY
    URL         https://${PUBLIC_HOST}
    Keycloak    https://${PUBLIC_HOST}/auth/admin/  (user: ${KEYCLOAK_ADMIN})
    Secrets     ${ROOT}/.env  — back this up somewhere safe, offline

    Still to do:
      * point DNS for ${PUBLIC_HOST} at this server
      * wire Active Directory: add LDAP_* to .env, re-run provision-realm.mjs
      * set SMTP_HOST/SMTP_PORT on the api service so notifications send
$([ "$MODE" = "onprem" ] && echo "      * distribute Caddy's root CA to staff machines (see ops/caddy/Caddyfile)")
SUMMARY

exit $PREFLIGHT_RC
