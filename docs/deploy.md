# Deploy to Supabase + Cloudflare Pages

Supabase hosts Postgres, the private `meally-images` bucket, pg_cron and the `meally` Edge Function. Cloudflare Pages
hosts the SPA, and a Pages Function (`apps/web/functions/api/[[path]].ts`) proxies `/api/*` to the Edge Function. The
browser sees one origin, so the session cookie stays first-party. Terraform (`infra/`) owns the Pages project, the
custom domain and its CNAME at Vercel DNS. Vercel only hosts the DNS zone. Design note:
[hosting-pages.md](design/features/hosting-pages.md).

## Prerequisites

- Node 24, Terraform 1.9 or later, bash (Git Bash on Windows works), curl.
- A Supabase project (free tier is fine), a Cloudflare account, and the DNS zone on Vercel DNS. No Docker needed.
- Run from the repo root. Never commit tokens; export them in your shell or use repo secrets.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token (CLI login) |
| `SUPABASE_PROJECT_REF` | the project ref (subdomain of `<ref>.supabase.co`) |
| `SUPABASE_DB_PASSWORD` | database password (link, `db push`, cron setup) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare custom token with Account / Cloudflare Pages / Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account that owns the Pages project (a repo variable, not a secret) |
| `VERCEL_API_TOKEN` or `VERCEL_TOKEN` | Vercel token, used only for the DNS record |
| `VERCEL_TEAM_ID` (optional) | the Vercel team that owns the zone; empty for a personal account |
| `JOB_SECRET` or `MEALLY_JOBS_SECRET` | shared secret between pg_cron and the function (a long random value) |
| `MEALLY_DOMAIN`, `MEALLY_SUBDOMAIN` (optional) | default `bachtly.com` and `meally`. The app URL, and `MEALLY_PUBLIC_URL`, is `https://<subdomain>.<domain>` |
| `MEALLY_PBKDF2_ITERATIONS`, `PAGES_PROJECT_NAME` (optional) | default 100000 and `meally` |

## Run

```
bash scripts/deploy.sh --dry-run   # prints the plan, calls nothing
bash scripts/deploy.sh
```

Or run the **Deploy (Supabase + Cloudflare Pages)** workflow by hand (`workflow_dispatch`) with the same values as repo secrets.
Every step is safe to repeat. What it does:

1. `npm ci`, `npm run build:edge -w apps/server`, copy the bundle to `supabase/functions/meally/meally.js` (gitignored).
2. `supabase link`.
3. Migrations: `scripts/sync-supabase-migrations.mjs` copies the drizzle SQL into `supabase/migrations/` as
   `<ts>_drizzle_<tag>.sql` (gitignored; drizzle stays the single source), then `supabase db push`. Chosen over a
   custom migrator because the CLI tracks applied versions and handles ordering. The same push creates the private
   `meally-images` bucket (`20200101000000_meally_images_bucket.sql`).
4. `scripts/supabase-cron.mjs` stores the jobs secret and project URL in Vault and applies `supabase/cron.sql`
   (unschedule, then schedule): `webhooks.retry` every minute, `mealplan.digest` every 15 minutes, `shares.cleanup`
   daily. The secret is read from `vault.decrypted_secrets`; nothing secret is in git.
5. `supabase secrets set --env-file` (a temp file, so values never hit a command line): `MEALLY_JOBS_SECRET`,
   `MEALLY_PUBLIC_URL`, `MEALLY_PBKDF2_ITERATIONS`, `DATABASE_URL`, `MEALLY_PLATFORM=supabase`, and the forced flags
   `MEALLY_FEATURE_BACKUPS=off`, `MEALLY_FEATURE_IMPORT_FILES=off`, `MEALLY_FEATURE_PWA=on`.
6. `supabase functions deploy meally --no-verify-jwt` (also `verify_jwt = false` in `config.toml`; the app does its own auth).
7. Terraform (`terraform -chdir=infra apply`): the Pages project, the custom domain on it, then the CNAME at Vercel
   DNS (in that order, because a CNAME that exists first gets a 522). State lives in the Supabase database, schema
   `meally_terraform_state`, through the session pooler (port 5432), because the `pg` backend needs advisory locks.
8. `scripts/render-pages.mjs` writes the function URL into `apps/web/pages/upstream.gen.ts` (gitignored), then
   `npm run build -w apps/web` and `wrangler pages deploy dist` from `apps/web`, so `functions/` is bundled too.
   `apps/web/public/_headers` sets no-cache on the shell and service worker and immutable caching on `/assets/*`.
9. Smoke test: `GET /api/v1/health` and `/api/v1/auth/status` on the custom domain.

### Database URL

Supabase injects `SUPABASE_DB_URL` into functions as a direct connection (port 5432). Functions are short-lived and
numerous, so we set our own `DATABASE_URL` to the transaction pooler (port 6543, built from the pooler host that
`supabase link` writes to `supabase/.temp/pooler-url`); the app uses postgres-js with `prepare: false`.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically and are the names the code reads.

