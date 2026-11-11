# Cookbooks (F14, flag `cookbooks`)

## What it does

A cookbook is a named, saved collection of recipes. A **smart** cookbook stores a filter (search text, tags, categories,
tools, favourites, minimum rating) and always shows whatever the library would show for that filter. A **manual**
cookbook is a hand-picked, ordered list. Mealie's cookbooks are filter-based only; RecipeSage has hand-made folders. We
offer both so "weeknight dinners" can stay current by itself, and "Christmas menu" can be exactly what you chose.
Depends on `organizers`; when it is off, tag/category/tool filters are ignored (as in the library).

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Two kinds, chosen at creation and not changeable later | Filter-only; manual-only; hybrid (filter plus pinned extras) | [S1] |
| D2 | A smart cookbook resolves through `listRecipes`, the same service as `GET /recipes`, so results always match the library | A separate query path | [S1] |
| D3 | Manual lists paginate with an offset cursor over `position`; smart lists use the library keyset cursor | One cursor style for both | n/a |
| D4 | Cover: chosen recipe, else up to 4 photos in a collage, else a warm placeholder | Single image only | [S1] |
| D5 | Sidebar entry on desktop; under More on phones, so the tab bar stays at 4 | A fifth tab | n/a |

## Data and API

Tables: `cookbooks` (id, household_id, name, slug, description, kind, filter JSON, cover_recipe_id, position,
created_at) and `cookbook_recipes` (cookbook_id, recipe_id, position; cascade on delete).

`/api/v1/cookbooks` (flag `cookbooks`): `GET /`, `POST /`, `PUT /order {slugs}`, `GET|PUT|DELETE /:slug`,
`GET /:slug/recipes?cursor&limit`, `POST /:slug/recipes {slug}`, `DELETE /:slug/recipes/:recipeSlug`,
`PUT /:slug/order {slugs}`, `GET /containing/:recipeSlug` (manual cookbooks holding a recipe). Adding to a smart
cookbook returns 409. Smart counts are capped at 100 (`countCapped`).

## UI

`/cookbooks` grid of covers with name and count and "New cookbook"; `/cookbooks/:slug` header (edit, delete) and the
library card grid, with a remove button on manual cards. Library shows "Save as cookbook" when filters are active.
Recipe overflow menu has "Add to cookbook…" with a checkbox per manual cookbook. All views have loading, empty and
error states; with the flag off the routes show the "turned off" page and the links disappear.

## Sources

- [S1] Cooked help, "Organizing your recipes" (smart collections that update by rules, next to manual ones),
  https://help.cooked.wiki/recipe-management/organizing-recipes/
