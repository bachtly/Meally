# Households, members and invites (F15, flag `households`)

## What it does

A household is the unit that owns recipes, plans and lists. Owners rename it, invite people with a one-time link, change
roles and remove members. Members can leave. Mealie nests groups above households and lets households share recipes;
RecipeSage keeps accounts separate and lets friends share individual recipes. Meally takes the simplest shape: one
shared household per user, no cross-household sharing yet.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | A user belongs to exactly one household (`users.household_id`), with a `household_role` column (`owner`/`member`) on `users`. | A membership table (many households per user). | [S1] |
| D2 | Invite links, stored as a sha256 hash, valid 7 days, single use, optionally locked to an email. No outgoing email. | Email invites (needs SMTP, which self-hosters often lack). | [S1] |
| D3 | On leave or removal the user gets a fresh empty household. Recipes, plans and lists stay with the old household. | Copy or export their data; delete it. | - |
| D4 | A valid invite works in every signup mode except `closed`; invite mode requires one. | Invite-only mode accepting nothing else. | - |

D1: Mealie documents groups containing households, each with its own users and settings, and shared recipes between
households. That is flexible but adds a level most home kitchens do not need. A single household per user keeps every
query keyed on one `householdId`. Migrating to a membership table later is possible; existing users become owners.

D3: nothing is deleted or copied, so a removal is reversible by re-inviting and never loses data. An owner may leave only
if another owner exists, so a household is never left without one. A user alone in their household cannot leave.

## Data and API

Tables: `users.household_role`; `invites` (id, household_id, token_hash, email, role, created_by, expires_at, used_at,
created_at).

All under `/api/v1/household` (auth and flag required): `GET /`; `PATCH /` {name} (owner); `POST /invites` (owner, returns
`{id,url,path,token,expiresAt}`, shown once); `GET /invites`; `DELETE /invites/:id` (owner); `PATCH /members/:userId`
{role} (owner); `DELETE /members/:userId` (owner); `POST /leave`; `POST /join` {token}.
Auth: `POST /auth/register` takes `inviteToken`; `GET /auth/invite/:token` returns `{householdName, valid}` and is
rate-limited (30 per 15 min per IP). Invite lookups return `valid: false` for unknown, used and expired tokens alike.

## UI

`/settings` (linked from More): Profile placeholder, Household (flagged), Appearance. Household: rename, members with
role badges and an owner menu, "Invite someone" copy box with expiry note, pending invites with revoke, Leave. Sign-up
`/sign-up?invite=TOKEN` shows "Join <household>". `/invite/:token` is for signed-in users and warns that old recipes stay
behind. States: skeleton while loading, retry on error; with the flag off the section and `/invite` route are hidden.

## Sources

- [S1] Mealie documentation, features (groups, households, shared recipes), https://mealie.io/documentation/getting-started/features/
- Mealie discussion on sharing between groups, https://github.com/mealie-recipes/mealie/discussions/2456
