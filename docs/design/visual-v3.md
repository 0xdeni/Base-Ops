# Depthwatch v3 visual and interaction spec

Status: **binding for the v3 build of `apps/web`**. It replaces [`visual.md`](visual.md) (v2) for v3 work.
- Rules are cited by ID from [`principles.md`](principles.md). Screens follow [`ia-v3.md`](ia-v3.md).
- Where this file changes a rule, §2 gives the wording that `principles.md` and `ia-v3.md` carry at that rule.
- **Reference implementation:** `apps/web`. When this file and the implementation disagree on a value, this file
  wins. For anything this file does not state, match the implementation.
- Measurements below are taken at 1440×900 and 390×844 (2× DPR), in both themes, with all disclosures closed.

---

## 1. Direction

### 1.1 Quiet precision

The chosen direction is **Quiet precision**: one grid, an editorial hero split, monochrome chrome, no cards, and
colour only in data and status. Two other directions were considered, a luminous instrument built around a
field-of-light signature and a crisp wayfinding-led layout; the elements kept from them are listed in §1.3.

### 1.2 What the final design is

The final design is the Quiet precision chassis with a field-of-light signature, rebuilt so the signature stays
honest, plus a wayfinding layer.
- **The chassis:**
  - the one-grid layout and the editorial hero split;
  - money at 3 significant figures, trailing zeros kept;
  - the phone butterfly with its label line;
  - the mirrored scorecard chart;
  - the metric-matched fallback face;
  - no cards anywhere.
- **The signature, kept honest:**
  - **The field of light.** The C9 area fill is drawn as a halftone screen of the side colour. It sits under the
    pool's mirrored curve and in an **"All of Base" total row** that closes the butterfly. The total row's
    strata are the pools above, stacked outward from the spine in the same order. The shared scale is set by
    Base itself, so the gap pool reads as a hairline next to Base.
  - **The lens.** Hover, focus or tap a pool row and its stratum leaves the stack and slides to the spine. The rest
    of Base stays behind as a dimmed ghost, and the caption reads "this pool: under 1 %".
  - The interruptible tween clock: every JS morph is timed by a Web Animation.
  - Controls in the section heading row, sticky section headings, the header hairline that fades in, the
    opacity-only row hover layer, and the lollipop cost plot.
- **Wayfinding:**
  - back links above detail titles;
  - fact labels that state their comparison ("below the $50K KPI");
  - scrubbing that rewrites the facts and adds a UTC status caption;
  - the phone sort sheet with a Highest first / Lowest first control;
  - the "Buying meets 19 % more depth than selling" data caption;
  - "One scale for every pool" under the butterfly.

**What the first view does:**
- **The first view shows three things.** It holds one sentence with its number, one figure and three facts:
  7 data numbers at 1440×900 and 3 at 390×844.
- **The figure has its own texture.** The halftone field is the product's own mark: phosphor on the tinted dark
  canvas, an engraved screen on light. It only ever fills real data areas.
- **The one moment explains something.** The lens morph, where USDC / AERO collapses to a hairline under the ghost
  of Base's depth, tells the gap story without words. That is the delight a first-time visitor remembers, and it is
  the same gesture in every theme.
- **Everything around it recedes.** The chrome is monochrome with no boxes, and colour appears only in data and
  status.

### 1.3 Elements kept from the alternative directions

| Element                                               | Where                           | Why                                                                            |
| ----------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| Field of light (halftone C9 fill)                     | Pool curve, butterfly total row | One ownable signature that is still pure data; the strongest dark theme        |
| Lens morph with ghost                                 | Home and Token butterfly        | Tells the gap story without words; given a tap path and an "under 1 %" caption |
| Web Animation tween clock                             | Range, context and lens morphs  | Interruptible, seekable, no jump on rapid toggles                              |
| Details and "See all" in the section heading row      | Every section; Home previews    | One thumb-reachable control position on phones; balances the Home columns      |
| Sticky section headings                               | Detail pages, ≥ 840 px          | The question stays in view beside long visuals                                 |
| Header hairline after scroll                          | App bar                         | Quiet chrome at rest, separation when needed                                   |
| Opacity-only row hover layer, 12 px bleed             | Row lists                       | Hairlines never move; animates only opacity (M4)                               |
| Lollipop stems from 0                                 | Cost to trade                   | Each spread reads as a length                                                  |
| Back links above detail titles                        | Pool, Scorecard, Token          | Wayfinding for deep-link arrivals                                              |
| Comparison and status in fact labels                  | Scorecard facts                 | Every number answers "compared to what" (P4, A6)                               |
| Scrub rewrites facts, with a status and UTC caption   | Scorecard chart                 | CH2 without a floating box                                                     |
| Order control in the phone sort sheet                 | Pools, Token                    | Ascending sorts reachable on phones                                            |
| Asymmetry caption in Show data                        | Pool curve                      | Turns the table into a takeaway                                                |
| "One scale for every pool"                            | Butterfly axis row              | Names the honesty of the shared scale                                          |
| Real y scale (magnitude ticks) on the scorecard chart | Scorecard chart                 | The roughly $60K plateaus read without hovering                                |

### 1.4 Considered and not taken

- **An aggregate strata curve as the Home hero.** It makes a second heavy region, breaks D1, and on phones
  pushes the butterfly below the fold. The total row keeps its idea, Base's stacked depth on one scale, inside
  the focal.
- **The halftone on the scorecard.** With bands and a square wave, it makes the busiest region on the page (C5).
  Scorecard series stay plain lines.
- **A raised plate, button and thumb shadows, and a footer theme toggle.** Each breaks a rule: E1 and E4
  (tell 6, the white card on a grey page) for the plate and shadows, and PH2 for the toggle.
- **A ±1/±2/±5 band switch with tonal segments on Home.** It adds a decode step before the gap story lands,
  and the pale tones measure 1.9–2.6:1 (C6). The per-band numbers stay in the pool curve's "Show data".
- **A digit roll on the display headline.** Mid-roll it shows overlapping glyphs. Headlines never animate.

---

## 2. Rules this spec adds to `principles.md` and `ia-v3.md`

The two files carry this wording at the rules named here; where older wording sits beside it, this wording wins.
- **N1 (USD).** "Format with `Intl.NumberFormat('en-US', {style: 'currency', currency:
  'USD', notation: 'compact', minimumSignificantDigits: 3, maximumSignificantDigits: 3})`, then drop a bare `.0`
  before the suffix. Money therefore always has 3 significant figures with trailing zeros kept ($5.10M beside
  $6.08M, $7.40K beside $7.38K), except round values ($50K, $1M) and whole dollars below $1,000." Strict
  `maximumSignificantDigits: 3` alone mixes `$5.1M` with `$6.08M` in one sentence, and `$7.9M` with `$9.77M` in
  one column (N8). Chart ticks keep 2 significant figures.
- **N4 (shares).** "A share above 0 and below 1 % reads 'under 1 %', never '0 %'."
- **C1 (tokens).** These tokens:
  - `--bad-mark`: light `oklch(0.585 0.120 25)` `#b85c57` (4.22:1); dark `oklch(0.680 0.090 22)` `#ca827f`
    (6.2:1). Used for breach marks.
  - `--band-op`: 0.06 light, 0.09 dark.
  - The field tokens in §3.7.
- **C5, CH7 and CH8 (breach marks).** "Breach bands and breached strip cells use `--bad-mark`, not `--bad`.
  Bands sit at `--band-op` opacity. `--bad` stays for status words, shapes and chips."
- **C9 and E6 (the field of light).** "The C9 area fill may be drawn as a halftone screen, the field of
  light. It is side-colour dots on a lattice anchored at the spine, with dot opacity following the same top-to-
  baseline ramp (§3.7), over a faint solid gradient. It is allowed only inside depth areas (the mirrored curve) and
  the butterfly's total row. The E6 background texture uses every fourth lattice point of the same grid behind the
  curve."
- **CH4 (butterfly).**
  - Sizes: "rows 40 px with 14 px bars on desktop; 56 px rows with 10 px bars on phones".
  - Labels: "The butterfly closes with an **'All of Base'** total row below a `border-subtle`
    hairline. Its two sides are drawn as the field of light, stacked from the spine in row order, with a canvas
    gap at each pool boundary and a 2 px solid cap at the end. The shared scale's maximum is the larger total
    side. The two direct value labels sit on the total row; pool rows show their values on hover, focus or tap
    (the lens). A caption under the axis reads 'One scale for every pool'."
- **ia-v3 §4.1 (Home focal element).**
  - "Exactly two direct value labels, on the total row ($11.8M and $14.3M, which sum to the H1)";
  - "A 'Show data' disclosure follows the figure."
  - The first-viewport count stays at 7: H1 1, lead pool count 1, total labels 2, facts 3.
- **ia-v3 §4.3 (Health) and §4.6 (Uptime).** The Health visual does not repeat the score: "the weighted bar
  with component names and weights". The Uptime visual has no readout: "the strip for the selected window; the
  takeaway carries the counts".
- **ia-v3 §4.6 (Scorecard).**
  - "On phones the status chip sits at the start of the meta line."
  - Fact labels are "sell side now, below the $50K KPI", "buy side now, within the $50K KPI" and "uptime, 7 d,
    below the 95 % target".
  - "Show data" follows the focal chart: per sample for 24 h, per UTC day for 7 d and 30 d.
- **K3 and K10 (controls position).** "A section's Details control sits in its heading: under the takeaway
  in the left column on desktop, at the right end of the heading line on phones. Its panel opens under the
  visual."
- **K2 (back link).** "Detail pages (Pool, Token, Scorecard) start with a back link to their list: a
  16 px chevron icon plus the list name, 13 px / 500, `text-2`."
- **TB7 and PH4 (phone columns).** "On phones the Sort sheet is also the column picker. The row's value
  is the sort metric, so every optional column is one tap away. Price is not sortable across pairs and stays on
  the pool page."
- **M3 (new rows).** The lens, the total-row reveal and the tween clock rows of §4.

---

## 3. Foundations

### 3.1 Colour tokens

Authored in OKLCH. Hex values are for reference; ratios are WCAG 2 against `canvas`.

The product follows the system appearance (PH2). `[data-theme]` exists only for screenshots and tests.

