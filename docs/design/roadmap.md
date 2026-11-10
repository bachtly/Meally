# Meally: roadmap

One row is one small PR, merged once CI passes. Each feature PR adds a note at `docs/design/features/<feature>.md`
following [the template](features/_template.md).

| PR | Scope | Feature |
|---|---|---|
| 1 | docs: research behind each architecture and UI decision (01-research.md) | |
| 2 | chore: monorepo scaffold, CI, Dockerfile | |
| 3 | feat: feature-flag core (registry, resolver, `/api/features`, `useFeature`) | G4 |
| 4 | feat(web): design system (tokens, themes, base components, app shell) | G2 |
| 5 | feat: accounts and sessions, first-run admin, sign-up modes, rate limits | F1, F4, F27 |
| 6 | feat(server): recipes data model and CRUD API, images | F2 |
| 7 | feat(web): recipe library (card grid, search) and recipe page | F2, F3 |
| 8 | feat(web): recipe editor | F2 |
| 9 | feat: import a recipe from a URL | F5 |
| 10 | feat: ingredient parser | F6 |
| 11 | feat: scale servings and convert units | F8 |
| 12 | feat: organisers (tags, categories, tools) and filters | F9 |
| 13 | feat: cook mode | F10 |
| 14 | feat: favourites and ratings | F11 |
| 15 | feat: meal planner | F12 |
| 16 | feat: shopping lists | F13 |
| 17 | feat: cookbooks | F14 |
| 18 | feat: households, members, invites | F15 |
| 19 | feat: public share links | F16 |
| 20 | feat: foods and units catalogue | F7 |
| 21 | feat: import from other apps | F17 |
| 22 | feat: export and backups | F18 |
| 23 | feat: timeline and comments | F19 |
| 24 | feat: print view | F21 |
| 25 | feat: API tokens | F22 |
| 26 | feat: webhooks | F23 |
| 27 | feat: nutrition | F20 |
| 28 | feat: PWA and offline | F24 |
| 29 | feat: admin console (users, flags, settings) | F26 |
| 30 | feat: AI helpers | F25 |
| 31 | test: end-to-end flows, self-hosting guide | |
