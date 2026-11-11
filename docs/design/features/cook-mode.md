# Cook mode (F10, flag `cook-mode`)

## What it does

A full-screen view at `/recipes/:slug/cook` that shows one step at a time in large type, with a progress bar, big
Previous and Next buttons, swipe and key navigation, an ingredients drawer, step timers and a screen wake lock. It
reads the same `?servings=&units=` as the recipe page and shares the ingredient check state with it.

## Decisions

| ID | Decision | Alternatives | Evidence |
|---|---|---|---|
| D1 | One step per screen, with step N of M, a progress bar and buttons in the thumb zone. Related ingredients show as chips under the step. | Full list with the current step highlighted (keeps context, but small type and scrolling with messy hands). The full list stays on the recipe page. | Product judgement; roadmap U3 |
| D2 | Request a screen wake lock on entry, re-request on `visibilitychange`, feature-detect it. If it is missing or fails, show "Keep your screen on manually". | A hidden video or NoSleep-style hack (battery cost, fragile). | [S1] [S2] |
| D3 | Detect durations with a shared regex parser (`parseDurations`): single, compound ("1 hr 20 min"), ranges and unicode fractions. A range starts the lower bound. Single-letter units must touch the number. | NLP (heavy); only "N minutes" (misses common forms). | Tests in `packages/shared/src/text/durations.test.ts` |
| D4 | Timers store end timestamps in localStorage (`meally:timers:<slug>`), tick every second, and survive step changes and refreshes. On finish: WebAudio beep, `navigator.vibrate`, toast. | Countdown counters (drift, lost on refresh). Browsers may block audio until a user gesture; tapping the timer chip counts as one. | Design choice |
| D5 | The ingredient hint matches whole-word food names (with simple plurals) in the step text. | Match on ingredient text (noisy), or authored links (too much work). | Heuristic; false positives are cheap |

## Wake lock caveats

- The browser releases the lock whenever the page is hidden, so we re-acquire when it becomes visible [S1].
- Safari on iOS has had partial support: it can silently do nothing in Home Screen web apps before 18.4 [S2]. A failed
  or missing request therefore shows the manual hint instead of an error.
- Firefox supports it since 126, Chrome since 84 [S2].

## Data and API

None. Server unchanged. Client storage: `meally:timers:<slug>` and the existing `meally:checks:<slug>`.

## UI

Loading skeleton, error and "no steps" empty states; a finish screen with "Done" (a "Log that I made it" action is
deferred until `timeline` exists). If the flag is off, the route shows the standard feature-off page and the
"Start cooking" button on the recipe page is hidden.

## Sources

- [S1] MDN, Screen Wake Lock API, https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- [S2] Can I use, Screen Wake Lock API (and WebKit bug 254545), https://caniuse.com/wake-lock , https://bugs.webkit.org/show_bug.cgi?id=254545
