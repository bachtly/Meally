# Push notifications (F8, flag `push`)

## What it does

A user can register a browser for push. When an accepted Friend posts a Snap, or someone reacts to the user's Snap, the
server sends a small encrypted Web Push to each of the user's devices. The payload holds only the kind, the Snap id, the
sender's name and (for a Reaction) the emoji key: no caption or photo. This slice is the server only; the subscribe
button and the service worker come in the web PR. Mealie has no push; RecipeSage has no social push. This is our own design.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Encryption (RFC 8291, `aes128gcm`) and VAPID signing (ES256 JWT) are written on WebCrypto (`crypto.subtle`), about 100 lines in `webpush.ts`. A test reproduces the RFC 8291 example body byte for byte. | The `web-push` npm package (uses Node `crypto`, `https` and its own HTTP client, so it neither runs on the edge runtime nor goes through our SSRF-safe fetcher). | [S1] defines the exact HKDF inputs and record layout; [S2] defines the JWT; [S3] shows the library's Node-only design. |
| D2 | VAPID keys are generated on first use and kept in `instance_settings` (`vapid_keys`). `MEALLY_VAPID_PUBLIC_KEY` and `MEALLY_VAPID_PRIVATE_KEY` override them. The subject is `MEALLY_VAPID_SUBJECT`, else `BASE_URL` when https, else a placeholder `mailto:`. A bad pair gives `503 push_unconfigured`. | Env vars only (a self-hoster must run a key generator before push works). | [S2] says the key pair must stay stable, since a changed key invalidates every existing subscription. Persisting in the DB keeps it stable across restarts and redeploys. |
| D3 | The subscription endpoint is validated at subscribe: https only (http only with `MEALLY_ALLOW_PRIVATE_URLS`), no credentials, port 443, no private, loopback or link-local IP literal, no single-label or `.local`/`.internal` host. Delivery runs the same check again and the fetcher vets the DNS answer. | Trust the browser-given URL. | [S4]: a user-supplied URL the server calls is the classic SSRF input. |
| D4 | Sends go through the existing `Fetcher` (`kind: "post"`, no redirects, 10 s timeout). Its `body` now accepts bytes, since the encrypted record is binary. A 3xx is a failure. | A second HTTP client. | One audited outbound path. |
| D5 | Queue = `push_deliveries` rows written in the same transaction as the Snap or Reaction. `push.deliver` claims 20 due rows with `FOR UPDATE SKIP LOCKED` and a 5-minute lease (as webhook retries), and sends them. 2xx deletes the row; 404 or 410 deletes the subscription; 429, 5xx, 3xx and network errors retry with the webhook backoff (3 retries, full jitter, base 60 s, cap 30 min) and are deleted after the last; other 4xx are deleted at once. | An in-memory queue (lost on restart). | [S5]: 404 and 410 mean the subscription is gone; 429 and 5xx mean try later. |
| D6 | The row is re-checked when claimed: the flag is still on, the subscription and endpoint are still valid, and the recipient can still see the Snap (author, or accepted Friend of its author). Otherwise the row is dropped without sending. | Trust the state at enqueue time (a removed Friend would still get a push). | ADR 0002. |
| D7 | Reaction pushes are queued only when the `reactions` row is first inserted, never for the author's own Reaction; a Snap push goes to Friends' devices only, never the author's. | A notification log table. | The soft-deleted row from F2 already remembers it. |
| D8 | At most 10 subscriptions per user (oldest dropped). One endpoint belongs to one account: subscribing it from another account moves it. | Unbounded. | Bounds fan-out per Friend. |
| D9 | The job is always registered by name (`push.deliver`) so `POST /internal/jobs/push.deliver` works on the edge; on Node it also runs every minute and right after a send (`runAfter(…, 0)`). `supabase/cron.sql` calls it every minute. | Node timers only. | The edge `runAfter` is a no-op, so cron is what drains the queue there. |

## Data and API

No new tables (`push_subscriptions`, `push_deliveries` came with F2); one `instance_settings` key, `vapid_keys`.

- `GET /api/v1/push/key`: `{ publicKey }` (the browser's `applicationServerKey`), or `503 push_unconfigured`.
- `POST /api/v1/push/subscriptions` `{ endpoint, keys: { p256dh, auth } }`: `204`. `400` for an endpoint that fails D3 or a bad body.
- `DELETE /api/v1/push/subscriptions` `{ endpoint }`: `204`, also when there is nothing to delete. Only the caller's own.
- Payload (≤ 2 KB, checked before queueing and before sending): `{ type: "snap" | "reaction", snapId, from, emoji? }`.
- Headers sent: `Authorization: vapid t=…, k=…`, `Content-Encoding: aes128gcm`, `TTL: 86400`, `Urgency: normal`.

All routes need a session and the `push` flag (else `404 feature_disabled`).

## UI

Not in this PR.

## Sources

- [S1] RFC 8291, Message Encryption for Web Push, https://www.rfc-editor.org/rfc/rfc8291
- [S2] RFC 8292, VAPID for Web Push, https://www.rfc-editor.org/rfc/rfc8292
- [S3] web-push-libs/web-push, https://github.com/web-push-libs/web-push
- [S4] OWASP, Server-Side Request Forgery Prevention Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- [S5] RFC 8030, Generic Event Delivery Using HTTP Push (status codes), https://www.rfc-editor.org/rfc/rfc8030
