# Motion and interaction craft: research for the Depthwatch redesign

Status: research input to the v3 motion rules. The binding rules are [`principles.md`](../principles.md) §6 (M1–M10) and the motion catalogue in [`visual-v3.md`](../visual-v3.md) §4; the motion paragraph of `visual.md` (v2) is superseded.
Date: 2026-10-24. Every rule cites a source tag `[Sn]` (list at the end). Lines marked **Depthwatch call** are Depthwatch's own decisions built on the cited rules; they are not direct quotes from a source.

How the sources were read: Emil Kowalski's rules come from his public `emilkowalski/skills` repository, which distils his articles and the animations.dev course; emilkowal.ski and animations.dev themselves were not read directly. Library defaults (Sonner, Vaul, Motion, Radix, Base UI, Floating UI, Recharts, d3, NumberFlow, Tailwind) were read from the published npm packages. Browser support comes from `@mdn/browser-compat-data` 8.1.7 and `web-features` 3.44.0. These list Chrome 156, Firefox 158 and Safari 27 as the current releases. Josh Comeau, NN/g, web.dev and Laws of UX were read through search excerpts only, so their exact numbers are noted where they could not be checked.

---

## 0. The stance in ten lines

1. Depthwatch is an instrument. Motion exists to explain a change of state, never to decorate data. A professional dashboard "should be crisp and fast" [S1].
2. Gate every animation on how often people see it. If they see it 100+ times a day or trigger it from the keyboard, there is no animation. Tens of times a day gets near-invisible motion. Occasional things get standard motion. Only first-time moments get "delight" [S1][S6].
3. UI motion stays at or under **300 ms**, and most of it falls between **100 and 200 ms** [S1][S7].
4. Entrances and exits use a strong **ease-out**, `cubic-bezier(0.23, 1, 0.32, 1)`. Movement on screen uses **ease-in-out**. Colour changes use `ease`. Nothing uses `ease-in` [S1].
5. Animate only `transform`, `opacity` and occasionally `clip-path`. Never write `transition: all` [S1][S7][S15].
6. Feedback lands on **pointer-down**, inside **100 ms** [S11][S23].
7. Never animate from nothing: start at `scale(0.95–0.97)` with `opacity: 0`. Popovers grow from their trigger, but modals stay centred [S1][S29].
8. Exits run faster than entrances. As a rule of thumb, the exit takes about 60 % of the entrance time (Radix Themes: 160 → 100 ms) [S29].
9. **Reduced motion is designed, not deleted.** Keep fades and colour changes of 200 ms or less and drop every positional, scale or parallax move [S1][S9][S22].
10. Route changes cross-fade `<main>` for at most 200 ms through React 19.3 `<ViewTransition>`. The browser is not hit-testing during the cross-fade, so it must stay short [S16][S18].

---

## 1. When to animate (the gate)

| Frequency                                                             | Decision                              | Source |
| --------------------------------------------------------------------- | ------------------------------------- | ------ |
| 100+ times a day: keyboard shortcuts, command palette, core nav, sort | **No animation. Ever.**               | [S1]   |
| Tens of times a day: hover, list navigation, toggles                  | Remove it, or keep it fast and subtle | [S1]   |
| Occasional: dialogs, sheets, toasts, a range switch                   | Standard animation                    | [S1]   |
| Rare or first-time: first visit to Home, empty states, success        | This is the only "delight" budget     | [S1]   |
- An animation needs a named purpose: **feedback, spatial consistency, state indication, preventing a jarring change, or explanation**. "It looks cool" does not qualify [S1].
- Data that people read or act on must not move for style. Emil's own rejected example is "animated line drawing on the analytics graph" [S1].
- Frequent, low-novelty actions skip extra motion: opening a context menu, adding or deleting list items, hovering trivial buttons. The macOS context menu animates out but not in [S5].
- Rauno's working rule: the more often an action is performed, the less any novel motion pays off. Make "90 % of the experience familiar, and 10 % novel" [S6].
- Apple: "generally avoid adding motion to UI interactions that occur frequently", "let people cancel motion", and "aim for brevity and precision" [S8].
- The preference order for implementation is CSS, then WAAPI, then a JS library. A motion library is never worth installing just for a fade [S1][S7].

---

## 2. Tokens

### 2.1 Easing curves (exact)

| Token                                 | Value                                         | Use                                                                      | Source    |
| ------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ | --------- |
| `--ease-out`                          | `cubic-bezier(0.23, 1, 0.32, 1)`              | Entrances, exits, press, popovers                                        | [S1]      |
| `--ease-in-out`                       | `cubic-bezier(0.77, 0, 0.175, 1)`             | Something already on screen moves or morphs (tab indicator, chart morph) | [S1]      |
| `--ease-drawer`                       | `cubic-bezier(0.32, 0.72, 0, 1)`              | Sheets and drawers (iOS-like curve, used by Vaul and Ionic)              | [S1][S4]  |
| `ease`                                | browser keyword                               | Hover colour and background changes                                      | [S1]      |
| `linear`                              | browser keyword                               | Progress, hold-to-confirm fills, constant motion                         | [S1]      |
| Radix Themes ease-out                 | `cubic-bezier(0.16, 1, 0.3, 1)`               | Reference: Radix's popper, tooltip and dialog curve                      | [S29]     |
| M3 standard                           | `cubic-bezier(0.2, 0, 0, 1)`                  | Reference: utility motion that begins and ends on screen                 | [S12]     |
| M3 standard decelerate / accelerate   | `(0, 0, 0, 1)` / `(0.3, 0, 1, 1)`             | Reference: utility enter / exit                                          | [S12]     |
| M3 emphasized decelerate / accelerate | `(0.05, 0.7, 0.1, 1)` / `(0.3, 0, 0.8, 0.15)` | Reference: expressive enter / exit                                       | [S12]     |
| M3 legacy ("fast-out-slow-in")        | `cubic-bezier(0.4, 0, 0.2, 1)`                | Do not use: Emil names it as the familiar default to avoid inventing     | [S1][S12] |
| Motion default tween                  | `[0.25, 0.1, 0.35, 1]`, 0.3 s                 | Reference: Motion's default for opacity and colour                       | [S15]     |
- **Never use `ease-in` on UI.** "A dropdown with `ease-in` at 300ms feels slower than `ease-out` at the same 300ms" [S1]. Josh Comeau: ease-in is "pretty much exclusively useful" when the element ends offscreen or invisible [S14].
- The built-in CSS keywords are "too weak", so use the strong custom curves above [S1].
- `linear()` springs are now **Baseline widely available** (since 2026-06-11: Chrome 113, Firefox 112, Safari 17.2), so CSS can carry a spring curve without JS [S21][S14].

