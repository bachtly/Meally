# Design system and app shell (roadmap PR 4, always on)

## What it does

Tokens, themes, a small component set and the app shell. Phone first: a bottom tab bar below 1024 px and a left
sidebar from 1024 px up. One olive accent from the Koi logo (bronze and cream around it), calm surfaces, light and dark themes. Everything is our own code on
Radix primitives. Follows U1, U5 and U7 in `01-research.md` (U1 phone first, U7 calm and one accent).

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Bottom tab bar on mobile (Recipes, Plan, Shopping, More), sidebar on desktop. Four items; overflow goes under More. | Hamburger drawer | [S1] |
| D2 | OKLCH colour tokens as CSS variables, mapped into Tailwind with `@theme inline`. Dark theme keeps hue and changes lightness and chroma. `[data-theme]` on html picks the theme (dark by default, D7); "System" removes it and falls back to `prefers-color-scheme`. | HSL or hex tokens | [S2] |
| D3 | Sheets (bottom sheet on phones, side panel on desktop) for forms; centred Dialog only for short confirmations. | Modals everywhere | U1 |
| D4 | Inter Variable via `@fontsource-variable/inter`, bundled by Vite, no runtime font CDN (works offline). | Google Fonts, system stack | n/a |
| D5 | Command palette with `cmdk`, nav commands only for now. Opened from the top-bar search button. | Search page only | n/a |
| D7 | Dark is the default theme (owner decision, 14 Nov 2026, #98). Settings still offers Light, Dark and System, and "System" is now stored like the others. The default is applied at startup but not saved, so changing it later reaches everyone who never picked. `index.html` ships `data-theme="dark"` and the dark `theme-color`, and the PWA manifest uses the dark surface, so there is no cream flash. | Follow the system setting (the old default) | [S4] [S5] advise following the system setting by default, and [S6] notes that some people with low vision rely on it. We go against that on purpose: with the Snap screens dark, a dark default makes the app one palette. The System choice stays one tap away in Settings. |
| D6 | Koi palette and logo (2026-11-11): olive accent (light `oklch(0.5 0.1 122)` with white labels, dark `oklch(0.78 0.13 120)` with dark labels), cream surfaces at hue 75 to 95, success at hue 162 so it reads apart from the brand green, crimson danger at hue 25. A softer two-layer shadow. The Koi cat is the app icon, favicon and the mark beside the wordmark (`ui/Brand.tsx`). | Tomato, Saffron, Nah (ginger) palettes; current rust | Chosen from the palette shortlist (artifact "Meally Palette Options"), where colours were sampled from the logo. The old rust read brown next to food and sat 13° from danger red. Container and on-container roles from [S3]. |

Evidence notes: [S1] says hidden navigation hurts discoverability and bottom nav suits 3 to 5 destinations (secondary
reports; NN/g numbers not verified). [S2] practice: fix hue and chroma, vary lightness for dark mode.

## Contrast (WCAG, computed from the OKLCH values in `theme.css`)

| Pair | Light | Dark |
|---|---|---|
| text on surface | 16.6:1 | 16.2:1 |
| text-muted on surface (sunken / raised) | 6.5:1 (6.0 / 6.8) | 8.5:1 (8.8 / 7.6) |
| accent-contrast on accent | 5.8:1 | 9.3:1 |
| accent-contrast on accent-hover | 7.6:1 | 10.9:1 |
| accent on surface (raised) | 5.6:1 (5.8) | 9.7:1 (8.7) |
| danger on surface | 6.3:1 | 7.2:1 |
| success on surface | 5.9:1 | 9.9:1 |

All meet AA (4.5:1) for text.

## UI

Components in `apps/web/src/ui/`: Button, IconButton, Input, Textarea, Label, Field, Card, Badge, Skeleton,
EmptyState, Dialog, Sheet, DropdownMenu, Tabs, Toast (own, `useToast`), ThemeToggle (saved in localStorage, guarded).
Shell in `apps/web/src/app/`. Nav items with a feature flag are hidden when the flag is off. `/ui` is a dev-only gallery.

## Sources

- [S1] Bottom Navigation Pattern On Mobile Web Pages, Smashing Magazine, https://smashingmagazine.com/2019/08/bottom-navigation-pattern-mobile-web-pages
- [S2] OKLCH, explained for designers, https://uxdesign.cc/oklch-explained-for-designers-dc6af4433611
- [S3] Android colour roles (container and on-container), https://developer.android.com/design/ui/mobile/guides/styles/color
- [S4] Apple Human Interface Guidelines, "Dark Mode". https://developer.apple.com/design/human-interface-guidelines/dark-mode
- [S5] Chrome for Developers, "Dark mode toggles". https://developer.chrome.com/docs/modern-web-guidance/guides/ui-components/dark-mode-toggle
- [S6] Nielsen Norman Group, "Dark Mode: How Users Think About It and Issues to Avoid". https://nngroup.com/articles/dark-mode-users-issues
