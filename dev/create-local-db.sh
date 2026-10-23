#!/bin/bash
# Creates the dev role and database in your main local Postgres, using the
# user, password and database name in .env's DATABASE_URL.
# Asks once for the postgres superuser password.
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL=$(command -v psql || echo /Library/PostgreSQL/18/bin/psql)
read -r DB_USER DB_PASS DB_NAME DB_HOST DB_PORT < <(node -e '
  require("dotenv").config({ quiet: true });
  const u = new URL(process.env.DATABASE_URL);
  console.log(decodeURIComponent(u.username), decodeURIComponent(u.password),
              u.pathname.slice(1), u.hostname, u.port || 5432);
')

echo "Creating role $DB_USER and database $DB_NAME on $DB_HOST:$DB_PORT."
echo "psql will ask for the postgres superuser password."
"$PSQL" -U postgres -h "$DB_HOST" -p "$DB_PORT" -d postgres -v ON_ERROR_STOP=1 \
  -v user="$DB_USER" -v pass="$DB_PASS" -v db="$DB_NAME" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'user', :'pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'user') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'user', :'pass') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SQL
echo "Done. Next: npm run db:reset"
