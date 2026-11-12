# Snap loop: API

Inputs: [brief](00-brief.md), [requirements](02-requirements.md), [data model](03-data-model.md),
[ADR 0001](adr/0001-replace-households-with-user-ownership-and-friendships.md),
[ADR 0002](adr/0002-scope-queries-by-user-or-accepted-friendship.md). Terms follow the brief's Glossary.

Style kept from the server: Hono routes under `/api/v1` (`apps/server/src/app-core.ts:111-140`), zod schemas in
`@meally/shared`, errors as `{ error: <code>, message }` through `ApiError` (`apps/server/src/lib/errors.ts:4-19`),
unknown or not-yours resources as `404 not_found` (`errors.ts:21-22`), lists as `{ items, nextCursor }` with keyset
`cursor` and `limit` 1-100, default 20 (`packages/shared/src/schemas/timeline.ts:14-15`,
`apps/server/src/features/timeline/service.ts:45-62`), images as multipart `file` or pre-sized `w320/w800/w1600`
parts (`apps/server/src/features/recipes/image-input.ts:21-26`), and every group behind `requireAuth` plus
`requireFeature` (`features/timeline/routes.ts:28-29`). New flags: `snaps`, `friends`, `push`
(`packages/shared/src/features.ts`); `push` depends on `snaps`.

## Surface
| Operation | Kind | Caller | Covers (UC/AC ids) | New / changed |
|---|---|---|---|---|
| `POST /snaps` | HTTP | web | UC-1, AC-1.2, AC-1.4, AC-3.1 | new |
| `GET /snaps` (Feed) | HTTP | web | AC-4.1 | new |
| `GET /snaps/:id` | HTTP | web, push tap | AC-2.3, UC-5 step 4 | new |
| `PATCH /snaps/:id` | HTTP | web | UC-3, AC-3.2 | new |
| `DELETE /snaps/:id` | HTTP | web | NFR-8 (kept until author deletes) | new |
| `GET /snaps/:id/image/:size` | HTTP | web | AC-4.1, AC-2.3 | new |
| `GET /snaps/:id/recipe` | HTTP | web | AC-2.1, AC-2.3, AC-2.4 | new |
| `GET /snaps/:id/recipe/image/:size` | HTTP | web | AC-2.1 | new |
| `POST /snaps/:id/recipe/save` | HTTP | web | AC-2.2 | new |
| `PUT /snaps/:id/reactions/:emoji` | HTTP | web | AC-4.2 | new |
| `DELETE /snaps/:id/reactions/:emoji` | HTTP | web | AC-4.2 | new |
| `POST /friends/invites` | HTTP | web | UC-4, AC-6.1 | new |
| `GET /friends/invites` · `DELETE /friends/invites/:id` | HTTP | web | UC-4 | new |
| `GET /friends/invites/:token` | HTTP | web | UC-4 step 2 | new |
| `POST /friends/invites/:token/accept` | HTTP | web | AC-6.1, AC-6.2 | new |
| `GET /friends` | HTTP | web | UC-4 | new |
| `DELETE /friends/:userId` | HTTP | web | AC-6.3 | new |
| `GET /push/key` | HTTP | web | AC-4.3 | new |
| `POST /push/subscriptions` · `DELETE /push/subscriptions/:id` | HTTP | web | AC-4.3, UC-5 | new |
| `push-delivery` job | job | server | AC-4.4, AC-4.5 | new |
| `GET /recipes?q=` | HTTP | web | AC-3.3 | unchanged (`packages/shared/src/schemas/recipe.ts:144`) |
| `PUT /admin/settings` | HTTP | admin UI | AC-6.2 (Friend cap) | changed: adds `friendCap` |
| `/household/*` | HTTP | web, API tokens | AC-6.4 | removed |
| All household-scoped routes, `/images/:id/:size`, `/shares/received/:token/save` | HTTP | web | AC-2.4, AC-5.1 | changed: scoped by session user |

