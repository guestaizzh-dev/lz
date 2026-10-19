#!/usr/bin/env bash
set -euo pipefail
umask 077
base=/opt/daoxue-academy
release=20261012-member-partial-02
prior=$(readlink -f "$base/current")
next="$base/releases/$release"
[[ "$prior" == "$base/releases/"* && -d "$prior/infra" && ! -e "$next" ]]
envfile="$base/production.env"
rollback="$base/production.env.before-$release"
cp -p "$envfile" "$rollback"
printf 'Previous release: %s\nNew release: %s\n' "$prior" "$next"
sudo systemctl start academy-backup.service
backup=$(sudo find "$base/backups" -maxdepth 1 -name '*.dump' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
[[ -n "$backup" ]]
sudo sha256sum -c "$backup.sha256"
sudo sh -c 'cat "$1" | docker exec -i daoxue-database-1 pg_restore --list >/dev/null' sh "$backup"
sudo tar -tzf "$backup.media.tar.gz" >/dev/null
printf 'Verified backup: %s\n' "$backup"
query='SELECT json_build_object('
query+="'users',(SELECT count(*) FROM \"User\"),'articles',(SELECT count(*) FROM \"Article\"),'courses',(SELECT count(*) FROM \"Course\"),'products',(SELECT count(*) FROM \"Product\"),'plans',(SELECT count(*) FROM \"MembershipPlan\"),'memberships',(SELECT count(*) FROM \"Membership\"),'orders',(SELECT count(*) FROM \"TradeOrder\"),'refunds',(SELECT count(*) FROM \"Refund\"),'member_hash',(SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id)::text,'[]')) FROM \"Membership\" m),'plan_hash',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'[]')) FROM \"MembershipPlan\" p));"
printf '%s' "$query" | docker exec -i daoxue-database-1 sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' > "$base/data-before-$release.json"
mkdir -p "$next"
cp -a "$prior/." "$next/"
mv "$next/apps/admin/dist" "$next/apps/admin/dist.previous"
tar -xzf /tmp/academy-member-partial-refund.tar.gz -C "$next"
chmod -R a+rX "$next/apps/admin/dist" "$next/services/api"
cd "$next/infra"
compose=(docker compose -p daoxue --env-file "$envfile" -f compose.yaml -f compose.shared-edge.yaml)
export API_IMAGE_TAG="$release"
"${compose[@]}" config --quiet
"${compose[@]}" build api
"${compose[@]}" run --rm migrate
rollback_release(){
  rc=$?
  if [[ "$rc" != 0 ]]; then
    printf 'Release verification failed; checking rollback safety\n' >&2
    partial=$(printf '%s' "SELECT count(*) FROM \"Refund\" WHERE \"reasonCode\"='MEMBERSHIP_PARTIAL';" | docker exec -i daoxue-database-1 sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At')
    if [[ "$partial" == 0 ]]; then
      cp -p "$rollback" "$envfile"
      unset API_IMAGE_TAG
      cd "$prior/infra"
      docker compose -p daoxue --env-file "$envfile" -f compose.yaml -f compose.shared-edge.yaml up -d --no-build api edge
      ln -sfn "$prior" "$base/current"
    else
      printf 'New refund records exist; preserve data and repair forward. Previous release: %s\n' "$prior" >&2
    fi
  fi
  exit "$rc"
}
trap rollback_release EXIT
sed -i "s/^API_IMAGE_TAG=.*/API_IMAGE_TAG=$release/" "$envfile"
grep -q "^API_IMAGE_TAG=$release$" "$envfile"
"${compose[@]}" up -d --no-build api edge
for n in $(seq 1 30); do
  health=$(docker inspect daoxue-api-1 --format '{{.State.Health.Status}}')
  [[ "$health" == healthy ]] && break
  sleep 2
done
[[ "$health" == healthy ]]
curl -fsS https://academy.43-160-229-173.sslip.io/api/v1/health
curl -fsS https://academy.43-160-229-173.sslip.io/membership-orders >/dev/null
printf '%s' "$query" | docker exec -i daoxue-database-1 sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' > "$base/data-after-$release.json"
cmp "$base/data-before-$release.json" "$base/data-after-$release.json"
cat "$base/data-after-$release.json"
ln -sfn "$next" "$base/current"
printf 'Previous release: %s\nPrevious config: %s\nMigration: additive nullable refund fields; do not roll back once negotiated refunds exist\n' "$prior" "$rollback" > "$base/rollback-$release.txt"
docker ps --format '{{.Names}} {{.Status}}'
printf 'Deployment verified: %s\n' "$release"
trap - EXIT
