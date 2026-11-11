# Meal planner web (F12 web half, flag `meal-plan`)

## What it does

`/plan` shows one week at a time (Monday start) with the four meal slots. People add recipes or free-text notes,
move or remove them, ask for a suggestion, push the week's ingredients to a shopping list and subscribe to the plan
in their calendar app. Server half: `docs/design/features/meal-plan.md` (PR #13).

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | A week view is the only view: a vertical list of day cards on phones, a 7-column grid with meal-type rows from 1024 px. No month calendar. | Month grid; switchable week/month | [S1] open-source planners converge on week-first with the month only as a date jump; mixing month and week start days confuses people. |
| D2 | Drag and drop with dnd-kit only on desktop, through a visible grip handle. Phones and keyboard users get the entry menu (Move to day, Change meal, Remove). Drops PATCH `date` and `mealType`. | Touch drag on phones; no drag at all | [S2] the keyboard sensor needs a focusable activator, and its default 25 px steps are coarse for big cells, so the menu is the accessible primary path and drag is a desktop shortcut. |
| D3 | Suggestions live in the Add sheet: "Surprise me" shows one suggestion with Accept / Another. Rules sit in a separate small sheet; tag and category pickers show only when `organizers` is on. | Auto-fill the whole week | Keeps the person in control; one tap to accept, one to reroll. |
| D4 | The week constant is `WEEK_START = 1` in `dates.ts`. Dates are plain `YYYY-MM-DD` strings, computed in the local timezone for "today". | Date objects | Matches the API and avoids timezone drift. |

## UI

- Header: ‹ This week › and the week label; actions: Add week to shopping list (only with `shopping-lists`),
  Subscribe in calendar (URL with Copy and Rotate), Suggestion rules.
- Slots with no entries are hidden on phones; desktop always shows all four rows as drop targets. Today is
  highlighted. States: skeleton while loading, retry on error, a hint when the week is empty.
- The recipe page menu has "Add to plan" (only with `meal-plan`) which opens the same sheet with the recipe chosen.

## Sources

- [S1] Planner on a phone: week board, month calendar (mealprep PR 117), https://github.com/matthieujgagnon/mealprep/pull/117 and
  Weekly calendar UI patterns, https://envydesign.jp/patterns/en/calendar-week/
- [S2] dnd-kit accessibility guide, https://dndkit.com/legacy/guides/accessibility/