### CSRF behind the proxy

The edge entry maps `MEALLY_PUBLIC_URL` to the app base origin, so the browser `Origin` (the custom domain) is what CSRF
compares and what decides `Secure` cookies. Test: `apps/server/src/deploy.test.ts`.

## Moving from Vercel (one time)

The first Pages deploy needs the name free at Vercel:

1. Vercel → the `meally` project → Settings → Domains: remove `meally.bachtly.com`. The site is down from here until
   step 3 finishes.
2. Set the repo secret `CLOUDFLARE_API_TOKEN` and the repo variable `CLOUDFLARE_ACCOUNT_ID`.
3. Run the deploy. Terraform creates the CNAME at Vercel DNS, and Pages issues the certificate.
4. After a login works on the custom domain, delete the Vercel project. Keep the `bachtly.com` zone.

## First run

Open `https://meally.bachtly.com`. With no users the app shows the setup screen: create the admin account there, then invite others
from Settings. In Admin, backups and file import show as unavailable.

## Limits on Supabase

- The shopping list syncs by polling (no SSE on Edge Functions).
- No in-app instance backups (use Supabase backups or `pg_dump`) and no file import (Node-only); both flags are forced off.
- Free-tier Edge Function CPU and size limits apply; lower `MEALLY_PBKDF2_ITERATIONS` if logins time out.

## Troubleshooting

- **Smoke test 404/502:** check `supabase functions logs meally`; confirm the `meally.js` bundle was copied (step 1).
- **Login works but the session is lost, or CSRF 403:** `MEALLY_PUBLIC_URL` must equal the browser URL exactly (https, no trailing slash). Re-run the script.
- **Cron does nothing:** `select * from cron.job_run_details order by start_time desc limit 5;` and check `net._http_response`. Re-run to reapply the Vault secret.
- **Prepared-statement errors:** `DATABASE_URL` must use port 6543.
- **Cookies through Pages:** the Function passes the request headers (minus `Host`) and returns the upstream response
  untouched, so `Set-Cookie` and `Origin` pass through. Tested in `apps/web/pages/proxy.test.ts`; still verify a login
  after the first deploy.
- **522 or a certificate error on the domain:** the Pages domain is still verifying. Wait a few minutes and re-run.
- **`*.pages.dev` returns 403 on POSTs:** expected. CSRF accepts only the custom domain.

## References

- Supabase function secrets and injected variables: https://supabase.com/docs/guides/functions/secrets
- Cloudflare Pages redirects (proxying is same-site only): https://developers.cloudflare.com/pages/configuration/redirects/
- Cloudflare Pages headers: https://developers.cloudflare.com/pages/configuration/headers/
- Terraform `pg` backend: https://developer.hashicorp.com/terraform/language/backend/pg
- Supabase CLI reference (`link --project-ref`, `db push`, `secrets set --env-file`, `functions deploy --no-verify-jwt`): https://supabase.com/docs/reference/cli

## Lessons from the first deploy (2026-11-11)

- **`Deno.env.set` throws `NotSupported` on the Supabase Edge Runtime.** `supabase/functions/meally/index.ts`
  passes defaults to `createEdgeApp(env)` instead of setting env vars.
- **postgres-js 4.x fails on the Edge Runtime** with `ERR_NOT_IMPLEMENTED` from `node:net` connect. The server pins
  `postgres@3.4.9`, which is the 3.4 line Supabase's guide uses
  ([Supabase: connect to Postgres](https://supabase.com/docs/guides/functions/connect-to-postgres)). The edge bundle
  imports the same version as `npm:postgres@3.4.9`.
- **Reading function logs without the dashboard.** Query the Management API logs endpoint against the single `logs`
  table filtered by `source`. Use `function_logs` for console output and `function_edge_logs` for requests
  ([Supabase: advanced log filtering](https://supabase.com/docs/guides/telemetry/advanced-log-filtering)):
  `GET /v1/projects/<ref>/analytics/endpoints/logs?sql=select timestamp, event_message from logs where source =
  'function_logs' order by timestamp desc limit 20&iso_timestamp_start=…&iso_timestamp_end=…` (the range must be
  24 hours or less).
- **Error causes.** The error handler logs `err.cause`, because Drizzle wraps driver errors in a generic
  "Failed query".
- **Vercel production URL** (before the move to Pages). It's `https://<project>-<suffix>.vercel.app` when `<project>.vercel.app` is taken. The
  script reads it back and resets `MEALLY_PUBLIC_URL`.
- **Custom domain** (before the move to Pages). Production runs at `https://meally.bachtly.com`. The domain was on the
  Vercel project, and Vercel DNS manages `bachtly.com`. `MEALLY_PUBLIC_URL` must equal the browser origin, because the CSRF check
  accepts that one origin, so POSTs from `*.vercel.app` URLs get 403. The deploy script prefers a custom-domain alias
  over `*.vercel.app` when it reads the production URL back.
