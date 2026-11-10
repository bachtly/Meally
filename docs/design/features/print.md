# Print view (F21, flag `print`)

## What it does

A recipe's overflow menu has "Print", which opens `/recipes/:slug/print`: a standalone page with no app chrome that
keeps `?servings=&units=`, so a scaled recipe prints as scaled. It opens the print dialog on load; "Print again" and an
"Include photo" toggle sit in a toolbar that is hidden in the printout. Ctrl+P on the normal recipe page also gives a clean result.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Dedicated print route plus `@media print` rules on the normal page | Only a print stylesheet | [S1] |
| D2 | Black on white, serif, 11 pt, `@page` margin 15 mm (fits A4 and Letter); no fixed paper size | Force A4 | [S1] |
| D3 | `break-inside: avoid` on steps and ingredients; two ingredient columns when over 8 lines | Single column | [S1] |
| D4 | Print the source URL in full as text; no QR code | QR of share link | [S1] |
| D5 | Servings meta shows the current value with a muted "(of N)" | Hide it | n/a |

Display polish shipped alongside: simple English pluralisation of count or unit-less foods when quantity > 1 (display
only), and coarse US oz and lb rounding.

## Data and API

None.

## UI

Print page states: loading skeleton, error, flag off (route falls back to the standard feature-off message).

## Evidence changed

None contradicts a decision. Searches found little for D2 to D5: 11 pt serif, 15 mm margins, two columns over 8
lines, no QR and the "(of N)" servings text are our own design judgment, not source-backed.

## Sources

Searched 2026-11-11. "(page)" = fetched and read; "(snippet)" = search summary only.

- [S1] Printing, MDN (page, first 100k chars): https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_media_queries/Printing . Supports D1: `@media print` rules, hiding chrome, `@page` sets dimensions, orientation and margins. It does not cover `break-inside`.
- [S2] break-inside, MDN mirror (snippet): https://docs.w3cub.com/css/break-inside . Supports D3: `avoid` value. Mirror, not MDN itself.
