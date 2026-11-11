# Design: sharing recipes, collections and the receiver's path into the app

Status: proposal, 2026-11-11. Docs only. Extends F16 (`share-links`), F14 (`cookbooks`) and F24 (`pwa`).
Source marks: **(page)** = fetched and read; **(snippet)** = search summary only; **(judgement)** = my inference.

## 1. The problem (UX feedback)

1. People want to share **many recipes at once**, or a **whole collection**. Today a link holds one recipe.
2. A **newcomer** who gets a link sees a read-only page and has nowhere to go: no "keep this", no sign-up, no install.
3. An **existing user** who gets a link lands in the browser, not the installed app, can't **add the recipe to their
   own list**, and can't see **who shared it**.

These are one flow, not three patches: *share → preview → open → keep → (join) → (install)*. This design gives each
step one owner and one primitive.

## 2. What others do (our own summary)

| App | Many at once | Receiver keeps it as | Attribution |
|---|---|---|---|
| RecipeSage | Public profile with chosen recipes; PDF export of several | A **copy**; the sender's edits don't reach it | Not documented |
| Plan to Eat | Friends see your whole (non-private) book | **Saved reference** (sender's edits show), or "Edit a copy" which cuts the link | The source URL is kept as a "stamp of ownership" for the original author |
| AnyList | Whole recipe collection + meal plan with one trusted person (live, both edit) | Live shared set, or a **sent copy** of one recipe (text + app file) | — |
| Paprika / Mela | Export a group as an app file | A **copy** via file import; only the same app opens it | Source field kept on import |
| Files.com, photo albums | — | Two link kinds: **live** (shows later changes) vs **snapshot** (frozen) | — |

Patterns that repeat (judgement):

- **The receiver gets a copy.** Every recipe app above copies on "save". Live sharing is reserved for a trusted
  partner, which in Meally is already the *household*. A copy keeps tenant isolation intact: no cross-household reads
  after the save.
- **A collection link is live, a saved recipe is not.** Shared albums and playlists show the current contents; saving
  freezes what you took.
- **The source URL is the author's credit.** Keep it untouched; add a separate "shared by" line for the person.
- **A link must work for people without the app** (RecipeSage, AnyList text), and the app should *also* recognise it.

## 3. Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | **One share primitive, three targets**: a recipe, a hand-picked **set** of recipes, or a **cookbook**. Same capability token, expiry, revoke and view count as F16. | A new "collection share" feature beside share links | [F16 D1–D3], [S1] |
| D2 | A **set** stores which recipes (ids, order), not their content: each recipe shows its current version until saved. A **cookbook** share is fully live: it shows the cookbook's current recipes (smart ones re-run their filter), capped at 200. | Snapshot copies at share time | [S6], [S7] |
| D3 | **"Save to my recipes" copies** into the receiver's household (fields, ingredients, steps, image bytes). No live link after the save. "Save all" also creates a manual cookbook with the set's title. | Saved reference that follows the sender (Plan to Eat) | [S2], [S3], [S4] |
| D4 | **Attribution is opt-in per link and snapshotted.** The dialog has "Show my name" (on by default, previewed as "Shared by Alice") and an optional note. The name is stored on the link at creation, never a user id. A saved copy keeps `saved_from_name` and `saved_at`; `source_url` is kept as is. | Live lookup of the sharer's profile; always anonymous (today) | [S3], [F16 exposure rules] |
| D5 | **Dedupe on save**: the copy remembers the origin recipe id (internal, never returned). Opening a link again shows "Saved on 3 Nov · Open"; a member of the sharer's own household sees "Already in your recipes · Open". | Allow duplicates silently | (judgement) |
| D6 | **Signed in → the share opens inside the app shell**; signed out → today's standalone public page. Same URL `/s/:token`. | Separate `/app/s/:token` route | (judgement) |
| D7 | **Newcomers: the save action is the sign-up prompt.** "Save to my recipes" → "Create an account to keep it" → `/sign-up?share=TOKEN`; after sign-up the save runs and lands on the copy. The intent rides in the URL (survives reloads and the sign-in page) and in `sessionStorage` as backup. Share links do **not** bypass the instance's sign-up mode. | Banner asking to sign up on page load | [S8], [S9] |
| D8 | **Install is offered after the save, not before.** A dismissible card on the saved recipe: native prompt when `beforeinstallprompt` fired, iOS steps otherwise. Shown once per device; "Not now" is remembered. No install prompt on the anonymous public page. | Install banner on the public page | [S8] |
| D9 | **Open in the installed app**: keep `/s/*` in the manifest scope and the SW navigate fallback; add `launch_handler: {client_mode: ["navigate-existing", "auto"]}`. Chrome desktop (139+) and Android (WebAPK intent filters) then open share links in the app. iOS can't: links from Messages open in Safari, whose cookies the home-screen app doesn't share. So the public page offers **"Already use Meally? Copy link, then paste it in the app"**, and the import page **recognises our own `/s/` links** and routes to the in-app share view. | Custom URL scheme (not possible for a web app) | [S10], [S11], [S12], [S13] |
| D10 | **Link previews and portability**: `/s/:token` HTML carries Open Graph tags (title, image, "Shared by Alice · 12 recipes") and, for a single recipe, schema.org `Recipe` JSON-LD, injected at the edge (Pages function) and by the Node static handler. Chat apps don't run JS. JSON-LD lets a user on *another* Meally instance, or another recipe app, import the link with "Import from URL". `noindex` stays. | Client-side meta (crawlers don't see it) | [S14], [F16 D4] |
| D11 | **Multi-select in the library**: a "Select" mode with checkboxes and a sticky bar ("Share 5", "Add to cookbook"). Cookbooks get "Share cookbook" in their header menu. Max 100 recipes per set. | Share only via cookbooks | (judgement) |
| D12 | **Tags, ratings and household foods are not copied.** Ingredient `food_id` is cleared; the receiver's parser and catalogue relink it. | Copy tags | [F16 exposure rules] |
| D13 | **One flag**: everything stays under `share-links`. Cookbook shares also need `cookbooks`; when it's off, a cookbook link answers 404. | A new `share-collections` flag | [CLAUDE.md] |

