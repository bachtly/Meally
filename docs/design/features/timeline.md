# Recipe timeline and comments (F19, flag `timeline`)

## What it does

Each recipe has a timeline at the bottom of its page: household members log that they made it (optionally with a note
and a photo), leave comments, or add notes. The library shows "Made 3×" on cards and can sort by last made. An
Activity page under More shows the household feed. Cook mode's finish screen has a one-tap "Log that I made it".
Mealie keeps a per-recipe timeline with images; RecipeSage has no equivalent journal. Ours is a single table of events.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | One `timeline_events` table with `kind` made/comment/note | Separate comments and cook-log tables | [S1] |
| D2 | `lastMadeAt` and `madeCount` come from household-wide 'made' events; `recipe_user_data.last_made_at` is also set per user when `ratings` is on | Per-user only | [S1] |
| D3 | Photo is attached after the event is created (`POST /timeline/:id/image`) through the existing image pipeline | Multipart on create | [S2] |
| D4 | Edit by author only; delete by author or household owner | Anyone in the household | [S2] |
| D5 | Newest-first keyset pagination on (created_at, id) | Offset paging | [S2] |

## Data and API

Table `timeline_events` (id, household_id, recipe_id cascade, user_id set null, kind, text, image_id, rating snapshot,
created_at, edited_at). The rating snapshot is the author's rating at the time of a 'made' event when `ratings` is on.

- `GET /api/v1/recipes/:slug/timeline?cursor&limit`, `POST /api/v1/recipes/:slug/timeline {kind, text?, rating?}`
- `POST /api/v1/timeline/:id/image` (field `file`), `PATCH /api/v1/timeline/:id {text?, rating?}`, `DELETE /api/v1/timeline/:id`
- `GET /api/v1/timeline` household feed
- Recipe summaries gain `lastMadeAt` and `madeCount`; the library accepts `?sort=last-made`.

## UI

Timeline section with composer (text, photo, "I made this"), list with initials avatars, relative times, "Made it"
badge, thumbnails opening a Dialog, and an edit/delete menu. States: loading skeleton, empty text, error panel. With the
flag off, the section, finish-screen button, card line, sort option and `/activity` are all absent.

## Sources

- [S1] Cooking journal apps (per-recipe attempt history with dated photos, notes and a rating; timeline views): https://apps.apple.com/us/app/id6754804617 and https://mwm.ai/apps/ohako-recipe-notebook/6758757110
- [S2] Standard keyset pagination and attach-after-create upload patterns (our own existing recipe image route and list cursors).
