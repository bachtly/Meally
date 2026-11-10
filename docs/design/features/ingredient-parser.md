# Ingredient parser (F6, flag `ingredient-parser`)

## What it does

Turns a free-text ingredient line ("1 (14 oz) can tomatoes, drained") into quantity, optional max quantity (ranges),
canonical unit, food and note, and keeps the original text. Users can paste a whole ingredient list and have it split
into structured lines. Mealie ships an NLP (CRF) parser as an option; RecipeSage stores mostly free text. Ours is a small
deterministic rule-based parser in `@meally/shared`, so it runs on server and web alike with no model download.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Rule-based, deterministic parser (regex plus a unit table) | CRF or neural tagger trained on labelled ingredient lines | [S1] |
| D2 | Always keep `raw`; structured fields are a derived view, so a wrong parse never loses the user's text | Store only parsed fields | [S1] |
| D3 | Display fractions as unicode (⅓, 1½) for US units; metric shows decimals | Always decimals; always ASCII fractions | own reasoning |
| D4 | One shared unit table (`UNITS`) with a factor to a base unit, reused by scaling and conversion later | Per-feature unit lists | own reasoning |

Notes. CRF parsers need a labelled corpus (the NYT set has about 170k lines) and a Python or native runtime, and they
still need post-processing of quantities and units [S1]. Real recipe lines are dominated by a few shapes (quantity,
unit, food, comma note), which rules cover well, are explainable, and are easy to fix with one more test row. The cost is
brittleness on unusual phrasing; the user can always edit the result and `raw` is kept. Rule order: strip bullet, normalise
unicode fractions, read quantity (mixed number, fraction, decimal with dot or comma, range), optional parenthetical size,
longest-match unit lookup (case-sensitive `T`/`t`), then split notes at the first top-level comma and in parentheses.

## Data and API

No tables. `POST /api/v1/ingredients/parse` with `{ lines: string[] }` (max 500 lines of 1000 chars) returns
`{ parsed: ParsedIngredient[] }`. Requires auth and the `ingredient-parser` flag (404 when off).
Shared helpers: `parseIngredient`, `parseIngredients(text)` (paste-to-parse, tracks section headers), `isSectionHeader`,
`formatQuantity`, `UNITS`, `findUnit`.

## UI

Not in this PR. The web wiring (paste box in the recipe editor) comes later.

## Sources

- [S1] Improving Ingredient Parser, Mealie contributor guide (describes a CRF parser trained on the NYT data), https://mealie.io/contributors/guides/ingredient-parser/
