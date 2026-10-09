Whisky Manager live backup (see MANIFEST.txt for when it was taken)

whisky-manager.db   app SQLite DB (settings, templates, executions), consistent online copy
collection.pgdump   pg_dump -Fc of the collection DB (--no-owner --no-privileges)
settings/           app_settings / automation_settings / templates as JSON, plus collection-db.json
restore.sh          macOS/Linux restore (needs pg_restore and an empty target database)
restore.ps1         Windows restore (installs PostgreSQL 18 via winget, restores both DBs)

Windows: powershell -ExecutionPolicy Bypass -File .\restore.ps1   (run from the unzipped folder, app closed)
The dump is PostgreSQL 18 format; restore with pg_restore 18 or newer.
Contains the pairing token and DB connection info - keep private.
After restore, install the app version named in MANIFEST.txt (or newer): the app refuses a collection DB
whose latest migration is not its own (COLLECTION_SCHEMA_MISMATCH).
The extension must pair again if the token differs.
