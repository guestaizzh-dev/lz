#!/usr/bin/env bash
# Restore only into an isolated database and temporary media directory.
set -Eeuo pipefail
umask 077
archive=${1:?Usage: restore-drill.sh /absolute/path/backup.dump}
[[ "$archive" = /* && "$archive" = *.dump && -f "$archive" ]]
sha256sum -c "$archive.sha256"
container=${ACADEMY_DATABASE_CONTAINER:-daoxue-database-1}
database="academy_restore_drill_$(date -u +%Y%m%d%H%M%S)_$$"
[[ "$database" =~ ^academy_restore_drill_[0-9_]+$ ]]
root=$(mktemp -d /opt/daoxue-academy/restore-drill-XXXXXXXX)
[[ "$root" == /opt/daoxue-academy/restore-drill-* ]]
cleanup() {
  docker exec "$container" dropdb --if-exists -U academy_owner "$database"
  [[ "$root" == /opt/daoxue-academy/restore-drill-* && -d "$root" ]]
  rm -rf -- "$root"
}
trap cleanup EXIT
# Validate every tar path before extracting. Never restore over production media.
python3 - "$archive.media.tar.gz" <<'PY'
import sys,tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1]) as archive:
 for entry in archive:
  p=PurePosixPath(entry.name)
  if p.is_absolute() or '..' in p.parts or not (entry.isfile() or entry.isdir()):
   raise SystemExit('Unsafe backup media entry')
PY
needed=$(gzip -dc "$archive.media.tar.gz" | wc -c)
available=$(df --output=avail -B1 "$root" | tail -1)
(( available > needed + 1073741824 )) || { echo 'Insufficient safe restore space'; exit 1; }
docker exec "$container" createdb -U academy_owner "$database"
docker exec -i "$container" pg_restore -U academy_owner -d "$database" --exit-on-error --no-owner < "$archive"
tar --no-same-owner -xzf "$archive.media.tar.gz" -C "$root"
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U academy_owner -d "$database" -At <<'SQL'
SELECT 'migrations='||count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;
SELECT 'users='||count(*) FROM "User";
SELECT 'orders='||count(*) FROM "TradeOrder";
SELECT 'media='||count(*) FROM "MediaAsset";
SQL
docker exec "$container" psql -U academy_owner -d "$database" -At -c 'SELECT "storageKey" FROM "MediaAsset" WHERE status=$$READY$$;' > "$root/ready-media-keys.txt"
python3 - "$root" "$archive.media.tar.gz" <<'PY'
import hashlib,sys,tarfile
from pathlib import Path
root=Path(sys.argv[1]).resolve(); verified=0
with tarfile.open(sys.argv[2]) as archive:
 for entry in archive:
  if not entry.isfile(): continue
  actual=(root/entry.name).resolve()
  if not actual.is_relative_to(root): raise SystemExit('Unsafe restore path')
  def digest(stream):
   h=hashlib.sha256()
   for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
   return h.digest()
  with actual.open('rb') as stream:
   if digest(stream)!=digest(archive.extractfile(entry)):raise SystemExit('Restored media checksum mismatch')
  verified+=1
keys=(root/'ready-media-keys.txt').read_text().splitlines();missing=[]
for key in keys:
 p=(root/key).resolve()
 if not p.is_relative_to(root) or not p.is_file():missing.append(key)
print('Restored archive files verified:',verified)
print('READY database media entries:',len(keys),'missing:',len(missing))
if missing:raise SystemExit('Database/media consistency requires repair; original production data unchanged')
print('ISOLATED_RESTORE_OK: database and media restored; production untouched')
PY
