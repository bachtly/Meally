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

Deferred to later PRs: `PATCH` (F6), Reactions (F7), push (F8).

## UI

Not in this PR.

## Sources

- [S1] Stripe, "Idempotent requests", https://docs.stripe.com/api/idempotent_requests
- [S2] PostgreSQL, "INSERT … ON CONFLICT", https://www.postgresql.org/docs/current/sql-insert.html
- [S3] MDN, "Cache-Control: immutable", https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control
- [S4] sharp, "Performance: concurrency", https://sharp.pixelplumbing.com/performance
- [S5] Mealie docs (behaviour only; nothing copied), https://docs.mealie.io/documentation/getting-started/features/
