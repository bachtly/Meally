# Installable app with offline recipes (F24, flag `pwa`)

## What it does

Meally can be installed to the home screen (manifest, icons, shortcuts for New recipe, Plan and Shopping), receives shared links through the OS share sheet (opens the import page with `?url`, `?text`, `?title`), and keeps recently viewed recipes readable offline. An offline banner, an update prompt and an "Install app" entry under More complete it. Mealie and RecipeSage ship a manifest-style PWA; the difference here is an explicit, bounded offline policy and a runtime kill switch (the flag).

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | `vite-plugin-pwa` in **generateSW** mode, `registerType: "prompt"` | injectManifest with a hand-written SW | Our rules are plain Workbox strategies with no custom SW logic, so a declarative config is smaller, unit-testable (matchers live in `apps/web/pwa/runtimeCaching.ts`), and includes the `SKIP_WAITING` handler the update toast needs. |
| D2 | Detail pages: StaleWhileRevalidate in cache `recipes` (100 entries, 30 days). Images: CacheFirst in cache `images` (300 entries, 60 days), since an image id never changes; the server serves bytes, not a redirect, so the URL is stable (2026-11-11). List: NetworkFirst, 3 s timeout. Feature flags: NetworkFirst so the shell can boot offline | CacheFirst for images; cache everything under `/api` | Opening a recipe is the offline use case; the list should be fresh when online but fall back to cache on bad connections. |
| D3 | The SW never touches auth, admin, shopping SSE, public share JSON or any non-GET. Matchers are exact-path regexes, not prefixes, and the navigate fallback denies `/api/` | Cache all GETs | Auth/admin responses are per-user and sensitive; SSE streams are long-lived and must not be buffered or replayed; writes must reach the server. Caches are also deleted on sign-out so a shared device keeps nothing. |
| D4 | Flag is read at runtime from `/features`: on registers `/sw.js`, off unregisters every registration. Unknown flags (loading or offline) leave the SW alone | Build-time flag | The admin can flip it without a rebuild. |
| D5 | Offline cold start: `RequireAuth` renders its children when `/auth/me` fails with a network error while `navigator.onLine` is false, instead of redirecting to sign-in. `/auth/me` itself stays uncached | Cache the session | Keeps D3 intact; cached API data is still only returned for already-viewed recipes. |
| D7 | Updates apply in the background (2026-11-11): a waiting version activates (`SKIP_WAITING`, then reload on `controllerchange`) when the page turns hidden, or at start if the user hasn't touched the page yet. The recipe editor with unsaved changes and cook mode hold updates off (`useHoldUpdates`). The app checks for a new `sw.js` each time it becomes visible. The toast is only a fallback after 30 minutes on screen (`apps/web/src/pwa/updates.ts`) | Toast only (the old flow); `autoUpdate` with `skipWaiting` and `clientsClaim` | With a toast, users who ignore it stay on the old version until every window closes, which on iOS can be days [S3]. Forcing control mid-session swaps the worker under a running page and reloads while the user is mid-task [S4]. Reloading while hidden is invisible, and #52 makes the reload cheap (stored session, cached images). |
| D6 | iOS: no `beforeinstallprompt`, so show "Share, then Add to Home Screen" text on iOS Safari | Hide the item | [S1] |

"Available offline" badge is deferred.

## iOS limits

- iOS Safari has no `beforeinstallprompt`; install is manual via Share, Add to Home Screen [S1].
- Safari may evict script-writable storage (Cache API, IndexedDB, SW registrations) after about 7 days without use; whether Home Screen apps are exempt is reported inconsistently, and quotas are small [S1][S2]. Treat offline recipes as best effort and re-fetch silently when online.
- The research doc (`01-research.md`) already notes WebKit gaps: Wake Lock has failed in iOS home-screen web apps, so features there must feature-detect.
- Web Share Target (receiving shares) is not supported on iOS; the bookmarklet and paste on the import page remain the iOS path.

## Data and API

None. Server change: `sw.js`, `manifest.webmanifest` and `registerSW.js` get `Cache-Control: no-cache`; hashed `workbox-*.js` is immutable.

## UI

`OfflineBanner` under the header (role=status), `UpdateToast` (fixed, persistent until Reload; only after an update has waited 30 minutes on screen, see D7), `InstallItem` on More (native prompt or iOS text; hidden when installed or flag off). Flag off: no registration, SW unregistered, nothing rendered.

## Sources

- [S1] PWA iOS Limitations and Safari Support, https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- [S2] Safari iOS PWA Data Persistence Beyond 7 Days, https://developer.apple.com/forums/thread/710157
- [S3] The service worker lifecycle (waiting until all clients close), https://web.dev/articles/service-worker-lifecycle
- [S4] Handling service worker updates with immediacy, https://developer.chrome.com/docs/workbox/handling-service-worker-updates
