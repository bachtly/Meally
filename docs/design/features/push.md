# Push notifications (F8, flag `push`)

## What it does

A user turns on notifications in Settings, on each device. Their Friends' new Snaps and Reactions to their own Snaps
then arrive as system notifications, and a tap opens the Snap. iPhone and iPad users first add Meally to the Home
Screen, which is the only way iOS offers Web Push. Mealie and RecipeSage have no social notifications; this is our own
design.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Encrypt and sign with Web Crypto only (`features/push/webpush.ts`): `aes128gcm` payloads and ES256 VAPID JWTs. | The `web-push` npm package (needs Node's `crypto` and `https`, so it doesn't run on the edge build). | [S1] defines the payload encryption from ECDH, HKDF and AES-GCM, which Web Crypto provides in Node and Deno. [S2] defines the VAPID JWT (ES256, `aud`, `exp` at most 24 h, `sub`). |
| D2 | VAPID keys from `MEALLY_VAPID_PUBLIC_KEY` and `MEALLY_VAPID_PRIVATE_KEY`; without them a pair is generated once and kept in `instance_settings`. Broken env keys turn push off (`503 push_unconfigured`). | Require env vars (push off until an admin acts). | [S2]: the key only has to stay the same for existing subscriptions; it needs no outside registration. |
| D3 | Subscriptions are accepted only for https endpoints on the Google, Mozilla, Apple and Microsoft push services, then sent through the SSRF-safe fetcher. | Any https URL (a subscription could make the server POST to an internal host). | [S3]: the endpoint is chosen by the browser's push service; the four services cover Chrome, Edge, Firefox and Safari. |
| D4 | The `push.deliver` job claims due rows with a lease, sends with `TTL: 86400`, deletes the subscription on 404 or 410, retries 429, 5xx and timeouts up to 3 attempts with full-jitter backoff, and drops other 4xx. | Send inline in the request (a slow push service would slow down posting a Snap). | [S3]: 404 and 410 mean the subscription is gone; `TTL` is how long the service keeps an undelivered message. |
| D5 | Node sends right after queueing and sweeps every minute; the edge runs the job from pg_cron every minute (`supabase/cron.sql`). | Edge-only cron for both (up to a minute late on Node). | Existing `webhooks.retry` pattern. |
| D6 | `push` depends on `snaps` and `pwa`: the service worker is only registered with `pwa` on. | Register a worker just for push. | One worker per scope; `vite-plugin-pwa` `importScripts` adds the push handlers to it. |
| D7 | Notifications are tagged by type, Snap, sender and emoji, so a repeat after a crash replaces the first. Signing out unsubscribes the device and deletes the server's copy. | No tag (duplicates stack); keep the subscription after sign-out (the next person on a shared device gets your alerts). | [S4]: iOS web apps get push only from the Home Screen, after a tap. |

## Data and API

No new tables: `push_subscriptions` and `push_deliveries` came with F2.

- `GET /api/v1/push/key` → `{ publicKey }`. `503 push_unconfigured` when the env keys are invalid.
- `POST /api/v1/push/subscriptions` `{ endpoint, keys: { p256dh, auth } }` → `201 { id }`, or `200 { id }` when the
  endpoint exists (it moves to the session user). `400 unsupported_endpoint` for other hosts.
- `DELETE /api/v1/push/subscriptions/:id` → `204`, owner only (`404` otherwise).
- `POST /snaps` queues one delivery per device of each accepted Friend in the same transaction (a retried `clientId`
  queues nothing). Reactions already queued one for the author (F7). Fan-out uses `acceptedFriendIds` in `lib/access`.
- Payload (encrypted, under 2 KB): `{ type: "snap" | "reaction", snapId, from, emoji? }`. No caption or photo.

## UI

Settings → Notifications (flag `push`): one switch, "New Snaps and Reactions, on this device". The permission prompt
only follows a tap on it. States: loading (switch disabled), off, on, blocked ("Allow them in your browser settings"),
iPhone in a browser tab (Home Screen steps), no Web Push support or no server keys (section hidden), and an inline
error. The service worker shows "Ann sent a Snap" or "Bo reacted ❤️" and opens `/snaps/:id` on tap, focusing an open
window if there is one.

## Sources

- [S1] RFC 8291, "Message Encryption for Web Push", https://www.rfc-editor.org/rfc/rfc8291
- [S2] RFC 8292, "VAPID for Web Push", https://www.rfc-editor.org/rfc/rfc8292
- [S3] RFC 8030, "Generic Event Delivery Using HTTP Push", https://www.rfc-editor.org/rfc/rfc8030
- [S4] WebKit, "Web Push for Web Apps on iOS and iPadOS", https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
