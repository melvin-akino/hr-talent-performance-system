#!/usr/bin/env bash
#
# Nightly Encrypted Database Backup with Automated S3 Offsite Sync
# Run via cron on the AWS EC2 instance:
#   0 2 * * * /opt/hr-system/ops/backup/backup-s3.sh >> /var/log/hr-backup-s3.log 2>&1
#
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/hr-system}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPOSE_FILE="${COMPOSE_FILE:-/home/ubuntu/hr-system/docker-compose.saas.yml}"
S3_BUCKET="${S3_BUCKET:-}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="${BACKUP_DIR}/hr-saas-${STAMP}.dump"

log() { echo "[$(date -Is)] $*"; }
fail() { log "FAILED: $*"; exit 1; }

mkdir -p "$BACKUP_DIR"
log "Starting logical database dump -> ${TARGET}"

# Dump compressed custom format
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_SUPERUSER:-postgres}" -d "${POSTGRES_DB:-hr}" -Fc \
  > "$TARGET" || fail "pg_dump failed"

[[ -s "$TARGET" ]] || fail "database dump is empty"

# Integrity verification
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore --list > /dev/null 2>&1 < "$TARGET" || fail "pg_restore integrity check failed"

sha256sum "$TARGET" > "${TARGET}.sha256"
log "Dump verified. Size: $(du -h "$TARGET" | cut -f1)"

# S3 Offsite Copy (if S3_BUCKET is provided)
if [ -n "$S3_BUCKET" ]; then
  log "Uploading to AWS S3: s3://${S3_BUCKET}/backups/"
  aws s3 cp "$TARGET" "s3://${S3_BUCKET}/backups/$(basename "$TARGET")" --sse AES256 || fail "S3 upload failed"
  aws s3 cp "${TARGET}.sha256" "s3://${S3_BUCKET}/backups/$(basename "$TARGET").sha256" --sse AES256
  log "S3 offsite upload complete."
else
  log "INFO: S3_BUCKET not specified; backup stored locally."
fi

# Rotate local backups
find "$BACKUP_DIR" -name 'hr-saas-*.dump*' -mtime "+${RETENTION_DAYS}" -delete
log "Local backup rotation complete."
