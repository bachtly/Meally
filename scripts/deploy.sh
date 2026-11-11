#!/usr/bin/env bash
# Deploys Meally: Supabase (DB, bucket, cron, Edge Function) + Vercel (SPA and /api proxy).
# Idempotent; secrets are read from the environment and never echoed. `--dry-run` prints the plan only.
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

TOKEN_V="${VERCEL_API_TOKEN:-${VERCEL_TOKEN:-}}"
JOBS="${JOB_SECRET:-${MEALLY_JOBS_SECRET:-}}"
missing=()
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || missing+=(SUPABASE_ACCESS_TOKEN)
[ -n "${SUPABASE_PROJECT_REF:-}" ] || missing+=(SUPABASE_PROJECT_REF)
[ -n "${SUPABASE_DB_PASSWORD:-}" ] || missing+=(SUPABASE_DB_PASSWORD)
[ -n "$TOKEN_V" ] || missing+=("VERCEL_API_TOKEN|VERCEL_TOKEN")
[ -n "$JOBS" ] || missing+=("JOB_SECRET|MEALLY_JOBS_SECRET")
if [ ${#missing[@]} -gt 0 ]; then echo "Missing required env vars: ${missing[*]}" >&2; exit 2; fi
[[ "$SUPABASE_PROJECT_REF" =~ ^[a-z0-9]{10,30}$ ]] || { echo "SUPABASE_PROJECT_REF looks invalid" >&2; exit 2; }

export SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD
REF="$SUPABASE_PROJECT_REF"
PROJECT="${VERCEL_PROJECT_NAME:-meally}"
PUBLIC_URL="${MEALLY_PUBLIC_URL:-https://$PROJECT.vercel.app}"
# A custom domain on the Vercel project (e.g. meally.bachtly.com) wins over *.vercel.app in step 9.
ITER="${MEALLY_PBKDF2_ITERATIONS:-100000}"
SB="npx --yes supabase@2"
VC="npx --yes vercel"

step() { echo; echo "==> $*"; }
redact() { local t="$*"; t="${t//$TOKEN_V/***}"; t="${t//$SUPABASE_DB_PASSWORD/***}"; echo "$t"; }
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

step "8. Deploy the SPA to Vercel (project: $PROJECT)"
run node scripts/render-vercel.mjs vercel.template.json vercel.json "$REF"
run $VC link --yes --project "$PROJECT" --token "$TOKEN_V"
run $VC deploy --prod --yes --token "$TOKEN_V"

step "9. Read back the production URL"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] GET https://api.vercel.com/v9/projects/$PROJECT, set MEALLY_PUBLIC_URL, redeploy function if it changed"
  FINAL_URL="$PUBLIC_URL"
else
  FINAL_URL="$(curl -fsS -H "Authorization: Bearer $TOKEN_V" "https://api.vercel.com/v9/projects/$PROJECT/domains" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const ds = (JSON.parse(s).domains ?? []).filter((d) => d.verified && !d.redirect).map((d) => d.name); const a = ds.find((d) => !d.endsWith(".vercel.app")) ?? ds[0]; process.stdout.write(a ? "https://" + a : ""); });')"
  [ -n "$FINAL_URL" ] || { echo "Could not read the Vercel production URL; keeping $PUBLIC_URL" >&2; FINAL_URL="$PUBLIC_URL"; }
  if [ "$FINAL_URL" != "$PUBLIC_URL" ]; then
    echo "Production URL is $FINAL_URL (was $PUBLIC_URL); updating MEALLY_PUBLIC_URL and redeploying the function"
    set_secrets "$FINAL_URL"
    $SB functions deploy meally --no-verify-jwt --project-ref "$REF"
  fi
fi

step "10. Smoke test"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] curl $FINAL_URL/api/v1/health and $FINAL_URL/api/v1/auth/status"
else
  for p in health auth/status; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --retry 5 --retry-delay 3 --retry-all-errors "$FINAL_URL/api/v1/$p")"
    echo "GET /api/v1/$p -> $code"
    [ "$code" = 200 ] || { echo "Smoke test failed" >&2; exit 1; }
  done
fi
echo
echo "Done: $FINAL_URL"
