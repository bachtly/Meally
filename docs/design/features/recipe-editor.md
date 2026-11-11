# Recipe editor (F2, core: no flag)

## What it does

`/recipes/new` and `/recipes/:slug/edit` share one editor: name, description, times (total auto-sums prep and cook until
edited), servings, yield, source URL, notes and a photo (drag-drop or pick, uploaded after save). Ingredients and steps
are lists of rows with section headers, drag-handle and menu reordering, and Cmd/Ctrl+S to save. Mealie's editor gives
each ingredient separate quantity, unit and food inputs; we keep one text line and parse it as you type.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | One text input per ingredient with a quiet parsed preview (quantity, unit, food, note chips). The parsed fields are saved next to `raw`, so the original wording is never lost. | Separate quantity, unit and food inputs per row (Mealie's approach): precise, but three controls per line are slow on a phone and truncate long unit names. | [S2] |
| D2 | `@dnd-kit` (core + sortable) for drag reorder, with the keyboard sensor, plus Move up/down in the row menu and Alt+Up/Down in the field. | react-beautiful-dnd: archived or in maintenance mode. Menu-only: no direct manipulation. | [S1] |
| D3 | Save bar: fixed above the tab bar on phones, in a sticky page header on desktop. Cmd/Ctrl+S everywhere. | Floating action button (hides content, hard to label); bottom bar on desktop (far from the title). | none needed |
| D4 | `useBlocker` + `beforeunload` for unsaved changes. This needs a data router, so the app now uses `createBrowserRouter`. | Custom link interception (misses back button). | n/a |

## Data and API

No new endpoints. Uses `POST /recipes`, `PUT /recipes/:slug` and `POST /recipes/:slug/image` (multipart). Blank rows are
dropped on save. A line that looks like a section header becomes one.

## UI

Loading skeleton and not-found states on the edit page; inline field errors and an alert summary; a discard dialog when
leaving with changes. Polish in this PR: prefix-active nav for `/recipes/*`, no duplicate search icon on desktop, an
overflow menu on the recipe page, per-recipe warm placeholder tints.

## Sources

- [S1] dnd-kit vs react-beautiful-dnd comparisons, https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026
- [S2] One-line text entry versus separate fields, https://github.com/ballggeasy/Recipe_app/pull/69 and https://github.com/robert-crump/Plantry/issues/77
