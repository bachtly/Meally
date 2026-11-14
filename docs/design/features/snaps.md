# Snaps: send a Snap and the Feed (F4, flag `snaps`)

## What it does

A signed-in user posts a Snap: one photo, with an optional caption, dish name, place and a Linked recipe from their own
recipes. The Feed lists the user's own Snaps and those of accepted Friends, newest first. Friends see only photos and
text that the author chose to post; a Snap is kept until its author deletes it. This slice is the server only. The
camera, composer and Feed screens come in the web PR. Mealie has no social feed; RecipeSage shares recipes, not
photos of the finished dish. This is our own design.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | `POST /snaps` is multipart with a required `clientId`. A retry with the same `(user, clientId)` returns `200` with the first Snap and stores no second image. | A server-chosen id in the response only (a lost response means a duplicate); an `Idempotency-Key` header with a time window. | [S1] says idempotency keys let a client retry safely after a network failure; a unique `(user_id, client_id)` index keeps the dedupe permanent and needs no cleanup job. |
| D2 | The image is stored first, then the row is inserted with `ON CONFLICT DO NOTHING` on `(user_id, client_id)`. The race loser deletes the files it just wrote and returns the winner's Snap. | Lock per user and client id (needs a lock table or advisory locks, which PGlite and the edge runtime treat differently). | [S2]: `ON CONFLICT DO NOTHING` returns no row when another transaction inserted first, so the loser can tell it lost. |
| D3 | Image URLs are `/snaps/:id/images/:imageId/:size`. The server checks the id is the Snap's own image, so the URL is safe to cache as immutable. | `/snaps/:id/image/:size` (bytes can change when the image changes; cached for a year). | [S3]: `immutable` with a year-long `max-age` is correct only when the URL changes whenever the bytes do. |
| D4 | Image processing runs through a limiter of 2 at once; extra uploads wait. | Unbounded (a burst of 10 MB originals can exhaust memory in sharp); reject with 503 (the client would retry anyway). | [S4]: sharp already runs its own thread pool, so more concurrent jobs add memory, not speed. |
| D5 | The Feed query takes the author set from `accepted` Friendship rows in `lib/access`. Pending and removed Friendships give nothing. | A join in each route (the rule would drift). | ADR 0002. |
| D7 | The Linked recipe is read through `GET /snaps/:id/recipe`, with its image under `/snaps/:id/images/:imageId/:size` (the Snap's image or the recipe's current image). A recipe is only returned when it belongs to the Snap's author. | Reusing `/recipes/:slug` for Friends (it is owner-only, ADR 0002). | ADR 0002. |
| D8 | Save to my recipes copies the recipe like a share link does (shared `copyRecipe`), and dedupes by `origin_recipe_id`: `201` for a new copy, `200` with the existing slug. The author gets `409 own_recipe`. | A new copy on every tap. | [S5] says copying a shared recipe should give an independent copy the saver can edit. |
| D6 | Devices that cannot run sharp (edge) send `w320`, `w800`, `w1600` parts, resized in the browser. The existing `readImageUpload` already handles this. | Resizing on the edge (sharp does not run there). | Existing `ImageStore.acceptsPresized`. |

## Data and API

No new tables: `snaps` and `reactions` came with F2. A Snap's image is its own `images` row owned by the author, so
deleting the Snap deletes the row and the files. Reactions are soft-deleted, so every reader filters `removed_at IS NULL`.

- `POST /api/v1/snaps` multipart: `file` (or `w320`, `w800`, `w1600`), `clientId`, `caption?`, `dishName?`, `place?`,
  `recipeId?`. `201 Snap`, or `200 Snap` for a repeated `clientId`. `400`, `404` (recipe not yours), `413`, `415`.
- `GET /api/v1/snaps?cursor&limit`: `{ items: Snap[], nextCursor }`, own and accepted Friends'.
- `GET /api/v1/snaps/:id`: `Snap`. `404` for a non-friend, a pending or removed Friendship.
- `DELETE /api/v1/snaps/:id`: `204`, author only (a Friend gets `404`).
- `GET /api/v1/snaps/:id/images/:imageId/:size`: image bytes, `Cache-Control: private, max-age=31536000, immutable`.

- `GET /api/v1/snaps/:id/recipe`: the recipe (same shape as `GET /recipes/:slug`, image URL on the Snap's path) plus `savedSlug` (the viewer's copy, or `null`). `404` when the Snap has no Linked recipe.
- `POST /api/v1/snaps/:id/recipe/save`: `201 { slug }` new copy, `200 { slug }` existing copy, `409 own_recipe` for the author.

Both are Friend paths: a non-friend, a pending Friendship and a removed Friendship all get `404`.

- `PATCH /api/v1/snaps/:id` `{ recipeId: string | null }`: author only, relinks or unlinks the Linked recipe. `200 Snap`. `404` when the recipe is not the author's own, and for a Friend, non-friend or pending Friendship. Caption, dish name and place stay fixed after posting (requirements).

### Reactions (F7)

