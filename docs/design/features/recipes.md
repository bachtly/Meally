# Recipes: data model, CRUD API, search and images (F2, F3 backend; core, no flag)

## What it does

Household members create, edit, list, search and delete recipes, and attach one photo each. Everything is scoped to the
household in the session; another household's recipe or image answers 404. This PR is server only; the UI follows.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | URLs use a slug (`/recipes/lemon-tart`), unique per household (`-2`, `-3` on collision). The slug is fixed at creation and does not change on rename, so links and bookmarks keep working. Ids are still returned. | Opaque id in the URL; slug that follows renames | Slugs are readable and shareable; stable slugs avoid broken links. |
| D2 | Ingredients are structured (quantity, unit, food, note, section) and the original line is always kept in `raw`. All structured fields are nullable, so an unparsed line is still a valid ingredient and a parser (later PR) can improve rows without losing the source text. Array order is the position. | Free text only; structured only | schema.org `recipeIngredient` is a list of plain strings, so `raw` maps to it directly [S1]. |
| D3 | Search uses a standalone FTS5 table (`recipes_fts`: name, description, ingredients) written by the recipes service in the same transaction as the recipe. Queries are tokenised into `"word"*` terms, ANDed, so prefix search works and user input cannot inject FTS syntax. A hand-written migration creates the virtual table. | Triggers; external-content table | The index text spans a parent and a child table, so triggers would need aggregation on every ingredient row change; they also do not backfill and are easy to get wrong [S2]. Doing it in the service keeps it in one transaction, testable, and independent of drizzle-kit's journal (which only tracks the migration file). Cost: any future code that writes recipes must go through the service. |
| D4 | Images: uploaded once, re-encoded to WebP at 320, 800 and 1600 px wide (fit inside, no upscaling, EXIF rotation applied, quality 80), stored in `$DATA_DIR/images/<householdId>/<imageId>-<size>.webp`. Max 10 MB, content sniffed by sharp (not only the MIME header). Served via an authenticated route with `private, max-age=1 year, immutable` since an id never changes. Replacing a photo creates a new id and deletes the old files. | Keep originals; one size | WebP is widely supported and smaller than JPEG; the three widths cover cards, the detail page and large screens [S3]. |
| D5 | List uses keyset cursor pagination on (sort key, id) with sorts `updated` (newest first), `created` (newest first) and `name` (A to Z, case-insensitive). | Offset pagination | Stable under inserts and deletes. |

## Data and API

Tables: `recipes` (unique `household_id` + `slug`), `recipe_ingredients`, `recipe_steps`, `images`, plus virtual
`recipes_fts`. Children cascade on recipe delete.

All routes need a session. Errors are `{error, message}`.

- `GET /api/v1/recipes?q=&sort=updated|name|created&cursor=&limit=` returns `{items: RecipeSummary[], nextCursor}`.
- `POST /api/v1/recipes` returns 201 with the Recipe.
- `GET|PUT|DELETE /api/v1/recipes/:slug`. PUT replaces fields, ingredients and steps in one transaction.
- `POST /api/v1/recipes/:slug/image`: multipart, field `file`. 413 over 10 MB, 415 for non-images.
- `GET /api/v1/images/:id/:size` where size is 320, 800 or 1600.

## UI

Not in this PR.

## Sources

- [S1] schema.org Recipe, https://schema.org/Recipe (recipeIngredient, recipeYield, prepTime, cookTime, totalTime)
- [S2] SQLite FTS5 extension, https://sqlite.org/fts5.html (external content and triggers, standalone tables, prefix queries)
- [S3] Common practice of 320/800/1600 responsive widths; no single authoritative source, chosen for card, detail and retina widths.
