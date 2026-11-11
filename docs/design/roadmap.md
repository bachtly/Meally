# Meally: roadmap

One row is one small PR. PRs are stacked: each targets the previous branch and they merge in order. Status shows the pull request number(s) for each row (row numbers differ from PR numbers). Each feature PR adds a note at `docs/design/features/<feature>.md`
following [the template](features/_template.md).

| PR | Scope | Feature | Status |
|---|---|---|---|
| 1 | docs: research behind each architecture and UI decision (01-research.md) | | Open (#1) |
| 2 | chore: monorepo scaffold, CI, Dockerfile | | Open (#2) |
| 3 | feat: feature-flag core (registry, resolver, `/api/features`, `useFeature`) | G4 | Open (#3) |
| 4 | feat(web): design system (tokens, themes, base components, app shell) | G2 | Open (#4) |
| 5 | feat: accounts and sessions, first-run admin, sign-up modes, rate limits | F1, F4, F27 | Open (#5) |
| 6 | feat(server): recipes data model and CRUD API, images | F2 | Open (#7, #6) |
| 7 | feat(web): recipe library (card grid, search) and recipe page | F2, F3 | Open (#9) |
| 8 | feat(web): recipe editor | F2 | Open (#12) |
| 9 | feat: import a recipe from a URL | F5 | Open (#10, #14) |
| 10 | feat: ingredient parser | F6 | Open (#8) |
| 11 | feat: scale servings and convert units | F8 | Open (#19) |
| 12 | feat: organisers (tags, categories, tools) and filters | F9 | Open (#11, #20) |
| 13 | feat: cook mode | F10 | Open (#21) |
| 14 | feat: favourites and ratings | F11 | Open (#22) |
| 15 | feat: meal planner | F12 | Open (#13, #17) |
| 16 | feat: shopping lists | F13 | Open (#15, #16) |
| 17 | feat: cookbooks | F14 | Open (#24) |
| 18 | feat: households, members, invites | F15 | Open (#18) |
| 19 | feat: public share links | F16 | Open (#23) |
| 20 | feat: foods and units catalogue | F7 | Open (#37) |
| 21 | feat: import from other apps | F17 | Open (#25) |
| 22 | feat: export and backups | F18 | Open (#28) |
| 23 | feat: timeline and comments | F19 | Open (#26) |
| 24 | feat: print view | F21 | Open (#27) |
| 25 | feat: API tokens | F22 | Open (#29) |
| 26 | feat: webhooks | F23 | Open (#31) |
| 27 | feat: nutrition | F20 | Open (#33) |
| 28 | feat: PWA and offline | F24 | Open (#32) |
| 29 | feat: admin console (users, flags, settings) | F26 | Open (#30) |
| 30 | feat: AI helpers | F25 | Open (#34) |
| 31 | test: end-to-end flows, self-hosting guide | | This PR (#36) |
| — | fix: polish meal plan, shopping aisles, cook entry point | | Open (#35) |
| 32 | feat(deploy): web hosting on Cloudflare Pages with Terraform, `/api` proxy function | | This PR |
| 33 | docs: design for a read-only local copy (Dexie), like daily-kaizen | F24 | Planned |
| 34 | feat(web): local copy core (Dexie schema, refresh, clear on sign-out and household switch) | F24 | Planned |
| 35 | feat(web): recipes and organisers read from the local copy | F2, F9 | Planned |
| 36 | feat(web): meal plan and shopping lists read from the local copy | F12, F13 | Planned |
| 37 | feat(web): writes confirm with the server, then refresh the local copy | F24 | Planned |
| 38 | docs: design for sharing many recipes, saving a share and the receiver's path into the app (`2026-11-11-sharing/design.md`) | F16 | Done (#54) |
| 39 | feat(server): share sets and cookbooks, sharer name and note | F16, F14 | Done (#63) |
| 40 | feat(server): save a share into my household (copy, images, provenance, dedupe, bulk job) | F16 | Done (#67) |
| 41 | feat(web): library select mode, share many, share a cookbook, Shared links page | F16, F14 | Done (#69) |
| 42 | feat(web): share view for sets and cookbooks, in-shell when signed in, Save and Save all | F16 | This PR |
| 43 | feat(web): newcomer path (sign-up with share intent, auto-save, install card after save) | F16, F24 | This PR |
| 44 | feat(web): import page accepts our own share links; "already have the app" hint on iOS ("Shared by" shipped in 43) | F16 | Planned |
| 45 | feat(deploy): link previews and JSON-LD for `/s/*`; `launch_handler` | F16, F24 | Planned |