### 2.2 Durations per interaction type

| Interaction                       | Duration                                                              | Easing      | Source                   |
| --------------------------------- | --------------------------------------------------------------------- | ----------- | ------------------------ |
| Press feedback (`:active` scale)  | **100–160 ms**                                                        | ease-out    | [S1]                     |
| Hover colour/background           | **≤ 150 ms** in; may fade out at 150–200 ms (**Depthwatch call**)     | ease        | [S1][S14]                |
| Toggle / segmented thumb          | **150–200 ms**                                                        | ease-in-out | [S1]                     |
| Tooltip (first one, after delay)  | **125–200 ms** (Emil 125; Radix Themes 140)                           | ease-out    | [S1][S29]                |
| Tooltip (subsequent within group) | **0 ms** (no delay and no animation)                                  | none        | [S1][S7][S29]            |
| Popover / dropdown / menu         | **150–250 ms** in (Radix Themes 160), **100 ms** out                  | ease-out    | [S1][S29]                |
| Modal / dialog                    | **200–250 ms** in, **100–160 ms** out                                 | ease-out    | [S1][S29]                |
| Sheet / drawer (phone)            | **300–500 ms** (Vaul 500 ms)                                          | ease-drawer | [S1][S4]                 |
| Toast                             | **400 ms** `ease` (Sonner), 4 s lifetime                              | ease        | [S3]                     |
| Accordion / disclosure (height)   | **≤ 200 ms**                                                          | ease-out    | [S1]                     |
| Route cross-fade                  | **150–200 ms** (UA default is 250 ms)                                 | ease-out    | [S18]**Depthwatch call** |
| List / grid stagger               | **30–80 ms** between items, each item ≤ 300 ms                        | ease-out    | [S1]                     |
| Chart range morph                 | **250–300 ms** (d3 default 250 ms cubic-in-out)                       | ease-in-out | [S34]**Depthwatch call** |
| Number change (user-initiated)    | **≤ 300 ms**; NumberFlow's 900 ms default is too long for a dashboard | —           | [S36]**Depthwatch call** |
| Keyboard-initiated anything       | **0 ms**                                                              | —           | [S1]                     |
| Focus ring                        | **0 ms** (appears instantly)                                          | —           | [S1]**Depthwatch call**  |

Reference scales:
- M3 durations [S12]: short 1–4 = 50/100/150/200 ms; medium 1–4 = 250/300/350/400 ms; long 1–4 = 450/500/550/600 ms; extra-long = 700–1000 ms.
- M3 pairings (secondary sources): enter uses emphasized decelerate at 400 ms, exit uses emphasized accelerate at 200 ms, and on-screen movement uses emphasized at 500 ms [S12b].
- Material's own rule is that duration grows with the area or distance the animation covers [S12].
- Vercel/Rauno puts the ceiling lower than Emil: "Animation duration should not be more than 200ms for interactions to feel immediate" [S5].

### 2.3 Springs

| System                          | Parameters                                                                                                                                                                                                                                                                  | Use                                                                   | Source         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------- |
| Apple (WWDC18 Fluid Interfaces) | damping **1.0** (critically damped) by default; **0.8** only after a flick; response **0.3–0.4 s**                                                                                                                                                                          | Move: 1.0/0.4; drawer: 0.8/0.3                                        | [S11] via [S1] |
| SwiftUI                         | `.default` response **0.55**, damping **1.0**; `.smooth` bounce 0; `.snappy` bounce **0.15**; `.bouncy` bounce **0.3**; all duration **0.5 s**                                                                                                                              | Presets                                                               | [S10]          |
| Motion (motion.dev)             | Physics defaults stiffness **100**, damping **10**, mass **1**. Duration API defaults visualDuration **0.3 s**, bounce **0.3**. With no transition set: x/y spring stiffness **500**/damping **25**; scale critically damped, stiffness **550**; opacity/colour 0.3 s tween | Library defaults                                                      | [S15]          |
| M3 standard springs             | Spatial (damping/stiffness): fast **0.9/1400**, default **0.9/700**, slow **0.9/300**. Effects (colour/opacity): fast **1/3800**, default **1/1600**, slow **1/800**                                                                                                        | Fast = small components; default = partial-screen; slow = full-screen | [S12]          |
| M3 expressive springs           | Spatial: fast **0.6/800**, default **0.8/380**, slow **0.8/200**. Effects are the same as standard                                                                                                                                                                          | Playful products: too bouncy for us                                   | [S12]          |
| Emil                            | `{ type: "spring", duration: 0.5, bounce: 0.2 }`; keep bounce **0.1–0.3**; no bounce in most UI                                                                                                                                                                             | Drag-to-dismiss, gestures                                             | [S1]           |
- Springs keep their velocity when interrupted; keyframes restart from zero. Anything a user can grab or reverse should use a spring or a CSS transition, never `@keyframes` [S1][S11].
- Overshoot belongs only after momentum. "Overshoot on a menu that just faded in feels wrong; overshoot on a card you flicked feels right" [S1][S11].
- Colour and opacity never bounce. M3's "effects" springs are critically damped (damping 1) for exactly this reason [S12].
- **Depthwatch call:** no bounce anywhere. Use damping 1.0 (bounce 0) for the phone sheet; everything else is a duration-based CSS transition.

