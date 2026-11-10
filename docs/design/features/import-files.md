# Import from files (F17, flag `import-files`)

## What it does

Upload an export from another app and have its recipes appear in the library: schema.org JSON (which covers
RecipeSage's JSON-LD export), Paprika `.paprikarecipes`, a Mealie export zip, or a zip of saved `.html` / `.json`
files. Progress is shown live, duplicates are skipped, and unreadable items are listed instead of failing the whole
import. The importers are written from public format descriptions, not from either project's code.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | Detect the format from content (zip magic bytes, then entry names), using the filename only as a hint for non-zip files. | Trust the extension. Users rename files and Paprika/Mealie both ship plain zips. | [S1] |
| D2 | Run jobs in-process, one at a time, through a promise chain. State lives in `import_jobs`; jobs left running by a crash are marked failed at startup. | A worker process or queue (Redis, BullMQ). Meally is a single-container, single-process app, so a worker adds ops cost with no throughput gain; imports are I/O and sharp-bound, and one at a time is gentle on a small server. | - |
| D3 | `yauzl` for zips (reads the central directory from disk, streams one entry at a time) and `busboy` to stream the upload to a temp file. | `fflate` unzip (whole archive in memory). Hono `parseBody` (buffers 200 MB). `fflate` is only a test dependency, used to build fixtures. | [S2] |
| D4 | Duplicate = same household, same name, same source URL (or both null). It is counted as skipped. | Content hash. Too strict for edited recipes and needs a new column. | - |
| D5 | Recipes from files never fetch remote images; only photos embedded in the file go through the image pipeline. JSON-LD `image` URLs are ignored. | Fetch via the SSRF-safe fetcher. A 5000-recipe import would trigger thousands of outbound requests. | - |

### Formats and sources

- **schema.org JSON-LD** ([S3]): one Recipe, an array, or an `@graph`. It reuses the extractor and mapper from
  import-url (`recipeFromNode`, `findAllRecipes`); the recipe's own `url` becomes the source link.
- **Paprika** ([S4]): a zip of `*.paprikarecipe` entries, each gzipped JSON. Fields used: `name`, `ingredients`
  (newline text, parsed with `parseIngredients`, so section headers work), `directions`, `description`, `notes`,
  `source_url`, `servings`, `prep_time` / `cook_time` / `total_time` (free text such as "1 hr 5 min"), `categories`
  and `photo_data` (base64). The field names are taken from community descriptions of the format; Paprika
  publishes no spec, so unknown or missing fields are ignored.
- **Mealie** (best effort, [S5]): `recipes/<slug>/<slug>.json` with `name`, `description`, `recipeIngredient`
  (`originalText`/`display`, or quantity + unit + food + note; `title` is a section), `recipeInstructions`
  (`title` is a section), `prepTime`, `performTime`, `totalTime`, `recipeYield`, `orgURL`, `tags`, `recipeCategory`,
  and `recipes/<slug>/images/original.*` for the photo. Other files in the zip (database dumps, users) are never read.
- **Zip of pages**: each `.html` goes through the JSON-LD/microdata extractor; each `.json` through the JSON-LD
  path. Hidden files and `__MACOSX` are ignored.

Tags and categories are saved only when `organizers` is on.

### Zip safety limits

Checked from the central directory before any entry is read: at most 5000 entries; at most 500 MB total declared
uncompressed size; entry names with `..` segments, a leading `/` or `\`, drive letters or NUL bytes reject the whole
archive. Nothing is ever extracted to disk, so traversal cannot write files, and the check also guards future
changes. yauzl validates that actual sizes match the declared ones, so a forged header cannot hide a bomb. Each
entry read is capped (50 MB; 30 MB for images; 100 MB after gunzip). The upload is capped at 200 MB while streaming
and the temp file is deleted when the job ends.

## Data and API

Table `import_jobs`: id, household_id, user_id, format, filename, status (`queued|running|done|failed`), total,
imported, skipped, failed (the real error count), errors JSON (capped at 100 `{item, message}`), created_at,
finished_at.

- `POST /api/v1/import/files`: multipart field `file`. Responds `202` with the job. Unsupported content gives
  `415`, an unsafe or oversized archive `400`, no recipes `422`, too large `413`. Validation happens before the job
  is created.
- `GET /api/v1/import/jobs/:id`: the job (404 for another household).
- `GET /api/v1/import/jobs`: the 20 most recent jobs of the household.

All routes need a session and the `import-files` flag.

## UI

Settings > "Import recipes" (shown when the flag is on) links to `/settings/import`: a drop zone with a file picker,
the supported formats in plain words, an upload progress bar (XHR, since fetch has no upload progress), live job
progress polled every second, a summary (imported, skipped, errors in an expandable list, "View recipes"), and recent
imports with skeleton, empty and error states. With the flag off the section and the route are absent.

## Sources

- [S1] File signatures list (PK zip header), https://en.wikipedia.org/wiki/List_of_file_signatures
- [S2] yauzl README (random-access reading, entry size validation, file name checks), https://github.com/thejoshwolfe/yauzl
- [S3] schema.org Recipe, https://schema.org/Recipe
- [S4] Paprika recipe export format notes (gzipped JSON per recipe), found via search: https://github.com/bojanrajkovic/paprika-exporter
- [S5] Mealie documentation, recipe import/export, https://docs.mealie.io/
