# Shopping lists (F13, flag `shopping-lists`)

## What it does

A household keeps any number of shopping lists. Items are typed as free text (parsed into quantity, unit and food) or added from a recipe or a date range of the meal plan. Items that repeat are merged into one line. Items are grouped by store aisle, and the app remembers which aisle each food belongs in. Everyone in the household sees changes live. This note covers the server half; the web UI comes in a later PR.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Merge into an existing unchecked item with the same normalised food when the units convert (mass to mass, volume to volume, identical count units). The result keeps the existing item's unit system and is re-expressed in a friendly unit. Otherwise keep a separate line. | Always keep separate lines; convert everything to metric | none needed (product choice) |
| D2 | Aisle memory: setting an item's aisle stores `(household, normalised food) -> aisle` in `food_aisles`; every later add of that food (any list, any source) gets it. Clearing the aisle forgets it. | Per-list only; a global food catalogue | none needed |
| D3 | Live sync over Server-Sent Events (`GET /lists/:id/events`) from an in-process bus. Events carry only a type; clients refetch the list. | WebSockets; polling | [S1] [S2] |

### Merge rules

- Food key: lower-case, collapsed spaces, crude singular ("Onions" and "onion" match; words ending in "ss" or "us" are left alone).
- Candidates are unchecked items only, so a checked item stays as a record of what was bought.
- `mergeQuantities(a, b)` in `packages/shared/src/units/convert.ts`: both quantities present, and `b`'s unit converts to `a`'s via the `UNITS` factors (same kind, not count-like). A missing quantity only merges with another missing quantity and the same unit ("salt" with "salt").
- The total is re-expressed by `friendlyAmount`: the largest unit in the same system where the value is at least 1 (ml/l, tsp/tbsp/cup/quart/gallon, g/kg, oz/lb). 1 cup + 250 ml gives about 2.06 cups; 500 g + 700 g gives 1.2 kg.
- Recipe quantities are scaled by `servings / recipe.servings` first (no scaling when either is missing). Contributing recipes are recorded in `recipe_refs` as `{slug, name}`, de-duplicated.
- Items with no parsed food (unparseable text) are never merged.

### SSE vs WebSocket vs polling

Clients mostly read a list and send changes as ordinary HTTP requests, so a one-way push channel is enough. SSE runs over plain HTTP (works with the existing cookie auth and reverse proxies) and reconnects by itself. WebSockets add bidirectional traffic we do not need, plus stateful connections and harder scaling. Polling is the simplest but is either laggy or wasteful for a list two people edit in a shop. A single self-hosted process means an in-memory bus is sufficient; a multi-process deployment would need a broker. The stream sends `ready` on connect and a `ping` every 25 s so proxies do not close an idle connection. Subscriptions are keyed by household and list, and the route 404s for lists of other households.

## Data and API

Tables: `shopping_lists`, `shopping_items` (`aisle` is an aisle label id, `recipe_refs` is JSON), `aisle_labels` (seeded with Produce, Bakery, Dairy & eggs, Meat & fish, Pantry, Spices, Frozen, Drinks, Household, Other on first use), `food_aisles`.

All under `/api/v1/shopping`, behind auth and the flag:

- `GET|POST /lists`, `GET|PATCH|DELETE /lists/:id` (GET returns `{list, items}`)
- `POST /lists/:id/items {text}`, `PATCH|DELETE /lists/:id/items/:itemId` (`checked`, `text`, `aisle`, `position`), `POST /lists/:id/clear-checked`
- `POST /lists/:id/add-recipe {slug, servings?}`, `POST /lists/:id/add-meal-plan {from, to}` (at most 62 days)
- `GET|POST /aisles`, `PATCH|DELETE /aisles/:id`, `PUT /aisles/order {ids}`
- `GET /lists/:id/events` (SSE: `ready`, `items`, `list`, `deleted`, `ping`)

## UI

Not part of this PR.

## Sources

- [S1] WebSockets vs Server-Sent Events vs Polling: When to Use Which, https://dev.to/weatherclockdash/websockets-vs-server-sent-events-vs-polling-when-to-use-which-5g6c
- [S2] SSE vs. WebSockets vs. Polling: Choosing a Real-Time Transport, https://www.back4app.com/glossary/sse-vs-websockets-vs-polling/