## Contracts
Shared shapes. `Snap`: `{ id, author: { id, name }, imageId, caption: string|null, dishName: string|null,
place: string|null, recipe: { slug, title } | null, createdAt, myReactions: string[], reactions?: { userId, name,
emoji }[] }`. `reactions` is present only for the author. No counts anywhere (brief non-goals). `Friend`:
`{ userId, name, since }`.

### POST /snaps
Request: multipart, image as `file` or pre-sized parts, plus `clientId` (required), `caption?`, `dishName?`,
`place?`, `recipeId?`. Field lengths: TBD: max length of caption and dish name (data model TBD).
Response: `201 Snap`; `200 Snap` when `(user, clientId)` already exists. Codes: 400, 404 (recipe not yours), 413, 415.

### GET /snaps
Request: `cursor?`, `limit?`. Response: `200 { items: Snap[], nextCursor: string|null }`. Own and accepted Friends'
Snaps, `created_at desc, id desc`.

### GET /snaps/:id · PATCH /snaps/:id · DELETE /snaps/:id
GET: `200 Snap`. PATCH (author only): `{ recipeId?: string|null, caption?, dishName?, place? }` → `200 Snap`.
DELETE (author only): `204`; also deletes its Reactions and its Image if nothing else references it (data model).

### GET /snaps/:id/image/:size · GET /snaps/:id/recipe/image/:size
`200` bytes with `Cache-Control: private, max-age=31536000, immutable`, as `/images/:id/:size`
(`features/recipes/routes.ts:84-99`). `:size` in 320, 800, 1600. Friend reads go through these paths because
`/images/:id/:size` is scoped to the owner.

### GET /snaps/:id/recipe
`200` read-only recipe, the same shape as `GET /recipes/:slug`, with image URLs rewritten to the snap paths above,
plus `savedSlug: string|null` (an existing copy, for UC-2 3a). `404` if the Snap has no Linked recipe.

### POST /snaps/:id/recipe/save
No body. `201 { slug }` new copy; `200 { slug }` if a copy with the same origin exists (`share/save.ts:26-31`).
`409 own_recipe` when the requester is the author (replaces the same-household rejection, `share/save.ts:75`).

### PUT · DELETE /snaps/:id/reactions/:emoji
`204`. `:emoji` is TBD: free emoji or a fixed set. PUT enqueues one push to the author only when the row is new.

### Friends
- `POST /friends/invites` `{}` → `201 { id, url, path, token, expiresAt }` (same shape as household invites,
  `features/households/routes.ts:34-42`). Expiry: TBD (data model TBD).
- `GET /friends/invites` → `{ items: { id, expiresAt, usedAt }[] }`; `DELETE /friends/invites/:id` → `204`.
- `GET /friends/invites/:token` → `200 { inviter: { name } }`, so the redeemer can accept or ignore. Unknown, used
  or expired tokens all give the same `404`, so the link can't probe accounts (requirements decisions).
- `POST /friends/invites/:token/accept` → `201 Friend`. Accepting is the other user's acceptance (AC-6.1): one
  transaction checks both users against the Friend cap and writes an `accepted` Friendship, setting
  `used_at` and `used_by` (data model open question). See open questions for whether `pending` is used at all.
- `GET /friends` → `{ items: Friend[] }` (bounded by the Friend cap, no pagination).
- `DELETE /friends/:userId` → `204`.

### Push
- `GET /push/key` → `{ publicKey }` (VAPID). `503 push_unconfigured` when the instance has no VAPID keys.
- `POST /push/subscriptions` `{ endpoint, keys: { p256dh, auth } }` → `201 { id }`, or `200 { id }` when the
  endpoint exists (moved to the session user).
- `DELETE /push/subscriptions/:id` → `204`.