```css
:root {
  color-scheme: light;
  --canvas: oklch(0.982 0.004 271); /* #f8f9fc */
  --well: oklch(0.965 0.005 275); /* #f2f3f7 */
  --raised: oklch(1 0 0); /* #ffffff */
  --overlay: oklch(1 0 0); /* #ffffff, with --shadow-pop */
  --hover: oklch(0.949 0.007 269); /* #eceef3 */
  --border-subtle: oklch(0.93 0.007 261); /* #e5e8ed */
  --border: oklch(0.891 0.009 265); /* #d8dbe1 */
  --control: oklch(0.639 0.016 264); /* #878c96, 3.21:1 */
  --text-1: oklch(0.221 0.017 260); /* #161b23, 16.4:1 */
  --text-2: oklch(0.449 0.021 268); /* #505561, 7.09:1 */
  --text-3: oklch(0.53 0.019 263); /* #666c77, 5.01:1 */
  --focus: oklch(0.52 0.199 262); /* #1f5ed9 */
  --sell: oklch(0.52 0.12 245); /* #196ea9, 5.18:1 */
  --buy: oklch(0.621 0.15 55); /* #c9690c, 3.62:1 */
  --ok: oklch(0.449 0.109 155); /* #036639 */
  --ok-bg: oklch(0.95 0.04 155); /* #daf7e3 */
  --warn: oklch(0.501 0.1 70); /* #875814 */
  --warn-bg: oklch(0.958 0.05 88); /* #fff0cc */
  --bad: oklch(0.501 0.17 25); /* #b02a2d, 6.2:1 */
  --bad-bg: oklch(0.947 0.027 23); /* #ffe7e5 */
  --bad-mark: oklch(0.585 0.12 25); /* #b85c57, 4.22:1: breach bands and strip cells */
  --band-op: 0.06;
  --dot: oklch(0.891 0.009 265 / 0.9); /* background lattice */
  --scrim: rgb(14 19 28 / 0.32);
  --shadow-pop:
    0 0 0 1px var(--border-subtle), 0 1px 2px rgb(22 27 35 / 0.06), 0 6px 16px rgb(22 27 35 / 0.08);
  --shadow-dialog:
    0 0 0 1px var(--border-subtle), 0 2px 4px rgb(22 27 35 / 0.06), 0 16px 40px rgb(22 27 35 / 0.12);
  /* Field of light (§3.7) */
  --ht-pitch: 3px;
  --ht-r: 1px;
  --field-top: 1;
  --field-low: 0.12;
  --field-under: 0.14;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --canvas: oklch(0.186 0.02 262); /* #0e131c */
    --well: oklch(0.213 0.021 264); /* #141923 */
    --raised: oklch(0.243 0.021 264); /* #1b202a */
    --overlay: oklch(0.272 0.02 264); /* #222731, with a 1 px --border ring, no shadow */
    --hover: oklch(0.289 0.021 266); /* #262b36 */
    --border-subtle: oklch(0.301 0.019 264); /* #292e38 */
    --border: oklch(0.344 0.019 264); /* #343943 */
    --control: oklch(0.53 0.02 264); /* #666c78, 3.53:1 */
    --text-1: oklch(0.96 0.005 258); /* #f0f2f5, 16.6:1 */
    --text-2: oklch(0.869 0.012 265); /* #d0d4dc, 12.5:1 */
    --text-3: oklch(0.756 0.017 263); /* #aab0bb, 8.54:1 */
    --focus: oklch(0.825 0.095 244); /* #8fcdff */
    --sell: oklch(0.721 0.11 242); /* #61ade4, 7.63:1 */
    --buy: oklch(0.781 0.14 68); /* #f2a548, 9.09:1 */
    --ok: oklch(0.82 0.13 155); /* #79dd9f */
    --ok-bg: oklch(0.3 0.049 156); /* #173523 */
    --warn: oklch(0.86 0.12 85); /* #f5cb70 */
    --warn-bg: oklch(0.31 0.05 85); /* #3c2e0f */
    --bad: oklch(0.797 0.116 22); /* #ff9e9b */
    --bad-bg: oklch(0.299 0.06 21); /* #472020 */
    --bad-mark: oklch(0.68 0.09 22); /* #ca827f, 6.2:1 */
    --band-op: 0.09;
    --dot: oklch(0.344 0.019 264 / 0.75);
    --shadow-pop: 0 0 0 1px var(--border);
    --shadow-dialog: 0 0 0 1px var(--border);
    --field-top: 1;
    --field-low: 0.1;
    --field-under: 0.12;
  }
}
/* Repeat the dark block verbatim under :root[data-theme='dark'] for tests and screenshots. */

@media (prefers-contrast: more) {
  :root {
    --text-3: var(--text-2);
    --border: var(--control);
    --border-subtle: var(--control);
  }
}
```

**Usage:**
- **Chromatic colour** appears only in data marks, status glyphs, the focus ring and the logo mark (C2).
- **`--sell` and `--buy`** mark sides and nothing else (C3).
- **Status colours (`--ok`, `--warn`, `--bad`)** go only on words, shapes and chips.
- **`--bad-mark`** goes only on breach bands and breached strip cells.

**Plumbing:**
- `<meta name="theme-color">` equals `--canvas` for each scheme (`#f8f9fc`, `#0e131c`).
- `forced-colors: active`: bars, strip cells, meters, bullets and health segments set `forced-color-adjust:
  none`. Grade glyphs and chips get a 1 px `CanvasText` border.
- Theme switch: add `.theme-switching` to `<html>` for two frames, which sets `transition: none !important;
  animation: none !important` on everything (C8).

### 3.2 Fonts

**Faces** (T1): Hanken Grotesk sets every word and number. IBM Plex Mono sets only addresses, pool ids, block
numbers in About lists, and code.

**Production loading: self-hosted** (T2):
- The three subsets live in `apps/web/public/fonts/`:
  - `hanken-grotesk-var.woff2`, 35.7 KB, weights 100–900;
  - `ibm-plex-mono-400.woff2`, about 14 KB;
  - `ibm-plex-mono-500.woff2`, about 14 KB.
- They were built from the `google/fonts` TTFs with the type-a11y §1.6 `pyftsubset` command, which keeps
  `tnum case frac ss01–ss04` and `± × − ≥ ≈`.
- Preload the sans file only, over http(s).
- Use `font-display: swap`.

```css
@font-face {
  font-family: "Hanken Grotesk";
  src: url("/fonts/hanken-grotesk-var.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/fonts/ibm-plex-mono-400.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/fonts/ibm-plex-mono-500.woff2") format("woff2");
  font-weight: 500;
  font-display: swap;
}
/* Metric-matched fallback (fontTools, letter-frequency-weighted advances): identical page heights with fonts blocked. */
@font-face {
  font-family: "Hanken Fallback";
  src: local("Arial"), local("Helvetica"), local("Liberation Sans");
  size-adjust: 101.7%;
  ascent-override: 98.3%;
  descent-override: 29.8%;
  line-gap-override: 0%;
}
:root {
  --sans:
    "Hanken Grotesk", "Hanken Fallback", ui-sans-serif, system-ui, -apple-system, "Segoe UI",
    Roboto, Helvetica, Arial, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
```

**Google Fonts link: reference only, not for the product.** T2 forbids it, because its latin subset strips
`tnum`, `case` and `frac` and omits `→` and `≥`. Use it only for a throwaway sketch outside the repository:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@100..900&family=IBM+Plex+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

**Glyph gaps.** Hanken has no `↑`, `⇄`, thin or narrow no-break spaces. Every arrow (sort, chevrons, the price
swap, the back link) is a 16 px SVG icon with a 1.5 px stroke (K9). Units use U+00A0.

**Fallback check.** With the web fonts blocked (`?nofonts=1`) and Liberation Sans as the resolved fallback:
- desktop page heights are identical or within 1 px;
- on phones, Home grows 39 px (2,008 to 2,047) and Pool 19 px, because the mandate meta line wraps;
- there is no overflow;
- hierarchy holds through size and colour.

### 3.3 Type scale

These are the only sizes (T4). Every number is `font-variant-numeric: tabular-nums`, nothing is uppercase, and
the floor is 12 px.

| Token         | Size (px)                                                | Line-height | Weight                     | Tracking | Role and rules                                                               |
| ------------- | -------------------------------------------------------- | ----------- | -------------------------- | -------- | ---------------------------------------------------------------------------- |
| `--t-caption` | 0.75rem (12)                                             | 16          | 500                        | +0.01em  | Chart ticks, captions, "Gap", chips                                          |
| `--t-small`   | 0.8125rem (13)                                           | 18          | 400 / 500                  | 0        | Fact labels, table headers, legends, secondary lines, back link, demo line   |
| `--t-data`    | 0.875rem (14)                                            | 20          | 400; 500 for names and nav | 0        | Table cells, nav, buttons, inputs ≥ 600 px, pair names                       |
| `--t-body`    | 0.9375rem (15; 16 below 600)                             | 24          | 400                        | −0.003em | UI copy and takeaways                                                        |
| `--t-prose`   | 1rem (16)                                                | 26          | 400                        | 0        | Methodology                                                                  |
| `--t-lead`    | 1.125rem (18; 16 on phones in the hero)                  | 28          | 400                        | −0.01em  | Page lead, `text-2`, ≤ 56ch (34ch in the Home split)                         |
| `--t-title`   | 1rem (16)                                                | 22          | 600                        | −0.008em | Sheet and dialog titles, wordmark                                            |
| `--t-h2`      | `clamp(1.25rem, 1.152rem + 0.4348vw, 1.5rem)` (20→24)    | 1.25        | 500 heading, 400 answer    | −0.016em | Section headings; answers on Pool, Token, Gaps, Scorecards, ≤ 44ch, balanced |
| `--t-h1`      | `clamp(1.625rem, 1.429rem + 0.8696vw, 2.125rem)` (26→34) | 1.15        | 500                        | −0.02em  | Page titles, ≤ 24ch (the mandate name may run wider)                         |
| `--t-kpi`     | `clamp(1.75rem, 1.457rem + 1.304vw, 2.5rem)` (28→40)     | 1.05        | 400                        | −0.028em | Fact values                                                                  |
| `--t-display` | `clamp(2.25rem, 1.761rem + 2.174vw, 3.5rem)` (36→56)     | 1.04        | 500                        | −0.032em | The Home answer only, ≤ 20ch, `text-wrap: balance`                           |
- `body`: `--t-body`, line-height 1.6 (1.5 below 600 px).
- Text rendering: `-webkit-font-smoothing: antialiased`, `text-rendering: optimizeLegibility`.
- Headings use `text-wrap: balance`; paragraphs use `text-wrap: pretty`.
- Chart text: `--t-caption`, 500, `text-3`, sans with tabular figures, never mono (CH1).
- Chart direct labels: 14 px / 500 `text-1` with a 4 px `canvas` halo (`paint-order: stroke`).

### 3.4 Spacing, grid and breakpoints

