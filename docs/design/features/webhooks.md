# Webhooks (F23, flag `webhooks`)

## What it does

A household owner registers URLs; Meally sends a signed JSON POST when a recipe is created, updated or deleted, when a
shopping item is checked, and once a day with that day's meal plan. Owners see delivery history, can re-view the
secret and send a test ping. Depends on `api-tokens` (the same "scripts talk to Meally" audience).

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | HMAC-SHA256 of the raw body, hex, in `X-Meally-Signature: sha256=...`, per-webhook random secret | Stripe-style timestamped `t=,v1=`; no signing | [S1] [S2] |
| D2 | Retry 3 times (1, 5, 30 min) on an in-process timer; auto-disable after 20 consecutive failures | Durable queue table; unlimited retries | [S2] |
| D3 | Deliver through the import `createFetcher` (`kind: "post"`): DNS vetted, connect to the vetted IP, no redirects, 10 s timeout | Plain `fetch` | SSRF note below |
| D4 | One in-process emitter keyed by `db`; services call `emitWebhookEvent` and never fetch | Calls in services | architecture |
| D5 | Digest checked every minute, sent once per local day within 2 h after `dailyAt` in the hook time zone | Fixed UTC time | - |

HMAC: GitHub signs the raw payload and sends `sha256=<hex>`; consumers must compare in constant time. Stripe adds a
timestamp to the signed string for replay protection. We sign only the body but include `occurredAt` in it, so
consumers can reject stale payloads themselves. Each attempt has a fresh `X-Meally-Delivery` id; use `event` +
`occurredAt` to dedupe retries.

Retries are in memory: a restart drops pending retries (the failure is still logged). Accepted for a self-hosted app.

SSRF: user-chosen URLs are the classic SSRF vector, so the fetcher resolves the host, rejects private, loopback,
link-local and metadata ranges, connects to the vetted address, and does not follow redirects (a 3xx is a failure).
Only ports 80/443 are allowed. `MEALLY_ALLOW_PRIVATE_URLS=true` lifts this for home labs (the older
`MEALLY_IMPORT_ALLOW_PRIVATE` still works).

## Data and API

Tables `webhooks` (id, household_id, name, url, secret, events JSON, enabled, daily_at, tz, last_digest_on,
created_at, last_status, last_delivery_at, failure_count) and `webhook_deliveries` (id, webhook_id, event,
status_code, ok, error, duration_ms, created_at; newest 50 kept per webhook).

`/api/v1/webhooks`, all owner-only (URLs often embed tokens): `GET /`, `POST /`, `GET|PUT|DELETE /:id` (GET and
create return `secret`), `POST /:id/test` (sends `ping`), `GET /:id/deliveries`. Body:
`{name, url, events[], enabled?, dailyAt?, tz?}`.

Payload: `{event, occurredAt, household: {id, name}, data}`; headers `X-Meally-Event`, `X-Meally-Delivery`,
`X-Meally-Signature`.

### Verifying the signature

Use the raw body, not re-serialised JSON.

```js
// Node (Express: app.post("/hook", express.raw({ type: "application/json" }), ...))
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(rawBody, header, secret) {
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
```

```python
import hashlib, hmac
def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header or "")
```

## UI

Settings, "Webhooks" (owners; members see a note). List with status dot (healthy, failing, disabled, none yet),
Send test, Deliveries (Sheet), Edit, Delete. Add/Edit Dialog: name, URL, event checkboxes, digest time and time zone
when `mealplan.today` is checked; the secret is shown with Copy after creation and in Edit. States: loading skeleton,
empty, error. Feature off: section hidden.

## Sources

- [S1] GitHub Docs, Validating webhook deliveries, https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- [S2] Stripe Docs, Webhooks: verify signatures, https://docs.stripe.com/webhooks#verify-manually
