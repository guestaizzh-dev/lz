#!/usr/bin/env bash
set -euo pipefail
# systemd journal is the local fallback when the application itself is unavailable.
endpoint=${ACADEMY_HEALTH_URL:-https://academy.43-160-229-173.sslip.io/api/v1/health}
curl --fail --silent --show-error --max-time 15 "$endpoint" >/dev/null || { echo 'CRITICAL academy API is unavailable'; exit 1; }
latest=$(find /opt/daoxue-academy/backups -maxdepth 1 -name '*.dump.sha256' -mmin -1560 -print -quit)
[[ -n "$latest" ]] || { echo 'CRITICAL academy verified backup is older than 26 hours'; exit 1; }
available=$(df --output=avail -B1 /opt/daoxue-academy | tail -1)
(( available >= 2147483648 )) || { echo 'CRITICAL academy filesystem has less than 2GiB free'; exit 1; }
echo 'academy health and backup freshness OK'
