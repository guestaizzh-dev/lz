#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
destination=${1:?Usage: bash backup.sh /absolute/backup/directory}
[[ "$destination" = /* ]] || { printf 'Backup directory must be absolute\n' >&2; exit 1; }
mkdir -p "$destination"
archive=$(mktemp "$destination/academy-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.dump")
trap 'rm -f -- "$archive.partial" "$archive" "$archive.media.tar.gz" "$archive.sha256"' EXIT
docker compose exec -T database sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$archive.partial"
mv -- "$archive.partial" "$archive"
docker compose exec -T api tar -C /data/media -czf - . > "$archive.media.tar.gz"
sha256sum "$archive" "$archive.media.tar.gz" > "$archive.sha256"
trap - EXIT
printf 'Database backup saved: %s\n' "$archive"
