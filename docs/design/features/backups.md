# Export and backups (F18, flag `backups`)

## What it does

Any member can download their household's recipes as a zip (schema.org JSON-LD or Markdown with front matter), or one
recipe at a time. Admins can create, list, download and delete whole-instance backups (database snapshot, images and a
manifest), and the server can make them on a timer. Restore is an offline command. Mealie and RecipeSage offer recipe
export and a database dump respectively; ours is one flag with both levels, written from scratch.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Snapshot the database with `VACUUM INTO` a temp file, then zip that file | Copy `meally.db` (plus `-wal`/`-shm`); online backup API | [S1][S2] |
| D2 | Restore is an offline CLI (`npm run restore -w apps/server -- <zip>`), guarded by a lock file | Restore over HTTP | below |
| D3 | JSON-LD export uses `recipeIngredient` raw lines and `HowToSection` steps so our importer reads it back unchanged | Custom JSON | tested round trip |
| D4 | Schedule is an in-process timer from env (`MEALLY_BACKUP_CRON_HOURS`, `MEALLY_BACKUP_KEEP`); read-only in the UI | Cron expression; editable in the UI | simplicity |
| D5 | Backup names are generated (`meally-<UTC timestamp>.zip`) and matched against one strict regex before touching disk | Sanitise user input | path traversal safety |

**D1.** Copying a live WAL-mode database can miss commits still in the WAL file, so a plain copy is not safe while the
server runs. `VACUUM INTO` writes a transactionally consistent, compacted copy in one statement and works through our
existing connection (libsql). The cost is extra temp disk space (about the database size) and a full rebuild, which is
fine for a household-sized database. The images directory is added as files; images are immutable once written (new
uploads get new ids), so they need no snapshot.

**D2.** Restore replaces the database file under a running process. Doing it over HTTP would mean swapping files
beneath open connections, a half-restored state if the request dies, and a destructive endpoint that is one stolen
admin session away from wiping the instance. The CLI refuses to run while `DATA_DIR/meally.lock` names a live process
(the server writes it at start and removes it on exit; a stale lock is ignored; `--force` overrides). It validates the
manifest first (format, and the backup's migration count must not exceed this build's), then moves `meally.db*` and
`images/` into `DATA_DIR/pre-restore-<timestamp>/` before unpacking. Nothing is deleted.

## 3-2-1 advice for operators

Keep 3 copies of your data, on 2 different kinds of storage, with 1 off-site. The built-in backups live under
`DATA_DIR/backups`, which is the same disk as the data, so they protect against mistakes and bad upgrades but not disk
loss. Copy them elsewhere (rsync, rclone, a NAS, cloud storage) on a schedule, and try a restore on a spare directory
now and then.

## Data and API

No new tables. Zip layout of a recipe export: `recipes/<slug>.json|md` and `images/<slug>.webp`. A backup zip holds
`manifest.json` (`format`, `appVersion`, `schemaMigrations`, `createdAt`), `meally.db` and `images/...`.

- `GET /api/v1/export/recipes?format=jsonld|markdown`: any member, streams a zip of the caller's household.
- `GET /api/v1/recipes/:slug/export?format=...`: one recipe; 404 for other households.
- `GET|POST /api/v1/admin/backups`: admin only. List returns `{items, schedule: {hours, keep}}`.
- `GET|DELETE /api/v1/admin/backups/:name`: names must match `^meally-\d{8}T\d{6,9}Z\.zip$`, else 404.

Not exported: ratings, timeline entries, cookbooks, meal plans and shopping lists (use an instance backup for those).
Retention (`MEALLY_BACKUP_KEEP`) is applied after every backup, manual or scheduled, and always keeps the newest.

## UI

Settings, section "Export & backups" (hidden when the flag is off). Members: two download links (JSON-LD, Markdown).
Admins also see the schedule sentence, "Create now", and a list with Download and Delete; skeleton while loading, an
error line, and an empty line. The per-recipe export menu item is deferred.

## Sources

- [S1] How to Back Up a WAL-Mode SQLite Database Without Losing Data, https://oneuptime.com/blog/post/2026-09-08-back-up-wal-mode-sqlite-safely/view
- [S2] How to VACUUM SQLite in WAL Mode, https://photostructure.com/coding/how-to-vacuum-sqlite/
