# Accounts and sessions (F1, F4, F27, core: no flag)

## What it does

People create an account, sign in and stay signed in for 30 days of activity. The first visit to a fresh instance runs
setup, which creates the first admin and the first household. Admins can choose who may sign up. Sign-in attempts are
rate limited.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Server-side sessions: a random 256-bit token in an httpOnly, SameSite=Lax cookie (Secure when `BASE_URL` is https). Only the sha256 of the token is stored, so a leaked database cannot be replayed. Sliding 30-day expiry, refreshed at most once a day. Logout deletes the row, so revocation is immediate. | JWT: cannot be revoked without a server list anyway, and adds key management for a single-node app | [S1] |
| D2 | Passwords use scrypt with N=2^17, r=8, p=1 (128 MiB per hash), a 16-byte salt and `maxmem` raised above the Node default. The parameters are stored in the hash string so they can be raised later. | argon2 (native dependency, build issues for self-hosters); bcrypt (72-byte limit) | [S1] |
| D3 | Signup modes `open`, `invite` (default) and `closed`, locked by `MEALLY_SIGNUP_MODE` or stored in `instance_settings`. Public instances should use `invite` or `closed`. `open` gives every user a new household. `invite` returns 403 `invite_required` until invite tokens land with households. | Always open (spam risk on public hosts) | none, product decision |
| D4 | CSRF: SameSite=Lax plus a check on unsafe `/api` requests that carry a session cookie. They must have a same-origin `Origin`, or no `Origin` and an `X-Requested-With` header, which cross-site forms cannot set. No token to manage. | Double-submit tokens (more client plumbing) | [S2] |
| D5 | In-memory fixed-window rate limit per IP: 10 login attempts per 15 minutes, 20 setup/register attempts per hour. Login failures return one generic error, and unknown emails still run a hash so timing matches. `X-Forwarded-For` is only used when `MEALLY_TRUST_PROXY=true`. | Persisted limiter (overkill; resets on restart are acceptable) | none |

## Data and API

Tables: `households`, `users` (unique lowercased email, role `admin|member`), `sessions` (id = token hash),
`instance_settings`. Routes under `/api/v1/auth`: `GET status`, `POST setup`, `POST register`, `POST login`,
`POST logout`, `GET me`. Middleware `requireAuth` (sets `user`, `householdId`) and `requireAdmin`.

## UI

Setup, Sign in and Sign up pages in a centred card, with skeleton and inline error states. Signed-out users are
redirected to sign in and back afterwards. The shell has an account menu with the name and Sign out. The sign-up page
is hidden when the mode is closed and shows an invitation notice in invite mode.

## Sources

- [S1] OWASP Password Storage Cheat Sheet (scrypt minimum N=2^17, r=8, p=1; Argon2id preferred), https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html (confirmed via secondary summaries)
- [S2] OWASP CSRF Prevention Cheat Sheet (Origin checks, custom request headers), https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
