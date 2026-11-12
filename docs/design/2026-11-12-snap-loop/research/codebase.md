# Snap loop: codebase survey

Terms follow the brief's Glossary (`../00-brief.md`). No ADRs exist yet in `../adr/`.

## How the job is done today
There is no Snap or Feed. The nearest flow is a Timeline event with a photo:
1. The web app opens on the recipe library: `/` redirects to `/recipes` (`apps/web/src/app/App.tsx:76-77`). The nav starts with Recipes, then Cookbooks, Plan, Shopping, More (`apps/web/src/app/nav.ts:13-19`).
2. The user opens a recipe and logs a "made" Timeline event: `POST /recipes/:slug/timeline` (`apps/server/src/features/timeline/routes.ts:40`). Kinds are `made | comment | note` (`apps/server/src/db/schema/timeline.ts:17`).
3. A photo is attached afterwards as a separate upload (`apps/server/src/features/timeline/routes.ts:61`), stored as an Image (`apps/server/src/db/schema/timeline.ts:19`).
4. The household-wide list is `GET /timeline` (`apps/server/src/features/timeline/routes.ts:43`), filtered by `householdId`. Only household members see it.
5. Non-members see recipes only through Share links (`apps/server/src/db/schema/share.ts:11-32`) at `/s/:token` (`apps/web/src/app/App.tsx:42-43`), and can copy them into their own household (`apps/server/src/features/share/save.ts:66-80`).

## Modules, data and contracts
- Users belong to exactly one Household (`apps/server/src/db/schema/auth.ts:15-19`); invites are per Household (`auth.ts:24-42`).
- The auth middleware sets `user` and `householdId` on the context for session and token callers (`apps/server/src/features/auth/middleware.ts:48-62`; type at `apps/server/src/lib/context.ts:38-39`). `SessionUser` carries `householdId` and `householdRole` (`middleware.ts:23`).
- Household routes: rename, invites, member roles, owner-only guard (`apps/server/src/features/households/routes.ts:16-50`).
- Images: metadata row keyed by `householdId`, files under `$DATA_DIR/images/<householdId>/` (`apps/server/src/db/schema/recipes.ts:6-13`); store port `ImageStore` does processing in `putOriginal` (`apps/server/src/ports/index.ts:23,96`); URLs are `/api/v1/images/:id/:size` (`apps/server/src/features/recipes/service.ts:22`).
- Recipes are household-scoped with a unique `(householdId, slug)` (`apps/server/src/db/schema/recipes.ts:44-46`), have `createdBy`, `imageId` (`recipes.ts:33-34`), and copy provenance `savedFromName`, `savedAt`, `originRecipeId` (`recipes.ts:36-40`).
- Recipe services all take `householdId` first (`apps/server/src/features/recipes/service.ts:135-328`).
- `householdId` columns per schema file: shopping 7, recipes 6, mealplan 5, foods 4, auth 3, cookbooks/import/organizers/share/timeline/webhooks 2, tokens 1 (grep count over `apps/server/src/db/schema/*.ts`).

## Reusable pieces
- Image pipeline and upload parsing: `readImageUpload` (`apps/server/src/features/timeline/routes.ts:61`), `apps/server/src/features/recipes/image-input.ts:31`. Fits Snap photos.
- Cross-owner image copy plus insert on save (`apps/server/src/features/share/save.ts:52-58`) and dedupe by `originRecipeId` (`save.ts:26-31`): the base for "Save to my recipes".
- Read-only recipe view for a non-owner: `ShareRecipePage` (`apps/web/src/app/App.tsx:43`); the Linked recipe view can reuse it.
- Timeline event rows already pair a user, recipe, photo and time (`apps/server/src/db/schema/timeline.ts:9-22`): a candidate to relate to or migrate into Snaps.
- Webhook dispatcher with retry and backoff (`apps/server/src/features/webhooks/service.ts:17-23`): a pattern for push delivery retries.
- Flags: registry (`packages/shared/src/features.ts:10-32`), `requireFeature` (`apps/server/src/features/features/middleware.ts:6`), web `FeatureRoute` (`apps/web/src/app/App.tsx:3,55`). `households` is already a flag (`features.ts:21`); `ai` exists for later dish recognition (`features.ts:31`).
- PWA: service worker registered behind the `pwa` flag (`apps/web/src/pwa/register.ts:12-20`).

## Constraints and debt
- The isolation rule is written into the architecture doc: "Every row has `householdId`. Every query filters on the caller's household" (`docs/design/03-architecture.md` API conventions, line ~133) and CLAUDE.md. Both need rewriting (brief Constraints).
- The service worker is built with `generateSW`, explicitly "no custom SW code" (`apps/web/vite.config.ts:8`). Web push needs a `push` handler, so this must switch to `injectManifest` or use `importScripts`.
- No camera or push code exists: no `mediaDevices`, `pushManager` or `Notification` in `apps/web/src` (grep, no hits).
- Image files are laid out by household on disk (`apps/server/src/db/schema/recipes.ts:6`); moving to user ownership moves or re-keys files, and backups read that directory (`apps/server/src/ports/index.ts:38`).
- Share save rejects same-household copies with `409 same_household` (`apps/server/src/features/share/save.ts:75`); this changes once ownership is per user.
- Slug uniqueness is per household (`recipes.ts:44`); it must become per user, and merging household members' recipes can collide.

## Conventions
- API: JSON under `/api/v1`, errors `{ error, message }`, cursor pagination `{ items, nextCursor }`, zod bodies from `packages/shared` (`docs/design/03-architecture.md:129-135`).
- Flags: resolution order env > override > default > dependency; disabled routes return `404 feature_disabled` (`docs/design/03-architecture.md:52-66`).
- Layout: `db/schema/<feature>.ts`, `features/<feature>/routes.ts, service.ts, *.test.ts`; web `features/<feature>/` (`docs/design/03-architecture.md:67-84`).
- Routes wire `requireAuth, requireFeature(...)` per group and pass `c.get("householdId")` to services (`apps/server/src/features/timeline/routes.ts:29-49`).
- Tests: each feature has a cross-household 404 test (`apps/server/src/features/timeline/timeline.test.ts:75-77`); DB via `openTestDb()` (CLAUDE.md).
- Migrations: drizzle-generated SQL, latest `0004_sad_skreet.sql` (`apps/server/src/db/migrations/`); `0001_recipe_search` is hand-written (CLAUDE.md).
- Docs: one `docs/design/features/<key>.md` per feature from `_template.md`; existing `households.md`, `timeline.md`, `share-links.md`, `pwa.md` (`docs/design/features/`).
