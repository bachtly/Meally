# Web hosting on Cloudflare Pages with Terraform (no flag, deploy only)

## What it does

The hosted deployment serves the SPA from Cloudflare Pages instead of Vercel. Terraform (`infra/main.tf`) owns the
Pages project, the `meally.bachtly.com` custom domain and its CNAME at Vercel DNS. Vercel keeps only the DNS zone. A
Pages Function forwards `/api/*` to the Supabase Edge Function, so the browser still sees one origin and the session
cookie stays first-party. This matches the daily-kaizen setup. Self-hosting with the Docker image doesn't change.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | `/api/*` goes through a Pages Function (`apps/web/functions/api/[[path]].ts`) that `fetch`es the Supabase function with `redirect: "manual"` | `_redirects` with a 200 rewrite to the Supabase URL; call Supabase cross-origin | `_redirects` can only proxy to relative URLs on the same site, not external domains [S1]. The community fix is a catch-all Function that calls `fetch()` on the backend [S2]. Cross-origin would break the SameSite=Lax cookie and the single-origin CSRF check (A4). |
| D2 | The upstream URL is written into `apps/web/pages/upstream.gen.ts` (gitignored) by `scripts/render-pages.mjs` at deploy time | A Pages env var managed by Terraform | Same pattern as the old `vercel.json` template. I couldn't confirm the v5 provider's `deployment_configs.production.env_vars` shape [S3], and a build-time constant needs no runtime config. (judgement) |
| D3 | `apps/web/public/_headers`: no-cache for `/`, `/index.html`, `/sw.js` and the manifest; `public, max-age=31536000, immutable` for `/assets/*` | One `/*` no-cache rule | When several `_headers` rules match, Pages joins their values, so a `/*` rule would add `no-cache` to the hashed assets too [S4]. Other SPA routes get Pages' default HTML caching (revalidate on every load), and the service worker serves navigations anyway. No `404.html`, so Pages treats the site as an SPA and serves `index.html` for unknown paths [S5]. |
| D4 | Terraform state in the Supabase Postgres (`pg` backend, schema `meally_terraform_state`) through the session pooler on port 5432 | Terraform Cloud; state in a bucket | No new service. The `pg` backend locks state with advisory locks, which the transaction pooler (6543) doesn't support. Same as daily-kaizen. [S6] |
| D5 | `MEALLY_PUBLIC_URL` is the custom domain built from `MEALLY_SUBDOMAIN` and `MEALLY_DOMAIN`, never `*.pages.dev` | Read the URL back from the hosting API (the old step 9) | CSRF accepts exactly one origin. The custom domain is known before the deploy, so the read-back and the second function deploy go away. |
| D6 | The proxy sets `X-Forwarded-For` from `CF-Connecting-IP` and drops `Host` | Pass headers as they are | Rate limits key on the first `X-Forwarded-For` entry when the proxy is trusted (`clientIp`). |

## Data and API

None. Deploy changes:

- `scripts/deploy.sh` step 8 runs `terraform -chdir=infra init/apply`. Step 9 renders the upstream, builds `apps/web` and
  runs `wrangler pages deploy dist` from `apps/web`, so `functions/` is bundled.
- New required env: `CLOUDFLARE_API_TOKEN` (Account / Cloudflare Pages / Edit) and `CLOUDFLARE_ACCOUNT_ID`.
  `VERCEL_API_TOKEN` is now only used for DNS.
- Removed: `vercel.template.json`, `scripts/render-vercel.mjs`.
- One-time cutover: remove `meally.bachtly.com` from the Vercel project, then deploy (see `docs/deploy.md`).

## UI

None.

## Sources

- [S1] Cloudflare Pages, Redirects (proxying supports relative URLs only), https://developers.cloudflare.com/pages/configuration/redirects/
- [S2] Proxying an external backend from Cloudflare Pages with a Function, https://misujob.com/engineering/cloudflare-pages-proxy
- [S3] Cloudflare Terraform, Pages resources, https://developers.cloudflare.com/api/terraform/resources/pages
- [S4] Cloudflare Pages, Headers, https://developers.cloudflare.com/pages/configuration/headers/
- [S5] Cloudflare Pages, Serving Pages (SPA rendering without 404.html), https://developers.cloudflare.com/pages/configuration/serving-pages/
- [S6] Terraform `pg` backend, https://developer.hashicorp.com/terraform/language/backend/pg
