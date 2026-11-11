# Snap loop: brief

Tracking issue: [#75](https://github.com/bachtly/Meally/issues/75)

## Problem
Meally is a recipe manager today: you add recipes and then plan, shop and cook from them. The owner wants the app's
main loop to be Locket's ([research report](https://claude.ai/artifact/X5gm3F2mo86Z9LXP96qKrT)): snap the food you
cook or eat, send it to a small circle of friends, and let a friend tap a snap to open the recipe behind it. That snaps
are what keep users coming back is an **assumption**: no Meally usage data exists. Locket's numbers (91M installs, over
25% of active users posting a weekly Rollcall) show the pattern works for general photos, not for food.

## Users and job
Home cooks and food lovers who share meals with a few close friends · job: show friends what I cooked or ate, and find
the recipe behind a friend's dish.

## Goals
- G1 Taking a snap is the first action on the home screen: open the app, shoot, add an optional caption, send. It takes
  at most 3 taps after the camera opens.
- G2 A snap can link to a recipe. Tapping a friend's snap that has a recipe opens that recipe read-only, and "Save to my
  recipes" makes a copy you own.
- G3 A snap of a dish eaten out stores the dish name (and optionally the place), so you can later link it to a recipe or
  search for one.
- G4 Friends get new snaps through a full-screen feed and PWA web push. Push needs the user's opt-in.
- G5 Recipe management (library, editor, cook mode, meal plan, shopping) still works, now reached from a snap or the nav
  instead of being the home screen.
- G6 Households are replaced by user-to-user friendships. Data that a household owned today belongs to a user after a
  migration, and no existing recipe is lost.

## Non-goals
- A native iOS or Android app, or home-screen widgets (the web can't provide them).
- Public profiles, followers, discovery or an algorithmic feed. Snaps reach friends only.
- Likes or counts. Reactions follow Locket and are never counted.
- AI dish recognition or recipe generation from a photo. This can come later behind the `ai` flag.
- Celebrity accounts, a Rollcall weekly dump, streaks and paid tiers. These can come later.

## Constraints
- Stack stays the same: the React web app and PWA (`apps/web`), the Node server with Drizzle on Postgres or PGlite
  (`apps/server`), and the shared flags (`packages/shared/src/features.ts`). Self-hostable with no outside services
  except web push (VAPID).
- New features sit behind flags (`requireFeature` / `useFeature`). CLAUDE.md asks for one small PR per roadmap row,
  stacked.
- The isolation rule changes: "every query filters by `householdId`" becomes "every query filters by the session
  user's own id, or by an accepted friendship for the snap and linked-recipe read paths". This needs an ADR and an
  update to CLAUDE.md, and each read path keeps a 404 test for a non-friend.
- The images pipeline and `timeline_events` already exist. Reuse them rather than add a second photo store.
- Owner's choice: households are removed, not hidden (see the open question).

## Area of the system
| Module / service | Path | Why it is touched |
|---|---|---|
| Auth and households | `apps/server/src/db/schema/auth.ts`, `docs/design/features/households.md` | Households replaced by friendships; data ownership moves from household to user |
| Every household-scoped table (38 `householdId` columns) | `apps/server/src/db/schema/*.ts` | Ownership migration, isolation rule |
| Images | `apps/server/src/db/schema/recipes.ts` (`images`) | Snap photos reuse the image pipeline |
| Timeline | `apps/server/src/db/schema/timeline.ts`, `docs/design/features/timeline.md` | "Made it" events with photos overlap snaps; merge or relate |
| Share links | `docs/design/features/share-links.md`, `apps/server/src/db/schema/share.ts` | Existing read-only recipe access pattern for non-owners |
| Feature flags | `packages/shared/src/features.ts` | New flags (snaps, friends, push) |
| Web shell and PWA | `apps/web/src/app`, `apps/web/src/pwa` | Home becomes the feed; camera capture; push subscription |
| Isolation rule | `CLAUDE.md` | Rule rewritten for user and friend scoping |

## Stages
| Stage | Run / skip | Reason |
|---|---|---|
| research | run | Options for the friend graph, web camera capture, web push and moving off households |
| requirements | run | |
| data-model | run | Snaps, friendships, and the migration from households to users |
| api | run | |
| ui | run | Home screen changes to a feed with a camera |
| backend | run | Push delivery, image processing, migration plan |
| design | run | |

## Glossary
| Term | Meaning | Name in code (if it exists) |
|---|---|---|
| Snap | One food photo a user sends to their friends, with an optional caption, dish name, place and linked recipe | new |
| Feed | The full-screen, newest-first list of snaps from you and your friends | new (today's household feed is `GET /api/v1/timeline`) |
| Friend | Another user with an accepted friendship. Friends see each other's snaps and the recipes those snaps link to, read-only | new |
| Friendship | A symmetric link between two users: pending, then accepted | new |
| Friend cap | The maximum number of friends per user | new |
| Linked recipe | The recipe a snap points to. It belongs to the snap's author | new (`recipes`) |
| Eat-out snap | A snap of food not cooked by the author. It carries a dish name and optionally a place, and has no linked recipe at first | new |
| Save to my recipes | Copy a friend's linked recipe into your own recipes, keeping an "adapted from" reference | new |
| Reaction | An emoji on a snap. The author is notified and nothing is counted | new |
| Household | **Retired.** Today's shared owner of recipes, plans and lists, replaced by user ownership plus friendships | `households`, `users.household_id` |
| Timeline event | Existing log of made, comment or note on a recipe | `timeline_events` |
| Image | An uploaded, processed photo | `images` |

## Open questions
- Removing households drops shared editing (a couple co-editing a meal plan or shopping list). Should friendships get an
  optional "can edit my plans and lists" level, or is that out of scope? The owner chose "replace" on 2026-11-12. The
  lead recommended keeping households, because of the size of the migration. Discussion:
  [#76](https://github.com/bachtly/Meally/issues/76).
- Friend cap: 20, like Locket, or set by the instance?