- **Scale** (S1): `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32, `--s7` 48, `--s8` 64, `--s9` 96.
  The only other lengths are 1 px hairlines and 2 px indicators.
- **Content:** max 1200 px, centred.
- **Gutter:**
  - `max(16px, env(safe-area-inset-left))` below 600 px;
  - 24 px from 600 px;
  - 32 px from 1200 px.
- **Breakpoints** (em): 37.5 (600), 52.5 (840), 75 (1200), 100 (1600).
  - The phone layout applies below 52.5em (840 px).
  - The Home editorial split applies from 75em.
- **Chrome heights:**
  - demo line 28;
  - desktop app bar 56;
  - phone app bar 52 plus a 44 px tab strip (`--appbar-h: 96px`).
  - `scroll-padding-top: calc(var(--appbar-h) + 8px)`.
- **Page rhythm:**

| Gap                                              | Desktop                                         | Phone                                  |
| ------------------------------------------------ | ----------------------------------------------- | -------------------------------------- |
| Page top padding (inner pages)                   | 48                                              | 32                                     |
| Home hero top padding                            | 64                                              | 24                                     |
| Back link to h1                                  | 16 (8 margin plus the 8 grid gap; link 24 high) | 6 (the 44 px target's margins overlap) |
| h1 to secondary line                             | 8                                               | 8                                      |
| Title block to answer                            | 24                                              | 24                                     |
| Answer to focal chart (legend row first)         | 32                                              | 24                                     |
| Chart to its foot row (Show data, scrub caption) | 12                                              | 12                                     |
| Foot row to facts                                | 32 (Home 48)                                    | 32                                     |
| Facts to first section                           | 64                                              | 32                                     |
| Section padding                                  | 48 top and bottom, 1 px `border-subtle` on top  | 20 top, 12 bottom                      |
| Section columns                                  | `minmax(0, 4fr) minmax(0, 8fr)`, gaps 24 / 32   | one column, row gap 12                 |
| Home hero to butterfly                           | 48                                              | 24                                     |
| Home facts to previews                           | 96                                              | 48                                     |
| Previews columns                                 | 2 equal, gap 64                                 | one column, gap 48                     |
| Last section to footer                           | 64                                              | 48                                     |

**Alignment** (S7): the page title, the focal plot's left edge, the first table column and section headings share
one left edge. The butterfly's spine is the only centred element. The back link sits 4 px left of the edge, so
its chevron's optical edge aligns with the title.

### 3.5 Radii

| Element                                           | Radius                                            |
| ------------------------------------------------- | ------------------------------------------------- |
| Chips, grade glyphs, segmented thumb, checkbox    | 4                                                 |
| Buttons, inputs, segmented outer, row hover layer | 6                                                 |
| Code blocks, badge preview well                   | 8                                                 |
| Popover, tooltip                                  | 10                                                |
| Sheet (top corners)                               | 12                                                |
| Bars                                              | 2 on the outer end only (the spine end is square) |
| Bullet and meter tracks                           | 1 and 2                                           |

There are no pills, except the API badge, which keeps its shields shape.

### 3.6 Elevation

- **One surface.** Sections sit on `canvas` with space and at most one hairline (E1). There are no cards.
- **The ladder is by lightness:** `canvas`, then `well` (demo line, code, segmented track, badge preview), then
  `raised` (inputs, thumb), then `overlay` (popover, tooltip, sheet).
- **Shadows** appear only on floating layers, in light only:
  - popover and tooltip: `--shadow-pop`;
  - sheet: `--shadow-dialog`.
- **Dark:** `overlay` plus a 1 px `--border` ring, no shadow.
- **Hairlines and outlines are borders, not `box-shadow`.** This covers the app bar hairline (a pseudo-element),
  the secondary button outline, the sticky table header rule and hollow strip cells.
- **The segmented thumb's edge** is a `drop-shadow` filter on its clipped layer:
  - light: `drop-shadow(0 0 0.5px rgb(22 27 35 / 0.32)) drop-shadow(0 1px 1px rgb(22 27 35 / 0.06))`;
  - dark: `drop-shadow(0 0 0.5px oklch(0.5 0.02 264))`.

### 3.7 Texture and the field of light

**1. Pool curve field (SVG).**
- **Lattice:** anchored at (spine x, baseline y). Pitch `P = round(5 × dpr) / dpr` CSS px on desktop and
  `round(4 × dpr) / dpr` on phones. Snapping to whole device pixels avoids beat patterns at fractional DPRs.
- **Dots:** radius 1.3 px on desktop and 1.0 px on phones, filled with the side colour. Each side's area path is
  filled with a `<pattern patternUnits="userSpaceOnUse">` of one circle.
- **Opacity ramp:** a mask with a `userSpaceOnUse` linear gradient from the plot top (y = 36) to the baseline:

  | Stop             | Opacity              |
  | ---------------- | -------------------- |
  | 0                | `--field-top`        |
  | 0.55             | 0.55 × `--field-top` |
  | 1 (the baseline) | `--field-low`        |

- **Underlay:** a solid gradient of the side colour from `--field-under` to 0 over the same span.
- **Background lattice (E6):** every fourth lattice point (20 px desktop, 16 px phone), r 0.9, `--dot`, with
  40 px horizontal edge fades. It is drawn first, behind the ±2 % band.
- **Draw order:** lattice; ±2 % band (`well` at 0.9); underlays; masked halftone; spine; y ticks with a `well`
  halo; lines; points; labels; baseline; x ticks.
- **Print and export:** pure SVG, so it survives both. A canvas version is not allowed.

**2. Total row field (CSS).**

```css
.tot-field {
  background-size: var(--ht-pitch) var(--ht-pitch);
}
.sell .tot-field {
  right: 0;
  background-image: radial-gradient(
    circle,
    var(--sell) var(--ht-r),
    transparent calc(var(--ht-r) + 0.4px)
  );
  background-position: right center;
}
.buy .tot-field {
  left: 0;
  background-image: radial-gradient(
    circle,
    var(--buy) var(--ht-r),
    transparent calc(var(--ht-r) + 0.4px)
  );
  background-position: left center;
}
```

- **Pitch and radius:** pitch 3 px, radius 1 px on desktop and 0.9 px on phones. The pattern is anchored at the
  spine.
- **Strata boundaries:** a `canvas` strip `pitch + 1` px wide, centred on each cumulative boundary. A boundary is
  skipped when the stratum before it is under 3 px.
- **Cap:** 2 px of solid side colour at the measured end.
- **Contrast:** every dot is full side colour, so each mark keeps its 3:1+ ratio (C6). Total width is read from
  the cap.

**Not allowed:** a field anywhere else (scorecard, time series, tables), and any brightness that does not follow
the ramp above.

### 3.8 Motion tokens

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1); /* enter, exit, press, popovers, intro */
  --ease-in-out: cubic-bezier(
    0.77,
    0,
    0.175,
    1
  ); /* on-screen movement: thumb, indicator, morphs, lens */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1); /* phone sheet */
  --dur-press: 160ms;
  --dur-hover: 120ms;
  --dur-tooltip: 140ms;
  --dur-popover: 180ms;
  --dur-exit: 100ms;
  --dur-disclosure: 200ms;
  --dur-dialog: 240ms;
  --dur-route: 180ms;
  --dur-morph: 280ms;
  --dur-sheet: 500ms;
  --stagger: 30ms;
  --press-scale: 0.97;
  --enter-scale: 0.96;
}
```

**Springs: none.** Every curve is one of the three beziers above, so durations stay deterministic and testable,
and seeking a frame gives the same picture. The sheet's `--ease-drawer` stands in for a spring. If a sheet
library is used, configure it to 500 ms with that curve and these thresholds: dismiss above 0.4 px/ms or past
25 % of the height, snap back over 300 ms.

**Other easings:**
- Hover colour changes use the `ease` keyword.
- Ease-in is never used on UI (M4).
- There is no `transition: all`.
- Only `transform`, `opacity` and `clip-path` animate, plus disclosure height.

**Tween clock** (`apps/web/src/lib/motion.ts`). Every JS-driven morph goes through this. Callers keep their
interpolated state, so a new tween on the same key starts where the last one stopped.

```ts
export type Ease = (t: number) => number
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  // Newton's method on x(t); clamp t to [0, 1].
}
export const easeInOut = bezier(0.77, 0, 0.175, 1)

const clock = document.createElement('i') // appended once to <body>, aria-hidden, 0×0
const running = new Map<string, { raf: number; anim: Animation }>()

export function tween(
  key: string,
  ms: number,
  ease: Ease,
  step: (e: number) => void,
  done?: () => void,
) {
  const prev = running.get(key)
  if (prev) {
    cancelAnimationFrame(prev.raf)
    prev.anim.cancel()
  }
  if (ms <= 0) {
    running.delete(key)
    step(1)
    done?.()
    return
  }
  // A no-op Web Animation is the clock: pausing or seeking it (tests, reduced motion, devtools) drives the morph.
  const anim = clock.animate([{ opacity: 0 }, { opacity: 0 }], { duration: ms })
  const rec = { raf: 0, anim }
  running.set(key, rec)
  const frame = () => {
    const finished = anim.playState === 'finished'
    step(ease(finished ? 1 : Math.min(1, Number(anim.currentTime ?? 0) / ms)))
    if (finished) {
      running.delete(key)
      done?.()
    } else rec.raf = requestAnimationFrame(frame)
  }
  step(ease(0))
  rec.raf = requestAnimationFrame(frame)
}
export const isTweening = (key: string) => running.has(key)
```

**Shared rules:**
- **Keyboard-initiated actions never animate** (M2). Click events with `detail === 0` and arrow keys pass
  `ms = 0`.
- **Reduced motion** (M9) replaces every morph with an instant state change plus a 150 ms opacity settle on the
  chart.
- **CSS is written no-motion-first.** Every transform and keyframe sits inside
  `@media (prefers-reduced-motion: no-preference)`.

---

## 4. Motion catalogue

Every animation in the product is listed here. Anything not listed does not animate (M7).

**Columns:**
- **When:** the trigger.
- **Duration and easing:** delay included where there is one.
- **Keyboard:** what happens when a keyboard action triggers it.
- **Reduced:** the reduced-motion behaviour.
- **Purpose:** the M2 purpose.

