#!/usr/bin/env bash
# Nightly logical backup. Run from cron on the host:
#   0 1 * * *  /opt/hr-system/ops/backup/backup.sh >> /var/log/hr-backup.log 2>&1
#
# This is the LOGICAL backup (pg_dump). It is not a substitute for continuous
# archiving -- a dump loses everything written since it ran. For an HR system
# with a daily change rate that is usually acceptable; confirm the RPO with the
# business and add pgBackRest WAL archiving if it is not.
#
# The backup is worthless until restore.sh has been run against it successfully.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/hr-system}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/hr-system/docker-compose.yml}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="${BACKUP_DIR}/hr-${STAMP}.dump"

# GPG recipient for at-rest encryption. Backups contain the entire HR record of
# every employee; an unencrypted dump on a NAS share is a data breach waiting
# for someone to browse the wrong folder.
GPG_RECIPIENT="${GPG_RECIPIENT:-}"

log() { echo "[$(date -Is)] $*"; }
fail() { log "FAILED: $*"; exit 1; }

mkdir -p "$BACKUP_DIR"

log "starting backup -> ${TARGET}"

# -Fc = custom format: compressed, and restorable selectively by table.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_SUPERUSER:-postgres}" -d "${POSTGRES_DB:-hr}" -Fc \
  > "$TARGET" || fail "pg_dump returned non-zero"

[[ -s "$TARGET" ]] || fail "dump file is empty"

# Verify the dump is structurally readable BEFORE trusting it. A truncated
# dump exits 0 from the pipeline above but fails here.
pg_restore --list "$TARGET" > /dev/null 2>&1 || fail "dump is not readable by pg_restore"

if [[ -n "$GPG_RECIPIENT" ]]; then
  gpg --batch --yes --encrypt --recipient "$GPG_RECIPIENT" "$TARGET" \
    || fail "encryption failed"
  shred -u "$TARGET" 2>/dev/null || rm -f "$TARGET"
  TARGET="${TARGET}.gpg"
  log "encrypted -> ${TARGET}"
else
  log "WARNING: GPG_RECIPIENT unset -- backup is UNENCRYPTED"
fi

sha256sum "$TARGET" > "${TARGET}.sha256"
log "size: $(du -h "$TARGET" | cut -f1)"

# Off-machine copy. A backup on the same disk as the database protects against
# exactly nothing (infra.md section 4).
if [[ -n "${OFFSITE_TARGET:-}" ]]; then
  rsync -a --partial "$TARGET" "${TARGET}.sha256" "$OFFSITE_TARGET/" \
    || fail "offsite copy failed -- backup exists locally ONLY"
  log "copied offsite -> ${OFFSITE_TARGET}"
else
  log "WARNING: OFFSITE_TARGET unset -- backup exists on this host ONLY"
fi

find "$BACKUP_DIR" -name 'hr-*.dump*' -mtime "+${RETENTION_DAYS}" -delete
log "backup complete"
