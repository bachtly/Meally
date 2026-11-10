# Meally: research

Light research behind the architecture decisions (A1-A9 in [03-architecture.md](03-architecture.md)) and the UI
direction. Searches ran in November 2026 through a search tool that often returns only summaries. A finding marked
(snippet) rests on a search summary I did not open. (judgement) marks my own reasoning. Direct user complaints were
hard to find, so section 1 is thinner than we wanted.

## Sources

- [S1] Mealie PR #7091, ingredient add form moved to a bottom drawer on mobile: https://www.github.com/mealie-recipes/mealie/pull/7091
- [S2] Mealie bug about ingredient quantities not stored on the PWA (#2926): https://github.com/mealie-recipes/mealie/issues/2926
- [S3] r/selfhosted thread on Recipya, where a Mealie developer says UI/UX is the hardest part: https://redlib.hackliberty.org/r/selfhosted/comments/18wy55c/introducing_recipya_the_clean_recipe_manager/l607ip8/
- [S4] r/selfhosted thread on a newer app, with a commenter who lost interest in Mealie: https://reddit.sentinel-team.org/posts/1pqu7ov/snapshots/2025-12-20T08%3A10%3A44.996769Z
- [S5] RecipeSage Clip Tool reviews (editor removed by Manifest v3, restored in 2.1): https://addons.mozilla.org/addon/recipesage/reviews
- [S6] RecipeSage FAQ: https://docs.recipesage.com/docs/tutorials/faq/
- [S7] Mela on the App Store: https://apps.apple.com/gb/app/id1548466041
- [S8] Pestle on the App Store and r/apple launch thread: https://apps.apple.com/in/app/id1574776971
- [S9] Samsung Food on the App Store: https://apps.apple.com/gb/app/id1133637674
- [S10] Plan to Eat comparison with Samsung Food: https://www.plantoeat.com/?p=9210
- [S11] web.dev, Screen Wake Lock in all browsers: https://web.dev/blog/screen-wake-lock-supported-in-all-browsers
- [S12] Chrome docs, Screen Wake Lock: https://developer.chrome.com/docs/capabilities/web-apis/wake-lock
- [S13] Fastify benchmarks: https://github.com/fastify/benchmarks
- [S14] Better Stack, Fastify vs Express vs Hono: https://betterstack.com/community/comparisons/fastify-vs-express-vs-hono
- [S15] SQLite WAL documentation: https://www.sqlite.org/wal.html
- [S16] OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- [S17] shadcn/ui Tailwind v4 docs: https://ui.shadcn.com/docs/tailwind-v4
- [S18] Drizzle SQLite quick start: https://orm.drizzle.team/docs/quick-sqlite
- [S19] Mealie repository (AGPL-3.0): https://github.com/mealie-recipes/mealie
- [S20] RecipeSage repository README (licence section): https://www.github.com/julianpoy/RecipeSage
- [S21] LinuxLinks on RecipeSage (dual licence summary): https://www.linuxlinks.com/recipesage/

## 1. Complaints about Mealie and RecipeSage

Caveat: searches did not surface a thread titled "the recipe page is cluttered". These are weaker signals than we
hoped.

1. **Mobile data entry was painful enough to need a rework.** A change moved the ingredient add form into a bottom
   drawer on mobile. The reviewer called it "a huge improvement" and said two stacked search and food icons clutter
   the form. [S1] (snippet)
2. **Even maintainers say early UX decisions were poor.** A Mealie developer says UI/UX is the hardest part of recipe
   managers and that working with a UX specialist showed many earlier choices were wrong. [S3] (snippet)
3. **Users drift to newer apps because of looks.** A commenter on a new app's launch says its UI looks inviting and
   that they had lost interest in Mealie. [S4] (snippet)
4. **The ingredient editor needed repeated fixes.** The commit history shows reworks of the ingredient editor and of
   creating units and foods inside it. (judgement; no user quote)
5. **Mobile entry bugs reach the PWA.** An issue reports ingredient quantities not being stored on the PWA. [S2]
   (snippet)
6. **RecipeSage:** no Reddit or issue complaints about layout turned up. The visible friction is in the browser
   extension, where the in-page editor was removed for Manifest v3 and later restored. [S5] (snippet) Its FAQ points
   mobile users to the browser or an installed PWA. [S6]

What we take from it (judgement): ingredient entry on a phone, and a calm first impression, are where existing apps
lose people. U1, U5 and U7 below address these. Before the recipe page PR, do a short manual look at both demos.

## 2. What well-liked apps do

- **Mela:** cook mode with a larger font readable from a distance, several recipes open at once, a grocery list with
  checkboxes. [S7] (snippet)
- **Pestle:** step-by-step cook mode, timers, and hands-free "Next" by voice. [S8] (snippet)
- **Paprika:** shows ingredients and steps side by side in landscape. [S8] r/apple thread (snippet)
- **Samsung Food:** shopping list organised by aisle, scaling and unit switching, 4.8 stars on 6.1K reviews. Plan to
  Eat is rated more customisable for lists. [S9][S10] (snippet)
- **Crouton, and Paprika's keep-awake and checkbox behaviour:** not confirmed by search. Treat as unknown.
- **Wake Lock:** `navigator.wakeLock.request("screen")` is Baseline since 2025 (Chrome and Edge 84, Safari 16.4,
  Firefox 122 or 126, sources disagree). It needs HTTPS and has failed in iOS home-screen web apps. Feature-detect
  and fail quietly. [S11][S12] (snippet)

### UI principles for later PRs

- **U1 Phone first.** Design at 360 px first. Touch targets of 44 px or more. Bottom sheets, not modals, for forms on
  small screens. (S1)
- **U2 Recipe page: reading first.** Title, photo, time and servings, then ingredients and steps. Edit, share and
  other tools sit behind one menu. On wide screens, ingredients and steps sit side by side. (S8)
- **U3 Cook mode.** One step at a time, large type, an ingredients drawer, tap to advance. Keeps the screen awake with
  the Wake Lock API and a quiet fallback. (S7, S8, S11)
- **U4 Checkboxes that remember.** Ingredients and steps can be ticked off. State is kept on the device and is never
  required. (S7)
- **U5 Fast, forgiving entry.** Paste a block of ingredients and parse it. One line per ingredient, with inline fixes
  rather than a form per field. (S1, judgement)
- **U6 Meal plan as a week strip.** A week view with day cards that scroll horizontally on phones. Add a recipe in two
  taps. Behind the `meal-plan` flag. (S9, judgement)
- **U7 Calm visual design.** Few colours, generous spacing, food photography leads, one accent colour, one primary
  action per screen. (S3, S4, judgement)
- **U8 Shopping list by aisle.** Group by aisle, big checkboxes, checked items sink to the bottom, usable with a poor
  connection in the shop. (S9, S10)

## 3. Checks on the architecture decisions

| ID | Verdict | Evidence |
|---|---|---|
| A2 Hono | Confirmed | Fastify is only slightly ahead on Node (about 88k vs 82k req/s in the Fastify benchmark, within 1% in another Node 24 run). Hono wins on startup and memory, and has typed routes. Speed is not our limit. [S13][S14] (snippet) |
| A3 SQLite WAL and FTS5 | Confirmed, note added | WAL allows many readers alongside one writer, which suits a household app. Writes are serialised, so keep transactions short. [S15] (snippet) |
| A3 Drizzle | Confirmed, note added | better-sqlite3 is supported and drizzle-kit generates migrations. I found nothing on FTS5, so assume drizzle-kit can't model virtual tables and put the FTS5 table and triggers in a hand-written SQL migration. [S18] (snippet, judgement) |
| A4 scrypt | Confirmed, parameters added | OWASP prefers Argon2id, and allows scrypt at N=2^17, r=8, p=1 (128 MiB) when Argon2id is unavailable. We use `node:crypto` scrypt to avoid a native dependency, and must raise `maxmem` above the default. [S16] (snippet) |
| A6 Tailwind v4 and Radix | Confirmed | shadcn/ui targets Tailwind v4 with CSS variables and `@theme inline`, with components copied into the project on Radix. Use `tw-animate-css`. [S17] (snippet) |
| A7 OKLCH tokens | Confirmed | Tailwind v4's default palette and shadcn's tokens use OKLCH. Define a `.dark` block with matching values. [S17] (snippet) |
| A1, A5, A8, A9 | Unchanged | Not researched. They are conventional choices (judgement). |

Edits made to 03-architecture.md: the A3 and A4 rows now carry the two notes above.

## 4. Licensing

- **Mealie** is AGPL-3.0. The repo moved from MIT to AGPL in 2022. [S19] (snippet)
- **RecipeSage** is dual licensed. Non-commercial use is under AGPL-3.0, and other use needs a separate licence from
  the author. Contributors sign a CLA. [S20][S21] (snippet) The README text was not opened, so confirm the wording
  before quoting it anywhere.
- **Why Meally can be hosted publicly under AGPL-3.0** (judgement): Meally is a clean rewrite. We copy no code, CSS,
  strings or assets from either project, so neither licence applies to our code. We only learn from their public
  behaviour and docs. Our code is AGPL-3.0, so anyone running a modified Meally over a network must offer its source,
  and public hosting is fine on those terms. RecipeSage's restriction would only matter if we reused its code.
- This is not legal advice. The "don't copy" rule in CLAUDE.md is what keeps this position safe.