| #   | Interaction                          | When                                                                                                                                                                                                                     | What moves                                                                                                                                                                      | Duration and easing                                                                       | Keyboard                              | Reduced                                      | Purpose                                |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------- | -------------------------------------- |
| 1   | Home first view (M6)                 | First Home render per session (`sessionStorage`)                                                                                                                                                                         | Pool bars `scaleX(0.001 → 1)` from the spine; total field `clip-path: inset()` revealed from the spine                                                                          | 300 ms `--ease-out`, delay `i × 30 ms`, total row delay 150 ms; ends ≤ 450 ms             | n/a                                   | 200 ms opacity fade of bars and field        | The one delight                        |
| 2   | Home first view, labels              | Same                                                                                                                                                                                                                     | Total values, caps, strata gaps, "Gap" marker: opacity 0 → 1                                                                                                                    | 150 ms `--ease-out`, delay 300 ms                                                         | n/a                                   | Part of the fade                             | Nothing runs ahead of its mark         |
| 3   | Lens enter                           | Pointer over a pool row (fine pointer), or tap on its bars (coarse)                                                                                                                                                      | The stratum overlay `translateX(±offset × track width → 0)`; other rows' bars, labels and Gap opacity → 0.38; total field, caps and gaps opacity → 0.22; row values opacity → 1 | Overlay 280 ms `--ease-in-out` (WAAPI, cancels the previous one); opacities 150 ms `ease` | Focus: instant, no slide              | Overlay appears at the spine, 150 ms opacity | Explanation: this pool's share of Base |
| 4   | Lens row to row                      | Pointer moves to another row while lensed                                                                                                                                                                                | New overlay at the spine: opacity 0.4 → 1                                                                                                                                       | 150 ms `ease`                                                                             | Instant                               | Same                                         | Calm while sweeping                    |
| 5   | Lens exit                            | Pointer leaves the rows, focus leaves the figure, tap outside or tap again                                                                                                                                               | Overlay off; all opacities return                                                                                                                                               | 150 ms `ease`                                                                             | Instant                               | Same                                         | State change                           |
| 6   | Route change (M3)                    | Pointer click on an in-app link. The route's first data is prefetched on intent (pointer rest, press or keyboard focus); a click whose data is still missing waits at most 120 ms (`ROUTE_WAIT_MS`) and is then replayed | `::view-transition-old(main)` opacity → 0; `::view-transition-new(main)` opacity 0 → 1; root and chrome `animation: none`                                                       | Out 100 ms, in 180 ms, both `--ease-out`                                                  | Instant; focus moves to `<main>`      | Instant                                      | Spatial consistency                    |
| 7   | Back and Forward                     | `popstate`                                                                                                                                                                                                               | Nothing; scroll is restored from `history.state`                                                                                                                                | 0                                                                                         | 0                                     | 0                                            | Speed                                  |
| 8   | Nav indicator                        | Route change                                                                                                                                                                                                             | 2 px bar `translateX(x) scaleX(w)`                                                                                                                                              | 200 ms `--ease-in-out`                                                                    | 0 ms                                  | 0 ms                                         | Where you went                         |
| 9   | Range switch (Pool 24 h ↔ 7 d)       | Segmented change                                                                                                                                                                                                         | x domain, y domains and the p10–median band interpolate; ticks cross-fade (old `max(0, 1 − 2.5e)`, new `max(0, (e − 0.4) / 0.6)`)                                               | 280 ms `--ease-in-out` via the tween clock; scrubbing paused while it runs                | Instant                               | Instant plus a 150 ms opacity 0.4 → 1 settle | Honest zoom: 24 h is the tail of 7 d   |
| 10  | Scorecard window (24 h / 7 d / 30 d) | Segmented change                                                                                                                                                                                                         | x domain and the symmetric max; the registration line appears in 30 d                                                                                                           | Same as 9                                                                                 | Instant                               | Same as 9                                    | Same                                   |
| 11  | Whole-pool context toggle            | Checkbox                                                                                                                                                                                                                 | y max interpolates; 1 px context lines opacity 0 ↔ 1                                                                                                                            | 280 ms `--ease-in-out`                                                                    | Instant                               | Instant plus settle                          | State change                           |
| 12  | Number change                        | Window switch, price ⇄ flip, filter                                                                                                                                                                                      | Only changed characters: opacity 0 + `translateY(0.32em)` → rest                                                                                                                | 200 ms `--ease-out`                                                                       | Instant swap                          | 200 ms opacity                               | State change, never a count-up         |
| 13  | Live values                          | Refetch, freshness, scrubbing                                                                                                                                                                                            | Nothing (M8)                                                                                                                                                                    | 0                                                                                         | 0                                     | 0                                            | Accuracy                               |
| 14  | Disclosure                           | Details, Show data, Show all N, Show code, About on phones                                                                                                                                                               | Panel height 0 ↔ content and opacity; chevron rotates 180°                                                                                                                      | Open 200 ms, close 150 ms, `--ease-out` (WAAPI); chevron 200 ms                           | Instant                               | Opacity only                                 | Prevents a jump                        |
| 15  | Segmented thumb                      | Selection                                                                                                                                                                                                                | `clip-path: inset(0 R 0 L round 4px)` on a full-width raised layer                                                                                                              | 200 ms `--ease-in-out`                                                                    | 0 ms                                  | 0 ms (lives in the no-preference block)      | Spatial consistency                    |
| 16  | Press                                | `:active` on buttons, segmented items, icon buttons, disclosure triggers, freshness, sheet options, Gap link, back link                                                                                                  | `scale(0.97)`                                                                                                                                                                   | 160 ms `--ease-out`; lands on pointer-down                                                | Not applicable                        | None                                         | Feedback                               |
| 17  | Hover (fine pointers only)           | Pointer over                                                                                                                                                                                                             | Colour, background, underline colour; row layer opacity                                                                                                                         | 120 ms `ease`; row layer 0 ms in, 150 ms out                                              | n/a                                   | Same                                         | Feedback                               |
| 18  | Header hairline                      | Scroll past 36 px (the demo line plus 8)                                                                                                                                                                                 | Pseudo-element opacity 0 ↔ 1                                                                                                                                                    | 200 ms `ease`                                                                             | n/a                                   | Same                                         | Separation when needed                 |
| 19  | Popover                              | Click on freshness, About the demo or Columns                                                                                                                                                                            | Opacity plus `translateY(4px) scale(0.97)` → none, origin at the trigger                                                                                                        | In 180 ms, out 100 ms, `--ease-out`                                                       | Opens instantly, Escape returns focus | Opacity only                                 | State change                           |
| 20  | Glossary tooltip                     | 600 ms hover over a dotted term                                                                                                                                                                                          | Opacity plus `scale(0.97)` → none from the trigger side                                                                                                                         | 140 ms `--ease-out`; closes in 0 ms; others open instantly within 400 ms                  | Opens on focus, no animation          | Opacity only                                 | Definition on demand                   |
| 21  | Chart tooltip and crosshair          | Pointer or arrow keys on a chart                                                                                                                                                                                         | Follows 1:1, snaps to measured points                                                                                                                                           | 0                                                                                         | Arrow keys step                       | 0                                            | Precision                              |
| 22  | Phone sheet                          | Filter or Sort                                                                                                                                                                                                           | `translateY(100%)` → 0; scrim opacity                                                                                                                                           | In 500 ms `--ease-drawer`; out 300 ms; drag snap-back 300 ms                              | Opens instantly, focus trapped        | Fade only                                    | Spatial: comes from the thumb zone     |
| 23  | Copy                                 | Copy HTML, Copy Markdown, copy address                                                                                                                                                                                   | Label to "Copied" with a check icon, for 2 s                                                                                                                                    | Instant swap                                                                              | Same                                  | Same                                         | Feedback (`aria-live`)                 |
| 24  | Refetch (M10)                        | Parameter change slower than 150 ms                                                                                                                                                                                      | Old content dims to 0.6; a 2 px indeterminate bar appears at the section top                                                                                                    | Dim 150 ms `ease`; the bar moves `linear`, only while fetching                            | n/a                                   | Dim only, static bar                         | System status                          |
| 25  | Theme switch                         | System appearance change                                                                                                                                                                                                 | Nothing; transitions are suppressed for 2 frames                                                                                                                                | 0                                                                                         | 0                                     | 0                                            | No flash                               |

**Route transition, near-instant by design.** By 80 ms the new view is mostly in. This is deliberate, following
Emil Kowalski's rule that UI motion stays under 300 ms. The nav indicator's 200 ms slide is the spatial cue.

**Numbers that change in place** (row 12) carry `white-space: nowrap`, so a mid-change glyph never wraps.

**Verification:**
- Frames at 0, 80, 160, 240 and 400 ms of the Home first view, the lens, the range morph and the route change
  show each step of rows 1–9.
- With reduced motion emulated, the animated properties are opacity, colour and background only.

---

## 5. Components

### 5.1 App shell

**Skip link.** The first focusable element: 44 px high, `text-1` fill with a `canvas` label, 14 / 500, radius 6.
It is visible at top 8, left 8 only on `:focus-visible` (A4).

**Demo line** (demo or mock data only):
- 28 px, `well`, 13 px `text-2`, one line, never wraps, `white-space: nowrap; overflow: hidden`.
- Content: "Demo data: a synthetic week of Base", 12 px gap, then the quiet link "About the demo". The link is
  `text-1` with a 1 px `text-3` underline, 3 px offset, and opens the demo popover.
- In mock mode the text reads "In-repo mock data".

**App bar, desktop:**
- 56 px, sticky at top 0, `canvas`.
- The hairline is an `::after`: 1 px `border-subtle`, opacity 0, turning 1 past 36 px of scroll over 200 ms.
- Contents, 32 px gaps:
  - **Wordmark:** 20 px mark plus "Depthwatch" at 16 / 600, −0.01em, with a 10 px gap. The link is ≥ 44 px high.
  - **Nav:** Pools, Gaps, Scorecards, Methodology at 14 / 500, 24 px gap.
    - Inactive items are `text-2`; the current item is `text-1` with `aria-current="page"`.
    - The indicator is a 2 px `text-1` bar under the current item, placed with
      `transform: translateX(x) scaleX(width)` and `transform-origin: 0 0`.
  - **Freshness** (pushed right): a button with a 6 px `ok` dot and "Updated 2 min ago" at 13 px `text-3`.
    - 32 px high, 8 px padding, radius 6. On hover it turns `text-1` on `hover`.
    - Its popover lists Updated, Block (grouped), Pools tracked ("6 of 6") and Snapshot (full UTC).
    - Offline state: a `bad` triangle and "Offline"; the popover adds the error and a Retry button.

**App bar, phone (below 840 px), 96 px in total:**
- **Row 1 (52 px):** the wordmark and the freshness button. The button is a 44 × 44 target with the dot only and
  sits −12 px from the right gutter.
- **Row 2:** a 44 px tab strip with the same `<nav>` element (one landmark).
  - Items are 15 / 500, 20 px apart, with 44 px targets and `white-space: nowrap`.
  - It scrolls sideways with hidden scrollbars below 360 px. It bleeds to the screen edges, padded by the gutter.
- The app bar never hides. There is no hamburger and no theme toggle (PH2).

**Main:** `view-transition-name: main`, `tabindex="-1"`, and focus moves here on keyboard navigation.

**Footer:**
- `margin-top` 64 (48 on phones), 1 px `border-subtle` on top, 13 px `text-2`, 32 px block padding plus the
  bottom safe area.
- **Desktop row:** the wordmark (14 px) with "Open source and read-only. No token, no custody."; then the links
  Methodology, API and GitHub, 24 px apart, `text-2` turning `text-1` on hover; then "Data: synthetic demo world"
  in `text-3`, pushed right.
- **Phone grid:** row 1 holds the wordmark and the links, which are right-aligned with 44 px targets and 16 px
  gaps. Row 2 is the sentence and row 3 the data line. "API" links to the API docs route, not Methodology.

### 5.2 Buttons and links (K1, K2)

| Variant     | Size                                        | Fill and text                                | Hover (fine pointer)                                         | Notes                                                 |
| ----------- | ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| Primary     | 36 high (44 coarse), padding 0 14, radius 6 | `text-1` fill, `canvas` label, 14 / 500      | Fill `color-mix(in oklch, var(--text-1) 86%, var(--canvas))` | At most one per view                                  |
| Secondary   | Same                                        | Transparent, 1 px `control` border, `text-1` | `hover` background                                           | Phone Filter and Sort, Copy, Retry                    |
| Quiet       | Same height, padding 0 8                    | Text only, `text-1`                          | `hover` background                                           | Done in sheets, Columns                               |
| Icon button | 28 × 28 (44 coarse), radius 6, 16 px icon   | `text-2`                                     | `hover` background, `text-1`                                 | `::after` inset −8 px hit area; `aria-label` required |
- A 16 px icon sits at an 8 px gap.
- A loading button keeps its label and adds a 12 px spinner.
- Phone Filter and Sort buttons are equal-width halves that state their value: "All DEXes" or the DEX name;
  "Sort: health" with a down or up arrow icon for the direction.

