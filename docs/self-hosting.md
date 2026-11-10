# Self-hosting Meally

## Configuration

Feature flags can be fixed with environment variables. The form is `MEALLY_FEATURE_<KEY>=on|off`, where `<KEY>` is
the flag key in upper case with `-` replaced by `_`:

```
MEALLY_FEATURE_MEAL_PLAN=off
MEALLY_FEATURE_AI=on
```

A flag set this way is locked: admins can't change it in the app. Flags that are not set can be changed by an admin.
A feature stays off if a feature it depends on is off. See `packages/shared/src/features.ts` for all keys.

## Accounts and sign-up

The first visit shows a setup page that creates the first admin and household.

- `MEALLY_SIGNUP_MODE=open|invite|closed` locks who can sign up (default `invite`). `open` creates a household per new
  user. Use `invite` or `closed` on a public instance.
- `BASE_URL` should be your public URL. With an https URL, session cookies are marked `Secure`.
- `MEALLY_TRUST_PROXY=true` makes the rate limiter use `X-Forwarded-For`. Set it only behind a reverse proxy you control.

## Importing recipes from URLs

Imports only fetch public http(s) pages on ports 80 and 443; private, loopback, link-local and metadata addresses are refused.
`MEALLY_ALLOW_PRIVATE_URLS=true` removes those checks (any address and port) for recipe import and webhooks. The old name `MEALLY_IMPORT_ALLOW_PRIVATE` still works. Use it only on a home lab where users are trusted.

## Backups

Members can download their household's recipes from Settings. Admins can also make whole-instance backups there.
A backup is a zip in `$DATA_DIR/backups/` with a consistent database snapshot, the images and a `manifest.json`.

- `MEALLY_BACKUP_CRON_HOURS` (default `24`, `0` turns scheduled backups off): hours between automatic backups. The
  first one runs shortly after start if the newest backup is older than that.
- `MEALLY_BACKUP_KEEP` (default `7`): how many backups to keep. Older ones are deleted after each new backup.
- `MEALLY_FEATURE_BACKUPS=off` disables export and backups.

Backups sit on the same disk as your data. Copy them off the machine too (3 copies, 2 media, 1 off-site).

### Restoring

Restore is offline on purpose. Stop Meally, then run, with the same `DATA_DIR`:

```
npm run restore -w apps/server -- /path/to/meally-<timestamp>.zip
# or, from a build: node dist/restore.js /path/to/meally-<timestamp>.zip
```

It refuses to run while the server's lock file (`$DATA_DIR/meally.lock`) names a running process (`--force`
overrides). It moves the current database and images to `$DATA_DIR/pre-restore-<timestamp>/`, unpacks the backup, and
refuses a backup made by a newer version than the one you run. Start Meally again afterwards.

## AI (optional)

The `ai` feature flag (off by default) adds recipe import from pasted text or photos. Nothing is sent anywhere until you
configure a provider; the key lives only in the environment.

| Variable | Meaning |
|---|---|
| `MEALLY_AI_PROVIDER` | `anthropic` or `openai` (any OpenAI-compatible server, including Ollama and LM Studio) |
| `MEALLY_AI_API_KEY` | Provider key. Optional for local OpenAI-compatible servers |
| `MEALLY_AI_MODEL` | Model name. Defaults to `claude-sonnet-5-5` for anthropic; required for openai |
| `MEALLY_AI_BASE_URL` | Optional API address, e.g. `http://localhost:11434` for Ollama |

Use a vision-capable model for photo import. Requests are limited to 30 per hour per user and time out after 60 s.
Users' text and photos are sent to the configured provider.
