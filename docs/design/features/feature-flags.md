# Feature flags (core mechanism)

## What it does

Every non-core feature has a flag. The server resolves each flag from env, then an admin override, then the default,
and a flag is off whenever one of its dependencies is off. The web app reads the result from `GET /api/v1/features`.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Env var `MEALLY_FEATURE_<KEY_UPPER_SNAKE>=on\|off`, one var per flag, other values ignored | one JSON blob var; comma list | [S1] |
| D2 | Env lock beats the DB override and the admin UI shows it read-only | DB wins over env | [S1], [S2] |
| D3 | Flags resolve once per change and are cached in memory; `setOverride` invalidates the cache | read DB per request; poll | [S2] |

Rationale: operators who set an env var are making a deployment-level decision (often in compose files), so a UI
click must not silently undo it. Flags are static, long-lived toggles managed by admins, not per-request
experiments, so a process-local cache with explicit invalidation is enough. Dependencies win over everything,
including an env `on`, because a feature cannot work without what it depends on; the flag is still reported as
locked.

## Data and API

- Table `feature_flags(key pk, enabled, updated_at)`. A row exists only while an override is set.
- `GET /api/v1/features` returns `{ features: { <key>: { enabled, locked, source, label, description } } }`.
- Disabled routes return `404 {"error":"feature_disabled"}` via `requireFeature(key)`.

## UI

`useFeature(key)`, `<Feature on fallback>`, `<FeatureRoute on>` (shows "This feature is turned off on this server").
Nothing is shown until the flags load, so a disabled feature never flashes.

## Sources

- [S1] Feature toggle types and "ops toggles" as long-lived, config-driven switches: https://martinfowler.com/articles/feature-toggles.html
- [S2] Same article: toggle configuration, static vs dynamic routing, and keeping toggle decisions in one place.
