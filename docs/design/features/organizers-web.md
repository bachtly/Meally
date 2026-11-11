# Organisers web (F9, flag `organizers`)

## What it does

Recipes can be tagged, categorised and linked to tools. The editor has three combobox multi-selects, the recipe page
shows a chip row, the library has a scrollable filter bar plus a Filters sheet, and `/organizers` manages names
(rename, delete, merge). Everything is hidden when the flag is off. Server API: PR #11.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Category chips sit in a horizontally scrolling bar; tags and tools (long lists) go in a Filters sheet with counts | Sidebar collapsed to an accordion; one chip per facet | [S1] |
| D2 | The sheet applies filters live (URL updates as you tick) and offers Done and Clear all | Confirm-before-apply | [S1] says confirm suits sheets, but the URL is the state here and live results keep deep links and back-button behaviour simple. Revisit if it feels jumpy. |
| D3 | Tagging uses a custom ARIA 1.2 combobox (chips, typeahead, "Create 'x'"); the list stays open after picking in design systems, ours closes on pick | cmdk, Radix Popover | [S1]; no new dependency, and the inline listbox avoids portal and focus issues |
| D4 | Filters live in the URL as repeated `tag`, `category` and `tool` params next to `q` and `sort`; OR within a type, AND across types | Local state | Matches the server API |

## UI

- Library: Filters button plus category chips (toggle, `aria-pressed`), active filters as removable chips with Clear all.
  Loading shows a skeleton; empty results show "No recipes match these filters."
- Manage page: tabs, rows with counts, an actions menu (Rename inline, Merge into... picker, Delete confirm).
- Flag off: no chips, no filters, no pickers, `/organizers` route is gated, no organiser requests are made.

## Sources

- [S1] Mobile search filter and chip guidance (search results, vendor design systems), https://digitalthriveai.com/en-au/resources/web-design/best-practices-mobile-search-filter/ and https://designsystem.vismaspcs.se/development/documentation/docs/combobox-multi-select/