### 2.4 Distances and scales

- Enter from `scale(0.95)` (range 0.9–0.97) together with `opacity: 0`. **Never use `scale(0)`** [S1]. Rauno allows a dialog to start from about 0.8 [S5]. **Depthwatch call:** 0.96 for dialogs and 0.97 for popovers.
- Press: `scale(0.97)` (range 0.95–0.98). Rauno's range is about 0.96 and never 0.8 [S1][S5].
- Popover travel: `translateY(4px) scale(0.97)` toward the trigger side (Radix Themes) [S29].
- Stagger travel: `translateY(8px)` [S1].
- M3 references: fade-through starts the incoming page at scale **0.92**; the outgoing page fades during the first **35 %** of a **450 ms** run; shared-axis slide distance is **30 dp** [S13].

---

## 3. Never animate (Depthwatch list)

1. Anything started from the keyboard: shortcuts, arrow-key moves in a segmented control, `/` to search, Escape [S1].
2. `transition: all`. List the properties instead (usually `opacity` and `transform`) [S1][S7].
3. Layout properties (`width`, `height`, `top`, `left`, `margin`, `padding`) except a short accordion height [S1][S15].
4. `box-shadow`, which repaints every frame. Fade a pseudo-element's opacity or use `filter: drop-shadow()` instead [S1].
5. Table re-sorts, filter results, row add/remove (frequent and low-novelty) [S5].
6. Chart lines "drawing in" on page load, and bars growing on every refetch [S1].
7. Live ticks such as the block number or "updated just now": swap the text instantly [S1] **Depthwatch call**.
8. Infinite loops in parallel with content, such as a pulsing live dot or a skeleton shimmer that never stops. If it runs over 5 s it needs pause, stop or hide (WCAG 2.2.2), and loops must pause offscreen [S22][S5].
9. Theme switch: suppress element transitions for that frame [S5][S38].
10. Hover "lift" on cards (translateY plus shadow), and hover motion on touch devices [S1][S5].
11. Scroll-jacking, parallax behind data, or reveal-on-scroll on functional pages. Reveal-on-scroll is "marketing surfaces only", fires once, and only when "re-animating on every scroll-by" would not happen [S1].
12. Count-up numbers on load. The number is the content; animating it delays the read [S1] **Depthwatch call**.

---

## 4. Per-component specifications

| Component                                              | Spec                                                                                                                                                                                                                                                                                                             | Source              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Button / link press                                    | `transition: transform 160ms var(--ease-out)`; `:active { transform: scale(0.97) }`; applies to anything pressable                                                                                                                                                                                               | [S1]                |
| Button hover                                           | Background or colour only, `ease`, ≤ 150 ms, gated by `@media (hover: hover) and (pointer: fine)`; contrast on hover, active and focus must exceed the rest state                                                                                                                                                | [S1][S7]            |
| Font weight on hover/selected                          | Never change it (it shifts layout)                                                                                                                                                                                                                                                                               | [S5]                |
| Table row hover                                        | Background tint; **Depthwatch call:** 0 ms in, 150 ms `ease` out. Never animate the row's position                                                                                                                                                                                                               | [S1][S14]           |
| Segmented control (±1/2/5 %, $1k/$10k/$100k, 24 h/7 d) | Thumb `transform` 150–200 ms `--ease-in-out`; 0 ms when changed by keyboard; prefer the clip-path duplicate technique so text colour and thumb change in sync                                                                                                                                                    | [S1]                |
| Tooltip                                                | First open after **600–700 ms** of hover; each later one in the group opens instantly (window **300–400 ms**); 125–140 ms `scale(0.97)` + fade from the trigger side; no interactive content; Escape dismisses; hoverable and persistent (WCAG 1.4.13)                                                           | [S29][S30][S1][S22] |
| Popover / menu                                         | `transform-origin: var(--transform-origin)` (the trigger); 160–200 ms in / 100 ms out; open on `mousedown` / pointer-down; hover-opened submenus use a safe triangle                                                                                                                                             | [S1][S5][S29][S31]  |
| Dialog                                                 | Centred origin; 200–250 ms in from `scale(0.96)` + opacity; 100–160 ms out; backdrop opacity moves with it; `overscroll-behavior: contain`                                                                                                                                                                       | [S1][S29][S7]       |
| Phone sheet (filters, nav)                             | Vaul: `translateY(100%)` → 0 over 500 ms `--ease-drawer`; dismiss on flick velocity > **0.4 px/ms** (Vaul) or > **0.11** (Emil, Sonner-style), or past **25 %** height; rubber-band beyond the edge; pointer capture                                                                                             | [S4][S1][S11]       |
| Toast                                                  | Sonner: lifetime **4000 ms**, enter/exit from the same edge over 400 ms, at most **3** visible, **14 px** gap, swipe threshold **45 px**, timer pauses when the tab is hidden, `transition: none` under reduced motion. Copy confirmation is **inline** ("Copied" with a check next to the trigger), not a toast | [S3][S5]            |
| Accordion (methodology)                                | Height + opacity ≤ 200 ms; `interpolate-size: allow-keywords` only as an enhancement (Chrome 129+ only)                                                                                                                                                                                                          | [S1][S21]           |
| Hold-to-confirm (not needed today)                     | 2 s `linear` fill on press, 200 ms ease-out snap back                                                                                                                                                                                                                                                            | [S1]                |
| Embed / badge copy                                     | Inline check for ~2 s (**Depthwatch call**); `aria-live="polite"` announcement                                                                                                                                                                                                                                   | [S5][S7]            |

---

## 5. Perceived performance: feedback, loading, optimism

### 5.1 Thresholds