**Links:**
- **Prose and quiet links** (`.plink`): `text-1`, 1 px underline in `text-3`, 3 px offset, underline turning
  `text-1` on hover.
- **Navigational links** (rows, nav, pair names): no underline.
- **Token symbols in a pool title:** `text-1`, underline only on hover (`text-3`).
- Link text never carries an arrow.

**Back link** (K2): a 16 px left-chevron icon plus the list name ("Pools", "Scorecards", "Pools" for Token).
- 13 / 500, `text-2` turning `text-1` on hover; 2 px gap; radius 6; `margin: 0 0 8px -4px`.
- 24 px high, or 44 px on coarse pointers with −10 / −2 px block margins so the layout does not grow.

**Disclosure trigger** (K10):
- "Details", "Show data", "Show all 6 episodes", "Show samples", "Show measured spread", "Show code", "Compare
  DEXes".
- 32 px high (44 coarse), 14 / 500 `text-1`, a 16 px chevron in `text-2` at a 6 px gap.
- `aria-expanded`, and the content follows it in the DOM.
- Hover is a `::before` layer in `hover` that bleeds 8 px to the left, at opacity 0 → 1. The padding never
  changes.
- Toggled labels: "Show all 6 episodes" becomes "Show fewer"; "Show 5 more pools …" becomes "Hide pools
  under 3×".

### 5.3 Segmented control (K4)

- **Track:** 32 px high (44 coarse), `well`, radius 6, 2 px padding, `isolation: isolate`.
- **Items:** 28 px high (40 coarse), padding 0 12, 13 / 500, `text-2`; the selected item is `text-1`.
- **Thumb:** a full-width `raised` layer at `inset: 2px`, clipped with
  `clip-path: inset(0 var(--r) 0 var(--l) round 4px)`, so both edges travel without radius distortion. Its edge
  is the drop-shadow from §3.6.
- **Semantics:** `role="radiogroup"` with `role="radio"` items, roving `tabindex`. Arrow keys move the selection
  instantly.
- **Uses:** time windows (24 h / 7 d, and 30 d on scorecards), the DEX filter on desktop, the sheet's order
  control (full width, equal halves), and List / Table views.

### 5.4 Inputs

**Search:**
- 320 px wide on desktop, 36 px high, radius 6, 1 px `control` border, `raised` fill, 14 px text.
- 16 px search icon at left 11 in `text-3`; text padding-left 34.
- Placeholder "Search by symbol or address" in `text-3`.
- Phones: full width, 44 px, 16 px text, padding-left 38.
- It has a visually hidden label, "Search pools".

**Checkbox** ("Whole-pool depth"):
- A 16 × 16 box: radius 4, 1 px `control` border, `raised` fill.
- Checked: a `text-1` fill with a `canvas` check (8 × 4, 1.5 px).
- Label 13 px `text-2` at an 8 px gap; ≥ 32 px row.

**Select:** none. Native `<select>` is replaced by sheets on phones and segmented controls on desktop. Any
remaining `<select>` gets explicit `background-color` and `color` (C8).

### 5.5 Grades, status and chips (C4, K5)

- **Shapes** are 8 × 8 SVGs in `currentColor`: circle (A–B, within KPI), square with 1 px radius (C), triangle
  (D–F, breached). They stay readable in greyscale.
- **Grade glyph:** 28 × 20, radius 4, 12 / 600; a 6 px shape and the letter, 4 px gap, centred.
  - Tinted fill and colour: `ok-bg` / `ok`, `warn-bg` / `warn`, `bad-bg` / `bad`.
  - In facts it is 32 × 24, 13 px, with a 7 px shape.
  - `role="img" aria-label="Grade A"`.
- **"Not rated" chip:** the glyph's counterpart for a scored pool with no grade (`unratedReason`). It takes the
  glyph's place, so it is the row's one chip (TB5), and no score is shown beside it.
  - Same height and radius as the glyph (20, or 24 in facts), neutral tone (`well` fill, `text-2`), 12 / 500: the
    words "Not rated" instead of the shape and the letter. The width is `auto` with 0 8 padding and no wrapping,
    not 28 px.
  - The words are a Glossary trigger, a `button` and not an image. Hover, focus or a tap shows the reason in plain
    words ("Too thin to rate", "Too thin on one side", "No USD price"), then its one-line why and "How it is
    measured".
  - In a row with a stretched link the trigger sits above it (`position: relative; z-index: 1`), so a hover or tap
    opens the reason and not the pool. On touch it gets the standalone-trigger hit area of at least 44 × 44 (A5,
    `touch-hit`).
- **Status word** (lists, previews, mandate rows): shape plus word, 13 / 500, in the status colour, no fill.
  Words are "Within KPI", "Breached", "Inactive" and "No data".
