#!/bin/bash
# Dev-only role setup. Mirrors ops/postgres/init/00-roles.sh but with fixed
# weak passwords and no Keycloak database (dev Keycloak keeps its own store).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username postgres --dbname hr <<-'EOSQL'
  CREATE ROLE hr_migrator LOGIN BYPASSRLS PASSWORD 'devmigrator';
  CREATE ROLE hr_app LOGIN NOBYPASSRLS PASSWORD 'devapp';
  ALTER ROLE hr_app NOBYPASSRLS;
  GRANT ALL ON DATABASE hr TO hr_migrator;
  GRANT CONNECT ON DATABASE hr TO hr_app;
  -- PG15+ : database-level GRANT ALL does not imply CREATE on schema public.
  ALTER SCHEMA public OWNER TO hr_migrator;
  GRANT USAGE ON SCHEMA public TO hr_app;
EOSQL
