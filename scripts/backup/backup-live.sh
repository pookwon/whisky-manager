#!/usr/bin/env bash
# Backs up the live app: SQLite DB, collection PostgreSQL DB and settings, then zips them.
# Safe while the app and a collection run are active (SQLite online backup, pg_dump snapshot).
# Output: $BACKUP_ROOT/live-YYYYMMDD-HHMMSS(.zip), named in KST. Earlier backups are never touched.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
backup_root="${BACKUP_ROOT:-$repo/backups}"

case "$(uname)" in
  Darwin) app_dir="$HOME/Library/Application Support/whisky-manager" ;;
  *) app_dir="${XDG_CONFIG_HOME:-$HOME/.config}/whisky-manager" ;;
esac
app_db="$app_dir/whisky-manager.db"
collection_config="$app_dir/collection-db.json"

for tool in sqlite3 pg_dump pg_restore zip node; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done
[ -f "$app_db" ] || { echo "app DB not found: $app_db" >&2; exit 1; }
[ -f "$collection_config" ] || { echo "collection config not found: $collection_config" >&2; exit 1; }

database_url="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).databaseUrl)" "$collection_config")"

name="live-$(TZ=Asia/Seoul date +%Y%m%d-%H%M%S)"
target="$backup_root/$name"
staging="$target.partial"
[ ! -e "$target" ] && [ ! -e "$target.zip" ] || { echo "already exists: $target" >&2; exit 1; }
trap 'rm -rf "$staging"' EXIT
mkdir -p -m 700 "$staging/settings"

sqlite3 -readonly "$app_db" ".backup '$staging/whisky-manager.db'"
[ "$(sqlite3 -readonly "$staging/whisky-manager.db" 'pragma integrity_check')" = ok ] \
  || { echo "app DB copy failed integrity check" >&2; exit 1; }

for table in app_settings automation_settings templates; do
  sqlite3 -readonly "$staging/whisky-manager.db" -json "select * from $table" > "$staging/settings/$table.json"
done
cp "$collection_config" "$staging/settings/collection-db.json"

pg_dump "$database_url" -Fc --no-owner --no-privileges -f "$staging/collection.pgdump"
pg_restore -l "$staging/collection.pgdump" >/dev/null

cp "$here/restore.sh" "$here/restore.ps1" "$here/README.txt" "$staging/"
chmod +x "$staging/restore.sh"
{
  echo "taken: $(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S') KST"
  echo "app version: $(node -p "require('$repo/package.json').version")"
  echo "collection schema: $(node -p "require('$repo/drizzle-collection/meta/_journal.json').entries.at(-1).tag")"
  echo "app executions: $(sqlite3 -readonly "$staging/whisky-manager.db" 'select count(*) from executions')"
  echo "collection tables in dump: $(pg_restore -l "$staging/collection.pgdump" | grep -c 'TABLE DATA')"
} > "$staging/MANIFEST.txt"
rm -f "$staging/whisky-manager.db-shm" "$staging/whisky-manager.db-wal"

chmod -R go-rwx "$staging"
mv "$staging" "$target"
(cd "$backup_root" && zip -qr -X "$name.zip" "$name")
chmod 600 "$target.zip"
trap - EXIT
echo "backup written: $target.zip"
cat "$target/MANIFEST.txt"
