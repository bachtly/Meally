# Snap loop: research

Inputs: [brief](00-brief.md), [codebase survey](research/codebase.md), web research in
`research/2026-11-12-private-friends-only-food-photo-sharing-for-home-c/` (cited as `[sid]`). No ADRs exist yet in
`adr/`. Terms follow the brief's Glossary.

## Our system today
- Current flow: `/` redirects to the recipe library (`apps/web/src/app/App.tsx:76-77`). The nearest thing to a Snap is
  a "made" Timeline event on a recipe (`apps/server/src/features/timeline/routes.ts:40`, kinds at
  `apps/server/src/db/schema/timeline.ts:17`), with a photo uploaded afterwards (`timeline/routes.ts:61`). The
  household list is `GET /timeline` (`timeline/routes.ts:43`). Non-members see a recipe only through a Share link
  (`apps/web/src/app/App.tsx:42-43`) and can copy it (`apps/server/src/features/share/save.ts:66-80`).
- Relevant modules, data and contracts: each user belongs to exactly one Household
  (`apps/server/src/db/schema/auth.ts:15-19`); the auth middleware puts `householdId` on the context
  (`apps/server/src/features/auth/middleware.ts:48-62`); recipe services take `householdId` first
  (`apps/server/src/features/recipes/service.ts:135-328`); recipe slugs are unique per household
  (`apps/server/src/db/schema/recipes.ts:44-46`). 16 `household_id` columns exist across 12 files in `apps/server/src/db/schema/`
  ([survey](research/codebase.md)).
- Reusable pieces: Image pipeline and upload parsing (`timeline/routes.ts:61`,
  `apps/server/src/features/recipes/image-input.ts:31`); cross-owner copy with image copy and `originRecipeId` dedupe
  for Save to my recipes (`share/save.ts:26-31,52-58`); read-only `ShareRecipePage` for the Linked recipe view
  (`App.tsx:43`); Timeline event rows pairing user, recipe, photo and time (`timeline.ts:9-22`); webhook retry and
  backoff as a pattern for push retries (`apps/server/src/features/webhooks/service.ts:17-23`); flags registry
  (`packages/shared/src/features.ts:10-32`) and service worker behind `pwa` (`apps/web/src/pwa/register.ts:12-20`).
- Constraints and debt: the isolation rule is written into `docs/design/03-architecture.md` (API conventions) and
  CLAUDE.md; the service worker uses `generateSW` with "no custom SW code" (`apps/web/vite.config.ts:8`), so a `push`
  handler needs `injectManifest` or `importScripts`; no camera or push code exists in `apps/web/src`; image files are
  laid out per household on disk (`recipes.ts:6`) and backups read that directory (`apps/server/src/ports/index.ts:38`);
  share save rejects same-household copies (`share/save.ts:75`); merging members' recipes per user can collide on slug
  (`recipes.ts:44`).

## How others solve it
| Solution | Approach | Strengths | Weaknesses | Source |
|---|---|---|---|---|
| Locket | Photo to a capped circle of friends | Small circle by design | Cap of 20 friends; unlimited only on paid tier | [r2q04-01] [r2q04-05] |
| BiteSnap | Photo or short video is the recipe; private, friends-only or public per item | No forms; no algorithm or strangers | iOS/Apple only | [r1q01-01] |
| MustTaste | Snap, rate, tag the restaurant, post to friends; pinned on a map | Fits eat-out snaps; friends-only, block or hide | Streaks and certified reviewers (non-goals here) | [r1q01-03] |
| Chefless | Household Kitchen for shared planning plus Plates (meal photo, optional recipe link, audience: followers, Kitchen or self) | Keeps shared plans and personal sharing side by side; block and report | One-way follow graph; free-tier caps | [r1q01-08] |
| Monarch shared views | Individual owners per item plus a Shared owner for household-wide items | Clear per-person ownership without losing shared items | Some views always show the whole household | [r2q03-04] |
| PWA camera via `getUserMedia` | Browser stream into video/canvas, fallback to file upload on denial | No native app; explain before the prompt | No manual controls; stops in background | [r1q02-02] |
| Web Push with VAPID via service worker | Subscribe in SW, server sends encrypted payload | Self-hostable; full on Android | iOS 16.4+ only after Home Screen install; Safari payload 2KB | [r1q02-06] [r2q01-01] [r2q02-03] |

Practices that apply to every option: ask for push permission only on a user gesture and keep payloads small
[r2q01-01]; clean up expired subscriptions [r1q02-06]; model the install rate before relying on push [r2q02-03]; offer
block controls next to social sharing [r1q01-08]; default to approximate location for places [r2q05-03].