| Threshold                                                  | Meaning                                                  | Source     |
| ---------------------------------------------------------- | -------------------------------------------------------- | ---------- |
| **100 ms**                                                 | Feels instantaneous: the user feels they caused it       | [S23]      |
| **1 s**                                                    | The flow of thought is kept, though the delay is noticed | [S23]      |
| **10 s**                                                   | Attention is lost: show an estimate or percent done      | [S23][S24] |
| **400 ms**                                                 | Doherty threshold for a productive back-and-forth        | [S25]      |
| **INP ≤ 200 ms** good, **> 500 ms** poor (75th percentile) | Input-to-paint budget                                    | [S26]      |
| **16.7 ms** a frame at 60 Hz, **8.3 ms** at 120 Hz         | Per-frame budget; "design against the smaller number"    | [S1]       |
| POST/PATCH/DELETE **< 500 ms**                             | Mutation budget                                          | [S7]       |

### 5.2 Rules

- **Respond on pointer-down, not on click.** Highlight on press and commit on release [S11]. Menus open on `mousedown` [S5].
- **Show no loading UI below about 150–300 ms.** Once one is shown, keep it at least **300–500 ms** so it never flickers [S7]. React Suspense already batches reveals every **300 ms** (`FALLBACK_THROTTLE_MS`) [S27].
- **Choosing an indicator:**
  - Skeletons fit **full-page or region loads under 10 s**. Spinners fit roughly **2–10 s** waits that are not page loads. Beyond 10 s, use a progress bar with an estimate [S24].
  - Skeletons must **mirror the final layout exactly** so nothing shifts [S7].
  - Pulse skeletons slowly: Radix Themes uses **1000 ms alternate**, Tailwind `pulse` uses **2 s `cubic-bezier(0.4, 0, 0.6, 1)`**. Make them static under reduced motion [S29][S37].
