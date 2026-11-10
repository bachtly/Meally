# Self-hosting Meally

Meally is one Node process that serves the API and the web app, with a SQLite database and an image folder in a single
data directory. There is nothing else to run.

Contents: [Quick start](#quick-start) · [Docker Compose](#docker-compose) · [Reverse proxy](#reverse-proxy-and-base_url) ·
[Public instance checklist](#public-instance-checklist) · [Environment variables](#environment-variables) ·
[Feature flags](#feature-flags) · [Backups and restore](#backups-and-restore) · [Upgrading](#upgrading)

## Quick start

```sh
docker run -d --name meally --restart unless-stopped \
  -p 8080:8080 -v meally-data:/data \
  -e BASE_URL=http://localhost:8080 \
  ghcr.io/bachtly/meally:latest
```

Open <http://localhost:8080>. The first visit shows a setup page that creates the first admin account and its
household. After that, the admin console (account menu, then Admin) controls sign-up, feature flags and users.

The container runs as the unprivileged `node` user and keeps everything under `/data`. Mount a volume or a folder you
own there.

## Docker Compose

`docker-compose.yml` at the root of the repository:

```yaml
services:
  meally:
    image: ghcr.io/bachtly/meally:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      BASE_URL: http://localhost:8080
      MEALLY_SIGNUP_MODE: invite
    volumes:
      - meally-data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

volumes:
  meally-data:
```

Run `docker compose up -d`. The healthcheck uses Node because the image has no `curl`.

## Reverse proxy and BASE_URL

Put Meally behind a proxy that terminates HTTPS. Then:

- Set `BASE_URL` to the public address, such as `https://recipes.example.com`. It is used for share and invite links,
  for the CSRF origin check, and, when it starts with `https://`, to mark session cookies `Secure`.
- Set `MEALLY_TRUST_PROXY=true` so rate limits use the client address from `X-Forwarded-For`. Only do this when the
  proxy is yours and Meally is not reachable directly.
- Turn response buffering off for the live shopping-list stream, `/api/v1/shopping/lists/*/events`. It is
  Server-Sent Events, and a buffering proxy delays updates or drops the connection.

### Caddy

Caddy streams responses by default and gets certificates for you.

```caddyfile
recipes.example.com {
    encode zstd gzip
    reverse_proxy meally:8080 {
        # Send SSE chunks straight away.
        flush_interval -1
    }
}
```

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name recipes.example.com;
    # ssl_certificate / ssl_certificate_key ...

    client_max_body_size 25m;   # photo and backup uploads

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Live shopping-list updates (Server-Sent Events).
    location ~ ^/api/v1/shopping/lists/[^/]+/events$ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
```

## Public instance checklist

Before you open Meally to people you don't know:

- [ ] **Sign-up mode.** Set `MEALLY_SIGNUP_MODE=invite` (default) or `closed`. Use `open` only if you want anyone to
      create a household.
- [ ] **HTTPS.** Serve it over HTTPS and set `BASE_URL` to the `https://` address, so cookies are `Secure`.
- [ ] **Proxy settings.** `MEALLY_TRUST_PROXY=true` behind your proxy, and only then.
- [ ] **Backups.** Keep scheduled backups on (`MEALLY_BACKUP_CRON_HOURS`), and copy them off the machine.
- [ ] **Rate limits.** Sign-in, sign-up, invite, URL import, share-link and API-token requests are limited per client
      address, in memory (see [below](#rate-limits)). They need `MEALLY_TRUST_PROXY` to see real client addresses.
- [ ] **Private addresses.** Leave `MEALLY_ALLOW_PRIVATE_URLS` unset. It lets URL import and webhooks reach your local
      network.
- [ ] **AI off.** Leave the `ai` flag off unless you accept that recipe text and photos go to the provider whose key is
      configured. That is a privacy decision for you and your users.
- [ ] **Flags.** Turn off features you do not want to support (`MEALLY_FEATURE_<KEY>=off`), for example `webhooks`.
- [ ] **Updates.** Follow [Upgrading](#upgrading) regularly.

### Rate limits

Fixed windows, per client address, kept in memory and reset on restart:

| Action | Limit |
|---|---|
| Sign in | 10 per 15 minutes |
| Sign up and first-run setup | 20 per hour |
| Accept an invite | 30 per 15 minutes |
| Import from URL | 20 per hour |
| Open a public share link | 60 per minute |
| API requests with a token | 600 per 10 minutes |

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `NODE_ENV` | `development` (`production` in the image) | `production` serves the built web app from the server. |
| `PORT` | `8080` | Port the server listens on. |
| `DATA_DIR` | `./data` (`/data` in the image) | Database, images and backups. A lock file stops two servers sharing it. |
| `BASE_URL` | `http://localhost:8080` | Public address. Used for share and invite links, the CSRF origin check, and `Secure` cookies when `https://`. |
| `WEB_DIST` | built-in path | Folder of the built web app. Rarely needed. |
| `MEALLY_SIGNUP_MODE` | `invite` | `open`, `invite` or `closed`. When set, admins cannot change it in the app. |
| `MEALLY_TRUST_PROXY` | `false` | `true` makes rate limits use `X-Forwarded-For`. Only behind a proxy you control. |
| `MEALLY_ALLOW_PRIVATE_URLS` | `false` | `true` lets URL import and webhooks reach private, loopback and non-standard-port addresses. |
| `MEALLY_IMPORT_ALLOW_PRIVATE` | `false` | Old name of `MEALLY_ALLOW_PRIVATE_URLS`; still works. |
| `MEALLY_BACKUP_CRON_HOURS` | `24` | Hours between automatic backups. `0` turns them off. |
| `MEALLY_BACKUP_KEEP` | `7` | How many backups to keep. |
| `MEALLY_AI_PROVIDER`, `MEALLY_AI_API_KEY`, `MEALLY_AI_MODEL`, `MEALLY_AI_BASE_URL` | unset | Optional AI helpers. See [AI (optional)](#ai-optional). |
| `MEALLY_FEATURE_<KEY>` | unset | `on` or `off` fixes a feature flag. See [Feature flags](#feature-flags). |

## Feature flags

Every feature after the core can be switched off. An admin changes flags in the admin console. To fix one for the
whole instance, set `MEALLY_FEATURE_<KEY>=on|off`, where `<KEY>` is the key in upper case with `-` replaced by `_`
(`meal-plan` becomes `MEALLY_FEATURE_MEAL_PLAN`). A flag fixed this way is locked in the console. A feature stays off
when a feature it depends on is off.

| Key | Default | What it does | Needs |
|---|---|---|---|
| `import-url` | on | Import a recipe from a web page. | |
| `ingredient-parser` | on | Split ingredient lines into quantity, unit and food. | |
| `foods-units` | on | A catalogue of foods and units, with merge. | `ingredient-parser` |
| `scaling` | on | Scale servings and convert units. | |
| `organizers` | on | Tags, categories and tools. | |
| `cook-mode` | on | One step at a time, large type, step timers. | |
| `ratings` | on | Per-user favourites and ratings. | |
| `meal-plan` | on | Plan meals by day and week. | |
| `shopping-lists` | on | Build and share shopping lists. | |
| `cookbooks` | on | Saved filtered collections of recipes. | `organizers` |
| `households` | on | Members, roles and invites. | |
| `share-links` | on | Public read-only links to a recipe. | |
| `import-files` | on | Import from other apps and files. | |
| `backups` | on | Export recipes; back up and restore the instance. | |
| `timeline` | on | Record when you cooked a recipe, with notes and photos. | |
| `nutrition` | **off** | Nutrition facts per serving. | |
| `print` | on | A print-friendly recipe view. | |
| `api-tokens` | on | Tokens for scripts. | |
| `webhooks` | **off** | Call a URL when events happen. | `api-tokens` |
| `pwa` | on | Install as an app; recent recipes work offline. | |
| `ai` | **off** | Bring your own key for photo and text import. | |

The source of truth is `packages/shared/src/features.ts`.

## Backups and restore

Everything lives in `DATA_DIR`, so the simplest backup is a copy of that folder while Meally is stopped. For a running
instance use the built-in backups.

- **Household export.** Any member can download their household's recipes from Settings.
- **Instance backups.** Admins create and download them from Settings. A backup is a zip in `$DATA_DIR/backups/`
  holding a consistent database snapshot, the images and a `manifest.json`.
- **Schedule.** `MEALLY_BACKUP_CRON_HOURS` (default 24, `0` is off) and `MEALLY_BACKUP_KEEP` (default 7). The first
  backup runs shortly after start if the newest is older than the interval.
- **Off-site.** Backups sit on the same disk as the data. Copy them elsewhere too (3 copies, 2 media, 1 off-site).

### Restoring

Restore is offline on purpose. Stop Meally, then run with the same `DATA_DIR`:

```sh
# from a checkout
npm run restore -w apps/server -- /path/to/meally-<timestamp>.zip

# from a build
node apps/server/dist/restore.js /path/to/meally-<timestamp>.zip

# in Docker, with the container stopped
docker run --rm -v meally-data:/data -v "$PWD":/backup ghcr.io/bachtly/meally:latest \
  node apps/server/dist/restore.js /backup/meally-<timestamp>.zip
```

The restore refuses to run while `$DATA_DIR/meally.lock` names a running process (`--force` overrides). It moves the
current database and images to `$DATA_DIR/pre-restore-<timestamp>/`, unpacks the backup, and refuses a backup made by a
newer version than the one you run. Start Meally again afterwards.

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

## Upgrading

1. Take a backup (Settings, or copy `DATA_DIR`).
2. Pull the new image and restart:
   ```sh
   docker compose pull && docker compose up -d
   ```
3. Database migrations run on start. Check `docker compose logs meally`, and open `/api/v1/health`.

Pin a version tag instead of `latest` if you want upgrades to be deliberate. Migrations only go forward: to go back,
restore a backup taken before the upgrade and run the older image. Meally is early software, so read the release
notes before upgrading.
