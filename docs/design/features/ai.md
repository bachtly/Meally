# AI helpers (F25, flag `ai`)

## What it does

Optional, off by default. Users can paste messy text, or upload up to 3 photos of a cookbook page or handwritten
card, and get a structured recipe preview that flows into the normal "Edit before saving" editor. A fallback endpoint
can also parse ingredient lines the rule-based parser couldn't understand. The server admin brings their own key;
nothing is sent anywhere unless they configure it. Mealie and RecipeSage offer comparable import paths; ours is a
single provider-agnostic server integration with no bundled SDK.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Config is env only (`MEALLY_AI_PROVIDER`, `_API_KEY`, `_MODEL`, `_BASE_URL`); keys never touch the DB, backups or the API | Per-user keys in settings | Keeps secrets out of exports and backups |
| D2 | Plain `fetch` to two wire formats: Anthropic Messages and OpenAI-compatible chat completions (covers Ollama, LM Studio via base URL) | Vendor SDKs | [S1] [S2] |
| D3 | Prompt for JSON, then validate with the shared zod `RecipeInput` schema; on failure retry once quoting the problem, else 502 | Provider-native tool/JSON-schema modes (not portable across local servers) | [S1] |
| D4 | Previews are never saved; the existing editor is the review step | Auto-save | AI output can be wrong |
| D5 | 60 s timeout, 30 requests per hour per user, and nothing from prompts or images is logged | None | Cost and privacy control |

## Data and API

No tables. All routes need auth and the flag.

- `GET /api/v1/ai/status` returns `{configured, provider?, model?}` (never the key).
- `POST /api/v1/ai/recipe-from-text {text}` and `POST /api/v1/ai/recipe-from-image` (multipart, 1 to 3 JPEG, PNG,
  WebP or GIF files, 8 MB each) return `{recipe, imageUrl: null}`.
- `POST /api/v1/ai/parse-ingredients {lines}` runs the rule-based parser first and asks the model only about lines
  with no food, then merges; unknown units are dropped.
- Errors: 503 `ai_not_configured`, 429 `rate_limited`, 502 `ai_failed` or `ai_invalid_response`, 504 `ai_timeout`.

Anthropic requests send `x-api-key` and `anthropic-version: 2023-06-01`, with photos as base64 `image` content blocks.
OpenAI-compatible requests send an optional bearer token and `image_url` data URLs.

## UI

`/recipes/import` gains "From text" and "From photos" tabs when the flag is on. Each tab states "Your text/photos are
sent to <provider> configured by your server admin". When unconfigured, admins see which env vars to set and others
are told to ask their admin. Loading, error and result states are shown. The editor "Fix with AI" button is deferred.

## Privacy

Only the pasted text or chosen photos are sent, only on an explicit click, only to the provider the admin chose.

## Sources

- [S1] Anthropic Messages API (headers, image blocks), via web search of third-party summaries of https://docs.anthropic.com/en/api/messages
- [S2] OpenAI-compatible chat completions with `image_url` content parts, https://platform.openai.com/docs/api-reference/chat
