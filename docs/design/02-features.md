# Meally: features and flags

Sources: Mealie docs and UI (M) and RecipeSage (RS), based on their public docs and features. The behaviour is
reimplemented from scratch. **Core** features are always on. Every other feature has a flag key (`kebab-case`) and a
default value. The flag mechanism is described in [03-architecture.md](03-architecture.md#feature-flags).

| # | Feature | From | Flag key | Default | Depends on |
|---|---|---|---|---|---|
| F1 | Accounts: sign-in, sessions, first user becomes admin | M, RS | core | on | |
| F2 | Recipes: create, edit, delete, image, ingredients, steps, notes, times, servings, source URL | M, RS | core | on | |
| F3 | Search and filter recipes (full-text) | M, RS | core | on | |
| F4 | Sign-up mode: open, invite-only, closed | M | core (setting) | invite-only | |
| F5 | Import a recipe from a URL (schema.org Recipe JSON-LD, microdata fallback) | M, RS | `import-url` | on | |
| F6 | Ingredient parser ("1 ½ cups flour, sifted" → quantity, unit, food, note) | M | `ingredient-parser` | on | |
| F7 | Foods and units catalogue, with merge | M | `foods-units` | on | F6 |
| F8 | Scale servings and convert units (metric and US) | M, RS | `scaling` | on | |
| F9 | Organisers: tags, categories, tools | M, RS (labels) | `organizers` | on | |
| F10 | Cook mode: one step at a time, large type, screen wake lock, step timers | M, RS | `cook-mode` | on | |
| F11 | Favourites and ratings, per user | M | `ratings` | on | |
| F12 | Meal planner: day and week views, meal types, random suggestion, plan rules | M, RS | `meal-plan` | on | |
| F13 | Shopping lists: from recipes and meal plans, merge duplicates, aisle labels, check off, shared live | M, RS | `shopping-lists` | on | |
| F14 | Cookbooks: saved filtered collections | M | `cookbooks` | on | F9 |
| F15 | Households: members, roles, invites; recipes shared in a household | M (groups/households), RS (friends) | `households` | on | |
| F16 | Public share links for a recipe (read-only, can be revoked) | M, RS | `share-links` | on | |
| F17 | Import from other apps: Mealie backup, RecipeSage export, Paprika, Tandoor, JSON-LD files | M, RS | `import-files` | on | |
| F18 | Export recipes (JSON, Markdown); full instance backup and restore | M, RS | `backups` | on | |
| F19 | Recipe timeline and comments ("made it", notes, photos) | M | `timeline` | on | |
| F20 | Nutrition facts per serving | M | `nutrition` | off | |
| F21 | Print-friendly recipe view | RS | `print` | on | |
| F22 | API tokens for scripts | M | `api-tokens` | on | |
| F23 | Webhooks on events (meal plan today, recipe created) | M | `webhooks` | off | F22 |
| F24 | Installable PWA, recently viewed recipes work offline | RS | `pwa` | on | |
| F25 | AI helpers (bring your own OpenAI-compatible key): import from a photo or text, ingredient parsing fallback | M, RS | `ai` | off | |
| F26 | Admin: users, feature flags, instance settings, server info | M | core | on | |
| F27 | Rate limits and abuse protection for public instances | (new, G3) | core | on | |

## Build order

The PRs are listed in [roadmap.md](roadmap.md).