- **Keep the previous data when parameters change.** Depthwatch already uses `placeholderData: keepPreviousData` [S28]. **Depthwatch call:** while a range or size switch is pending, keep the old chart. After 150 ms, dim it to `opacity: 0.6` and show a 2 px indeterminate bar at the panel top. Never fall back to a skeleton once content exists.
- **Progressive reveal.** Paint the page chrome, headings and captions immediately and let data blocks fill in. Group reveals (Suspense's 300 ms batch) so the page does not pop in piecemeal [S27][S7].
- **Optimistic and instant local work.** Client-side sort and filter run synchronously, with no spinner and no animation. Mutations update first and roll back with an error and Undo [S7][S5].
- **Loading buttons** keep their label and add an indicator. Labels end with an ellipsis ("Loading…") [S7].
- **A faster spinner reads as a faster load** for the same wait [S1].

---

## 6. View Transitions (2026 status and our integration)

### 6.1 Browser support (MDN BCD 8.1.7 / web-features 3.44.0) [S21]

| Feature                                                              | Chrome    | Firefox                      | Safari      | Baseline                         |
| -------------------------------------------------------------------- | --------- | ---------------------------- | ----------- | -------------------------------- |
| Same-document `document.startViewTransition()`                       | 111       | 144                          | 18          | **Newly available, 2025-10-14**  |
| `view-transition-class`                                              | 125       | 144                          | 18.2        | Newly available, 2025-10-14      |
| Transition types (`types`)                                           | 125       | 147                          | 18.2        | Yes (all three engines)          |
| `view-transition-name: match-element`                                | 137       | 144                          | 18.4        | Yes (all three engines)          |
| `:active-view-transition` selector / `document.activeViewTransition` | 125 / 142 | 144 / 147                    | 18 / 26.2   | Newly available, 2026-01-13      |
| **Cross-document** `@view-transition { navigation: auto }`           | 126       | **no**                       | 18.2        | **Not Baseline**                 |
| Element-scoped `Element.startViewTransition()`                       | 147       | no                           | no          | No                               |
| `view-transition-group` (nested groups)                              | 140       | no                           | no          | No                               |
| `@starting-style`, `transition-behavior: allow-discrete`             | 117       | 129                          | 17.5 / 17.4 | Newly available, 2024-08-06      |
| Scroll-driven animations (`animation-timeline`)                      | 115       | 159 (beta, ships 2026-10-27) | 26          | Not yet                          |
| `@container scroll-state()`                                          | 133       | no                           | no          | No                               |
| `interpolate-size` / `calc-size()`                                   | 129       | no                           | no          | No                               |
| `linear()` easing                                                    | 113       | 112                          | 17.2        | **Widely available, 2026-06-11** |

### 6.2 How it behaves (spec)

- The UA default is a **0.25 s** cross-fade (`::view-transition-group(*) { animation-duration: 0.25s }`) using `plus-lighter` blending [S18].
- During the animation, captured elements **do not respond to hit-testing** (as if they had `pointer-events: none`). While the update callback runs, all hit-testing goes to the document element. A long transition is therefore a dead page, which is why route transitions stay ≤ 200 ms [S18].
- The old view is a static snapshot. The new view is live DOM [S19].
- Two elements rendered with the same `view-transition-name` make the browser **skip** the transition [S19].
- A cross-document transition is skipped if navigation takes more than **4 s** (Chrome, `TimeoutError`) [S20].

### 6.3 Integration in this repo (React 19.3.1, react-router-dom 7.18.4, declarative `BrowserRouter`/`HashRouter`)

- **Use React's `<ViewTransition>`** (stable in React 19.3, exported from `react`). React Router's `viewTransition` prop and `useViewTransitionState` are **deprecated**, and they only work in Data/Framework mode. Depthwatch uses declarative mode, so the legacy prop is not even an option [S17][S16].
- The declarative `BrowserRouter` wraps router updates in `React.startTransition` unless `useTransitions={false}` is set (checked in the 7.18.4 source). A `<ViewTransition>` around the `<Outlet/>` inside `Layout` therefore animates navigations without extra code. Keep the boundary mounted and do not key it by location [S17].
- React calls `startViewTransition` itself. Never call it alongside React, because React will interrupt a foreign transition [S16].
- React waits for data and CSS, and up to **500 ms** for fonts and visible images, before it starts [S16].
- **Back/Forward (popstate) navigations are not animated** by React [S16][S17]. **Depthwatch call:** that is the desired behaviour, since Back should feel instant.
- Only Transition, Suspense or `useDeferredValue` updates activate it. A plain `setState` does not [S16].
- **Depthwatch call:**
  - Cross-fade only `<main>`. The header, nav and demo banner stay outside the boundary so they never flicker.
  - Override the cross-fade to **180 ms `--ease-out`**, with no slide.
  - Use one optional shared element, the pool pair title, going from a list row to the pool-detail H1 (`<ViewTransition name={"pool-" + id}>`), at **250 ms `--ease-in-out`**.
  - Use `addTransitionType` only if forward and back ever need to differ.
- Reduced motion must be done by hand, because React does not do it [S16]:

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}
```

- Browsers without View Transitions simply navigate instantly, so this is progressive enhancement [S17].

---

## 7. Reduced motion

- **Write CSS no-motion-first.** Put movement inside `@media (prefers-reduced-motion: no-preference)` (Radix Themes does this) [S29]. Josh Comeau's hook treats "unknown" (including the server render) as reduced [S14].
- **Keep** opacity and colour transitions that aid comprehension, at about 200 ms or less. **Drop** translate, scale, parallax, springs and blur-ins. Reduced means "fewer and gentler", not zero [S1].
- Apple's Reduce Motion list [S9]:
  - Replace x/y/z transitions with fades.
  - Tighten springs.
  - Stop animating depth.
  - Avoid animating into and out of blurs.
  - Reduce automatic or repeating animation, zooming, scaling and peripheral motion.
- Avoid sustained oscillation near **0.2 Hz** (one cycle every 5 s) [S8].
- Library switches:
  - Motion: `<MotionConfig reducedMotion="user">` turns transform animations off [S15].
  - Recharts 3: `isAnimationActive="auto"` already disables animation when reduced motion is set [S35].
  - NumberFlow: `respectMotionPreference` is on by default [S36].
  - Sonner: `transition: none` [S3].
- WCAG [S22]:
  - **2.3.3** (AAA): motion triggered by interaction can be disabled.
  - **2.2.2** (A): anything moving or auto-updating for **> 5 s** in parallel with content needs pause/stop/hide or frequency control.
  - **2.3.1** (A): ≤ **3 flashes a second**.
- `prefers-reduced-transparency` exists in Chrome 118+ only. Make translucent chrome solid when it is set [S21][S1].

---

## 8. Focus and keyboard

- Use `:focus-visible` (Baseline widely available) and not `:focus` [S7][S21].
- The ring must cover at least a **2 px** perimeter and change contrast by at least **3:1** (WCAG 2.4.13, AAA) [S22]. The current 2 px ring and 2 px offset passes. Rauno prefers box-shadow rings for radius, but Safari 16.4+ makes `outline` follow `border-radius`, so outline is fine [S5].
- The ring appears **instantly**. Focus moves come from the keyboard, so they get no animation [S1].
- The sticky header must never fully cover a focused element (WCAG 2.4.11, AA). Set `scroll-padding-top` to the header height and `scroll-margin-top` on headings [S22][S7].
- Every flow is keyboard-operable using the WAI-ARIA APG patterns. Focus is trapped and returned for dialogs and sheets [S7].
- Arrow keys move through sequential lists and segmented controls; Escape closes overlays [S5][S7].
- Hover-triggered content (WCAG 1.4.13) must be **dismissible** (Escape), **hoverable** and **persistent** [S22].
- Disabled buttons get no tooltips, because keyboard users cannot reach them [S5].

---

## 9. Hover intent and pointer

| Pattern                                    | Number                                                                | Source        |
| ------------------------------------------ | --------------------------------------------------------------------- | ------------- |
| Tooltip open delay                         | Radix **700 ms**; Base UI **600 ms**                                  | [S29][S30]    |
| "Skip delay" window after a tooltip closes | Radix **300 ms**; Base UI group **400 ms**                            | [S29][S30]    |
| Tooltip close delay                        | Base UI **0 ms**                                                      | [S30]         |
| Hover-opened popover                       | Base UI **300 ms**                                                    | [S30]         |
| Hover-opened menu / submenu                | Base UI **100 ms**                                                    | [S30]         |
| hoverIntent heuristic                      | Pointer must slow to < **6–7 px** of movement per **100 ms** poll     | [S32]         |
| Safe triangle ("prediction cone")          | Floating UI `safePolygon()`, buffer **0.5 px**, `requireIntent: true` | [S31][S5][S7] |
- Gate all hover styles with `@media (hover: hover) and (pointer: fine)`. Touch devices fire a sticky false hover on tap [S1][S5].
- **The doom flicker:** if hovering moves the element out from under the cursor, the hover toggles rapidly. Move a child or a pseudo-element and leave the hit area still; use `translate` rather than `margin` [S14].
- No dead zones between items in a list. Grow their padding instead [S5].
- Decorative layers get `pointer-events: none` [S5].
- **Depthwatch call:** the only hover-triggered content is the tooltips (glossary terms such as "HHI" and "turnover"). Nothing opens a menu on hover.

---

## 10. Touch and phones

- Press feedback on `:active` (`scale(0.97)`, **100–160 ms**), because touch has no hover [S1].
- `html { -webkit-tap-highlight-color: transparent }`, always replaced by a designed `:active` state [S1][S5].
- `touch-action: manipulation` on controls removes the double-tap-zoom delay [S1][S7].
- Targets:
  - **24×24 CSS px** minimum (WCAG 2.5.8, AA) and **44×44** enhanced (2.5.5, AAA) [S22].
  - Apple's default is **44×44 pt** (minimum 28×28) with about **12 pt** of padding around bezelled controls [S9].
  - Vercel: ≥ 24 px, and **44 px on mobile** [S7].
- Inputs use a font size of at least **16 px**, or iOS zooms the page. Never disable zoom [S1][S5][S7].
- `overscroll-behavior: contain` on sheets and modals. Keep pull-to-refresh on coarse pointers [S1][S7].
- Use `100dvh` for app shells and `100svh` for heroes, never `100vh` [S1].
- `user-select: none` on controls only, never on body text [S1].
- Gestures for sheets (Vaul):
  - Dismiss on velocity or on distance (**25 %**).
  - Ignore a second finger, and capture the pointer.
  - Require about **10 px** of hysteresis before committing to a direction.
  - Every gesture also has a tap or keyboard alternative (WCAG 2.5.7) [S4][S1][S11][S7].
- Test on real hardware. Emulation does not show sticky hover, tap delay, safe areas or the keyboard [S1].

---

## 11. Scroll-linked effects, tastefully

- Allowed only where they explain position or separate layers:
  - The sticky header gains a hairline or shadow after **0 → 8 px** of scroll. Use `animation-timeline: scroll()` with `animation-range: 0 8px`, falling back to an IntersectionObserver sentinel [S21].
  - A reading-progress bar on the long Methodology page.
  - Use "scroll edge effects" (a soft fade or blur) where floating chrome overlaps content, rather than a hard border [S1][S11] **Depthwatch call**.
- `animation-timeline` is **not Baseline yet**: Chrome 115, Safari 26, and Firefox 159 is still in beta. Treat it as progressive enhancement only [S21].
- Use `scroll-behavior: smooth` for in-page anchors only, with an offset, and turn it off under reduced motion [S5].
- Reveal-on-scroll is for marketing surfaces only and fires once (`once: true`, margin `-100px`) [S1].
- Never move full-viewport backgrounds, never run parallax behind numbers, and never hijack the scroll [S1][S9].
- Big moving objects become semi-transparent in transit. Fade large surfaces out during a big reposition and back in once settled [S1][S8].

---

## 12. Charts and numbers

### 12.1 Charts

- **No draw-in on load or refetch.** A line chart people read is functional data [S1]. Today the app sets `isAnimationActive={false}` everywhere, and that is correct for line and area charts. Recharts' own defaults are long: Line/Area **1500 ms**, Bar **400 ms**, Tooltip **400 ms**, all `ease` [S35].
- **Arrival:** when a chart's data first arrives, an opacity fade of **150–200 ms** is allowed. It prevents a jarring change and is kept under reduced motion [S1] **Depthwatch call**.
- **Range switch (24 h ↔ 7 d, ±1/2/5 %):**
  - Morph only when marks correspond: the same series and the same entity. Otherwise cross-fade. Heer & Robertson's congruence principles are "maintain valid data graphics", "respect semantic correspondence" and "avoid ambiguity" [S33].
  - Simple transitions of about **1 s** tracked best in their studies, and the rule is "as long as needed, but no longer". Rescaling the axes and changing the values in separate stages costs time; their results on staging were mixed [S33].
  - **Depthwatch call:** users switch ranges tens of times a day, so morph over **250–300 ms `--ease-in-out`**, with axes and values moving together. d3's default is **250 ms cubic-in-out** [S34].
- **Crosshair and tooltip follow the pointer 1:1 with 0 ms easing.** This is direct manipulation [S11]. Set the Recharts Tooltip `animationDuration` to 0 or disable it.
- **SVG transforms:** animate a `<g>` wrapper with `transform-box: fill-box; transform-origin: center` (Safari origin bugs) [S7].
- **Depth ladder and uptime tape:** static. **Depthwatch call:** on the Home hero only, the first time a session sees it, the ladder bars may grow out from the centre axis (`scaleX` with the origin at the axis, 300 ms ease-out, 30 ms stagger, ≤ 450 ms in total) to _explain_ "two sides of the book". This is the "explanation" purpose in the rare/first-time tier [S1].

### 12.2 Numbers

- Use `font-variant-numeric: tabular-nums` everywhere numbers update or are compared, so digits do not jitter [S5][S7].
- **Live updates** (the block number, "updated … ago", refetched KPIs): swap the text with no motion [S1]. **Depthwatch call:** an optional one-shot 600 ms background-tint fade marks a changed value. It is colour only, so it survives reduced motion, and it fires at most once per update, which keeps it far below WCAG 2.3.1's 3 flashes a second.
- **User-initiated parameter changes** on headline figures may use a digit roll. NumberFlow defaults to **900 ms** spring transform and **450 ms** opacity, skips animation when the tab is hidden, and respects reduced motion. Cap it at **≤ 300 ms** for a dashboard, or cross-fade in 150 ms instead [S36] **Depthwatch call**.
- No count-up on load (§3).

---

## 13. Performance rules

- Composite-only properties: `transform`, `opacity`, and in current engines `filter` and `clip-path`. Motion's tier list puts these in its S tier [S15][S1].
- **Swaps:**
  - `width` or `height` → `scale()`.
  - `top`, `left` or `margin` → `translate()`.
  - `box-shadow` → `filter: drop-shadow()` or a pseudo-element's opacity.
  - `display` → `opacity`. `@starting-style` and `transition-behavior: allow-discrete` handle entering and leaving `display: none` [S1][S21].
- **Where motion runs:** CSS and WAAPI can run off the main thread; rAF/JS cannot. Vercel's tab indicator dropped frames during page loads until it moved to CSS. Route-time motion must be CSS [S1].
- **Motion library:** the `x`/`y`/`scale` shorthands run on the main thread. Use `transform: "translateX()"` strings when the page is busy [S1].
- **React:** write per-frame values to `ref.current.style`, never to state. Do not drive child transforms through an inherited CSS variable: Vaul lagged once a drawer held more than about 20 items [S1][S5].
- **Blur:** keep animated blur ≤ 20 px; 2–5 px is enough to mask a cross-fade [S1].
- **`will-change`:** only once a 1 px shift or dropped frames have been observed, and only on the animating element [S1][S5].
- Pause loops offscreen. Virtualise or use `content-visibility: auto` for long lists [S5][S7].
- Test against an iOS Low Power Mode or mid-range phone, at 120 Hz [S1][S7].

---

## 14. Depthwatch surface map

| Surface                               | Motion                                                                                                                                 | Rejected (and why)                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Top nav links                         | Colour 120 ms `ease`; active indicator moves 200 ms `--ease-in-out` on click, 0 ms on keyboard                                         | Underline grow-in on hover (tens a day)        |
| "Block 52,950,000 · updated just now" | Instant text swap; optional 600 ms tint on a new block                                                                                 | Infinite pulsing dot (WCAG 2.2.2, distraction) |
| Home hero (first session visit)       | Stagger the H1, subline, CTAs and the KPI panel: `translateY(8px)` + opacity, 300 ms, 50 ms apart, ≤ 500 ms in total, once per session | Count-up KPIs, typewriter headline             |
| KPI tiles                             | Static; `tabular-nums`                                                                                                                 | Hover lift                                     |
| Gaps / Pools tables                   | Row hover tint 0 ms in / 150 ms out; sort and filter instant                                                                           | Row reorder (FLIP) animation                   |
| Gap meter / score bars                | Static                                                                                                                                 | Grow-in on scroll                              |
| Segmented controls                    | Thumb 150–200 ms `--ease-in-out`; data swaps per §5 and §12                                                                            | Spring bounce                                  |
| Pool detail charts                    | §12 morph or cross-fade; instant crosshair                                                                                             | Line draw-in                                   |
| Depth ladder                          | Static; optional first-visit explain-animation on Home only                                                                            | Per-refetch regrowth                           |
| Uptime tape                           | Static                                                                                                                                 | Ticks sweeping in                              |
| Scorecard badge / embed copy          | Inline "Copied ✓" ~2 s; `aria-live`                                                                                                    | Toast                                          |
| Glossary tooltips                     | 600 ms delay, 140 ms in, instant within group                                                                                          | Tooltips on disabled controls                  |
| Route changes                         | `<ViewTransition>` cross-fade of `<main>`, 180 ms; optional shared pool title, 250 ms; Back/Forward instant                            | Slides, page-wide fades                        |
| Phone nav / filter sheet              | Vaul-style sheet, 500 ms `--ease-drawer`, velocity dismiss                                                                             | Hamburger morph theatrics                      |
| Theme toggle                          | Suppress element transitions for one frame; optional 200 ms root cross-fade (none under reduced motion)                                | Per-element colour transitions                 |
| Loading                               | Nothing < 300 ms; then a static skeleton that mirrors the layout; keep previous data on parameter change                               | Spinners for page loads, endless shimmer       |

---

## 15. Proposed tokens (for `apps/web/src/styles.css`)

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --dur-press: 160ms; /* :active scale */
  --dur-hover: 120ms; /* colour/background */
  --dur-tooltip: 140ms;
  --dur-popover: 180ms; /* exit: --dur-exit */
  --dur-exit: 100ms;
  --dur-dialog: 240ms;
  --dur-route: 180ms;
  --dur-morph: 280ms; /* chart range change, indicator slide */
  --dur-sheet: 500ms;
  --stagger: 50ms;
  --press-scale: 0.97;
  --enter-scale: 0.96;
}
@media (prefers-reduced-motion: reduce) {
  :root {
    --press-scale: 1;
    --enter-scale: 1;
    --stagger: 0ms;
    --dur-morph: 0ms;
    --dur-sheet: 200ms;
  }
}
```