### PUT /admin/settings
Adds `friendCap: integer ≥ 1`; `GET` returns it, falling back to 20 in code when unset (data model open question).
Upper bound: TBD.

## Errors
| Error | When | Code | Retryable | Caller should |
|---|---|---|---|---|
| `not_found` | Snap, recipe, invite or friend missing, not yours, non-friend, pending Friendship, flag off | 404 | no | Show the 404 view |
| `invalid_body` | Bad fields, missing `clientId`, bad image fields | 400 | no | Fix input |
| `too_large` | Image over 10 MB (`MAX_IMAGE_BYTES`, `image-input.ts:7`) | 413 | no | Show size error |
| `unsupported_media` | Not JPEG or WebP | 415 | no | Show type error |
| `friend_cap` | Either user at the Friend cap on accept | 409 | no | Show "at most N friends" |
| `already_friends` | Accepting a link from a current Friend | 409 | no | Open the Friend |
| `own_invite` | Accepting your own link | 409 | no | Explain |
| `own_recipe` | Saving your own Linked recipe | 409 | no | Open the recipe |
| `rate_limited` | Invite view or accept over limit | 429 | yes, later | Wait |
| `push_unconfigured` | No VAPID keys | 503 | no | Hide push |
| `internal_error` | Anything else | 500 | yes | Keep the draft, retry (AC-1.4) |

## Auth
| Operation | Who may call | Check (role, ownership, scope) |
|---|---|---|
| `POST /snaps`, `PATCH`, `DELETE /snaps/:id` | Signed-in User, author for PATCH/DELETE | `snaps.user_id = session`; `recipeId` must have `recipes.user_id = session`, else 404 |
| `GET /snaps`, `GET /snaps/:id`, Snap image | Author or Friend | Author is session, or an `accepted` Friendship with the author ([ADR 0002](adr/0002-scope-queries-by-user-or-accepted-friendship.md)) |
| `GET /snaps/:id/recipe` (+ image, save) | Author or Friend | As above, and the Linked recipe's `user_id` equals the Snap's author |
| Reactions | Author or Friend | As Snap read |
| Friends, invites | Signed-in User | Rows where the session is `created_by` or one of the pair |
| Push | Signed-in User | `push_subscriptions.user_id = session` |
| `PUT /admin/settings` | Instance admin | Existing admin check |

Each friend-readable path gets two 404 tests: a non-friend and a pending Friendship (ADR 0002). API tokens keep their
user (`tokens.ts:24`) and get the same rules.

## Behaviour
- **Idempotency:** `POST /snaps` dedupes on `(user, clientId)`; save dedupes on origin; reaction PUT/DELETE and
  `DELETE` routes are idempotent by key (DELETE of a missing row returns 404, like existing routes); push
  subscribe upserts by endpoint; invite accept is single-use (second call 404 or `already_friends`);
  `POST /friends/invites` is not idempotent (each call makes a new link).
- **Pagination:** only the Feed, keyset on `(created_at, id)`, `limit` 1-100, default 20. Other lists are bounded.
- **Rate limits:** invite view and accept use the existing invite limiter (`features/households/routes.ts:65-66`).
  Snap upload rate: TBD.
- **Timeouts:** upload body limit `MAX_IMAGE_BYTES + 512 KB`, as timeline (`features/timeline/routes.ts:53-58`).
  Push send timeout: TBD (reuse webhook values, data model open question).

## Events and async
| Event / job | Producer | Consumers | Schema | Ordering key | Delivery |
|---|---|---|---|---|---|
| `push-delivery` | `POST /snaps` (one row per Friend's subscription), reaction PUT (author's subscriptions), in the same transaction | push worker → Web Push service | `{ type: "snap" \| "reaction", snapId, from: name, emoji? }`, ≤ 2 KB (NFR-3) | none | at-least-once; retry with backoff as webhooks (`webhooks/service.ts:17-23`); 404/410 deletes the subscription (AC-4.5); max attempts TBD |

