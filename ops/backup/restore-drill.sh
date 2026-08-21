#!/usr/bin/env bash
# RESTORE DRILL -- the Phase 0 exit gate.
#
# Restores the most recent backup into a THROWAWAY container, verifies the data
# actually arrived, and reports how long it took. That elapsed time is your real
# RTO; the number you assume without measuring is always wrong and always low.
#
# Run this monthly, and after any Postgres version change. A backup that has
# never been restored is a hypothesis, not a backup.
#
#   ./restore-drill.sh [path-to-dump]
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/hr-system}"
DUMP="${1:-$(ls -t "${BACKUP_DIR}"/hr-*.dump 2>/dev/null | head -n1 || true)}"
DRILL_CONTAINER="hr-restore-drill-$$"
DRILL_PASSWORD="drill-$(head -c 12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"

log() { echo "[$(date -Is)] $*"; }
cleanup() { docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

[[ -n "$DUMP" && -f "$DUMP" ]] || { log "No dump found. Pass a path explicitly."; exit 1; }

if [[ -f "${DUMP}.sha256" ]]; then
  log "verifying checksum"
  (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256") \
    || { log "CHECKSUM MISMATCH -- this backup is corrupt"; exit 1; }
fi

log "restoring ${DUMP} into a scratch container"
START=$(date +%s)

docker run -d --name "$DRILL_CONTAINER" \
  -e POSTGRES_PASSWORD="$DRILL_PASSWORD" \
  -e POSTGRES_DB=hr_drill \
  postgres:16-alpine >/dev/null

# Wait for readiness rather than sleeping a guessed interval.
for _ in $(seq 1 60); do
  docker exec "$DRILL_CONTAINER" pg_isready -U postgres -d hr_drill >/dev/null 2>&1 && break
  sleep 1
done

docker exec -i "$DRILL_CONTAINER" \
  pg_restore -U postgres -d hr_drill --no-owner --no-privileges < "$DUMP" \
  || log "pg_restore reported errors (often benign role/ownership warnings -- read them)"

END=$(date +%s)
ELAPSED=$((END - START))

log "verifying restored contents"
FAILED=0
verify() {
  local label="$1" sql="$2" expect="$3"
  local actual
  actual=$(docker exec "$DRILL_CONTAINER" psql -U postgres -d hr_drill -tAc "$sql" 2>/dev/null || echo "ERR")
  if [[ "$actual" == "$expect" || ( "$expect" == ">0" && "$actual" =~ ^[0-9]+$ && "$actual" -gt 0 ) ]]; then
    log "  OK   ${label}: ${actual}"
  else
    log "  FAIL ${label}: got '${actual}', expected '${expect}'"
    FAILED=1
  fi
}

verify "employees present"      "SELECT count(*) FROM employee"        ">0"
verify "reporting lines present" "SELECT count(*) FROM reporting_line" ">0"
verify "audit history present"  "SELECT count(*) FROM audit_log"       ">0"
verify "RLS still enabled"      \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity" ">0"
verify "authorization fn intact" \
  "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app' AND p.proname='can_access'" "1"

echo
if [[ "$FAILED" -eq 0 ]]; then
  log "RESTORE DRILL PASSED"
else
  log "RESTORE DRILL FAILED -- do not treat this backup as usable"
fi
log "Measured restore time: ${ELAPSED}s. This is your RTO for the database"
log "layer only; add container rebuild and DNS/cert time for a true figure."
exit "$FAILED"