All three dark/light theme blocks stay colour-only. Motion tokens live in the non-colour `:root` block (visual.md §1).

---

## 16. QA checklist (testable)

- [ ] `grep -r "transition: all\|transition:all"` returns nothing; no `ease-in` on UI.
- [ ] No UI transition over 300 ms, except sheet (500) and first-visit hero (≤ 500 in total).
- [ ] Every pressable element has `:active` feedback; hover styles sit under `(hover: hover) and (pointer: fine)`.
- [ ] No animation starts from `scale(0)`; popovers set `transform-origin` to the trigger.
- [ ] Keyboard actions (arrow keys, Escape, shortcuts) cause no animation; the focus ring appears in 0 ms and is never covered by the sticky header.
- [ ] Reduced motion: no `transform`, translate or scale animation remains (check with DevTools "Emulate prefers-reduced-motion"); fades stay ≤ 200 ms; view-transition pseudos have `animation: none`.
- [ ] Nothing loops more than 5 s in parallel with content; loops pause offscreen.
- [ ] No loading indicator appears for responses under 300 ms; any shown stays at least 300 ms; skeletons match the final layout (CLS 0).
- [ ] Parameter switches keep previous data; nothing flashes back to a skeleton.
- [ ] INP ≤ 200 ms on a 4× CPU-throttled profile; animations hold 60 fps on a mid-range phone.
- [ ] Charts: no draw-in; crosshair tracks 1:1; morph ≤ 300 ms and only between corresponding marks.
- [ ] Touch targets ≥ 24 px (44 px for primary phone controls); inputs ≥ 16 px.
- [ ] Review animations at 2–5× slow motion and frame by frame (DevTools Animations panel), and again the next day [S1].

