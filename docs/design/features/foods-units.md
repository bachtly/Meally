# Foods and units catalogue (F7, flag `foods-units`)

## What it does

Each household gets a catalogue of foods and custom units. Saving a recipe links every ingredient's food to a catalogue
food, creating it when missing. From a management page you can rename a food, give it aliases, set its default aisle,
merge duplicates ("spring onion" into "scallion") and delete unused ones. Custom units sit beside the read-only
built-ins. Mealie and RecipeSage keep similar lists; ours matches by name, plural or alias, and feeds the parser and the
shopping list. Depends on `ingredient-parser`.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Link on save by case-insensitive name, plural or alias; create when missing. | Fuzzy matching with suggestions. | [S1] |
| D2 | Merge records the absorbed spellings as aliases, so future saves and parses resolve to the target. Raw lines stay untouched; only the structured `food` text and `food_id` change. | Plain delete and relink, losing the old spelling. | [S1] |
| D3 | Delete is refused with 409 while in use; `?force=1` unlinks (ingredient text is kept). | Always cascade. | [S1] |
| D4 | The parser stays pure: `parseIngredient(line, vocab?)` takes optional household foods and units. | Server-side post-processing. | |
| D5 | Shopping uses the catalogue name for linked ingredients, so differently spelled foods merge. No new shopping columns. | A `food_id` on items. | |

## Data and API

Tables: `foods` (id, household_id, name, plural_name, aliases JSON, aisle_id, created_at), `custom_units` (id,
household_id, key, name, plural, abbreviation, kind, factor), and a nullable `recipe_ingredients.food_id` (set only
while the flag is on). Custom unit keys are `c-<slug>` and never change on rename.

- `GET /api/v1/foods?q` list with usage counts; `POST`; `PATCH /:id {name, pluralName, aliases, aisleId}`;
  `DELETE /:id[?force]`; `POST /:id/merge {into}`. Duplicate spellings give 409.
- `GET /api/v1/units` (custom first, then built-ins with `builtIn: true`); `POST`; `PATCH /:id`; `DELETE /:id[?force]`.
- `POST /ingredients/parse` uses the household vocabulary when the flag is on.

## UI

`/foods`, linked from More and Settings, shown only with the flag. Foods tab: search, add, inline rename, alias chips,
aisle picker (when shopping lists are on), merge dialog, delete dialog. Units tab: custom units with add, edit and
delete; built-ins shown with a "Built-in" badge. Loading skeletons, empty and error states throughout.

## Sources

- [S1] Patterns from open-source issues on ingredient identity: keep absorbed names as aliases, leave raw text alone,
  suggest rather than auto-merge when unsure. https://github.com/holgerkrupp/MealPlan/issues/14
