# Import from URL, web (F5, flag `import-url`)

## What it does

`/recipes/import` takes a recipe link, shows what was found, and saves it or opens the editor. Mealie and RecipeSage
both import from a URL; ours previews first so a bad extraction is caught before it lands in the library.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Preview before save: Fetching, then a compact card (title, image, ingredients, steps) with "Save recipe" and "Edit before saving" | Save directly and fix afterwards (fewer taps, but junk recipes to delete) | own reasoning |
| D2 | "Save recipe" posts the URL to `/import/url`, which refetches. The image is imported only on this path; "Edit before saving" opens the editor with the text fields and no photo | Pass the remote image through the editor (needs a server-side image fetch endpoint) | own reasoning |
| D3 | `/recipes/import?url=...` pre-fills and auto-starts the preview. `text` is read as a fallback and the first http(s) link in it is used | `url` only | [S1] |
| D4 | A bookmarklet link (`javascript:` that opens `/recipes/import?url=` plus the current address) is shown on the page. A PWA `share_target` can use the same route later | Browser extension (heavier) | [S1] |

Notes. Share targets declared with GET pass `title`, `text` and `url` as query parameters, and Android often puts the
link in `text` rather than `url` [S1]. Share targets only work for an installed PWA, so the manifest entry is deferred
until the PWA PR. The editor gets an `initial` prop that pre-fills a new, unsaved recipe.

## UI

Single large URL field, Paste from clipboard (only when the Clipboard API exists) and Import. Errors: `blocked_url`,
`no_recipe_found` (with "Create it manually"), `fetch_failed`, rate limit. The library's "New recipe" becomes a menu
(Write from scratch, Import from URL) when the flag is on; the import item and the command palette action are hidden
when it is off, and the route shows the feature-off page.

## Sources

- [S1] MDN, share_target, https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target ; Android `text` fallback: https://martin.hjartmyr.se/articles/pwa-web-share-target-android/
