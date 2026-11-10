# Shopping lists, web (F13, flag `shopping-lists`)

## What it does

The web half of shopping lists (server: [shopping-lists.md](shopping-lists.md)). A lists overview, a list view
built for use in a shop (aisle groups, big checkboxes, checked items sink), a quick-add box that previews how the text
parses, live sync between household members, an aisle editor, and an "Add to shopping list" action on recipe pages.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Checked items sink into a collapsible "In the cart" section at the bottom, open by default, with "Clear checked". | Hide checked items; leave them in place struck through. | [S1] reports that apps commonly sink checked items, and that hiding them in a collapsed section made users think they were deleted. So the section is open by default and shows a count. |
| D2 | Unchecked items are grouped under aisle headings in the household's aisle order, with "No aisle" last. Empty groups are not shown. | One flat list; sort by recipe. | [S1]: aisle grouping is the core of shopping mode; a stable fallback group keeps unknown items visible. |
| D3 | The whole row toggles the item (the checkbox sits inside a `<label>`); the row menu is a separate 44 px button. Checkbox is 28 px inside a 56 px tall row. | Tap only the checkbox. | [S2]: WCAG 2.2 AA needs 24 px and 44 px is the platform and AAA norm. Full-width rows are the easiest way to be one-handed friendly. |
| D4 | Updates are optimistic (toggle, edit, aisle, delete, clear) with rollback; adding waits for the server, which does the parsing and merging. SSE events and reconnects only invalidate queries. | Local-only parse and add. | Server merging makes a local guess wrong. |

## UI

- `/shopping`: cards (name, items left, updated). A lone list opens directly. New, rename and delete are in dialogs.
- `/shopping/:id`: sticky add box with a preview (quantity, unit, food, note), aisle groups, the cart, a "Live" dot, an
  Aisles sheet (rename, add, delete, move up/down), and a row menu (Edit text, Set aisle, Delete). Recipe refs show as a
  muted "From <recipe>" line.
- Recipe page: the action is inside `<Feature on="shopping-lists">`. It picks a list (or creates one), has a servings
  stepper, and toasts "Added N items" with "View list".
- States: skeletons, empty, error and not-found on each view; the route is behind `<FeatureRoute>`.

## Sources

- [S1] Practice from shopping-list projects: https://github.com/pendolohq/scrappy-meals/issues/141 and https://birdeye.com/blog/google-shopping-list/
- [S2] WCAG 2.5.8 Target Size (Minimum): https://wcag22aa.org/new-criteria/target-size/
