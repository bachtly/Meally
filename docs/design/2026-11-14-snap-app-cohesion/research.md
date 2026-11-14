# Snap screens and the recipe app: making them feel like one app

Research, 14 Nov 2026. Issue #98, part of #75. No code changes yet. The owner picks a direction in #98.

## The problem

The owner wrote: "The snap screen seems outvibe with recipe app, especially once we switch back and forth."

Here is what the code does today:

| Area | Snap loop (`SnapShell`) | Recipe app (`AppShell`) |
|---|---|---|
| Background | `--cam-bg`, near-black, in both themes | Koi cream (light) or Koi olive-dark (dark) |
| Accent | `--cam-accent`, the dark-theme olive | `--accent`, the olive that matches the theme |
| Photo radius | `rounded-[2.75rem]` (44 px), hard-coded | `--radius-lg` (20 px) at most |
| Chrome | No header or tab bar; three corner controls | Header with the brand, a tab bar, a desktop sidebar |
| Way out | Avatar, then a **light** menu sheet over the dark camera | — |
| Way back | — | The **Snap** tab in the tab bar |
| Motion between them | Hard cut | Hard cut |
| Status bar | `theme-color` fixed at cream `#fcf8f2` (being fixed in a separate issue) | Same |
| Snap to recipe | A recipe chip, then `/snaps/:id/recipe` in the light shell with a text link, "Back to Snap" (a new navigation, not a history back) | — |

The dark camera is not the problem in itself. The real problems are: two different ways in and out, cuts with no motion, a light sheet on a dark screen, radii and accents from two systems, and a coming-back step that doesn't put you back where you were.

## Findings from other products

1. **A permanently dark UI is fine for immersive media, but only there.** Apple's HIG says that "in rare cases" an app that supports immersive media viewing can use a permanently dark appearance so the UI recedes. The same page says to avoid app-specific appearance settings, because people expect the app to follow their system choice. A screen that is always dark should therefore be one where the photo fills it, not a browsing screen. [S1]
2. **Photos changes only the full-screen view.** Apple uses the Photos app as its example: when you look at a full-screen photo it hides the status bar and controls for a while, and one tap brings them back. The library grid is ordinary app chrome that follows the system theme. Never hide the status bar for good, and keep it readable over content. [S2]
3. **Locket shows that the camera can be home with corner controls instead of a tab bar.** History is one swipe up from the camera. The reviewer called the missing tab bar a welcome change. Locket has no second "utility" half to match, though. Its whole app is the camera and History. [S3]
4. **Instagram and Twitter make the camera a mode next to the feed, not a separate app.** The camera is one sideways swipe from the home timeline, and it comes back the same way. The camera is dark, but you reach it and leave it through one gesture, so it reads as part of the same app. [S4]
5. **Snapchat is the camera-first extreme.** It opens to the camera, and every other screen is a swipe in a fixed direction (chat to one side, Stories then Discover to the other, Memories below, your profile above). The layout is spatial, so you always know how to get back: you swipe the opposite way. [S5]
6. **Motion tells you how two screens relate.** Material's motion system uses "fade through" when you switch between top-level destinations that aren't related, "container transform" when a list item or card grows into its detail page, and "shared axis" for parent–child moves, where forward and back go in opposite directions. [S6]
7. **The web can do this now.** Same-document View Transitions support a hero transition from a thumbnail to its detail page through `view-transition-name`. Each name must be unique at the moment of the transition. `types` mark back navigation, and the page should skip its own animation when the browser already plays a swipe-back (`hasUAVisualTransition`). Reduced motion should mean a gentler animation, not none. Support covers Chrome 111+, Safari 18 and Firefox 144 (for types). Without support, the page just updates. [S7]
8. **On Safari 26 the status bar follows the page background.** A forum answer reports that Safari 26 ignores `theme-color` and takes the bar colour from the `html` or `body` background. So the dark screens need to set the page background, not only their own `div`. [S8]

## Directions

### A. One system, dark only where the photo fills the screen (the Photos model)

The camera and the full-screen Snap viewer stay dark. Everything you browse follows the app theme: the Feed grid, the menu, the friends sheet, and the recipe. Both halves use one set of tokens.

- **Palette:** `--cam-*` becomes a short alias layer over the Koi dark tokens (`--cam-bg` = a darker Koi surface with the same 95° hue, `--cam-accent` = the dark `--accent`). In light mode, the Feed grid sits on `--surface`.
- **Shape and type:** add `--radius-xl` (for example 2rem) to `theme.css`. Use it for `PhotoFrame` and for recipe hero images, so the photo looks the same on both sides. Keep Inter and the same type scale.
- **Navigation:** keep the camera as home (decision U1). Remove the gap between going in and coming back: the menu becomes a dark sheet when it opens over the camera, and the AppShell's Snap tab and the camera's menu lead to the same places.
- **Motion:** a fade-through between the two shells. A container transform from a Feed tile to the viewer and back, and from the recipe chip to the recipe.
- **Status bar:** follows the page background (`html` background plus `theme-color` from the current shell).

Pros: this matches Apple's guidance and how Photos works. Browsing screens respect light mode. The approved camera mockups stay as they are. Each step is small and ships on its own.
Cons: the Feed grid moves away from the approved mockup (U4 and U7 say the grid is dark). In light mode the switch from light to dark still happens, but only when you open the camera or a full-screen Snap, and it is animated.

