# Import from URL (F5, flag `import-url`)

## What it does

Paste a link to a recipe page; Meally fetches it, reads the recipe and saves it (or shows a preview first). Mealie
leans on a scraper library with per-site rules plus a generic fallback; RecipeSage fetches and parses structured data
too. Ours reads the structured data that sites already publish for search engines, with no per-site code.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Read schema.org Recipe from JSON-LD first, then microdata. No site-specific scrapers | A library of per-site rules (more coverage on odd sites, constant maintenance as sites change); HTML heuristics | [S1] |
| D2 | Fetch with SSRF protection: http(s) only, ports 80/443, DNS resolved and every address checked, connect to the vetted IP, redirects re-validated (max 5), 10 s timeout, 5 MB cap, HTML only | Blocklist of hostnames; no protection (unsafe on a public instance) | [S2] |
| D3 | The recipe image is downloaded through the same safe fetcher (image types, 10 MB) and stored by the existing image pipeline. A failed image never fails the import | Hot-link the remote image (leaks viewers' IPs, breaks later) | own reasoning |
| D4 | `MEALLY_IMPORT_ALLOW_PRIVATE=true` lifts the address and port checks for home labs | Always strict | [S2] |

Notes. JSON-LD is present on most recipe sites because search engines require it [S1]. The scraper-per-site approach
trades coverage for upkeep; we accept that some sites return `no_recipe_found` and users can enter the recipe by hand.
SSRF: the cheat sheet recommends validating the destination after DNS resolution and not following redirects blindly [S2].
We check every resolved address (so a name with one private answer is refused), then connect to that IP through a custom
`lookup`, so a second DNS answer (rebinding) cannot change the target. Blocked ranges: IPv4 0/8, 10/8, 100.64/10
(CGNAT), 127/8, 169.254/16 (metadata), 172.16/12, 192.168/16, test and reserved ranges, multicast; IPv6 loopback,
unspecified, unique-local, link-local, multicast, documentation, and addresses embedding IPv4 (mapped, NAT64, 6to4).
Parsing: `@graph`, arrays, nested `mainEntity` and array `@type` are handled; durations are ISO 8601 to minutes;
instructions may be text, steps or sections (sections become step sections). Keywords and categories are returned as
suggestions for the organisers feature.

## Data and API

No tables. All routes need auth and the `import-url` flag, and share a limit of 20 requests per hour per user.

- `POST /api/v1/import/url/preview` `{url}` returns `{recipe, imageUrl, keywords, categories}` without saving.
- `POST /api/v1/import/url` `{url}` creates the recipe and returns `{slug}` (201).
- Errors: `blocked_url` 400, `no_recipe_found` 422, `fetch_failed` 502, `rate_limited` 429.

## UI

Built in the web PR (paste field, preview, save).

## Sources

- [S1] schema.org Recipe and Google's recipe structured-data guide, https://developers.google.com/search/docs/appearance/structured-data/recipe
- [S2] OWASP Server-Side Request Forgery Prevention Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