Deferred: sending directly to a user or friend's inbox (RecipeSage/Plan to Eat style), "the original changed since you
saved" notices, a sharer's public profile page, and cross-instance save (D10's JSON-LD covers the manual path).

## 4. The flows

```
Sharer                         Receiver (link in a chat app)
──────                         ─────────────────────────────
Recipe ⋯ / Library "Select" /  Preview card: photo, "Shared by Alice · 12 recipes"   (D10)
Cookbook ⋯  → Share dialog            │
  · expiry 1/7/30/never               ▼
  · Show my name  ✓  (D4)       Opens /s/:token
  · Note (optional)              ├─ App installed (Android, Chrome desktop) → opens in app  (D9)
  → Copy / native share          ├─ Signed in (browser or app) → in-shell share view       (D6)
                                 └─ Signed out → public page
                                        │  [Save to my recipes]  [Print]
                                        │  "Already use Meally? Copy link…" (iOS)  (D9)
                                        ▼
                                 Not signed in → "Create an account to keep it"
                                   /sign-up?share=TOKEN → auto-save                (D7)
                                        ▼
                                 Saved copy, "From Alice · saved today"           (D4)
                                   + once: "Add Meally to your home screen"        (D8)
```

Receiver views:

- **One recipe**: today's page plus a header line "Shared by Alice", the note, and the primary button.
- **Set or cookbook**: title, "Shared by Alice", note, count, the card grid; each card opens the recipe inside the link
  (`/s/:token/:n`). Buttons: "Save all (12)" and per-recipe "Save". Partial saves show "Saved 3 of 12".
- **States**: skeleton while loading; "This link no longer works" (unknown, expired, revoked, flag off); "Sign-ups are
  closed on this server" (save hidden, print kept); save errors with retry; "Saving 12 recipes…" progress for bulk.

Sharer views: the dialog above; a **Shared links** page under Settings listing every active link (what, created, expiry,
views, revoke), since with sets and cookbooks the per-recipe list is no longer enough.

## 5. Data and API

Migration (one, generated):

- `share_links`: `kind` (`recipe` | `set` | `cookbook`), `recipe_id` nullable, `cookbook_id` nullable (cascade),
  `title` nullable, `note` nullable (≤ 280), `sharer_name` nullable. Check: exactly one target matches `kind`.
  Existing rows become `kind = 'recipe'`.
- `share_link_recipes` (share_link_id cascade, recipe_id cascade, position), PK (share_link_id, recipe_id).
- `recipes`: `saved_from_name` nullable, `saved_at` nullable, `origin_recipe_id` nullable (no FK; internal; index on
  `(household_id, origin_recipe_id)`).

Authenticated (`requireFeature('share-links')`, household from session):

- `POST /api/v1/recipes/:slug/shares` `{expiresInDays, showName, note}` → `{url}` (extended).
- `POST /api/v1/shares` `{recipeSlugs: string[1..100], title, expiresInDays, showName, note}` → `{url}`.
- `POST /api/v1/cookbooks/:slug/shares` (also `cookbooks`) → `{url}`.
- `GET /api/v1/shares` → every active link of the household (no tokens). `DELETE /api/v1/shares/:id` as today.
- `GET /api/v1/shares/by-token/:token/status` → `{sameHousehold, saved: {n: slug}[]}`.
- `POST /api/v1/shares/by-token/:token/save` `{items: number[] | "all", asCookbook?: boolean}` → `{recipes: slug[],
  cookbookSlug?}`; over 10 items it runs as a job (existing jobs machinery) and returns `{jobId}`. Rate-limited.

Public (no auth, 404 for unknown/expired/revoked/flag off, same headers as F16):

- `GET /api/v1/public/shares/:token` → `{kind, title, note, sharedBy, count, recipe? , items?: {n, name, imageUrl,
  totalMinutes}[]}`.
