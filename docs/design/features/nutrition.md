# Nutrition facts per serving (F20, flag `nutrition`, default off)

## What it does

A recipe can carry optional nutrition facts for one serving: calories, protein, carbohydrate, fat, saturated fat,
fibre, sugar and sodium, plus a free-text source. You type them in the editor, or they come in with a URL or file
import when the page has schema.org `nutrition`. The recipe page shows a label-style table, per serving and as a
total for the servings you have picked. JSON-LD export writes them back out. Nothing is calculated for you.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Manual entry and import only. No bundled food database and no automatic calculation from ingredients. | Ship a food DB; compute from parsed ingredients. | [S1] |
| D2 | Values are stored per serving, as one nullable JSON column on `recipes`, with a `source` text inside it. | Columns per nutrient; a separate table; per-recipe totals. | [S2] |
| D3 | The card shows "per serving" and a "total for N" column that follows the servings stepper. | Scale the per-serving numbers (wrong: they do not change with servings). | [S2] |
| D4 | Import parses schema.org strings ("240 kcal", "12 g", "1,5 g", "0.5 g" sodium as 500 mg) and drops values it cannot read. | Store raw strings. | [S2] |
| D5 | Flag off hides the editor fieldset and card, and the API ignores and omits the field. | Always on. | n/a |

Why no database: matching free-text ingredients to foods is unreliable, and a database adds licensing questions and
size. A wrong calorie count looks authoritative, so we only show numbers a person entered or a page published, and
label where they came from. USDA FoodData Central is the best candidate for a later opt-in lookup: USDA states the data
is public domain under CC0 1.0 and asks for credit, and its API is free with a key (1,000 requests per hour) [S1].
That would be a separate, opt-in feature that fills the manual fields, with the source set to "USDA FoodData Central".

Schema.org gives `calories`, `fatContent`, `saturatedFatContent`, `sodiumContent`, `sugarContent` and `servingSize` as
text values with units, which is why the importer parses units [S2]. Export writes `servingSize: "1 serving"`.

## Data and API

- Migration 0016: nullable JSON `recipes.nutrition` with keys `calories`, `proteinG`, `carbsG`, `fatG`,
  `saturatedFatG`, `fibreG`, `sugarG`, `sodiumMg`, `source`.
- `RecipeInput.nutrition`: omitted leaves it as is, `null` or an all-empty object clears it. `Recipe.nutrition` is
  present (object or null) only when the flag is on.
- Import (URL and files) maps `nutrition` when the flag is on; export adds a `NutritionInformation` node.

## UI

- Editor: a collapsible "Nutrition (per serving)" section with number inputs showing units, opened when values exist.
- Recipe page: a table with a per-serving column and a total column; it is hidden when no values exist or the flag is off.

## Sources

- [S1] FoodData Central, USDA, https://data.nal.usda.gov/dataset/fooddata-central-0 (public domain, CC0 1.0)
- [S2] NutritionInformation, schema.org, https://schema.org/NutritionInformation
