# Recipe library and recipe page (F2, F3, core: no flag)

## What it does

The library at `/recipes` is a card grid of the household's recipes with search, sort and cursor pagination ("Load
more"). Opening a card shows the recipe page, built for reading while cooking: photo, title, meta row, ingredients and
steps you can tick off, and notes. Delete asks for confirmation. Edit and import are placeholders until the editor PR.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Cards use a 4:3 photo (srcset 320/800) with a warm placeholder showing the initial. Grid is 2 columns on phones, 3 from 640 px, 4 from 1024 px and 5 from 1536 px; names clamp to 2 lines. | 1:1 or 16:9 crops; list view | Food photos are usually landscape, so 4:3 crops least. Placeholder keeps the grid even. |
| D2 | Recipe page is reading-first: ingredients first on phones; at 1024 px and up, ingredients sit in a sticky left column and steps on the right. | Tabs for ingredients/steps; ingredients inline above steps on desktop | [S1] puts ingredients at the top and values checkboxes; [S2] suggests a sticky ingredients panel on desktop. |
| D3 | Ingredient and step ticks are saved per recipe in `localStorage` (`meally:checks:<slug>`, try/catch, memory-only fallback) with a Reset button. | Server-side state; session-only | Ticks persist across reloads in similar apps [S2]. They are a per-device convenience, so no server state or sync. |
| D4 | Desktop top bar has a real search field ("Search recipes", Ctrl K hint) that debounces 250 ms into `?q=`. On small screens the search icon opens the command palette, which also searches recipes. | Icon only everywhere; expanding icon | [S3] recommends an open text field on desktop and hiding it behind an icon only on small screens. |
| D5 | "Load more" button instead of infinite scroll. | Infinite scroll | Keeps the footer and tab bar reachable, and is simpler to test and make accessible. |

## Data and API

No new endpoints. Uses `GET /recipes?q&sort&cursor&limit`, `GET/DELETE /recipes/:slug`. Sort values: `updated`,
`name`, `created` (shown as "Newest"). `npm run seed -w apps/server` creates `demo@meally.local` / `demo-password` with
6 recipes.

## UI

- `/recipes`: loading skeleton cards, empty state (New recipe, plus Import from URL when `import-url` is on), "No
  results" for a search, error with retry.
- `/recipes/:slug`: loading, not-found and error states; toolbar with Edit and Delete (confirm dialog, toast, back to
  the library).
- Ctrl/Cmd+K focuses the field on desktop and opens the palette on small screens.

## Sources

- [S1] SideChef, User Experience Best Practices for Recipe Platforms, https://www.sidechef.com/business/recipe-platform/ux-best-practices-for-recipe-sites
- [S2] Cook mode / checklist issues in open-source recipe apps, e.g. https://github.com/usernode-bot/recipebot-33b169/issues/116
- [S3] NN/g, The Magnifying-Glass Icon in Search Design, https://www.nngroup.com/articles/magnifying-glass-icon/
