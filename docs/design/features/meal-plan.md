# Meal planner (F12, flag `meal-plan`)

## What it does

Households put recipes, or free-text meals such as "Leftovers", on a day and meal slot, ask for a random suggestion
that follows simple rules, and subscribe to the plan from a calendar app. Mealie and RecipeSage both offer a planner
with a random pick; Meally adds per-household rules and a token-protected iCalendar feed. This PR is the server half.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Meal types are fixed (breakfast, lunch, dinner, snack) | Custom, user-defined slots | Fixed keeps rules, ordering and the iCal summary simple. Custom slots can be added later as a table without changing entries much. |
| D2 | Rules are alternatives: a recipe qualifies if it fits any rule that applies to the meal type (or `any`) and weekday (or every day). Within a rule: any listed tag AND any listed category. Rules are ignored when the organisers flag is off. | AND of all rules; most-specific rule wins | OR keeps "Fridays dinner: pizza" and a general "any: quick" rule from emptying the pool. |
| D3 | Suggestions skip recipes planned in the previous 7 days, falling back to the full pool if none remain | Hard exclusion | Avoids "no suggestion" in small collections. |
| D4 | iCal feed is a read-only all-day-event feed at `/api/v1/meal-plan/ical?token=`, authorised by a random per-household token that can be rotated | Session cookie (calendar apps cannot send it); full-time-of-day events | Calendar apps poll a URL with no login, so a secret URL is the norm [S1]. Meals have no time, so all-day events. Text is escaped and lines folded at 75 octets without splitting UTF-8 [S1][S2]. |

## Data and API

Tables: `meal_plan_entries`, `meal_plan_rules` (tag and category slugs as JSON arrays; day of week 0 = Sunday),
`household_feed_tokens`. Deleting a recipe keeps the entry (recipe set to null).

All under `/api/v1/meal-plan`, behind auth and the flag (except `/ical`, which uses the token):
`GET ?from&to` (max 62 days), `POST`, `PATCH /:id` (date, mealType, recipeId, title, note, position),
`DELETE /:id`, `POST /suggest {date, mealType}` (returns `{recipe|null}`), `GET /today[?date]`,
`GET|POST|PUT|DELETE /rules`, `GET /ical/token`, `POST /ical/token` (rotate), `GET /ical?token=`.
"Today" is the server's UTC date unless `?date` is given.

## UI

Web half is a separate PR.

## Sources

- [S1] RFC 5545, sections 3.1 (content lines) and 3.3.11 (TEXT), https://www.rfc-editor.org/rfc/rfc5545
- [S2] Building an RFC 5545 iCal generator: line folding and escaping, https://dev.to/sendotltd/building-an-rfc-5545-iCal-file-generator-line-folding-escaping-and-all-5fid
