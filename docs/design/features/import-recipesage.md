# RecipeSage import (flag `import-files`)

Part of [import from files](import-files.md). RecipeSage is the first-class source; Paprika and Mealie are
labelled experimental.

## What RecipeSage exports (verified)

- Formats: **JSON-LD, plain text and PDF**. Only JSON-LD is re-importable. In the app: Side menu → Settings →
  Export Recipe Data. [Export docs](https://docs.recipesage.com/docs/tutorials/settings/export/),
  [JSON-LD import docs](https://docs.recipesage.com/docs/tutorials/settings/import/json-ld/).
- Read from the public source (`julianpoy/RecipeSage`, `packages/util/server/src/general/jsonLD.ts` and
  `queue/export/handlers/jsonldExportJobHandler.ts`) to learn the shape; nothing was copied.
- **One file**: `{ "recipes": [ <Recipe>, ... ] }`, `Content-Type: application/ld+json`. No zip. Images are not embedded.

| Field | Encoding | Meally |
|---|---|---|
| `name`, `description` | strings | name, description |
| `image` | array of URLs (the instance's image storage); import also accepts `data:image/png;base64` | first usable one; URL fetched via the SSRF-safe fetcher |
| `recipeCategory` | array of **label** names | **tags** |
| `comment` | `[{ "@type": "Comment", "name": "Author Notes", "text": ... }]` | notes |
| `aggregateRating` | `{ ratingValue: "4", bestRating: "5" }` (string) | rating |
| `creditText` | free-text source | note line `Source: ...` (unless it equals the link) |
| `isBasedOn` | source URL (may be empty) | sourceUrl |
| `recipeYield` | free string | yield text and servings |
| `prepTime` | **active time**; ISO 8601, or the raw free text when it could not be converted | prep minutes |
| `totalTime` | same | total minutes |
| `recipeIngredient` | plain strings; section headers are lines like `[Dressing]` | ingredient rows with `section` |
| `recipeInstructions` | `HowToStep {text}`; a section is a **sibling** `HowToSection {name}` with no `itemListElement` | steps with `section` |
| `nutrition`, `identifier`, `datePublished` | present | nutrition ignored for now; others ignored |

## Decisions

1. **Detection**: top-level `recipes` array of Recipe nodes (or Recipe nodes with `creditText` / an "Author Notes"
   comment) gives format `recipesage`; other JSON still uses the generic JSON-LD path.
2. **Labels become tags**, not categories: labels are free-form and a recipe has many, which is what tags are. Categories stay empty.
3. **Rating**: one 1-5 value. With the `ratings` flag on it becomes the importing user's rating; otherwise a
   `Rating in source: n/5` line is added to notes.
4. **Images**: at most 1 per recipe, 10 s per fetch (fetcher default), 120 s total per job; after that recipes import
   without photos. Any failure is ignored.
5. **Quirks handled**: sibling section headers (a generic mapper would drop them), `[Header]` ingredient lines,
   free-text times ("5 minutes"), empty `isBasedOn`, empty Author Notes, empty label arrays, free-text credit.
6. **Duplicates**: same name and source URL are skipped (existing rule).

## Not verified

Exact label text of the export page buttons beyond the documented menu path. Fixture
`apps/server/src/features/import-files/fixtures/recipesage-export.json` is invented content in the documented shape.
