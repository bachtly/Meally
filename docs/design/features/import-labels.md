# Import entry labels (F5 follow-up, flags `import-url` and `ai`)

## What it does

Every way into `/recipes/import` used to say "Import from URL", even when the page also offers "From text" and
"From photos" (flag `ai` on). People who wanted to paste a recipe's text didn't expect to find it there. Now each
entry point names one source and opens its tab: "Import from a link", "Import from text", "Import from photos". With
`ai` off, only "Import from a link" shows. Plan to Eat's Add recipe menu works the same way, with separate items for
pasting a link, pasting text and taking a photo [S3].

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | One menu item per source in the "New recipe" menu and the command palette | One generic "Import a recipe" item (shorter, but the user still has to guess what's on the page) | [S1], [S2], [S3] |
| D2 | Labels are verb phrases that name the source: "Import from a link / text / photos". "Link" replaces "URL" | Keep "URL" (jargon for many users) | [S1], [S2] |
| D3 | `?from=text` or `?from=photos` selects the tab and switching tabs updates it (replace, not push). Anything else means the link tab. `?text=` stays the share-target fallback for a link | Reuse `?text=` (it already means "shared text that may hold a URL") | own reasoning |
| D4 | The empty library's button says "Import a recipe" when more than one source exists, and "Import from a link" otherwise | Three buttons in the empty state (crowded at 360 px) | own reasoning |

## Data and API

None. Web only.

## UI

`useImportOptions()` (`apps/web/src/features/import-url/importOptions.ts`) returns the visible options from the two
flags. The menu, the palette and the empty state read it. When `import-url` is off, none show, as before.

## Sources

- [S1] NN/g, "UI copy: UX guidelines for command names", https://www.nngroup.com/articles/ui-copy/ (specific verb
  phrases beat vague command labels)
- [S2] Apple HIG, Menus, https://developer.apple.com/design/human-interface-guidelines/menus (label menu items with
  a verb phrase that describes the action)
- [S3] Plan to Eat, "How do I add recipes using the app", https://learn.plantoeat.com/help/how-do-i-add-recipes-using-the-app
  (Add recipe offers paste link, paste recipe text and photo as separate choices)
