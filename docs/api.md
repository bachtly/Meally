# Meally API

The web app and scripts use the same JSON API under `/api/v1`. This guide covers token auth and the main endpoints.
Examples use `$MEALLY` for your server (for example `https://meally.example.com`) and `$TOKEN` for a token.

## Authentication

Create a token in Settings, under "API tokens" (needs the `api-tokens` feature). Pick a name, a scope and an expiry.
The token looks like `mly_...` and is shown once; Meally keeps only a hash.

```sh
export MEALLY=https://meally.example.com
export TOKEN=mly_xxxxxxxx
curl -H "Authorization: Bearer $TOKEN" "$MEALLY/api/v1/recipes?limit=5"
```

- `read` tokens may only send GET and HEAD. Anything else returns 403 `insufficient_scope`.
- `write` tokens may do everything you can do, except manage tokens (that needs a signed-in browser session).
- Send either a bearer token or a session cookie, never both (400 `mixed_auth`).
- Bearer requests need no CSRF header. Each token is limited to 600 requests per 10 minutes (429 with `Retry-After`).
- Tokens act within your household. Revoke a token in Settings and it stops working at once.

## Recipes

```sh
# list and search (q, sort, cursor, limit; tag/category/tool filters when organisers are on)
curl -H "Authorization: Bearer $TOKEN" "$MEALLY/api/v1/recipes?q=soup&limit=20"
# read one
curl -H "Authorization: Bearer $TOKEN" "$MEALLY/api/v1/recipes/tomato-soup"
# create
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$MEALLY/api/v1/recipes" \
  -d '{"name":"Tomato soup","servings":4,"ingredients":[{"raw":"400 g tomatoes"}],"steps":[{"text":"Simmer."}]}'
# replace (full body, same shape as create)
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$MEALLY/api/v1/recipes/tomato-soup" -d @recipe.json
# delete
curl -X DELETE -H "Authorization: Bearer $TOKEN" "$MEALLY/api/v1/recipes/tomato-soup"
# upload an image (multipart)
curl -X POST -H "Authorization: Bearer $TOKEN" -F "file=@photo.jpg" "$MEALLY/api/v1/recipes/tomato-soup/image"
```

Create returns 201 with the recipe, including its `slug`. The slug stays the same if you rename the recipe.

## Import from a URL

```sh
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$MEALLY/api/v1/import/url/preview" -d '{"url":"https://example.com/recipe"}'   # preview, saves nothing
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$MEALLY/api/v1/import/url" -d '{"url":"https://example.com/recipe"}'           # returns {"slug":"..."}
```

## Meal plan

```sh
curl -H "Authorization: Bearer $TOKEN" "$MEALLY/api/v1/meal-plan?from=2026-11-09&to=2026-11-15"   # up to 62 days
curl -H "Authorization: Bearer $TOKEN" "$MEALLY/api/v1/meal-plan/today"
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$MEALLY/api/v1/meal-plan" \
  -d '{"date":"2026-11-12","mealType":"dinner","recipeId":"<recipe id>"}'    # or "title" instead of recipeId
curl -X DELETE -H "Authorization: Bearer $TOKEN" "$MEALLY/api/v1/meal-plan/<entry id>"
```

`mealType` is `breakfast`, `lunch`, `dinner` or `snack`.

## Shopping lists

```sh
curl -H "Authorization: Bearer $TOKEN" "$MEALLY/api/v1/shopping/lists"
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$MEALLY/api/v1/shopping/lists" -d '{"name":"Weekend"}'
curl -H "Authorization: Bearer $TOKEN" "$MEALLY/api/v1/shopping/lists/<id>"                       # {list, items}
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$MEALLY/api/v1/shopping/lists/<id>/items" -d '{"text":"2 lemons"}'
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$MEALLY/api/v1/shopping/lists/<id>/add-recipe" -d '{"slug":"tomato-soup","servings":6}'
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$MEALLY/api/v1/shopping/lists/<id>/add-meal-plan" -d '{"from":"2026-11-09","to":"2026-11-15"}'
```

## Tokens (browser session only)

`GET /api/v1/tokens`, `POST /api/v1/tokens {name, scope: "read"|"write", expiresInDays?}` and
`DELETE /api/v1/tokens/:id`. Listing never includes the secret; create returns it once as `token`.

## Errors

Errors are JSON: `{"error": "<code>", "message": "<text>"}`.

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_body`, `mixed_auth` | Bad input, or both cookie and token sent |
| 401 | `unauthenticated`, `invalid_token` | No credentials, or the token is unknown, revoked, expired, or the feature is off |
| 403 | `insufficient_scope`, `session_required` | Read token used to write, or a token used on token management |
| 404 | `not_found`, `feature_disabled` | Missing (or in another household), or the feature is off |
| 429 | `rate_limited` | Slow down; see `Retry-After` |