Files: `apps/web/src/ui/theme.css` (aliases, `--radius-xl`); `features/snaps/parts.tsx` (`SnapShell` takes a `tone`: `dark` for `/` and `/snaps/:id`, theme for `/feed`; it sets the `html` background); `FeedPage.tsx` (token classes); `MenuSheet.tsx`, `FriendsSheet.tsx` and `ui/Overlays.tsx` (a dark `Sheet` variant inside `SnapShell`); `app/App.tsx` (wraps navigation in `startViewTransition`); `SnapViewPage.tsx` and `LinkedRecipePage.tsx` (`view-transition-name` on the photo, a history-back button); stories in `apps/web/src/stories/`; `docs/design/features/snaps.md` (update U4 and U7).

### B. The camera becomes a tab in one shell (the Instagram and BeReal model)

Bring back one tab bar for the whole app. The camera is the first tab, and on that tab the bar is drawn as a dark, see-through overlay. The Feed becomes an ordinary light screen inside `AppShell`. Only the viewer goes full screen.

Pros: there is one way to move around, and it is the same in both directions. People already know it from Instagram. The two-shell split goes away entirely.
Cons: it reverses U1 (the camera is down to three controls) and the approved mockups. The camera loses about 64 px of height to the bar. It feels less like Locket, which was the point of the Snap redesign.

Files: `app/App.tsx` (moves the Snap routes under `AppShell`); `app/AppShell.tsx` (a translucent dark bar on `/`); `app/nav.ts`; `features/snaps/SnapHome.tsx` (drops the avatar menu, `MenuSheet.tsx` retires); `parts.tsx` (`SnapShell` only for the viewer); e2e flows in `e2e/` that open the menu; the snaps stories; `snaps.md` (U1, U4, U7).

### C. Keep the layout, use Koi dark (smallest change)

Keep the current routes and layout. Restyle the Snap screens with the existing Koi dark tokens instead of a separate near-black palette, so the camera looks like Meally in dark mode. Render every sheet and menu opened inside `SnapShell` in that dark theme. Add the Koi brand mark to the camera's top bar. Add one fade between the shells.

Pros: about a day of work, with no layout change and no change to the mockups. The camera and dark mode really are the same palette.
Cons: in light mode you still jump between cream and dark every time you go back and forth, which is the case the owner reported. The jump is just softer. It does not fix the round trip from a Snap to its recipe.

Files: `theme.css` (`--cam-*` set to the dark tokens); `parts.tsx` (`data-theme="dark"` on the shell subtree so Radix portals pick it up, which needs a portal container inside the shell); `ui/Overlays.tsx` (accepts a portal container); `SnapHome.tsx` (brand mark); stories.

## Opening a recipe from a Snap and coming back

This applies whichever direction is picked:

- Opening the recipe is a step deeper, so it should look like one: the recipe slides up over the Snap (shared axis on the y axis), or, where View Transitions are supported, the Snap photo morphs into the recipe hero. [S6] [S7]
- "Back to Snap" should be a real back button at the top left (`navigate(-1)` when the previous entry is that Snap, otherwise a link). It should return you to the same Snap, with the Feed scroll position and filter unchanged. Today it is an inline text link that adds a new history entry.
- Show a small thumbnail of the Snap next to the back button, so you can see where you will land.
- With reduced motion turned on, use a cross-fade instead of the slide or morph. [S7]

## Recommendation

**Direction A, shipped in three small PRs:**

1. Shared tokens: `--cam-*` become aliases over Koi dark, add `--radius-xl`, and use dark sheets inside `SnapShell`. This alone removes the "two design systems" feel and the light-sheet-on-dark clash. It overlaps with C, so C becomes step one rather than a separate choice.
2. Motion: View Transitions for shell changes, tile to viewer, and Snap to recipe; plus the history-back button with its thumbnail.
3. The Feed grid follows the app theme (U4 and U7 change). The camera and viewer stay dark.

A keeps everything the approved mockups got right: a three-control camera, Locket-style sending, a Photos-style grid. It also follows the rule from Apple and Photos that only full-screen media is always dark. B would make navigation more consistent, but it undoes the redesign the owner just approved. C alone doesn't fix the light-mode switching that the owner described.

**Owner decision (14 Nov 2026, #98): C**, with dark as the app's default theme. With dark as the default, the cream-to-dark jump C left open only happens to people who pick Light. Recorded as U13 in `features/snaps.md` and D7 in `features/design-system.md`.

## Sources

- [S1] Apple, Human Interface Guidelines: Dark Mode. https://developer.apple.com/design/human-interface-guidelines/dark-mode
- [S2] Apple, Human Interface Guidelines: Status bars. https://developer.apple.com/design/human-interface-guidelines/status-bars
- [S3] Fueled, "App of the Week: Locket". https://fueled.com/blog/locket-photo-sharing-widget/
- [S4] MacStories, "Twitter's iOS app makes the camera more prominent than ever". https://www.macstories.net/news/twitters-ios-app-makes-the-camera-more-prominent-than-ever/
- [S5] iPhone Life, "How to use Snapchat: a crash course". https://www.iphonelife.com/content/how-to-use-snapchat-crash-course-filters-memories-snapcash-more
- [S6] Material Components for Android, Motion. https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md
- [S7] Chrome for Developers, "Same-document view transitions for single-page applications". https://developer.chrome.com/docs/web-platform/view-transitions/same-document
- [S8] Apple Developer Forums, thread 801239 (Safari 26 and `theme-color`). https://developer.apple.com/forums/thread/801239
