# Deploy to Supabase + Vercel

Supabase hosts Postgres, the private `meally-images` bucket, pg_cron and the `meally` Edge Function. Vercel hosts the
SPA and proxies `/api/*` to the function, so the browser sees one origin and the session cookie stays first-party.

## Prerequisites

- Node 24, bash (Git Bash on Windows works), curl.
- A Supabase project (free tier is fine) and a Vercel account. No Docker needed.
- Run from the repo root. Never commit tokens; export them in your shell or use repo secrets.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token (CLI login) |
| `SUPABASE_PROJECT_REF` | the project ref (subdomain of `<ref>.supabase.co`) |
| `SUPABASE_DB_PASSWORD` | database password (link, `db push`, cron setup) |
| `VERCEL_API_TOKEN` or `VERCEL_TOKEN` | Vercel token |
| `JOB_SECRET` or `MEALLY_JOBS_SECRET` | shared secret between pg_cron and the function (a long random value) |
| `MEALLY_PUBLIC_URL` (optional) | first-run guess of the Vercel URL; defaults to `https://meally.vercel.app` and is corrected in step 9 |
| `MEALLY_PBKDF2_ITERATIONS`, `VERCEL_PROJECT_NAME` (optional) | default 100000 and `meally` |

## Run

```
bash scripts/deploy.sh --dry-run   # prints the plan, calls nothing
bash scripts/deploy.sh
```

Or run the **Deploy (Supabase + Vercel)** workflow by hand (`workflow_dispatch`) with the same values as repo secrets.
Every step is safe to repeat. What it does:

1. `npm ci`, `npm run build:edge`, copy the bundle to `supabase/functions/meally/meally.js` (gitignored).
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
   `MEALLY_FEATURE_BACKUPS=false`, `MEALLY_FEATURE_IMPORT_FILES=false`, `MEALLY_FEATURE_PWA=true`.
6. `supabase functions deploy meally --no-verify-jwt` (also `verify_jwt = false` in `config.toml`; the app does its own auth).
7. `vercel.json` is rendered from `vercel.template.json` (gitignored), then `vercel link --yes --project meally` and
   `vercel deploy --prod --yes`.
8. The production URL is read from the Vercel API; if it differs from `MEALLY_PUBLIC_URL`, the secret is updated and the
   function redeployed.
9. Smoke test: `GET /api/v1/health` and `/api/v1/auth/status` through Vercel.

### Database URL

Supabase injects `SUPABASE_DB_URL` into functions as a direct connection (port 5432). Functions are short-lived and
numerous, so we set our own `DATABASE_URL` to the transaction pooler (port 6543, built from the pooler host that
`supabase link` writes to `supabase/.temp/pooler-url`); the app uses postgres-js with `prepare: false`.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically and are the names the code reads.

### CSRF behind the proxy

The edge entry maps `MEALLY_PUBLIC_URL` to the app base origin, so the browser `Origin` (the Vercel URL) is what CSRF
compares and what decides `Secure` cookies. Test: `apps/server/src/deploy.test.ts`.

## First run

Open the Vercel URL. With no users the app shows the setup screen: create the admin account there, then invite others
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
- **Cookies through Vercel:** the proxy is a rewrite, so the browser only talks to Vercel. Vercel docs do not explicitly
  state that `Set-Cookie` and `Origin` pass through external rewrites. It is expected to work, but verify a login after the first deploy.

## References

- Supabase function secrets and injected variables: https://supabase.com/docs/guides/functions/secrets
- Vercel rewrites: https://vercel.com/docs/routing/rewrites
- Vercel external rewrites: https://vercel.com/kb/guide/vercel-reverse-proxy-rewrites-external
- Supabase CLI reference (`link --project-ref`, `db push`, `secrets set --env-file`, `functions deploy --no-verify-jwt`): https://supabase.com/docs/reference/cli