---

## Sources

Read directly (raw files, packages or official JSON):
- **[S1]** Emil Kowalski, `emilkowalski/skills`: `emil-design-eng`, `review-animations/STANDARDS.md`, `animate` (+ `RECIPES.md`), `animation-performance`, `apple-design`, `mobile-native`, `find-animation-opportunities`. https://github.com/emilkowalski/skills (distils https://emilkowal.ski/ui/great-animations, https://emilkowal.ski/ui/7-practical-animation-tips, https://emilkowal.ski/ui/you-dont-need-animations, https://animations.dev)
- **[S3]** Sonner 2.0.8 source (constants and CSS). https://github.com/emilkowalski/sonner
- **[S4]** Vaul 1.1.2 source (`TRANSITIONS`, thresholds). https://github.com/emilkowalski/vaul
- **[S5]** Rauno Freiberg, Web Interface Guidelines. https://github.com/raunofreiberg/interfaces
- **[S7]** Vercel, Web Interface Guidelines. https://github.com/vercel-labs/web-interface-guidelines (https://vercel.com/design/guidelines)
- **[S8]** Apple HIG, Motion. https://developer.apple.com/design/human-interface-guidelines/motion
- **[S9]** Apple HIG, Accessibility (Reduce Motion, control sizes). https://developer.apple.com/design/human-interface-guidelines/accessibility
- **[S10]** SwiftUI `Animation.default`, `snappy(duration:extraBounce:)`, `bouncy(...)`, `Spring(duration:bounce:)`. https://developer.apple.com/documentation/swiftui/animation/default
- **[S11]** Apple WWDC18 "Designing Fluid Interfaces", via [S1] `apple-design`. https://developer.apple.com/videos/play/wwdc2018/803/
- **[S12]** Material motion tokens: Android docs (easing, durations, springs). https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md . Compose tokens (`MotionTokens.kt`, `StandardMotionTokens.kt`, `ExpressiveMotionTokens.kt`): https://github.com/androidx/androidx/tree/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens . Spec: https://m3.material.io/styles/motion/easing-and-duration/tokens-specs
- **[S12b]** M3 enter/exit pairings (secondary). https://api.flutter.dev/flutter/material/Easing-class.html , https://design.kpay-group.com/docs/motion/type/flutter-type/flutter-intro
- **[S13]** `MaterialFadeThrough`, `FadeThroughProvider`, `SlideDistanceProvider`. https://github.com/material-components/material-components-android/tree/master/lib/java/com/google/android/material/transition
- **[S15]** Motion (motion-dom 14.6.0 `spring.mjs`, `default-transitions.mjs`; framer-motion 14.6.0 `reducedMotion`). https://github.com/motiondivision/motion . Tier list: https://motion.dev/magazine/web-animation-performance-tier-list
- **[S16]** React `<ViewTransition>` reference. https://react.dev/reference/react/ViewTransition
- **[S17]** React Router, View Transitions how-to (main) and 7.18.4 changelog/source. https://reactrouter.com/how-to/view-transitions
- **[S18]** CSS View Transitions Level 1 (UA stylesheet, hit-testing). https://drafts.csswg.org/css-view-transitions-1/ . Level 2: https://drafts.csswg.org/css-view-transitions-2/
- **[S19]** MDN, Using the View Transition API. https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using
- **[S21]** MDN browser-compat-data 8.1.7 and web-features 3.44.0 (Baseline). https://github.com/mdn/browser-compat-data , https://github.com/web-platform-dx/web-features
- **[S22]** WCAG 2.2: 2.3.3, 2.2.2, 2.3.1, 1.4.13, 2.4.11, 2.4.13, 2.5.8, 2.5.5. https://www.w3.org/TR/WCAG22/ (source: https://github.com/w3c/wcag)
- **[S27]** React DOM 19.3.1, `FALLBACK_THROTTLE_MS = 300`. https://github.com/facebook/react
- **[S28]** TanStack Query `keepPreviousData`. https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries
- **[S29]** Radix Tooltip 1.4.1 (`delayDuration` 700, `skipDelayDuration` 300) and Radix Themes 3.3.0 CSS. https://www.radix-ui.com/primitives/docs/components/tooltip , https://github.com/radix-ui/themes
- **[S30]** Base UI 1.9.0 (tooltip 600 / group 400, popover 300, menu 100). https://base-ui.com/react/components/tooltip
- **[S31]** Floating UI 0.27.20 `safePolygon`. https://floating-ui.com/docs/useHover
- **[S32]** hoverIntent (jQuery 1.10.2: sensitivity 6; tristen/hoverintent 2.2.1: sensitivity 7; interval 100). https://github.com/briancherne/jquery-hoverIntent , https://github.com/tristen/hoverintent
- **[S34]** d3-transition 3.0.1 defaults. https://github.com/d3/d3-transition
- **[S35]** Recharts 3.10.1 defaults. https://recharts.github.io/en-US/api/Line
- **[S36]** NumberFlow 0.6.2 defaults. https://github.com/barvian/number-flow
- **[S37]** Tailwind CSS 4.3.3 `--animate-pulse`. https://github.com/tailwindlabs/tailwindcss