## Options
The camera (getUserMedia plus upload fallback) and push (VAPID Web Push) parts are the same in every option; the
options differ in who owns data and how friends reach it.

### O1 · Replace households with user ownership and Friendships
Every household-owned row moves to a user; Friendships grant read access to Snaps and Linked recipes only. Matches the
brief's G6 and the owner's choice. Fit: rewrites every service signature and the isolation rule (16 columns in 12 files, image
paths, slug uniqueness). Cost: high (migration of every feature plus per-user re-keying of images). Main risk: shared
editing of a plan or shopping list between a couple is lost, and the migration must keep every recipe (G6).
Reversible: no (household data is split per user).

### O2 · Keep households, add user-authored Snaps and Friendships on top
Snaps belong to a user; Friendships are between users; recipes, plans and lists stay household-owned and a Friend
reads a Linked recipe through the Snap. This is the Chefless Kitchen-plus-Plates shape [r1q01-08] and Monarch's
individual-plus-shared ownership [r2q03-04]. Fit: additive; existing services and the household isolation rule stay,
with one new friend-scoped read path. Cost: medium. Main risk: two scoping rules side by side; contradicts G6 and the
owner's choice. Reversible: yes (O1 can follow later).

### O0 · Reuse Timeline events and Share links
A "made" Timeline event becomes the Snap, and sharing to friends uses Share links. Fit: no new tables. Cost: low. Main
risk: no Friend graph, no Feed across friends, no eat-out snap without a recipe (Timeline rows hang off a recipe,
`timeline/routes.ts:40`). Fails G2–G4 and G6. Reversible: yes.

## Comparison
| Criterion (brief) | O1 | O2 | O0 |
|---|---|---|---|
| G1 snap in at most 3 taps from home | yes | yes | no (needs a recipe first) |
| G2 friend opens Linked recipe, Save to my recipes | yes | yes | partly (Share link per recipe) |
| G3 Eat-out snap with dish name and place | yes | yes | no |
| G4 Feed and opt-in push | yes | yes | no Feed |
| G5 recipe management keeps working | yes, after migration | yes, unchanged | yes |
| G6 households replaced, no recipe lost | yes | no | no |
| Constraint: reuse images and `timeline_events` | yes | yes | yes |
| Constraint: isolation rule with non-friend 404 tests | one new rule everywhere | two rules side by side | unchanged |
| Cost and migration risk | high | medium | low |

## Recommendation
O1, because G6 and the brief's constraints record the owner's choice to remove households. The trade-off accepted:
the highest cost and an irreversible data migration, and loss of shared editing of plans and lists unless Friendships
get an edit level (brief open question, [#76](https://github.com/bachtly/Meally/issues/76)). The industry evidence leans
the other way: products that combine shared planning with personal photo sharing keep a shared space next to
per-user ownership [r1q01-08] [r2q03-04]. If the owner decides shared editing must stay, or the migration plan cannot
guarantee that no recipe is lost, switch to O2.

## Decisions (owner, 2026-11-12)
- **Option: O1, full replacement** ([ADR 0001](adr/0001-replace-households-with-user-ownership-and-friendships.md),
  [ADR 0002](adr/0002-scope-queries-by-user-or-accepted-friendship.md)).
- **Migration split: copy to every member.** Each member of a multi-member household gets a full copy of its recipes,
  plans, lists and images. Nothing is lost, and duplicates are accepted. This also covers recipes whose `created_by` is
  null (`recipes.ts:34`) and images shared between rows.
- **Friend cap: an instance setting, default 20** [r2q04-01]. Members of the same household become Friends
  automatically during the migration.
- **Timeline: snaps are separate, with no migration.** Snaps get their own table, so the Linked recipe can be empty
  for an Eat-out snap (`timeline_events.recipe_id` is NOT NULL, `timeline.ts:13-15`). Existing Timeline events stay as
  they are, and the Feed starts empty.

## Open questions
- Shared editing after households are removed: drop it, or add a Friendship edit level? (brief, #76)
- iOS push needs Home Screen install [r2q02-03]: is the Feed acceptable without push for iOS users who don't install?
- **Approved over an objection:** the critic proposed O3, a "household of one" (each user keeps a personal household
  behind the scenes, and the existing `householdId` scoping, image paths and slug uniqueness stay). It meets G6 at
  lower cost and can be undone. The owner chose O1.
- Review findings not applied (research approved without revision): the G1 wording in the Comparison table should be
  "3 taps after the camera opens"; reusing Share links needs a lookup keyed on the Snap or Friendship, not on the
  token (`share/save.ts:16-23`); the claim about BeReal's location default overstates [r2q05-03].

## Glossary proposals
- Push subscription: one browser's Web Push endpoint and keys stored for a user.
