# Share links (F16, flag `share-links`)

## What it does

From a recipe's overflow menu, a signed-in member creates a public, read-only link to that one recipe, with an optional
expiry (1, 7 or 30 days, or never). Anyone with the link sees a clean recipe page without signing in. Links can be
listed (created, expiry, views) and revoked at any time. The link is shown once, at creation.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Capability URL: an unguessable 32-byte random token in the path is the only credential. | A public "published" flag on the recipe with a slug URL. | [S1] |
| D2 | Store only the SHA-256 of the token; the URL is returned once and cannot be recovered. | Store the token to show it again. | [S1], [S2] |
| D3 | Expiry and revocation are required, per link; the public API answers 404 for unknown, expired, revoked or flag-off. | Permanent links only. | [S1] |
| D4 | `X-Robots-Tag: noindex, nofollow` on the public API, and `Referrer-Policy: no-referrer` for `/s/*`, so the token is not leaked via Referer or indexed. | Rely on robots.txt (it only asks crawlers not to crawl, and the URL can still be indexed). | [S1], [S3] |

A slug-based public recipe would be guessable and permanent; a capability URL ties access to a secret that can be
revoked without changing the recipe. The cost is that anyone holding the link can forward it; that is the intended model.

## Data and API

Table `share_links`: id, household_id, recipe_id (cascade), token_hash (unique), created_by, created_at, expires_at,
revoked_at, view_count.

- `POST /api/v1/recipes/:slug/shares {expiresInDays?: 1|7|30|null}` returns `{url}`.
- `GET /api/v1/recipes/:slug/shares` lists active links (id, createdAt, expiresAt, viewCount), never tokens.
- `DELETE /api/v1/shares/:id` revokes.
- `GET /api/v1/public/recipes/:token` (no auth, 60 requests per minute per IP) and
  `GET /api/v1/public/recipes/:token/image/:size`.

Exposed: name, description, times, servings, source URL, notes, ingredients, steps, and the recipe's own image. Not
exposed: any id, household, author or user data, tags, ratings, or other recipes. Images are fetched through the token,
so a link can never read another recipe's file.

## UI

Share dialog (create with expiry, copy, native share when available, list with revoke; loading and error states).
Public page `/s/:token` outside the shell and outside auth, with the servings stepper when `scaling` is on, a print
button, and a "This link no longer works" state.

## Evidence changed

None contradicts a decision. Two gaps: the TAG document does not mention `noindex` (it suggests listing the capability
path in `robots.txt`, which Google says can stop the `noindex` header being read, so we do not do that), and OWASP says
tokens are "stored securely" without saying "hashed". D2 (SHA-256 of a 256-bit random token) is our own reasoning.

## Sources

Searched 2026-11-11. "(page)" = fetched and read; "(snippet)" = search summary only.

- [S1] Good Practices for Capability URLs, W3C TAG (page): https://www.w3.org/2001/tag/doc/capability-urls/ . Supports: 120+ bits of entropy, expiry, owner revocation, several links per resource, Referer leakage mitigations, 404/410 once expired.
- [S2] Forgot Password Cheat Sheet, OWASP (page): https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html . Supports: random, long, single-use, expiring tokens, "stored securely". No hashing detail, no lifetime.
- [S3] Block Search indexing with noindex, Google Search Central (snippet): https://developers.google.com/search/docs/crawling-indexing/block-indexing . Supports: `X-Robots-Tag: noindex`; a robots.txt-blocked page can still appear in results.
- [S4] Referrer Policy, MDN (snippet): https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy . Supports: `no-referrer` omits the Referer header.