Read through search excerpts (unverified in full):
- **[S6]** Rauno Freiberg, "Invisible Details of Interaction Design" and "Novelty". https://rauno.me/craft/interaction-design , https://rauno.me/craft/novelty
- **[S14]** Josh W. Comeau: "An Interactive Guide to CSS Transitions", "Springs and Bounces in Native CSS", "Accessible Animations in React", "Scroll-Driven Animations". https://www.joshwcomeau.com/animation/css-transitions/ , https://www.joshwcomeau.com/animation/linear-timing-function/ , https://www.joshwcomeau.com/react/prefers-reduced-motion/ , https://www.joshwcomeau.com/animation/scroll-driven-animations/
- **[S20]** Chrome for Developers, cross-document view transitions (4 s timeout). https://developer.chrome.com/docs/web-platform/view-transitions/cross-document
- **[S23]** Nielsen, response-time limits. https://www.nngroup.com/articles/response-times-3-important-limits/
- **[S24]** NN/g, Skeleton Screens 101 and Progress Indicators. https://www.nngroup.com/articles/skeleton-screens/ , https://www.nngroup.com/articles/progress-indicators/
- **[S25]** Doherty threshold. https://lawsofux.com/doherty-threshold/
- **[S26]** web.dev, INP. https://web.dev/articles/inp
- **[S33]** Heer & Robertson, "Animated Transitions in Statistical Data Graphics" (InfoVis 2007). https://idl.cs.washington.edu/files/2007-AnimatedTransitions-InfoVis.pdf
- **[S38]** Paco Coursey, disable transitions on theme change. https://paco.me/writing/disable-theme-transitions