The service worker opens `/snaps/:snapId` on tap. Latency target: TBD (NFR-7).

## Compatibility
Breaking for existing callers, with one release and no versioning (single first-party web client, shipped together):
`/household/*` is removed and the `households` flag retired; every household-scoped route keeps its path and shape
but returns only the session user's rows; `householdRole` leaves the session payload. Scripts using API tokens on
`/household/*` break; the release notes must say so. Share links keep working (data model). `/api/v1` stays v1.
TBD: does the `/timeline` "household feed" stay as a per-user list or go away?

## Consumer check
| Consumer | Flow | Can it be built from this contract? |
|---|---|---|
| Web home / camera | UC-1 send with draft retry | Yes: `clientId` makes retries safe |
| Web Feed | AC-4.1 scroll, react | Yes |
| Web Snap view | UC-2 open, save | Yes: `savedSlug` and save dedupe |
| Web own Snap | UC-3 link later | Yes: `GET /recipes?q=` then `PATCH` |
| Web friends | UC-4 invite, accept, remove | Yes, if `pending` stays unused (open question) |
| Service worker | UC-5 subscribe, tap | Yes |
| Admin UI | Friend cap | Yes |
| API-token scripts | household routes | No, removed (Compatibility) |

## Decisions (owner, 2026-11-12)
- **Invite flow:** when a Friend opens the invite link and taps Accept, the Friendship is created as accepted. v1 writes
  no pending row. The pending-Friendship 404 test from ADR 0002 stays, so the check keeps filtering on
  `status = accepted`.
- **Reactions:** the author sees every Reaction on their own Snap, and everyone else sees only their own. Reactions
  come from a fixed set of about 6 emoji keys, and no counts are shown.
- **`GET /timeline` is removed.** The Feed replaces it. List this under Compatibility as a breaking change.
- **Defaults the owner accepted:** caption up to 2000 characters, dish name and place up to 120. Push uses the
  webhook retry values (`apps/server/src/features/webhooks/service.ts:17-23`). v1 has no separate rate limit for Snap
  uploads.

## Open questions
Approved as is, over a REVISE verdict from the critic. The ui and backend stages must resolve these:
- **Blocking: image cache keys.** `/snaps/:id/recipe/image/:size` is cached as immutable, but its bytes change when
  the Snap is relinked. Use `/snaps/:id/images/:imageId/:size`, where the server checks that `imageId` is the Snap's
  Image or its Linked recipe's current Image. Return ready-made `imageUrl`/`thumbUrl` instead of a raw `imageId`.
- `PUT /admin/settings`: make `signupMode` and `friendCap` both optional, apply `locked_by_env` only to
  `signupMode`, and return `friendCap` from `GET`. Lowering the cap keeps existing Friendships but refuses new ones.
- Errors: a flag that is off returns `404 feature_disabled` (`features/middleware.ts:5-9`), not `not_found`.
- Shapes to match the repo: `recipe: { slug, name } | null`, and `createdAt` as epoch ms.
- Compatibility: also list `ShareStatus.sameHousehold` and the `same_household` code, `householdId`/`householdName`
  in `GET /admin/users`, `counts.households` in `GET /admin/info`, and the session payload.
- Accept is safe to retry: return 200 when `used_by` is the session user and the Friendship exists.
- Check the cap on `POST /friends/invites` too (`409 friend_cap`).
- Don't send a push when the person reacting is the Snap's author. Validate the emoji key against the fixed set.
- DELETE on a missing row: pick one behaviour (204, or a 404 the client treats as success) and use it everywhere.
- Limit `PATCH /snaps/:id` to `recipeId` unless a requirement covers editing the other fields.
- Define the invite link path and the flow for a recipient with no account (sign up, then accept).
- Terms: "invite" should be "Friendship request". "Push worker" and "draft" aren't glossary terms. Capitalise Snap and
  Friend.
