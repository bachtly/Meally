# Webhooks (F23, flag `webhooks`)

## What it does

A household owner registers URLs; Meally sends a signed JSON POST when a recipe is created, updated or deleted, when a
shopping item is checked, and once a day with that day's meal plan. Owners see delivery history, can re-view the
secret and send a test ping. Depends on `api-tokens` (the same "scripts talk to Meally" audience).

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Signed timestamp for replay protection: `X-Meally-Timestamp` (unix seconds) and `X-Meally-Signature: t=<ts>,v1=<hex>`, HMAC-SHA256 of `"<ts>.<raw body>"`, per-webhook random secret. Fresh timestamp and signature on every attempt. Consumers reject if older than 5 minutes and compare in constant time. The old body-only `sha256=<hex>` stays in `X-Meally-Signature-256` for one release, **deprecated** | Body-only (GitHub style); no signing | [S2] [S3] |
| D2 | Retry 3 times in process with exponential backoff and full jitter: delay is uniform in `[0, min(30 min, 1 min * 2^n))`; auto-disable after 20 consecutive failures. Durable retries (Stripe retries up to 3 days) arrive with the Supabase cron work | Fixed 1/5/30 min delays; durable queue now; unlimited retries | [S2] [S3] |
| D3 | https only by default, validated on create, update and delivery; `http://` needs `MEALLY_ALLOW_PRIVATE_URLS=true` (home labs). Deliver through the import `createFetcher` (`kind: "post"`): DNS vetted, connect to the vetted IP, no redirects, 10 s timeout, ports 80/443 only (our own rule) | Plain `fetch`; allow http everywhere | [S3] [S4] |
| D4 | One in-process emitter keyed by `db`; services call `emitWebhookEvent` and never fetch | Calls in services | architecture |
| D5 | Digest checked every minute, sent once per local day within 2 h after `dailyAt` in the hook time zone | Fixed UTC time | - |

HMAC: GitHub signs the raw body and sends `sha256=<hex>`; Stripe signs `t.payload` and enforces a 5 minute tolerance, and
OWASP recommends the same plus constant-time comparison. We follow Stripe: the signed timestamp stops a captured request
being replayed later. `X-Meally-Signature-256` (body only) is deprecated and will be removed next release. Each attempt has
a fresh `X-Meally-Delivery` id; use `event` + `occurredAt` to dedupe retries.

Retries are in memory: a restart drops pending retries (the failure is still logged). Accepted until the Supabase cron work adds durable retries.

SSRF: user-chosen URLs are the classic SSRF vector, so the fetcher resolves the host, rejects private, loopback,
link-local and metadata ranges, connects to the vetted address, and does not follow redirects (a 3xx is a failure).
Only https URLs are accepted (http only with the flag below), on ports 80/443. `MEALLY_ALLOW_PRIVATE_URLS=true` lifts this for home labs (the older
`MEALLY_IMPORT_ALLOW_PRIVATE` still works).

## Data and API

Tables `webhooks` (id, household_id, name, url, secret, events JSON, enabled, daily_at, tz, last_digest_on,
created_at, last_status, last_delivery_at, failure_count) and `webhook_deliveries` (id, webhook_id, event,
status_code, ok, error, duration_ms, created_at; newest 50 kept per webhook).

`/api/v1/webhooks`, all owner-only (URLs often embed tokens): `GET /`, `POST /`, `GET|PUT|DELETE /:id` (GET and
create return `secret`), `POST /:id/test` (sends `ping`), `GET /:id/deliveries`. Body:
`{name, url, events[], enabled?, dailyAt?, tz?}`.

Payload: `{event, occurredAt, household: {id, name}, data}`; headers `X-Meally-Event`, `X-Meally-Delivery`,
`X-Meally-Timestamp`, `X-Meally-Signature`, `X-Meally-Signature-256` (deprecated).

### Verifying the signature

Use the raw body, not re-serialised JSON.

```js
// Node (Express: app.post("/hook", express.raw({ type: "application/json" }), ...))
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false; // stale or replayed
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  const got = Buffer.from(parts.v1);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
```

```python
import hashlib, hmac, time
def verify(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    try:
        parts = dict(p.split("=", 1) for p in (header or "").split(","))
        t = int(parts["t"])
        v1 = parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > tolerance:
        return False  # stale or replayed
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)
```

## UI

Settings, "Webhooks" (owners; members see a note). List with status dot (healthy, failing, disabled, none yet),
Send test, Deliveries (Sheet), Edit, Delete. Add/Edit Dialog: name, URL, event checkboxes, digest time and time zone
when `mealplan.today` is checked; the secret is shown with Copy after creation and in Edit. States: loading skeleton,
empty, error. Feature off: section hidden.

## Sources

Searched 2026-11-11. "(page)" = fetched and read; "(snippet)" = search summary only.

- [S1] Validating webhook deliveries, GitHub Docs (snippet): https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries . `sha256=<hex>` HMAC header, constant-time compare in examples.
- [S2] Receive Stripe events in your webhook endpoint, Stripe Docs (page): https://docs.stripe.com/webhooks . Signed `t.payload`, 5 min tolerance, fresh signature per retry, retries up to 3 days, redirects count as failures, dedupe by event id.
- [S3] Webhook Security Cheat Sheet, OWASP (page): https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Cheat_Sheet.html . HMAC-SHA256, timestamps, constant-time compare, backoff with jitter, https only, validate connected IP, no redirects.
- [S4] Server-Side Request Forgery Prevention Cheat Sheet, OWASP (snippet): https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html . Resolve once, validate, pin the IP; handle redirects.
