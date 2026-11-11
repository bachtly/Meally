#!/usr/bin/env bash
# Deploys Meally: Supabase (DB, bucket, cron, Edge Function), Terraform (Cloudflare Pages project, custom domain,
# CNAME at Vercel DNS), then the SPA and its /api proxy function to Pages with wrangler.
# Idempotent; secrets are read from the environment and never echoed. `--dry-run` prints the plan only.
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

TOKEN_V="${VERCEL_API_TOKEN:-${VERCEL_TOKEN:-}}"
TOKEN_CF="${CLOUDFLARE_API_TOKEN:-}"
JOBS="${JOB_SECRET:-${MEALLY_JOBS_SECRET:-}}"
missing=()
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || missing+=(SUPABASE_ACCESS_TOKEN)
[ -n "${SUPABASE_PROJECT_REF:-}" ] || missing+=(SUPABASE_PROJECT_REF)
[ -n "${SUPABASE_DB_PASSWORD:-}" ] || missing+=(SUPABASE_DB_PASSWORD)
[ -n "$TOKEN_V" ] || missing+=("VERCEL_API_TOKEN|VERCEL_TOKEN")
[ -n "$TOKEN_CF" ] || missing+=(CLOUDFLARE_API_TOKEN)
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || missing+=(CLOUDFLARE_ACCOUNT_ID)
[ -n "$JOBS" ] || missing+=("JOB_SECRET|MEALLY_JOBS_SECRET")
if [ ${#missing[@]} -gt 0 ]; then echo "Missing required env vars: ${missing[*]}" >&2; exit 2; fi
[[ "$SUPABASE_PROJECT_REF" =~ ^[a-z0-9]{10,30}$ ]] || { echo "SUPABASE_PROJECT_REF looks invalid" >&2; exit 2; }

export SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD
REF="$SUPABASE_PROJECT_REF"
PROJECT="${PAGES_PROJECT_NAME:-meally}"
DOMAIN="${MEALLY_DOMAIN:-bachtly.com}"
SUBDOMAIN="${MEALLY_SUBDOMAIN:-meally}"
# The browser origin. CSRF accepts exactly this origin, so it is the custom domain, never *.pages.dev.
PUBLIC_URL="https://$SUBDOMAIN.$DOMAIN"
ITER="${MEALLY_PBKDF2_ITERATIONS:-100000}"
SB="npx --yes supabase@2"
VC="npx --yes vercel"

step() { echo; echo "==> $*"; }
redact() { local t="$*"; t="${t//$TOKEN_V/***}"; t="${t//$TOKEN_CF/***}"; t="${t//$SUPABASE_DB_PASSWORD/***}"; echo "$t"; }
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $(redact "$@")"; else "$@"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

step "1. Install and build the edge bundle"
run npm ci
run npm run build:edge -w apps/server
run cp apps/server/dist-edge/meally.js supabase/functions/meally/meally.js

step "2. Link the Supabase project ($REF)"
run $SB link --project-ref "$REF" --password "$SUPABASE_DB_PASSWORD" --yes

step "3. Migrations (drizzle SQL copied to supabase/migrations, then db push)"
run node scripts/sync-supabase-migrations.mjs
run $SB db push --linked --password "$SUPABASE_DB_PASSWORD" --yes

step "4. Storage bucket meally-images (created by supabase/migrations/20200101000000_meally_images_bucket.sql in step 3)"

step "5. Vault secret + pg_cron schedules"
# Pooler connection string: the linked project's pooler URL (written by `supabase link`) with our password, port 6543.
DB_URL=""
if [ "$DRY" = 1 ]; then
  echo "[dry-run] node scripts/supabase-cron.mjs (DB_URL from supabase/.temp/pooler-url, port 6543)"
else
  DB_URL="$(POOLER="$(cat supabase/.temp/pooler-url)" node -e 'const u = new URL(process.env.POOLER); u.password = process.env.SUPABASE_DB_PASSWORD; u.port = "6543"; process.stdout.write(u.toString());')"
  DB_URL="$DB_URL" JOB_SECRET="$JOBS" node scripts/supabase-cron.mjs
fi

set_secrets() {
  # Written to a 0600 temp file so values never appear on a command line.
  (
    umask 077
    {
      echo "MEALLY_JOBS_SECRET=$JOBS"
      echo "MEALLY_PUBLIC_URL=$1"
      echo "MEALLY_PBKDF2_ITERATIONS=$ITER"
      echo "MEALLY_PLATFORM=supabase"
      echo "MEALLY_FEATURE_BACKUPS=off"
      echo "MEALLY_FEATURE_IMPORT_FILES=off"
      echo "MEALLY_FEATURE_PWA=on"
      echo "DATABASE_URL=$DB_URL"
    } > "$TMP/secrets.env"
  )
  run $SB secrets set --env-file "$TMP/secrets.env" --project-ref "$REF"
}

step "6. Function secrets (DATABASE_URL = transaction pooler, port 6543; SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected)"
set_secrets "$PUBLIC_URL"

step "7. Deploy the Edge Function"
run $SB functions deploy meally --no-verify-jwt --project-ref "$REF"

step "8. Terraform: Pages project $PROJECT, $SUBDOMAIN.$DOMAIN, CNAME at Vercel DNS (state in Supabase)"
export CLOUDFLARE_API_TOKEN="$TOKEN_CF" CLOUDFLARE_ACCOUNT_ID VERCEL_API_TOKEN="$TOKEN_V"
export TF_VAR_cloudflare_account_id="$CLOUDFLARE_ACCOUNT_ID" TF_VAR_vercel_team_id="${VERCEL_TEAM_ID:-}"
export TF_VAR_domain="$DOMAIN" TF_VAR_subdomain="$SUBDOMAIN" TF_VAR_project_name="$PROJECT"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] terraform -chdir=infra init + apply (PG_CONN_STR = session pooler, port 5432)"
else
  # Session pooler (5432), not the transaction pooler: the pg backend locks state with advisory locks.
  PG_CONN_STR="$(POOLER="$(cat supabase/.temp/pooler-url)" node -e 'const u = new URL(process.env.POOLER); u.password = ""; u.port = "5432"; u.searchParams.set("sslmode", "require"); process.stdout.write(u.toString());')"
  export PG_CONN_STR PGPASSWORD="$SUPABASE_DB_PASSWORD"
  terraform -chdir=infra init -input=false
  terraform -chdir=infra apply -input=false -auto-approve
fi

step "9. Build the SPA and upload it with the /api proxy function to Pages (Direct Upload)"
run node scripts/render-pages.mjs apps/web/pages/upstream.gen.ts "$REF"
run npm run build -w apps/web
# From apps/web so wrangler finds functions/ next to dist/.
run bash -c "cd apps/web && npx --yes wrangler@4 pages deploy dist --project-name '$PROJECT' --branch main --commit-dirty=true"

step "10. Smoke test"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] curl $PUBLIC_URL/api/v1/health and $PUBLIC_URL/api/v1/auth/status"
else
  for p in health auth/status; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --retry 10 --retry-delay 6 --retry-all-errors "$PUBLIC_URL/api/v1/$p")"
    echo "GET /api/v1/$p -> $code"
    [ "$code" = 200 ] || { echo "Smoke test failed" >&2; exit 1; }
  done
fi
echo
echo "Done: $PUBLIC_URL"
