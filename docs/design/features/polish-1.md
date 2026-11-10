# Polish 1: meal plan, shopping aisles, cook entry point

Small fixes from review screenshots. No new features or flags.

- **Recipe thumbnails.** Plan entries and Add-to-plan search results showed an empty grey box for recipes without a
  photo. The warm per-recipe placeholder (initial on a tinted tile) is now a shared `RecipeThumb` used by the library
  cards, plan entries, the add sheet and cookbook covers. Reason: one look for "no photo" everywhere.
- **Plan actions on phones.** "Add week to shopping list", "Subscribe in calendar" and "Suggestion rules" moved into
  one overflow menu next to the week navigation below 1024 px; desktop keeps the inline buttons. Reason: three stacked
  rows pushed the week below the fold.
- **Default aisles.** `shared/shopping/aisleGuess.ts` maps about 150 common foods to the default aisle names
  (singular/plural normalised, head-noun match). The server uses it only when the household has no remembered
  `food_aisles` entry and still has an aisle with that name. A remembered choice always wins. Reason: every item
  landed in "No aisle" until sorted by hand. Unknown foods stay unassigned.
- **Start cooking.** On phones it is a full-width accent pill fixed above the tab bar (with extra bottom padding on
  the page); on desktop it stays inline in the header. Reason: it is the main action for a recipe with steps.

## Evidence changed

None.

## Sources

Searched 2026-11-11 (snippet only). Mostly judgment from review screenshots; one UI decision has support.

- App bars: bottom, Material Design (snippet): https://material.io/components/app-bars-bottom . Supports a primary action at the bottom for thumb reach on phones.
