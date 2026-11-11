# Scaling and unit conversion (F8, flag `scaling`)

## What it does

On the recipe page the cook can change the number of servings (stepper, or tap the number and type) and switch the
units between Original, Metric and US. Ingredient quantities re-render with friendly units and the choice lives in the
URL (`?servings=6&units=metric`), so a shared link keeps it. "Add to shopping list" uses the chosen servings. All of
this is client-side and stateless: the stored recipe is never changed. Steps are not rewritten.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Friendly units: pick the largest unit in the target system where the amount is at least 1 (a cup from 1/4 up), so 48 tsp becomes 1 cup and 1000 g becomes 1 kg. Small metric volumes stay in ml. Count units and unparsed lines only have the quantity scaled. | Always keep the original unit; always use the smallest unit | [S1] |
| D2 | Convert from the exact factors in `UNITS` (cup = 236.588 ml) and round once, at the end, to a measurable amount: ml to 0.5 below 20, 1 below 50, else 5; g to 1 below 50, else 5; kg and l to 2 decimals. | Treat a cup as 240 or 250 ml; round each step | [S1] |
| D3 | US amounts snap to eighths and thirds and display as fractions through `formatQuantity` (1½ cups, ⅓ cup). Metric amounts show decimals (2.5 ml). Ranges scale and convert both ends. | Decimals everywhere | [S1] |
| D4 | Steps text is not rewritten. A note says "Quantities in steps aren't scaled." | Rewrite numbers found in step text | below |
| D5 | State in the URL with `replace`, not in storage. Servings equal to the original are omitted. | localStorage; server-side | |

Why steps are not rewritten: step text is free prose. "Bake at 180 degrees for 20 minutes", "step 2" and "1 cup" look
alike to a regex, and a wrong silent rewrite is worse than a visible note. Ingredients are structured (quantity, unit,
food), so only they are scaled. Lines with no quantity or no parsed food keep their original text.

Cups to grams is ingredient dependent (flour about 120 g, sugar about 200 g), so we never convert between volume and
mass; the toggle only converts within the same kind.

## Data and API

None. Shared exports `scaleIngredient`, `convertIngredient`, `adjustIngredient` (both in one step, one rounding) and
`formatIngredient` from `packages/shared/src/units/scale.ts`.

## UI

Servings stepper (minus, number input, plus; "Reset servings" when it differs) and a Original/Metric/US segmented
radio group sit under the meta row. Changed quantities get a subtle background. A recipe with no servings shows only the
units toggle. With the flag off, nothing renders and URL parameters are ignored.

## Sources

- [S1] Kitchen conversions and recipe scaling guides: https://toolarithm.com/blog/kitchen-conversions, https://recipecard.io/recipe-unit-converter/
