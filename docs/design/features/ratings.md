# Favourites and ratings (F11, flag `ratings`)

## What it does

Each person in a household can mark a recipe as a favourite (a heart) and give it 1-5 stars. Both are personal: your heart
and stars are yours. The recipe page also shows the household average ("4.3 · 3 ratings") so the family can see the
shared verdict. The library has a "Favourites" quick chip, a "Top rated" sort and a `minRating` API filter, all based on
the caller's own data.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Favourite and rating are per user (`recipe_user_data`, PK user+recipe); the household average is computed from members' rows | One shared rating per recipe (members overwrite each other); average only | [S3] found no convention to copy, so we chose what avoids conflicts between members |
| D2 | A heart for favourite, not a bookmark. One concept ("save for later" is covered by meal plan and lists) | Bookmark icon; both | [S2] hearts are the common card-overlay pattern; bookmarks are a weaker, separate idea |
| D3 | Stars are a `radiogroup` of `radio` buttons with roving tabindex; arrows move and select, clicking the chosen star or Backspace/Delete clears | Native radio inputs; slider | [S1] radiogroup with arrow keys is the recommended pattern |
| D4 | Heart and stars update optimistically and roll back on error | Wait for the server | Quick taps on cards must feel instant |
| D5 | Flag off: endpoints 404, response fields omitted, filters and sort ignored (rating sort falls back to updated) | Hard-fail | Matches the organisers behaviour |

`last_made_at` is stored for a later "cooked it" feature; nothing writes it yet.

## Data and API

- Table `recipe_user_data(user_id, recipe_id, favourite, rating, last_made_at, updated_at)`, cascade on user and recipe.
- `PUT /api/v1/recipes/:slug/me {favourite?, rating?}` (rating `null` clears) returns `{favourite, rating}`. 404 for another household's recipe.
- `GET /recipes/:slug` adds `me` and `householdRating {average, count}`; summaries add `favourite` and `rating`.
- `GET /recipes?favourites=1&minRating=4&sort=rating`.

## UI

Heart overlay (44 px hit area) on cards and beside the title, star rating under the title with a Clear button and the
household average, a small star value on rated cards, a Favourites chip above the filters, and "Top rated" in the sort menu.
With the flag off none of these render.

## Sources

- [S1] Accessible star rating (radio group, arrow keys), https://www.atomica11y.com/accessible-web/star-rating/ and https://github.com/schne324/star-rating
- [S2] Heart-based favourites on recipe cards, https://support.shift.com/hc/en-us/articles/24810311853204-Recipe-App-How-to-save-and-locate-your-recipes-for-later
- [S3] A search for per-user versus household rating conventions found nothing definitive.
