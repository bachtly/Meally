# Design system and app shell (roadmap PR 4, always on)

## What it does

Tokens, themes, a small component set and the app shell. Phone first: a bottom tab bar below 1024 px and a left
sidebar from 1024 px up. One warm tomato accent, calm surfaces, light and dark themes. Everything is our own code on
Radix primitives. Follows U1, U5 and U7 in `01-research.md` (U1 phone first, U7 calm and one accent).

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Bottom tab bar on mobile (Recipes, Plan, Shopping, More), sidebar on desktop. Four items; overflow goes under More. | Hamburger drawer | [S1] |
| D2 | OKLCH colour tokens as CSS variables, mapped into Tailwind with `@theme inline`. Dark theme keeps hue and changes lightness and chroma. `prefers-color-scheme` by default, `[data-theme]` on html overrides it. | HSL or hex tokens | [S2] |
| D3 | Sheets (bottom sheet on phones, side panel on desktop) for forms; centred Dialog only for short confirmations. | Modals everywhere | U1 |
| D4 | Inter Variable via `@fontsource-variable/inter`, bundled by Vite, no runtime font CDN (works offline). | Google Fonts, system stack | n/a |
| D5 | Command palette with `cmdk`, nav commands only for now. Opened from the top-bar search button. | Search page only | n/a |

Evidence notes: [S1] says hidden navigation hurts discoverability and bottom nav suits 3 to 5 destinations (secondary
reports; NN/g numbers not verified). [S2] practice: fix hue and chroma, vary lightness for dark mode.

## Contrast (WCAG, computed from the OKLCH values in `theme.css`)

| Pair | Light | Dark |
|---|---|---|
| text on surface | 16.6:1 | 16.3:1 |
| text-muted on surface (sunken / raised) | 6.9:1 (6.3) | 7.3:1 |
| accent-contrast on accent | 5.8:1 | 7.6:1 |
| accent-contrast on accent-hover | 7.4:1 | 9.3:1 |
| accent on surface | 5.95:1 (raised) | 7.8:1 |
| danger on sunken | 5.8:1 | 7.4:1 |
| success on sunken | 5.4:1 | 9.0:1 |

All meet AA (4.5:1) for text.

## UI

Components in `apps/web/src/ui/`: Button, IconButton, Input, Textarea, Label, Field, Card, Badge, Skeleton,
EmptyState, Dialog, Sheet, DropdownMenu, Tabs, Toast (own, `useToast`), ThemeToggle (saved in localStorage, guarded).
Shell in `apps/web/src/app/`. Nav items with a feature flag are hidden when the flag is off. `/ui` is a dev-only gallery.

## Sources

- [S1] Bottom Navigation Pattern On Mobile Web Pages, Smashing Magazine, https://smashingmagazine.com/2019/08/bottom-navigation-pattern-mobile-web-pages
- [S2] OKLCH, explained for designers, https://uxdesign.cc/oklch-explained-for-designers-dc6af4433611