- `GET /api/v1/public/shares/:token/:n` and `…/:n/image/:size`. `GET /public/recipes/:token` stays as an alias.

Exposure is F16's list plus `sharedBy` (only when the sharer left it on), `note` and `title`. Never ids, emails,
household names, tags or ratings.

Tests: other household → 404 on list/revoke/save-into; saving never writes outside the session household; a set can't
include another household's recipe (400); cookbook share with `cookbooks` off → 404; dedupe; image bytes copied to the
receiver's household prefix.

## 6. PR plan (one roadmap row each, stacked)

| PR | Scope |
|---|---|
| 38 | docs: this design |
| 39 | feat(server): share sets and cookbooks, sharer name and note (migration, public API) |
| 40 | feat(server): save a share into my household (copy, images, provenance, dedupe, bulk job) |
| 41 | feat(web): library select mode, share many, share a cookbook, Shared links page |
| 42 | feat(web): share view for sets and cookbooks; in-shell when signed in; Save / Save all |
| 43 | feat(web): newcomer path (sign-up with share intent, auto-save, install card after save) |
| 44 | feat(web): "From Alice" on saved recipes; import page accepts our own share links |
| 45 | feat(deploy): link previews and JSON-LD for `/s/*` (Pages function + Node); `launch_handler` |

Each feature PR adds or updates `docs/design/features/share-links.md` with its decisions.

## 7. Open questions for the product owner

1. **"Show my name" default** — on (proposed, matches the feedback) or off (stricter privacy)?
2. **Invite-only instances** — should a share link let a newcomer sign up (like an invite), or stay "ask the owner"?
   Proposed: no; sign-up mode wins.
3. **Set links** — live (proposed, D2) or frozen at share time?

## 8. Sources

Searched 2026-11-11.

- [S1] Good Practices for Capability URLs, W3C TAG (page, via F16): https://www.w3.org/2001/tag/doc/capability-urls/
- [S2] RecipeSage docs, Sharing (page): https://docs.recipesage.com/docs/tutorials/people/sharing/ . Single recipes by link to anyone; several via a profile link or PDF. Search snippets of the same docs: the receiver gets a separate copy.
- [S3] Plan to Eat, "Whose recipe is it anyway" (page): https://learn.plantoeat.com/help/whose-recipe-is-it-anyway . The source URL stays as the original author's credit. Friends (snippet): https://learn.plantoeat.com/help/app-friends-in-the-app . Saving a friend's recipe, "Edit a copy" cuts the link.
- [S4] AnyList help (snippet): https://help.anylist.com/articles/share-recipes-meal-plan/ (live shared collection for one trusted person), https://help.anylist.com/articles/send-recipe/ (send a copy as text plus app file).
- [S5] Paprika forum and Mela reviews (snippet): https://pitmaster.amazingribs.com/forum/the-pit-mastery-program/misc-or-general-food-discusison/1280024-paprika-recipe-manager-3 , https://www.macstories.net/reviews/mela-an-elegant-and-innovative-recipe-and-cooking-app-for-iphone-ipad-and-mac/ . Group export as an app-only file.
- [S6] Files.com, Snapshot and live share links (snippet): https://www.files.com/docs/sharing/share-links/snapshot-and-live-share-links
- [S7] Apple Community, shared albums vs normal albums (snippet): https://discussions.apple.com/thread/250566864
- [S8] web.dev, Patterns for promoting PWA installation (page): https://web.dev/articles/promote-install . Show only after `beforeinstallprompt`; after a completed journey such as sign-up; dismissible, remember the choice, don't block next steps.
- [S9] Deferred deep linking for onboarding (snippet, vendor): https://www.airbridge.io/en/blog/deferred-deeplink-for-onboarding . Carry the original intent through install or sign-up and replay it.
- [S10] Chrome for Developers, Navigation management into installed PWAs (page): https://developer.chrome.com/docs/capabilities/pwa-navigation-management . Desktop captures in-scope links by default from Chrome 139; `launch_handler.client_mode`.
- [S11] WICG, PWAs as URI handlers (snippet): https://discourse.wicg.io/t/proposal-pwas-as-uri-handlers/4394 . Android registers intent filters for in-scope URLs at WebAPK install.
- [S12] MobiLoud, PWAs on iOS (snippet): https://www.mobiloud.com/blog/progressive-web-apps-ios ; Glide community (snippet): https://community.glideapps.com/t/open-url-from-other-app-in-pwa/59048 . iOS 26 opens Home Screen sites as web apps, but links from other apps still open Safari.
- [S13] WebKit bug 181849 (snippet): https://bugs.webkit.org/show_bug.cgi?id=181849 . Home Screen apps don't share storage with Safari, by design.
- [S14] Rich link previews need server-side meta tags (snippet): https://dev.to/grabbit/how-to-build-rich-link-previews-like-slack-and-imessage-3m5 . Fetchers don't run JS; absolute HTTPS `og:image`.
