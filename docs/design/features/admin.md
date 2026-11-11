# Admin console (F26, core, no flag)

## What it does

Admins get an `/admin` area with four tabs: server overview, feature flags, users and sign-up mode. It is core, so it has
no flag and is reachable only with the `admin` role (`requireAuth` then `requireAdmin` on `/api/v1/admin/*`).

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | An env var always wins over the UI. A locked flag or sign-up mode is shown with a "Locked by MEALLY_..." badge, the control is disabled, and the API answers 409 `locked_by_env`. | Let the UI write a DB override that env silently masks (confusing); drop the env lock. | [S1] |
| D2 | The last admin cannot be demoted or deleted (409 `last_admin`). Counted as "admins other than this user". | Allow it and rely on a CLI to recover. | [S2] |
| D3 | No email, so a password reset sets a random 96-bit temporary password, returned once with `no-store`, and signs the user out everywhere. | Reset links (need email or a token table); letting the admin type a password. | [S3] |
| D4 | Deleting a user removes their sessions. Their household stays while it has other members or recipes; an empty household is deleted. If the owner left, the oldest remaining member becomes owner. | Always delete the household (data loss); never delete it (orphans). | n/a |
| D5 | "Last seen" is derived from the latest session expiry minus the session TTL, since expiry slides on use. No new column. | A `last_seen_at` column written per request. | n/a |

## Data and API

No new tables. All routes are under `/api/v1/admin`:

- `GET /features`, `PUT /features/:key {enabled: boolean|null}` (null clears the override).
- `GET /settings`, `PUT /settings {signupMode}`.
- `GET /users?q&limit&offset`, `PATCH /users/:id {role}`, `DELETE /users/:id`, `POST /users/:id/reset-password`.
- `GET /info`.

## UI

Tabs: Overview (cards), Features (grouped switches, dependency notes, reset button), Users (table on desktop, cards on
phones, confirm dialogs), Sign-up (radio cards with plain-language consequences). Each has loading, error and empty
states. Changing a flag invalidates the `features` query, so the nav updates at once.

## Evidence changed

None contradicts a decision, but support is thin. The twelve-factor page backs env-based config, not "env beats UI"
(D1 is our own rule). Searches found no OWASP text on protecting the last administrator (D2, own judgment) and the
OWASP reset sheet does not cover admin-issued temporary passwords (D3), only random, single-use secrets.

## Sources

Searched 2026-11-11. "(page)" = fetched and read; "(snippet)" = search summary only.

- [S1] III. Config, The Twelve-Factor App (page): https://12factor.net/config . Supports env vars as the per-deploy config mechanism.
- [S2] Testing for Weak Lock Out Mechanism, OWASP WSTG (snippet): https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/03-Testing_for_Weak_Lock_Out_Mechanism . Loosely related: admins need a recovery path.
- [S3] Forgot Password Cheat Sheet, OWASP (page): https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html . Supports random, long, single-use secrets. Silent on admin resets.
