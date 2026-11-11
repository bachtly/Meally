# API tokens (F22, flag `api-tokens`)

## What it does

A signed-in user creates personal tokens in Settings so scripts can call the API as them. Each token has a name, a scope
(read or write) and an optional expiry. The secret is shown once; tokens can be listed (never with the secret) and
revoked. The usage guide is `docs/api.md`.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Tokens are `mly_` plus 32 random bytes (base64url). The fixed prefix makes them recognisable to secret scanners and to people; 256 bits of randomness makes them unguessable. | Bare random strings; JWTs. | [S1] |
| D2 | Store only the SHA-256 of the token, plus the first 8 characters for display. Tokens are high-entropy, so a fast hash is enough (no salt or slow KDF needed). | Store plaintext, or hash with scrypt. | [S1], [S2] |
| D3 | Two scopes: `read` (GET/HEAD only) and `write`. Enforced in `requireAuth`, so every route gets it for free. Token management itself needs a session, so a leaked token cannot mint more tokens. | Per-resource scopes (more to build and explain). | [S2] |
| D4 | A request with both a cookie and a bearer token is rejected (400 `mixed_auth`). CSRF protection keys on the cookie, and rejecting avoids an ambiguous credential. Bearer-only requests carry no ambient credential, so CSRF does not apply. | Bearer wins and CSRF is skipped. | [S3] |
| D5 | Per-token rate limit of 600 requests per 10 minutes; `last_used_at` is written at most once a minute. | One limit per IP; a write per request. | n/a |

## Data and API

Table `api_tokens`: id, user_id, household_id, name, token_hash (unique), prefix, scopes, created_at, last_used_at,
expires_at, revoked_at.

- `GET /api/v1/tokens` lists active tokens (id, name, prefix, scope, createdAt, lastUsedAt, expiresAt).
- `POST /api/v1/tokens {name, scope, expiresInDays?}` returns `{token, item}` once.
- `DELETE /api/v1/tokens/:id` revokes. A user only sees and revokes their own tokens (others get 404).
- With the flag off, bearer tokens get 401 and the routes return 404.

## UI

Settings, "API tokens": list (name, prefix, scope, last used, expiry) with loading, empty and error states; "Create
token" dialog (name, access, expiry); the token is shown once with a warning and a Copy button; revoke asks to confirm.

## Sources

- [S1] GitHub, "Behind GitHub's new authentication token formats" https://github.blog/security/behind-githubs-new-authentication-token-formats/ (prefixes make tokens identifiable and cut false positives in secret scanning)
- [S2] OWASP, REST Security Cheat Sheet https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html (least privilege, keys not in URLs)
- [S3] OWASP, CSRF Prevention Cheat Sheet https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
