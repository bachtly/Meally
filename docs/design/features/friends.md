# Friends and invite links (F3, flag `friends`)

## What it does

A user makes a one-time invite link and sends it to someone. The other person opens it, sees who it is from, and taps
Accept; both are then Friends. Friends are the only people who can see each other's Snaps (later PRs). Removing a Friend
works from either side. An admin sets the Friend cap. RecipeSage has a similar friends list. Meally keeps it to a link
with no search or email, and no pending request: accepting the link is the other person's consent.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Invite token: 24 random bytes (base64url), stored only as a sha256 hash, valid 7 days, single use. | Store the raw token; longer or no expiry. | [S1] |
| D2 | Preview (`GET`) never consumes a link. Only the `POST` accept does. | Consume on open. | [S1] |
| D3 | Accept locks both users in id order, re-reads the invite, then checks used or expired (404), own invite, already friends, and the cap for both users. | Check without a lock. | - |
| D4 | A retry by the same user returns 200 with the Friend. | 409 on retry. | - |
| D5 | In invite sign-up mode a valid unused invite is the permit. It is redeemed in the same transaction as the account (used_by = new user, Friendship created, cap checked), so a second sign-up with it gets `invite_required`. | Check only and let the user accept later (reusable until accepted). | - |
| D6 | The Friend cap is `instance_settings.friend_cap`, default 20, max 100. Lowering it keeps existing Friendships and refuses new ones. | A per-user cap. | - |
| D7 | A missing Friend or invite on DELETE is a 404, the same as a row that isn't yours. | 204 for any DELETE. | - |

D1/D2: guidance on one-time tokens says to store only a digest, and that expiry alone does not make a token single
use. It also warns that link scanners can fetch a link before the user does, so a GET must not use the token up.

## Data and API

Uses the `friendships` and `friendship_invites` tables from F2. All routes need a session and the `friends` flag (a
404 `feature_disabled` when off).

- `POST /friends/invites` → 201 `{ id, url, path: "/invite/<token>", token, expiresAt }`; 409 `friend_cap`.
- `GET /friends/invites` → `{ items: { id, expiresAt, usedAt }[] }` (your own only). `DELETE /friends/invites/:id` → 204.
- `GET /friends/invites/:token` → `{ inviter: { name } }`; one 404 for unknown, used or expired.
- `POST /friends/invites/:token/accept` → 201 `Friend`, or 200 on a retry; 404, 409 `own_invite` / `already_friends` /
  `friend_cap`.
- `GET /friends` → `{ items: Friend[], cap }`. `DELETE /friends/:userId` → 204 (404 if not a Friend).
- `POST /auth/register` accepts `inviteToken` as the permit in invite mode and redeems it with the account (403 `invite_required` when invalid or already used, 409 `friend_cap` with no account created). It does not open a closed instance. In open mode the token is ignored.
- `GET`/`PUT /admin/settings`: `signupMode` and `friendCap` are both optional on PUT (at least one). `locked_by_env`
  applies only to `signupMode`.

Viewing and accepting share the existing invite limiter (30 per 15 minutes; by IP for view, by user for accept).

## UI

Added in the web PR (`f3-friends-web`).

## Sources

- [S1] One-time tokens: hashed storage, atomic single use, scanner prefetch, https://docs.kavachos.com/one-time-tokens
