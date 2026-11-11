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
| D5 | A link targets one recipe, a hand-picked **set** (1–100, ordered) or a **cookbook**. Sets store recipe ids and show each recipe's current version; a deleted recipe drops out. Cookbook links are fully live (up to 200 recipes); a smart cookbook re-runs its filter as the sharer. | Snapshot copies at share time; a separate collection feature. | [S5], [S6] |
| D6 | "Shared by" is the sharer's name **snapshotted** on the link at creation, on by default (`showName: false` hides it). An optional note (≤ 280). Never a user id. | Live lookup of the profile; anonymous only. | [S7] |
| D7 | A recipe inside a set or cookbook link is addressed by its **slug**, checked against what the link currently shows. Slugs are derived from names already on the page and stay stable when a live cookbook reorders. | An index `n` (shifts in a live cookbook); recipe ids (internal). | (judgement) |
| D9 | **Save to my recipes copies** a recipe into the viewer's household: fields, ingredients, steps and the image bytes (a new image id under their household). Tags, ratings and the sharer's food ids are not copied; with `foods-units` on, ingredients relink to the viewer's catalogue. The copy keeps `source_url` and records `saved_from_name` and `saved_at`. | A saved reference that follows the sharer. | [S5], [S7] |
| D10 | **Dedupe by origin**: the copy stores the source recipe id (`origin_recipe_id`, internal, never returned). Saving again returns the existing copy. The viewer's own household gets 409. | Allow duplicates. | (judgement) |
| D11 | **At most 10 recipes per save request**; the web app saves a larger set in batches with progress, and the first batch can create a hand-picked cookbook that later batches fill. Keeps each request well inside the edge function's limits without a job queue. | One request for up to 200 with a background job. | (judgement) |
| D8 | A smart cookbook filtered by favourites or rating shows **nothing** once the sharer's account is gone, instead of the unfiltered library. | Fall back to no filter. | (judgement) |

A slug-based public recipe would be guessable and permanent; a capability URL ties access to a secret that can be
revoked without changing the recipe. The cost is that anyone holding the link can forward it; that is the intended model.

## Data and API

Table `share_links`: id, household_id, kind (`recipe`/`set`/`cookbook`), recipe_id (cascade, recipe links),
cookbook_id (cascade, cookbook links), title (sets), note, sharer_name, token_hash (unique), created_by, created_at,
expires_at, revoked_at, view_count. A check constraint ties the target columns to `kind`. Table `share_link_recipes`
(share_link_id, recipe_id, position), both cascade.

