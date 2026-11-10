# Meally: brief

## Problem

People who self-host their recipes mostly use Mealie, Tandoor or RecipeSage. They work, but:

- **P1 · Dated, dense UI.** Mealie and RecipeSage show a lot on screen at once, look old, and are awkward on a phone
  in the kitchen.
- **P2 · Licence limits.** RecipeSage is AGPL-3.0 for personal use only, and other uses need a paid licence. So a
  community or small business can't run a public instance.

## Goals

1. **G1 · Feature parity.** Cover the features people use in Mealie and RecipeSage: recipes, URL import, meal
   planning, shopping lists, organisers, households, sharing, imports from other apps, and backups.
2. **G2 · Modern UI.** Mobile-first, fast, accessible (WCAG 2.2 AA), light and dark themes. Every UI decision has a
   short research note.
3. **G3 · Public self-hosting.** AGPL-3.0 with no extra conditions. Multi-household, open or invite-only sign-up, and
   rate limits, so one instance can safely serve strangers.
4. **G4 · Each feature can be switched off.** Every non-core feature has a flag. An operator sets it with an
   environment variable or turns it off in the admin UI.
5. **G5 · Easy to run.** One Docker image, SQLite by default, nothing else to install.

## Non-goals (for now)

- Native mobile apps. The installable PWA covers phones.
- Copying code, assets or wording from Mealie or RecipeSage. Meally reimplements their behaviour from public
  documentation and from using the apps.
- Running a hosted SaaS.

## Constraints

- TypeScript everywhere. Node 24 LTS. Low running cost: the instance should idle in under 150 MB of RAM.
- Built in small PRs that can be reviewed one at a time. Each PR changes one thing and includes its design note.
