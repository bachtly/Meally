# Organisers: tags, categories, tools (F9, flag `organizers`)

## What it does

Recipes can be labelled with tags, categories and tools, and the recipe list can be filtered by them. Mealie offers three
separate organiser types; RecipeSage has one flat concept called labels (with an optional grouping layer). Meally follows
the three-type model but keeps each type deliberately simple: a name and a slug, scoped to the household. This PR is the
server half; the web UI is a separate PR.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Three types: tags, categories, tools | One "labels" concept | [S1] [S2] |
| D2 | Filters: OR within a type, AND across types | AND everywhere; user-chosen "match all" toggle | [S2] |
| D3 | Merge is offered for all three types | Merge for tags only | [S1] |
| D4 | Recipe writes upsert organisers by name (case-insensitive) and omitted fields leave links untouched | Require ids; replace always | [S1] |

**D1.** The types answer different questions. Categories are the coarse "what is it" (dinner, dessert) and feed future
planner rules and cookbooks. Tags are free-form traits (vegan, quick). Tools are equipment (slow cooker), which is
filterable on its own so you can ask "what can I make with the air fryer". A single labels list (RecipeSage) is lower
ceremony and lets users invent any structure, but it cannot drive meal-plan rules or equipment filtering without the user
policing naming. Cost of three types: three tables and a slightly longer editor. They share one implementation, so the
cost is small. Imports map naturally: schema.org `keywords` become tags and `recipeCategory` becomes categories (capped at
10 each and trimmed).

**D2.** Within one type, picking "vegan" and "quick" most often means "show me either" while widening a browse; across
types, picking a category and a tool narrows. So `?tag=a&tag=b` matches recipes with a or b, and
`?tag=a&category=x&tool=y` requires all three types to match. RecipeSage exposes a "match all" switch; we skip the switch
for now and can add `match=all` later without breaking this default. All filters also combine with `?q` (AND). Unknown
slugs simply match nothing.

**D3.** Merge moves every recipe from the source to the target, collapses duplicates (a recipe with both keeps one link),
and deletes the source. It cleans up the near-duplicates that imports create ("Vegan" and "vegan food").

**D4.** The editor and importer only know names. Matching is by lower-cased name, then the slug is generated
(`creme-brulee`), with a numeric suffix on slug collision. Rename changes the slug to follow the name, so slug-based
links should be re-fetched after a rename. If the flag is off, organiser input is ignored and output omits the fields;
data is kept, so turning the flag back on restores it.

## Data and API

Tables (household-scoped, unique `(household_id, slug)`): `tags`, `categories`, `tools`. Join tables `recipe_tags`,
`recipe_categories`, `recipe_tools` (primary key recipe and item, both cascade on delete).

- `RecipeInput`: optional `tags`, `categories`, `tools` (arrays of names). `Recipe`: all three as `{name, slug}[]`.
  `RecipeSummary`: tags and categories.
- `GET /api/v1/recipes?tag=&category=&tool=&q=` (each repeatable).
- `GET /api/v1/organizers/:type` returns `{items: [{name, slug, count}]}`; `POST` `{name}` (409 on a duplicate name);
  `PATCH /:slug` `{name}`; `DELETE /:slug` (204); `POST /:slug/merge` `{into}`. `:type` is tags, categories or tools.
  All require auth and the flag (404 `feature_disabled` otherwise).

## UI

Not in this PR.

## Sources

- [S1] Mealie docs, features (categories, tags and tools as separate organisers; merge of duplicates is a maintenance task): https://mealie.io/documentation/getting-started/features/
- [S2] RecipeSage docs, managing labels (single label concept, "Match All Labels" filter): https://docs.recipesage.com/docs/tutorials/labels/manage-labels/
