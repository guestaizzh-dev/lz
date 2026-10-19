#!/usr/bin/env bash
set -euo pipefail
# psql imports the password from the container environment, never from command arguments.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password DATABASE_APP_PASSWORD
CREATE ROLE academy_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE academy TO academy_app;
GRANT USAGE ON SCHEMA public TO academy_app;
ALTER DEFAULT PRIVILEGES FOR ROLE academy_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO academy_app;
ALTER DEFAULT PRIVILEGES FOR ROLE academy_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO academy_app;
SQL
