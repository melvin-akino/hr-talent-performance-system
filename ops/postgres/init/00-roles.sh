#!/bin/bash
# Runs once, on first cluster init only.
#
# Creates the two non-superuser roles the system uses. This separation is
# load-bearing: PostgreSQL RLS is bypassed by superusers AND by table owners,
# so the API must connect as a role that is neither (decisions.md D-003).
#
#   hr_migrator -- owns the schema, runs migrations, BYPASSES RLS by ownership
#   hr_app      -- the API's role. Owns nothing. RLS always enforced.
set -euo pipefail

# Fail loudly and specifically. This script runs once, on first cluster init,
# and a cluster that comes up without these roles is not recoverable by
# restarting: the volume has to be destroyed. An unset password here previously
# produced a healthy-looking database containing nothing but the superuser, and
# the first symptom was "password authentication failed" from every service.
for required in POSTGRES_APP_PASSWORD POSTGRES_MIGRATOR_PASSWORD KEYCLOAK_DB_PASSWORD; do
  if [ -z "${!required:-}" ]; then
    echo "FATAL: $required is unset. It must be passed to the postgres service" >&2
    echo "       in docker-compose.yml, not merely present in .env." >&2
    exit 1
  fi
done

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- BYPASSRLS is required for two operator paths only: migrations, and the
  -- bulk employee import (which has no authenticated user by definition).
  -- This role must NEVER appear in the API's DATABASE_URL.
  CREATE ROLE ${POSTGRES_MIGRATOR_USER:-hr_migrator}
    LOGIN BYPASSRLS PASSWORD '${POSTGRES_MIGRATOR_PASSWORD}';
  CREATE ROLE ${POSTGRES_APP_USER:-hr_app}
    LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}';

  -- Defensive: if someone later grants this role table ownership, RLS would
  -- silently stop applying. FORCE on each table (set in migrations) closes
  -- the owner-bypass hole; NOBYPASSRLS closes the attribute hole.
  ALTER ROLE ${POSTGRES_APP_USER:-hr_app} NOBYPASSRLS;

  GRANT ALL ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_MIGRATOR_USER:-hr_migrator};
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_APP_USER:-hr_app};

  -- PostgreSQL 15+ no longer grants CREATE on schema public to PUBLIC, and
  -- database-level GRANT ALL does NOT imply schema-level CREATE. Without this
  -- the very first migration fails with "permission denied for schema public".
  -- Ownership (rather than a bare GRANT) also makes hr_migrator the owner of
  -- every table it creates, which is what FORCE ROW LEVEL SECURITY assumes.
  ALTER SCHEMA public OWNER TO ${POSTGRES_MIGRATOR_USER:-hr_migrator};
  GRANT USAGE ON SCHEMA public TO ${POSTGRES_APP_USER:-hr_app};

  -- Keycloak gets its own database, fully separate from HR data.
  CREATE ROLE ${KEYCLOAK_DB_USER:-keycloak}
    LOGIN PASSWORD '${KEYCLOAK_DB_PASSWORD}';
  CREATE DATABASE ${KEYCLOAK_DB:-keycloak}
    OWNER ${KEYCLOAK_DB_USER:-keycloak};

  -- Public schema is not a dumping ground.
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
EOSQL