- **Status chip** (the scorecard's own page only, the one filled element): 24 high (22 in the phone meta line),
  padding 0 8, radius 4, 13 / 500, tinted background, shape plus word.
- **Breached value marker:** a 10 px `bad` triangle beside a fact value, `role="img" aria-label="Below KPI"`.

### 5.6 Facts (stat blocks, D3)

Value first, label second, no icons and no boxes.
- **Desktop:** a grid of equal columns with a 32 px gap.
  - The value is `--t-kpi` / 400 / `text-1`, `white-space: nowrap`; a grade glyph or breached triangle follows at
    a 12 px gap.
  - The label sits 6 px below: 13 px `text-2`, carrying the comparison. Glossary terms in it are dotted.
- **Bullet variant** (scorecard): the value, then a bullet graph 8 px below (up to 220 px wide), then the label.
- **Home on phones:** rows with hairlines. Each row is 16 px padded, with the value (`min-width: 6.2ch`) then the
  label at 14 px, baseline-aligned.
- **Pool on phones:** a 2 × 2 grid with 16 px column and row gaps.
- **Scorecard on phones:** one column. The value and triangle sit left, the bullet right (max 160 px), and the
  label below.

### 5.7 Sections (D4)

**Desktop:**
- Grid `minmax(0, 4fr) minmax(0, 8fr)`, 24 / 32 gaps, 48 px block padding, 1 px `border-subtle` top.
- The head is sticky at `calc(var(--appbar-h) + 24px)` and holds:
  - the h2;
  - the takeaway (`text-2`, ≤ 32ch);
  - a control row (Details first), 8 px below the takeaway.
- The body is a grid with 16 px gaps: the visual, then the disclosure panel.

**Phone:**
- One column, 20 px top and 12 px bottom padding.
- The head is a grid `minmax(0, 1fr) auto`: the h2 left, the control right (−8 px end margin), the takeaway
  below at full width.

**About and Mandate lists (L3):**
- Desktop: a two-column definition list; each row is a `9.5rem` term column and a value, with 10 px padding and a
  `border-subtle` bottom border. The value is 14 px, mono only for addresses and blocks.
- Phones: the section heading is visually hidden, and the disclosure ("About this pool", "Mandate details", at
  16 / 500, 48 px high) is the section.

### 5.8 Tables and row lists (TB)

**Pools table (desktop):**
- Full content width.
- **Header:** 40 px, sticky at the app bar height, `canvas` background, a 1 px `border` rule drawn as a
  background image. Cells are 13 / 500 `text-2`, right-aligned except Pool.
- **Sorting:** sortable headers are buttons. The sorted column is `text-1` with a 12 px arrow icon; other arrows
  appear at 0.6 on hover. `aria-sort` is set.
- **Rows:** 64 px, 1 px `border-subtle`, cells 14 px, numbers right-aligned and tabular.
  - The row link stretches over the row with `::after`, giving one tab stop.
  - Hover: `hover` background, 0 ms in and 150 ms out.
- **Columns:**
  - Pool: pair 14 / 500, then "Aerodrome Slipstream, 0.05 %" (and ", stable pair") in 13 px `text-2`.
  - Health: glyph plus the score in a 2ch column; a pool with no grade shows the "Not rated" chip (§5.5) and no
    score.
  - Depth ±2 %: an 80 × 20 row glyph plus the value, 16 px gap.
  - Spread at $10K.
  - 24 h volume.
  - Optional through Columns: TVL, Gap score, Top LP, Price.
- **Caption row** (13 px `text-3`, space-between): "6 rated pools" or "Showing 2 of 6 rated" (`aria-live`) on the
  left, "All pools updated 2 min ago" on the right.
- **Unrated pools:** a table lists the rated pools. The others follow them under one quiet heading row, "Unrated
  pools", once the reader asks, or stay out with "Rated only" (`rated=1`).
  - One toggle button under the table opens and closes them: "Show 442 unrated pools" / "Hide unrated pools", with
    `aria-expanded`. It is the same button in both states, so keyboard focus stays on it, and "Show 50 more unrated
    pools" (`unrated=N`, pages of 50) sits beside it.
  - The caption says what is on screen, so the change is announced: "15 rated pools, plus 50 of 442 unrated".
  - Sorting by Health puts them after the rated pools in both directions, in every table.
- **Columns menu:** a quiet button with a 16 px columns icon, flush to the right content edge (−8 px margin),
  opening a popover of checkboxes stored in `?cols=`.

**Phone rows (TB7):**
- A head row: "Pool" left, the current sort metric's label right, 13 px `text-2`, 1 px `border` under it.
- Rows ≥ 64 px: the pool cell; the sort metric value (14 px, right); the grade glyph (28 px) or, for a pool with
  no grade, the auto-width "Not rated" chip (§5.5), so the third grid column is `auto`, not 28 px.
- The sort label, the row value and the Sort button always agree.

**Dense tables** (Details, Show data, Compare DEXes):
- 14 px, header 13 / 500 `text-2` with a 1 px `border` under it, cells with 9 px block padding and a
  `border-subtle` rule.
- A total row is 500 weight with a `border` rule.
- They scroll inside a gutter-bleeding wrapper on phones. A `.tbl-note` (13 px) may follow, 12 px below.

**Row lists** (previews, episodes, mandates, gaps):
- `li` with a 1 px `border-subtle` bottom border; `.ruled` adds the top border.
- The row is a grid with 16 px gaps, ≥ 64 px high, padding 10 / 12, bleeding −12 px inline.
- Hover is a `::before` layer in `hover`, radius 6, opacity 0 → 1 (0 ms in, 150 ms out), so hairlines never move.
- The quiet line ("Every other pool trades less than 3× its depth.") is 13 px `text-3`, 14 px padded, with no
  rule.

### 5.9 Charts

#### Depth butterfly (Home and Token focal, CH4)

**Desktop (≥ 840 px):**
- **Grid:** each row is `minmax(0, 1fr) 168px minmax(0, 1fr)`.
- **Head row:** "■ Sell side, price down" right-aligned with 16 px padding; "Depth within 2 %" centred in
  `text-3`; "■ Buy side, price up" left-aligned. 13 px, 8 px swatches, radius 2, 12 px bottom padding.
- **Pool rows:**
  - 40 px high with 14 px bars, on a 64 px value lane that keeps labels clear of the content edge.
  - The sell bar is right-anchored to the spine with radius `2 0 0 2`; the buy bar is left-anchored with
    `0 2 2 0`. Each is at least 2 px wide when non-zero.
  - The centre label is the pair (14 / 500, `text-1`, the row link) over the DEX (12 px `text-3`).
  - Two vertical `border-subtle` hairlines bound the label column.
- **Value labels:** 13 / 500 `text-1`, 10 px outside each bar end, opacity 0 at rest.
- **Gap marker:** on the gap pool's buy side, 8 px past the bar. It is a 44 px dotted `text-3` leader and "Gap"
  (12 / 500 `text-2`), and links to `/gaps`.
- **Total row ("All of Base"):**
  - 52 px high, 8 px below the rows, with a 1 px `border-subtle` rule across the full width.
  - Fields 20 px high (§3.7).
  - Label "All of Base" at 14 / 500, with the caption "6 pools" in 12 px `text-3`; the lens changes the caption
    to "this pool: 43 %".
  - Values at 14 / 500 outside the caps.
- **Scale:** one linear scale, `max = max(total sell, total buy)`.
- **Axis row:** 12 px below, 16 px high. Nice ticks on each side ($5M, $10M) mirror around the spine. The centre
  caption reads "One scale for every pool".
- **Show data:** 8 px below; a table of pool, sell ±2 %, buy ±2 % and share of Base, with an "All of Base" total
  row.

**Phone (below 840 px):**
- Each row is two lines: the pair and DEX centred on top (13 px), then the bar pair centred on the spine.
- Rows 56 px with 10 px bars; total row 76 px with 14 px fields.
- The value lane is 52 px, so the total labels fit at the ends.
- The head shows the two side legends only; the axis has no centre caption.

**Lens:**
- Trigger and timings: §4 rows 3–5.
- Fine pointers: the whole row is the link.
- Coarse pointers: the pair name is the link (≥ 24 px), and the bars toggle the lens.
- Focus on a row's link lenses it instantly.
- Lensed rows get a `hover` background at 60 % (`color-mix`) and a 2 px focus outline when keyboard-focused.
- The lensed gap row hides its leader and shifts "Gap" 8 px, so it never collides with the value.

**Rows:** at most 8, the 7 deepest plus the largest gap. Pools beyond the list form one "other pools" stratum in
the total.

**Accessibility:**
- The figure is `role="group"` with an `aria-label` summarising Base and every pool.
- Each pair link's `aria-label` includes both sides and the share.
- "Show data" is the non-pointer route (CH9).

**Empty state:** the spine hairline only, with the H1 "No pools are scored yet." and no fake bars.

#### Mirrored depth curve (Pool focal, CH3 and C9)

- **Size:** 340 px tall on desktop, 240 on phones. Plot top 36, bottom 30.
- **x:** log-spaced at −5, −2, −1, 0, 1, 2, 5 % from the spine (`x = cx ± log(1 + |p|) / log 6 × (W/2 − 4)`).
- **y:** linear from 0, with nice ticks along the spine in `text-3` ($5M / $10M / $15M) on a `well` halo.
- **Marks:**
  - legend row above: "■ Sell side, price down" left, "■ Buy side, price up" right, 13 px;
  - the ±2 % band in `well`;
  - the field of light;
  - 2 px side-colour lines with round joins, joining measured points only;
  - points r 3.5 with a 2 px `canvas` ring;
  - exactly two direct labels at ±2 %, 10 px inward and 12 px above their points;
  - a 1 px `border` baseline;
  - x ticks "−5 %" … "Mid" … "+5 %", clamped 14 px inside the edges.
- **Exhausted side:** a dashed segment with "Liquidity runs out". A missing level shows a sentence instead.
- **Interaction:**
  - The pointer snaps to the nearest measured point: a 1 px `control` crosshair, the point grows to r 5, and the
    tooltip opens.
  - Arrow keys step through points; Escape clears.
  - The SVG is `tabindex="0"` with `role="img"` and a full `aria-label`.
- **Tooltip** (CH2):
  - min 150 px wide, padding 8 / 10, radius 10, `overlay`, `--shadow-pop`, 13 px;
  - header: an 8 px swatch and "+2 %, buy side";
  - rows: Depth, Spent (buy) or Sold (sell) with the token amount (≤ 4 significant figures), and Price ("Reached"
    or "Liquidity runs out");
  - placed 16 px right of the point (left if it would overflow), vertically centred, never over a direct label;
  - `pointer-events: none`.
- **Show data:** under the chart. A ±1/2/5 table of USD and token amounts per side, then "Buying meets 19 % more
  depth than selling at ±2 %."

#### Row depth glyph (CH8)

80 × 20 SVG, `aria-hidden`:
- sell rectangle left of x 40, buy right, 6 px high at y 7;
- width `max(1, v / max × 38)`;
- a 1 × 12 `border` spine;
- max shared across the table.

#### Time-series small multiples (Pool "Over time", CH5)

**Layout:**
- Depth ±2 % at 160 px and Spread at $10K at 120 px, scaled ×0.7 on phones. They are 24 px apart, share one
  x axis and use a 52 px right pad for y ticks.
- **Head per multiple:** label (13 px `text-2`), the value (14 / 500 `text-1`, rewritten by scrubbing), and "now"
  or the sample time (`text-3`).
- **Depth legend:** "p10 to median, 7 d" with a 12 × 8 `hover` swatch, right-aligned.

**Marks:**
- 2 px `text-1` lines with round joins, no fill.
- The p10–median band as a `hover` rect.
- Two nice y ticks, right-aligned.
- **Y domain:** padded 18 %. Line multiples never span less than 20 % of the window median, so a flat series
  (10.3–10.4 bps) reads as flat.
- **Time ticks:** 6-hour landmarks (00:00, 06:00, …) up to 2 days, weekday names up to 10 days, "16 Oct" weekly
  beyond. They sit 14 px clear of the edges.
- A "Times in UTC" caption sits on the window control row.

**Scrub** (CH2):
- A 1 px `control` crosshair across both multiples and a 4 px dot with a 2 px `canvas` ring.
- Head values swap instantly.
- Arrow keys step; Escape and blur clear; scrubbing is disabled while a morph runs.

**Range morph:** §4 row 9.

#### Market-maker chart (Scorecard focal)

**Layout:**
- 340 px tall on desktop, 240 on phones. Top 8, bottom 28.
- A right pad of 80 px (64 on phones) holds the y labels, so no label touches a line.

**Encoding:**
- The buy side is plotted above a zero line and the sell side mirrored below it, on one symmetric scale
  `M = ceil(max(1.25 × KPI, values) × 1.08 / niceStep)`.
- **Marks:**
  - 2 px lines in `buy` (above) and `sell` (below);
  - the KPI as 1 px dashed `text-2` lines (4 4) on both sides, labelled "KPI $50K" in `text-2`;
  - magnitude ticks in `text-3` at 0.5× and 1.5× the KPI per side, at most two, each more than 0.2 M from the KPI
    and below 0.97 M;
  - "0" at the 1 px `border` zero line.
- **Breach episodes:** `--bad-mark` bands at `--band-op`, full plot height, from `start − interval / 2` to
  `end + interval / 2`.
- **30 d window:** a dashed (2 3) `border` registration line labelled "Registered 16 Oct".
- **Whole-pool depth toggle:** 1 px `text-3` context lines.

**Head row:**
- Left: the legend "■ Buy side, above", "■ Sell side, below" and "■ Breached" (a `--bad-mark` swatch at 0.35).
- Right: the checkbox, then the 24 h / 7 d / 30 d segmented control.

**Scrub:**
- A crosshair, plus dots on both lines.
- The facts rewrite to "then" with their comparison words and triangles.
- A caption in the foot row shows the status shape and word ("Breached, both sides") and the full UTC time.
- The caption is empty and keeps its height at rest.
- Arrow keys step through samples.

**Show data:** in the same foot row. Per sample for 24 h; per UTC day for 7 d and 30 d (lowest sell, lowest buy,
"3 of 12" within KPI).

#### Uptime strip (CH8)

- One row of cells, one per sample in the window, 12 px high with 2 px gaps.
- Within-KPI cells are `border`, breached cells `--bad-mark`, unevaluable cells hollow (1 px `border`).
- Each cell's `title` is its full UTC time.
- Axis caption: the first sample's full UTC time on the left, "now" on the right, 12 px `text-3`.
- `role="img"` with "36 of 84 samples within KPI".

#### Cost-to-trade lollipop (Pool)

- **Rows:** 40 px (32 on phones), a 56 px label column ("$1K", "$10K", "$100K" at 13 px `text-2`), and a 1 px
  `border-subtle` track.
- **Marks:**
  - a 3 px `text-1` stem from 0 to the value;
  - a 10 px `text-1` dot;
  - the value label (13 px `text-1`) 14 px right of the dot, or left of it on a 6 px-padded `canvas` patch when
    past 72 % of the axis.
- **Not fillable:** a hollow 10 px ring (1.5 px `text-2`) at 0, with "Not fillable" in `text-3`.
- **Axis:** nice ticks, and the last tick carries the dotted "bps" glossary term.

#### Health bar (CH8)

- Four segments in a `35fr 25fr 20fr 20fr` grid with 2 px gaps. They are 8 px tall in the section and 4 px at
  80 px in tables.
- Track `border-subtle`, fill `text-1` to component ÷ weight.
- **Names** under each segment, 8 px below, 13 px `text-2`, each followed by its weight in `text-3`
  ("Concentration 20"). The weakest is `text-1`.
- **Below 600 px** the names stagger on two rows, so none is ellipsized:
  - row 1: Depth, then Concentration;
  - row 2: Spread, then Persistence (right-aligned).

#### Share bar, turnover glyph and bullet graph

- **Share bar:** an 8 px bar with 2 px gaps: top LP in `text-1`, the next two in `control`, everyone else in
  `border`. The legend uses 8 px swatches at 13 px `text-2`, with "4 owners within ±5 %" in `text-3`.
- **Turnover glyph** (gaps):
  - a 96 × 4 meter with radius 2, track `border-subtle`, fill `text-1` (`control` for rows under 3×);
  - a 1 × 12 `text-3` tick at 24 % (3× turnover, the meaningful-gap threshold);
  - the gap score at 14 px, 8 px after it;
  - `role="img"`: "Gap score 85 of 100; 3× turnover is 24".
- **Bullet graph:**
  - 96 × 6 in lists and up to 220 in facts, track `border-subtle`, fill `text-1`;
  - target tick 2 × 14 in `text-2`;
  - scorecard depth bullets scale to 1.5× the KPI, so the tick sits at two thirds;
  - uptime bullets scale 0–100 % with the tick at the target.

### 5.10 Floating layers

**Popover:**
- `position: fixed`, min 220 / max 320 px, padding 12 / 16, radius 10, `overlay`, `--shadow-pop`, 13 px,
  line-height 1.5.
- Placed 8 px below its trigger, aligned to its nearer edge, 8 px from the viewport edge.
- Closes on outside pointer-down or Escape (which returns focus).
- `role="dialog"` with `aria-label`.
- Definition rows are `dt` `text-2` and `dd` tabular, with a 24 px gap.

**Glossary tooltip** (D8, K7):
- Max 340 px, padding 8 / 10, radius 10, 13 px.
- One or two lines, then a "How it is measured" prose link to the Methodology anchor.
- Hoverable; Escape dismisses it.
- The trigger is a `tabindex="0"` span with a 1 px dotted `text-3` underline.

**Sheet** (PH4):
- Fixed to the bottom, full width, radius 12 at the top.
- Max height `calc(100dvh - env(safe-area-inset-top) - 24px)`, `overscroll-behavior: contain`.
- Padding 0, the gutter, and 16 plus the bottom safe area.
- **Parts:**
  - grip: 36 × 4, radius 2, `border`, 8 px from the top;
  - head: 52 px, with the title (16 / 600) and a quiet "Done";
  - options: ≥ 52 px rows at 16 px, with a `border-subtle` rule and a 16 px check icon on the selected one;
  - foot (Sort only): 16 px top padding, then the full-width "Highest first / Lowest first" segmented control.
- Scrim: `--scrim`.
- Behaviour: focus is trapped and returned. Body scroll locks while open. A route change closes it instantly.

### 5.11 Embed badge

- **Preview:** the API's badge SVG, unaltered: label `#2a3140`; ok `#1c7a4c`; breached `#b8232f`; no data and
  inactive `#5c6573` (`apps/api/src/badge.ts`). It sits in a `well` with 16 px padding and radius 8.
- **Copy buttons:** "Copy HTML" and "Copy Markdown" are secondary buttons with copy icons, 16 px apart.
- "Cached for 5 minutes." follows in 13 px `text-3`.
- "Show code" in the heading row reveals mono code blocks: `well`, radius 8, padding 12 / 16, 13 px, line-height
  1.6, horizontal scroll. Each block has a 13 px `text-2` caption (HTML, Markdown, Badge URL).

### 5.12 States (ST1–ST7)

- **Loading** (ST1, M10):
  - No UI for responses under 300 ms. Once shown, a skeleton stays at least 400 ms.
  - Skeletons mirror the final layout in `well` blocks at the same heights, static with no shimmer:
    - butterfly: rows of 14 px bars;
    - curve: a 340 / 240 px block;
    - facts: 40 px value blocks with 13 px label blocks;
    - tables: 64 px rows.
  - The title block renders immediately. CLS is 0.
- **Refetch:** keep the content, dim it to 0.6 after 150 ms, and show a 2 px indeterminate `text-3` bar at the
  section top. Never fall back to a skeleton.
- **Empty** (ST2): one sentence that says what is empty and the next step, plus at most one secondary button or
  link. Examples:
  - "No pools match "xyz"." with "Clear search";
  - "No market-maker mandates registered yet. Mandates are added with `depthwatch mm add`. How scorecards work".
- **Error inside a section** (ST3): "Unable to load history. Check that the API is running, then retry.", 14 px
  `text-2`, with a secondary "Retry". The rest of the page stays usable.
- **Offline** (ST7): the header freshness shows a `bad` triangle and "Offline", never a full-page takeover when
  cached data exists.
- **Not found** (ST4):
  - h1 "Pool not found";
  - one sentence;
  - the id in mono, 16 px below;
  - "Browse pools" (secondary) and "See liquidity gaps" (prose link), 32 px below.
- **Partial** (ST5, D6):
  - Unknown values are "—" in `text-3`, with a tooltip giving the reason ("Uniswap v4 pools share one singleton
    contract, so pool TVL is not reported.").
  - "Not tracked" and "exhausted" are words.
  - An unscored pool says "Not scored yet".

### 5.13 Icons (K9)

One stroke set: 16 px, `viewBox 0 0 16 16`, 1.5 px stroke, round caps and joins, `currentColor`, `aria-hidden`.

The set (`apps/web/src/components/ui/Icon.tsx`): chevron down, chevron right, chevron left (back), swap (⇄), search,
check, copy, external, arrow down, arrow up, sliders (filter) and columns.

The logo mark is the only multicolour glyph: a 2 × 14 `text-1` spine with three steps on each side in `sell` and
`buy`.

---

## 6. Screens

Measured at 1440×900 and 390×844 (2×). Heights are with all disclosures closed.

| Screen    | Desktop height (budget) | Phone height (budget) | First-viewport data numbers, desktop / phone (budget)                             |
| --------- | ----------------------: | --------------------: | --------------------------------------------------------------------------------- |
| Home      |         1,385 (≤ 1,500) |       2,008 (≤ 2,100) | 7 / 3 (≤ 7)                                                                       |
| Pool      |                   2,837 |       2,435 (≤ 2,600) | 7 / 3 (≤ 8): price, two answer numbers (the curve labels repeat them), four facts |
| Scorecard |                   2,851 |       2,490 (≤ 2,600) | 7 / 3 (≤ 7): streak and time, three facts, KPI and target                         |
| Pools     |                   1,007 |       1,145 (≤ 1,600) | Header 3; rows are the content (TB2 exception)                                    |

There is no horizontal overflow at either width, and no console errors.

### 6.1 Home (`/`)

**Desktop:**

| Element                        | Position (y × height, px) |
| ------------------------------ | ------------------------- |
| Chrome                         | 0–84                      |
| Display, columns 1–7           | 148 × 116                 |
| Lead and actions, columns 8–12 | 148                       |
| Butterfly head                 | 358                       |
| Pool rows                      | 391–631                   |
| Total row                      | 639 × 52                  |
| Axis                           | 703                       |
| Show data                      | 727                       |
| Facts                          | 807 × 66                  |
| Previews                       | 969                       |
| Footer                         | 1,298                     |
- The display (56 px) wraps to two lines, "$26.1M sits within 2 % of the price on Base.", at ≤ 20ch.
- The lead is 18 px `text-2` at ≤ 34ch. The actions sit 24 px below it: "Browse pools" (primary) and "How it's
  measured" (prose link, 14 / 500), 24 px apart.
- The facts are $28.2M "traded in 24 h", 82 with an A glyph "median health", and 51× "USDC / AERO, the biggest
  gap".
- **Previews**, two columns:
  - The head row has the h2 left and "See all gaps" or "See all scorecards" right, baseline-aligned.
  - The takeaway follows 8 px below, then the ruled list 16 px below that.
  - **Gap rows** have three lines on the left (the pair in 14 / 500, "Aerodrome v2, 0.3 %" and "Trades 51× its
    depth a day" in 13 px `text-2`) and the turnover glyph with its score on the right. The quiet line follows.
  - **Mandate rows:** the status word; the mandate name (14 / 500, may wrap); "Alice Markets (synthetic) on USDC /
    AERO" in 13 px `text-2`; right, "42.9 % 7 d" over a 96 px bullet with the 95 % tick.

**Phone:**
- The display (36 px) runs 148–224.
- The butterfly runs 264–744, entirely in the first viewport (PH6).
- Show data, then the lead (16 px) and actions, then the facts as rows, then the previews in one column.
- "See all" links shorten to "See all" with a full `aria-label`.

**First view (M6):** §4 rows 1–2.

**States:** ia-v3 §4.1 (no scored pools; one pool; hundreds of pools, with 8 rows plus "Show all 312 pools"; no
meaningful gap; no mandates).

### 6.2 Pools (`/pools`)

**Desktop:**

| Element                                            | Position (y)            |
| -------------------------------------------------- | ----------------------- |
| h1 "Pools"                                         | 132                     |
| Answer (`--t-h2` 400, updates with the DEX filter) | 195                     |
| Controls row                                       | 258, 36 px              |
| Caption                                            | 318                     |
| Table                                              | 351, header 40, rows 64 |
| "Compare DEXes" disclosure                         | 48 px below the table   |
- **Controls row:** search 320 px, 16 px gap, the DEX segmented control (All, Uniswap v3, Uniswap v4, Aerodrome
  v2, Aerodrome Slipstream), 16 px, the Rating segmented control (All pools, Rated only), then a spacer and
  Columns.
- **Filter-aware answer:** "Uniswap v3: 2 pools, $9.3M within 2 % of the price, median health 79 (B)." The answer
  cross-fades over 150 ms on a filter change, and "Showing 2 of 6" is announced.

**Phone:**
- The search is full width at 44 px.
- Below it sit equal-width "All DEXes" and "Sort: health" buttons (the latter with a down-arrow icon), 12 px apart,
  opening sheets. The filter sheet holds the DEX and the Rating options (All pools, Rated only).
- Then the caption, the head row and the phone rows.

**State:** sort, direction, DEX, query, columns and page live in the URL, with `rated=1` (Rated only) and
`unrated=N` (pages of unrated pools shown).

### 6.3 Pool (`/pools/:id`)

**Desktop:**

| Element                 | Position (y)     |
| ----------------------- | ---------------- |
| Back link "Pools"       | 132              |
| h1                      | 172              |
| Secondary line          | 219              |
| Answer                  | 271              |
| Curve legend and figure | 365, SVG 394–734 |
| Show data               | 746              |
| Facts                   | 810              |
| Sections                | from 940         |
- **h1:** "WETH / USDC", with the token symbols as links.
- **Secondary line:** "Aerodrome Slipstream, 0.05 % fee", then 24 px, then "1 WETH = 2,460.32 USDC" with the ⇄
  icon button (price flip, §4 row 12).
- **Answer:** `--t-h2` 400, ≤ 44ch.
- **Facts:** 88 with an A glyph "health", 10.4 bps "spread at $10K", $9.77M "traded in 24 h", $85.3M "TVL".
- **Gap callout,** when turnover ≥ 3×: "Liquidity gap: trades 51× its depth daily." at 14 px `text-2`, 16 px below
  the facts.
- **Sections, in order:**
  1. **Health:** weighted bar and names; notes line; Details shows components to 1 decimal and a "How health is
     graded" link.
  2. **Cost to trade:** lollipop; Details shows the averages.
  3. **Who provides it:** share bar; Details shows band, HHI and owners.
  4. **Over time:** the window control and "Times in UTC", then the multiples; Details shows persistence.
  5. **Mandates on this pool,** when there are any.
  6. **About this pool:** a two-column list on desktop, a disclosure on phones.

**Phone:** back link at 146, h1 at 196, answer at 327, curve SVG 457–697 (in the first viewport), Show data, facts
2 × 2, then the sections with Details at the right of each heading line.

### 6.4 Gaps (`/gaps`)

- h1 "Liquidity gaps".
- Answer: "1 pool trades 3× its depth or more every day."
- Lead (`text-2`): "A gap is a pool that trades far more each day than the liquidity near its price."
- A caption row, 48 px below: "Pools with at least $10K of 24 h volume" with "How the score works".
- Ranked rows: `2rem minmax(0, 1fr) auto 136px`, holding the rank (`text-3`), the pool cell, "Trades 51× its depth
  a day" (with a hover and focus tooltip "$1.60M traded through $31.5K of depth") and the turnover glyph.
- Rows under 3× sit behind "Show 5 more pools that trade less than 3× their depth", drawn quiet (`control` meter,
  `text-3` sentence).
- The table view follows ia-v3 §4.4.
- On phones, rows show the pool cell, then "51×", then the score.

### 6.5 Scorecards list (`/mm`)

- h1 "Market-maker scorecards".
- Answer: "1 of 2 mandates is within its KPIs right now."
- The lead, 48 px above a ruled list of mandate rows (the same row as the Home preview).
- On desktop with 10 mandates or fewer, each row adds a 7 d uptime strip with only breaches coloured.
- Filter (All / Active / Inactive) and List / Table use segmented controls in the URL.

### 6.6 Scorecard (`/mm/:id`)

**Desktop:**

| Element                         | Position (y) |
| ------------------------------- | ------------ |
| Back link "Scorecards"          | 132          |
| h1, with the status chip inline | 172          |
| Meta line                       | 219          |
| Answer                          | 265          |
| Chart head row                  | 329          |
| Chart                           | 377–717      |
| Foot row                        | 729          |
| Facts                           | 793          |
| Sections                        | from 943     |
- **Status chip:** inline after the h1 at a 16 px gap, baseline-aligned (−4 px optical lift).
- **Meta line:** "Alice Markets (synthetic) on USDC / AERO, Aerodrome v2, 0.3 %", with the pool as a prose link.
- **Answer:** "Breached for 8 consecutive samples, since 14 h ago."
- **Foot row:** Show data left, the scrub caption right.
- **Facts:**
  - $7.82K with a triangle, "sell side now, below the $50K KPI";
  - $7.66K with a triangle, "buy side now, below the $50K KPI";
  - 42.9 % with a triangle, "uptime, 7 d, below the 95 % target";
  - each with a bullet.
- **Sections, in order:**
  1. **Uptime:** the strip; Details shows all three windows.
  2. **Breaches:** five newest episode rows ("21 Oct, 04:00 UTC", "14 h, 8 samples, both sides", "$7.40K
     lowest"); "Show all 6 episodes" below; Show samples in the heading.
  3. **Worst moments:** rows of label, value with "KPI $50K", and time (UTC, block number on hover and focus).
  4. **Spread:** "This mandate has no spread KPI." with "Show measured spread" in the heading.
  5. **Embed badge.**
  6. **Mandate:** a two-column list on desktop, a disclosure on phones.

**Phone:**
- The h1 wraps to two lines.
- The chip leads the meta line.
- The legend is on one row, and the checkbox and window control on the next.
- The chart runs 511–751, and the facts are one column with bullets on the right.
- Three episodes show before "Show all".

### 6.7 Token (`/tokens/:address`)

Same anatomy as Pool's title block, with the butterfly of Home:
- back link "Pools";
- h1 "WETH" with "Wrapped Ether";
- answer "$16.5M sits within 2 % of the price across WETH's 2 scored pools.";
- butterfly scoped to the token, with the total row labelled "All of WETH" and its own scale;
- facts per ia-v3 §4.7;
- the Pools table component, with sort in the URL and the phone sort sheet;
- About this token.

### 6.8 Methodology (`/methodology`)

- h1, then the provenance answer.
- The metric index: a definition list on a `border` top rule, `10rem` term column, terms 14 / 500 `text-1`,
  definitions `text-2`, 16 px rows.
- Sections per ia-v3 §4.8 in `--t-prose` at ≤ 66ch, each figure built from the components above, with "Show
  formula" disclosures.
- Desktop ≥ 1200 px has a sticky "On this page" list in the left column (current section `text-1`). Phones get an
  "On this page" disclosure.

### 6.9 Not found

§5.12, on the page grid with 48 px top padding.

---

## 7. Implementation map for `apps/web`

No chart library and no new dependencies.
- **Charts** are hand-written SVG and HTML: `depthCurve`, `butterfly`, `multiples`, `mmChart`. A chart library is not used: Recharts' defaults conflict with CH1 and CH10, and it cannot draw the field of light.
- **Metrics** stay in `packages/core`. The web only formats and draws.

| Area                | Where                                                                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens, fonts, base | `src/styles/tokens.css`, `src/styles/base.css`, `public/fonts/`                                                                                                                        | §3 verbatim; one token file, no per-page overrides                                                                                                                                                                                                                                                                     |
| Motion              | `src/lib/motion.ts`                                                                                                                                                                    | `bezier`, `easeInOut`, `tween`, `isTweening`, `useReducedMotion()`, `isKeyboardClick(e) => e.detail === 0`                                                                                                                                                                                                             |
| Formatting          | `src/lib/format.ts`                                                                                                                                                                    | `usd` (N1), `usdTick` (2 significant figures), `bps`, `share`, `shareOf` (N4), `uptime`, `ratio`, `score` (floor), `price`, `amount`, `fee`, `ago`, `abs`, `full` (UTC), `when`                                                                                                                                        |
| Scales              | `src/lib/scale.ts`                                                                                                                                                                     | `linear`, `niceStep`, `ticks`                                                                                                                                                                                                                                                                                          |
| Shell               | `components/shell/{DemoLine,AppBar,Nav,Freshness,Footer,SkipLink}.tsx`                                                                                                                 | One `<nav>`, restyled per breakpoint                                                                                                                                                                                                                                                                                   |
| Primitives          | `components/ui/{Button,BackLink,Disclosure,SegmentedControl,Sheet,Popover,Glossary,GradeGlyph,StatusWord,StatusChip,Fact,Section,CopyButton,Icon}.tsx`                                 | `Section` takes `details` and places the trigger in the head (K10)                                                                                                                                                                                                                                                     |
| Charts              | `components/charts/{DepthButterfly,DepthCurve,SmallMultiples,MarketMakerChart,UptimeStrip,SpreadLollipop,HealthBar,ShareBar,TurnoverGlyph,BulletGraph,RowDepthGlyph,ChartTooltip}.tsx` | Each takes a `Show data` table as a child (CH9)                                                                                                                                                                                                                                                                        |
| Routing transitions | `Layout.tsx`                                                                                                                                                                           | React's `<ViewTransition>` wraps `<main>`; the cross-fade runs only for pointer clicks with reduced motion off and `document.startViewTransition` available (`supportsViewTransitions`); keyboard navigation and `popstate` are instant, and focus moves to `<main>` on keyboard navigation (§4 row 6, principles M3). |
| Per-side depth      | `apps/api/src/dto.ts`, `src/api/types.ts`, mocks, static export                                                                                                                        | `PoolSummary` carries `depth2UpUsd` and `depth2DownUsd` (ia-v3 §6.1): the newest snapshot's ±2 % sides as stored. The butterfly and total row read them from the pool summaries; a null side draws as unknown; the total sums all pools                                                                                |
| Breach episodes     | `src/lib/scorecard.ts`                                                                                                                                                                 | `breachEpisodes(points)`; durations are `end − start` (14 h for 8 samples, matching "since 14 h ago")                                                                                                                                                                                                                  |
| URL state           | pages                                                                                                                                                                                  | `window`, `sort`, `dir`, `dex`, `q`, `cols`, `view`, `active`, `page`; replace, not push                                                                                                                                                                                                                               |
| Tests               | `pages/*.test.tsx`, `components/*.test.tsx`, `styles.test.ts`                                                                                                                          | Assert ia-v3 and this file: answer sentences, focal presence, total row, lens classes, Show data contents, URL params, the greps in principles §17, `usd` cases ($5.10M, $50K, $7.40K, $412), `shareOf(0.001) === 'under 1 %'`                                                                                         |

---

## 8. Acceptance

A build matches this spec when all of the following hold:
1. **Screenshots** at 1440×900 and 390×844, in both themes and with fonts blocked, match the positions and
   values in §6 and the components in §5.
2. **Budgets** in §6 hold: heights, data numbers and focal positions.
3. **Motion frames** at 0, 80, 160, 240 and 400 ms match the catalogue in §4. With reduced motion emulated, only
   opacity and colour animate.
4. **Accessibility and principles checks** pass:
   - `document.fonts.check('16px "Hanken Grotesk"')` is true before shots;
   - the network log has no Google Fonts request;
   - the contrast table in §3.1 passes (`--bad-mark` 4.22:1 light and 6.2:1 dark as a mark);
   - `scrollWidth === clientWidth` at 320, 360, 375, 390, 412 and 430;
   - every interactive element has a visible ring;
   - segmented controls and charts work with the arrow keys;
   - keyboard actions never animate.
5. **The rule audit** of principles §17 lists no unmet rule, and the wording in §2 is in `principles.md` and
   `ia-v3.md`.

---

## 9. Sources

**Repository:**
- [`principles.md`](principles.md), [`ia-v3.md`](ia-v3.md), [`critique-v2.md`](critique-v2.md);
- the research notes in [`research/`](research/), with every URL they cite.

**Read for this file:**
- Emil Kowalski, design-engineering skill (read raw). Covers transitions that can be interrupted and retargeted
  while keyframes restart, no animation on keyboard-initiated actions, UI motion under 300 ms, no ease-in, press
  scale 0.95–0.98, and popovers that scale from their trigger:
  https://raw.githubusercontent.com/emilkowalski/skills/main/skills/emil-design-eng/SKILL.md
- Vercel Web Interface Guidelines (read raw). Covers "Animations are cancelable by user input", a reduced-motion
  variant, `transform` and `opacity` first, tabular numbers, URL as state, a show-delay of about 150–300 ms with a
  minimum visible time of about 300–500 ms, 24 px and 44 px hit targets, layered shadows and concentric radii:
  https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/README.md
- MDN, `Animation.currentTime`: "returns and sets the current time value of the animation in milliseconds,
  whether running or paused". This is the basis of the tween clock. Read via
  https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/animation/currenttime/index.md
- MDN, `prefers-reduced-motion`. Read via
  https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/css/reference/at-rules/@media/prefers-reduced-motion/index.md
- React Router, view transitions: the `viewTransition` prop and the `navigate` option, now deprecated in favour of
  React's `<ViewTransition>`:
  https://raw.githubusercontent.com/remix-run/react-router/main/docs/how-to/view-transitions.md
- React, `<ViewTransition>`: imported from `react`, DOM only, examples pinned to canary builds:
  https://raw.githubusercontent.com/reactjs/react.dev/main/src/content/reference/react/ViewTransition.md

**Secondary, unverified** (not read in full; treat as supporting only):
- Halftone moiré worsens when the sampling grid is a fraction of the screen frequency. This supports snapping the
  lattice to device pixels. https://docs.krita.org/en/reference_manual/layers_and_masks/fill_layer_generators/screentone.html,
  https://krita-artists.org/t/screentone-quality-of-krita-4-4-x/24159
- Vercel-style elevation reconstructions (stacked hairline-plus-offset shadows), used only to keep shadows on
  floating layers: https://cdn.jsdelivr.net/npm/gridstamp@1.4.0/DESIGN.md, https://www.shadcn.io/design/vercel/raw
- Dot-matrix brand languages (Nothing). The field of light is deliberately data-bound, which keeps it clear of
  this trend's decorative use: https://design-milk.com/the-nothing-phone-3s-glyph-matrix-turns-notifications-into-pixel-art/
- Also consulted: https://linear.app/now/behind-the-latest-design-refresh,
  https://linear.app/now/how-we-redesigned-the-linear-ui,
  https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/stripe/DESIGN.md,
  https://design.hagicode.com/designs/vercel/, https://www.nngroup.com/articles/scrolling-and-attention/,
  https://www.nngroup.com/articles/progressive-disclosure/, https://www.nngroup.com/articles/accordions-on-desktop/,
  https://www.w3.org/TR/WCAG22/
