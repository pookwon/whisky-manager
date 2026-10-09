#!/usr/bin/env bash
# Restores this backup on a new machine. Quit Whisky Manager first.
# Usage: ./restore.sh [postgres-url]   (default: URL stored in settings/collection-db.json)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

case "$(uname)" in
  Darwin) appdir="$HOME/Library/Application Support/whisky-manager" ;;
  *) appdir="${APPDATA:-$HOME/.config}/whisky-manager" ;;
esac
url="${1:-$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['databaseUrl'])" "$here/settings/collection-db.json")}"

mkdir -p "$appdir"
if [ -e "$appdir/whisky-manager.db" ]; then
  echo "refusing to overwrite $appdir/whisky-manager.db — move it aside first" >&2
  exit 1
fi
cp "$here/whisky-manager.db" "$appdir/whisky-manager.db"
cp -n "$here/settings/collection-db.json" "$appdir/collection-db.json"

# the database named in the URL must already exist: createdb <name>
pg_restore --no-owner --no-privileges --dbname "$url" "$here/collection.pgdump"
grep -e '^app version:' -e '^collection schema:' "$here/MANIFEST.txt" || true
echo "install that app version (or newer) - the app refuses a collection DB whose latest migration is not its own"
echo "restored app DB to $appdir and collection DB to $url"