- `PUT /api/v1/snaps/:id/reactions/:emoji`: `200 Snap`, idempotent. `:emoji` is one of `heart yum fire clap wow laugh`, else `400`.
- `DELETE /api/v1/snaps/:id/reactions/:emoji`: always `204`, even when the Reaction is not there (idempotent).
- Both are Friend paths through `lib/access`: a non-friend, a pending and a removed Friendship get `404`.
- The author sees every live Reaction on their Snap (`reactions`); everyone else sees only their own (`myReactions`).
  The filter runs in SQL (Snap author is the viewer, or the reactor is the viewer), so other users' rows never leave the DB.
- DELETE soft-deletes (`removed_at`); PUT after DELETE revives the same row. A push is queued (in `push_deliveries`, one per
  author device) only when the row is first inserted, so DELETE then PUT never notifies twice. No push when the author
  reacts to their own Snap. Sending the queued pushes is F8.

Deferred to later PRs: push sending (F8).

## UI

Redesign v2 (14 Nov 2026), from the approved mockups (https://claude.ai/artifact/SQ5ReRrPFVoSC1YrDLaSCt). The camera, the
Feed and the Snap viewer are one full-screen dark layout (`SnapShell`) with no app header or tab bar. The Linked
recipe and every other page keep the normal app shell.

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| U1 | The camera is home and shows three controls only: your avatar (menu), a friends pill and a Feed button. Recipes, Plan, Shopping, Cookbooks, Friends, Settings and Admin move into a menu sheet. | Keep the app header and tab bar on the camera (the first build); a hamburger drawer. | [S6] Locket's camera keeps only flash and lens controls and puts History one scroll below it. |
| U2 | Every control row (top bar, shutter row, Send row) is three equal columns, so the middle control sits in the true centre. | `justify-between` (the first build pushed the shutter right, because "Upload" had a label and Flip didn't). | Owner feedback, 14 Nov. |
| U3 | After the shot the photo stays in the same square frame. The caption is typed over the photo; Recipe and Eaten out are chips under it; the row is Discard, Send, Save photo. | A composer sheet over the camera (the first build). | [S6] [S7] Locket sends from the camera screen itself. |
| U4 | The Feed is a square grid, edge to edge with 2 px gaps and the newest at the bottom, with All and Months (one cover card per month) at the bottom and an Everyone filter at the top. | A scrolling list of cards (the first build). | [S8] [S9] The iOS 18 Photos library is one grid with Years, Months and All at the bottom; Months shows cover cards rather than a column grid. |
| U5 | Tapping a photo opens it at camera size with the caption over it, a recipe chip, and one bar of six Reactions. Rare actions (Link or change recipe, Unlink, Save photo, Delete) live in a More menu. The author sees "Ana and Minh reacted" instead of the bar. | All actions as buttons under the photo. | [S6] |
| U6 | Gestures always have a button: swipe up from the camera has the Feed button; swiping between Snaps has Newer and Older buttons and the Up and Down keys; the grid's pinch is Months and All. | Gestures only. | CLAUDE.md UI rules (accessibility). |
| U7 | The camera, Feed and viewer are dark in both themes, using `--cam-*` tokens in `theme.css`. | Follow the light theme. | [S8] Photos and Locket both put photos on black. |
| U8 | Link a recipe lists each recipe as a row: a 48 px photo thumbnail (a warm-tinted initial when there is none), the name, and a muted "1 h 30 min · Serves 4" line. The photo is decorative; the name is the button's accessible name and the meta line is its description. | Name-only rows (the first build), which made recipes with similar names hard to tell apart. | [S10] [S11] |

States: the camera has starting, live, off (pick from your photos) and an unsent-draft banner. The composer has
sending, a kept draft with Retry, and an inline error for 400, 413 and 415. The Feed has loading tiles, empty (Take a
Snap, Add friends), error with Try again, a "Load earlier" error, a broken image (caption on a plain tile), and an empty
filter. The viewer has loading, 404 (dead link), other errors with Try again, and a delete confirmation.

## Sources

- [S1] Stripe, "Idempotent requests", https://docs.stripe.com/api/idempotent_requests
- [S2] PostgreSQL, "INSERT … ON CONFLICT", https://www.postgresql.org/docs/current/sql-insert.html
- [S3] MDN, "Cache-Control: immutable", https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control
- [S4] sharp, "Performance: concurrency", https://sharp.pixelplumbing.com/performance
- [S5] Mealie docs (behaviour only; nothing copied), https://docs.mealie.io/documentation/getting-started/features/
- [S6] Bustle, "How to use Locket", https://www.bustle.com/life/locket-app-how-to-use-tiktok-photo-widget
- [S7] Locket Widget on the App Store, https://apps.apple.com/us/app/1600525061
- [S8] MacRumors, "iOS 18 Photos app: all the new features", https://macrumors.com/guide/ios-18-photos
- [S9] MacStories, "iOS and iPadOS 18: the MacStories review", https://www.macstories.net/stories/ios-and-ipados-18-the-macstories-review/9
- [S10] W3C WAI, "Decorative images", https://www.w3.org/WAI/tutorials/images/decorative/
- [S11] W3C WAI, "An alt decision tree", https://www.w3.org/WAI/tutorials/images/decision-tree/