- `POST /api/v1/recipes/:slug/shares {expiresInDays?, showName?, note?}` returns `{url}`.
- `POST /api/v1/shares {recipeSlugs, title?, expiresInDays?, showName?, note?}` (a set; 400 if any slug isn't the
  household's) and `POST /api/v1/cookbooks/:slug/shares {…}` (also needs `cookbooks`) return `{url}`.
- `GET /api/v1/shares` lists every active link of the household (`ShareSummary`: kind, title, targetSlug, count,
  sharedBy, note, dates, views), never tokens.
- `GET /api/v1/recipes/:slug/shares` lists active links (id, createdAt, expiresAt, viewCount), never tokens.
- `DELETE /api/v1/shares/:id` revokes.
- `GET /api/v1/shares/received/:token` → `ShareStatus` (`sameHousehold`, `saved`: link slug → the viewer's copy).
- `POST /api/v1/shares/received/:token/save {slugs: 1..10, cookbook?: {name} | {slug}}` → `{saved, cookbookSlug}`
  (201). 404 for a dead link or a slug the link doesn't show, 409 for the sharer's own household.
- Recipes gain `savedFrom: {name, at} | null`. Columns `recipes.saved_from_name`, `saved_at`, `origin_recipe_id`.
- `GET /api/v1/public/shares/:token` (`PublicShare`: kind, title, note, sharedBy, count, recipe for recipe links,
  items), `GET /api/v1/public/shares/:token/recipes/:slug` and `…/:slug/image/:size`. No auth, 60 requests per minute
  per IP. A cookbook link answers 404 while `cookbooks` is off.
- `GET /api/v1/public/recipes/:token` and `…/image/:size` stay for recipe links already sent.

Exposed: the link's title, note and sharer name (when shown), and for each recipe: slug (inside the link only), name, description, times, servings, source URL, notes, ingredients, steps, and the recipe's own image. Not
exposed: any id, household, author or user data, tags, ratings, or other recipes. Images are fetched through the token,
so a link can never read another recipe's file.

## UI

One share dialog for a recipe, a set or a cookbook: optional name (sets), note, "Show my name" switch with a preview
("Shown as "Shared by Ada""), expiry, then the link once with Copy and native share. The library has **Select** (cards
become toggle buttons, a sticky bar shows the count and **Share N**, up to 100); cookbooks have **Share** in the header;
**Settings, Shared links** lists every active link with what it is, the name shown, expiry, views and Revoke.

**Receiver** (`/s/:token`, `/s/:token/:slug`): inside the app shell when signed in, a bare page with Sign in otherwise
(a skeleton while the session check runs, so the page doesn't remount). "Shared by Ada" with an initial and the note
in a quote. One recipe: the recipe view with **Save to my recipes**. Set or cookbook: title, count, grid (Saved
badges), **Save all N** / **Save the other N** into a new hand-picked cookbook named after the link, in batches of 10
with "Saving 4 of 12…". Already saved: **Open my copy**; the sharer's own household: "already in your household".

**Newcomer**: Save opens "Keep this recipe" with **Create account and save** (`/sign-up?next=/s/…?save=1`) and **I have
an account** (`/signin?next=…`). `next` is a same-origin path kept in the URL, so it survives reloads and the switch
between sign-up and sign-in. Back on the link, `?save=1` saves by itself and lands on the copy. Invite-only servers say
to ask the sharer for an invite; closed servers offer sign-in only (sign-up mode always wins).

**After saving**: "Saved to your recipes" and a one-time **Add Meally to your home screen** card (native prompt, or the
iOS steps), dismissed for good with **Not now** (web.dev: promote after a completed journey, remember dismissal).
Saved recipes show "Shared by Ada · saved 3 Nov".

**Opening in the app** (D9 of the sharing design): pasting or sharing (Web Share Target) one of this server's own
`/s/…` links into the Import page opens the share view in the app instead of importing the page. On iPhone/iPad, links
from other apps always open Safari, whose sign-in the Home Screen app doesn't share, so the signed-out page shows
"Already have Meally on your home screen?" with **Copy link** (only on iOS, not in the installed app).

**Link previews and portability**: `/s/*` HTML carries Open Graph and Twitter tags (title, "Shared by Ada · 12
recipes · note", absolute image) and, for one recipe, schema.org `Recipe` JSON-LD, so chat apps show a card and other
recipe apps or Meally servers can "Import from URL". Injected by a Cloudflare Pages function (`functions/s/[[path]].ts`,
logic in `pages/sharePreview.ts`) and by the Node server's SPA fallback, from `GET /public/shares/:token/meta`, which
never counts a view. Values are HTML-escaped and JSON-LD is `<`/`>`/`&`-escaped so a name or note can't close the tag.
The HTML is `private, no-store`; `noindex` stays. Any failure serves the plain page. The manifest has
`launch_handler: {client_mode: ["navigate-existing", "auto"]}` so a link reuses the open app window.

F16 (single recipe):

Share dialog (create with expiry, copy, native share when available, list with revoke; loading and error states).
Public page `/s/:token` outside the shell and outside auth, with the servings stepper when `scaling` is on, a print
button, and a "This link no longer works" state.

## Evidence changed

None contradicts a decision. Two gaps: the TAG document does not mention `noindex` (it suggests listing the capability
path in `robots.txt`, which Google says can stop the `noindex` header being read, so we do not do that), and OWASP says
tokens are "stored securely" without saying "hashed". D2 (SHA-256 of a 256-bit random token) is our own reasoning.

## Sources

Sets and cookbooks (PR 39) follow `docs/design/2026-11-11-sharing/design.md`, which has the full research.

Searched 2026-11-11. "(page)" = fetched and read; "(snippet)" = search summary only.

- [S1] Good Practices for Capability URLs, W3C TAG (page): https://www.w3.org/2001/tag/doc/capability-urls/ . Supports: 120+ bits of entropy, expiry, owner revocation, several links per resource, Referer leakage mitigations, 404/410 once expired.
- [S2] Forgot Password Cheat Sheet, OWASP (page): https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html . Supports: random, long, single-use, expiring tokens, "stored securely". No hashing detail, no lifetime.
- [S3] Block Search indexing with noindex, Google Search Central (snippet): https://developers.google.com/search/docs/crawling-indexing/block-indexing . Supports: `X-Robots-Tag: noindex`; a robots.txt-blocked page can still appear in results.
- [S4] Referrer Policy, MDN (snippet): https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy . Supports: `no-referrer` omits the Referer header.
- [S5] RecipeSage docs, Sharing (page): https://docs.recipesage.com/docs/tutorials/people/sharing/ . Several recipes via one profile link.
- [S6] Files.com, Snapshot and live share links (snippet): https://www.files.com/docs/sharing/share-links/snapshot-and-live-share-links . Live links show later changes; snapshots freeze them.
- [S7] Plan to Eat, "Whose recipe is it anyway" (page): https://learn.plantoeat.com/help/whose-recipe-is-it-anyway . The source stays as the original author's credit, separate from who shared it.
- [S8] Chrome for Developers, Navigation management into installed PWAs (page): https://developer.chrome.com/docs/capabilities/pwa-navigation-management . In-scope links open the installed app by default from Chrome 139 on desktop; `launch_handler.client_mode`.
- [S9] Rich link previews need server-side meta tags (snippet): https://dev.to/grabbit/how-to-build-rich-link-previews-like-slack-and-imessage-3m5 . Fetchers don't run JS; absolute HTTPS `og:image`.
- [S10] schema.org Recipe: https://schema.org/Recipe . `recipeIngredient`, `recipeInstructions` as `HowToStep`, ISO 8601 durations.
