# Depthwatch visual identity (dashboard v2)

**Direction.**
1. The v2 identity is **Signal instrument**. Each colour means one thing: cobalt and orange are the two sides of the book, green, amber and red are health and status, and ink is everything else. Every status also has a cue that does not rely on colour.
2. It carries the least migration risk. Its greys, border and grid values are almost the same as the previous `styles.css` and its accent is already blue, so most of the migration is swapping values under the existing token names.
3. Two other directions were considered: **Broadsheet**, a plain-language newspaper layout, and **Night Desk**, a dark mono terminal. From Broadsheet come the plain-language layer and its phone discipline: the hero headline and subline, a caption under each headline number, the gap and scorecard explainer sentences, a one-sentence reading under the ladder, scroll boxes with edge shadows in place of hidden columns, and a nav that fits on one row at 320 px.
4. From Night Desk come the accent sort arrow, the phone ladder with values above the bars, the ladder scale labels at ½ and full scale, and its dark-mode restraint: no pure black, shadows or gradients.
5. Rejected: all-mono numerals (labels collide at 320 px), serif display type (a second voice and a layout rewrite), a solid-red F grade, an uptime tape coded by colour only, green/red as the bid/ask pair (the pair colour-blind readers confuse most), and the stock badge colours, which fail 4.5:1.

Status: superseded by [`visual-v3.md`](visual-v3.md), which `apps/web` now follows; kept as the record of the v2 decisions. Do not apply its Google Fonts link (§2): the product self-hosts its fonts and makes no Google Fonts request (visual-v3.md §3.2, principles T2). For v2, `docs/design/web-v2.md` set routes, data and behaviour and this file set how things look; if the two conflicted, web-v2 won on behaviour and this file on appearance.

## What is kept, grafted and dropped

- **Base:** the Signal instrument palette, type (Archivo + JetBrains Mono), logo, ladder, gap meter, uptime tape, status glyphs and redesigned badge colours.
- **From Broadsheet:** the hero headline and subline, plain-language captions under the headline numbers, the gap and scorecard explainers, a reading sentence under the ladder, scroll boxes with edge shadows (never hidden columns), and a phone nav sized to fit at 320 px.
- **From Night Desk:** the sort arrow in accent, the phone ladder with values above the bars, scale labels at 0 / ½ / max, and its dark-mode restraint (no pure black, no shadows, no gradients).
- **Changed from Signal:**
  - Ask is darkened to `#cf6f0c`: 3.54:1 on white, against 3.07:1 for the original.
  - F is a tint like A–D, not a solid fill.
  - DEX chips keep their case ("UNI v3").
  - The section-divider glyph is monochrome and used on Home only.
  - The badge gets no logo glyph, so the API tests stay stable.
  - There is no mini-ladder in tables.
  - Tablet tables scroll instead of hiding columns.
  - Spread gets its own violet so that orange always means ask.
- **Colour grammar (the one rule):**
  - Blue in a bar, tick, swatch or line always means **bid**, and orange always means **ask**.
  - Blue text with an arrow or a hover underline is a **link**.
  - Never fill a bar, meter or line with `--accent`. Neutral magnitudes (gap score, score breakdown) are ink (`--text`).
  - Green, amber and red appear only in grade and status chips, ok/breach ticks and thresholds.

## 1. Tokens: `apps/web/src/styles.css`

The existing token names are kept wherever one exists, so components change only where noted in the migration table below. Colour tokens live in three blocks: light on `:root`, dark under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`, and the **same dark declarations again** under `:root[data-theme="dark"]`. The two dark blocks must be identical; consider adding a guard test for this in `styles.test.ts`. Non-colour tokens go in one more `:root` block that is not repeated.

```css
:root {
  color-scheme: light;
  --bg: #f3f4f6;
  --surface: #ffffff;
  --surface-2: #eceef2; /* raised: hover rows, active segment, chip and track fills */
  --border: #dde1e7; /* hairlines, decorative */
  --border-strong: #7c8594; /* control boundaries: inputs, secondary buttons, segmented, no-data chip (≥3:1) */
  --grid: #e3e6eb;
  --text: #10141b;
  --muted: #566072;
  --faint: #8a93a1; /* NON-TEXT ONLY: ticks, disabled, n/a borders */
  --on-ink: #ffffff; /* text on an ink (--text) fill: primary button */
  --accent: #1d4db5; /* links, sort arrow: never bars */
  --accent-hover: #163d92;
  --focus: #1d4db5;
  --bid: #1d4db5; /* bid side marks: down / sell token0 */
  --bid-ink: #1d4db5; /* bid side as text */
  --ask: #cf6f0c; /* ask side marks: up / buy token0 */
  --ask-ink: #8f4c08; /* ask side as text */
  --series-depth: #2a3140; /* total-depth line in history charts */
  --spread: #6d3fc0; /* spread series and the spread score bar only */
  --threshold: #b8232f; /* KPI threshold lines */
  --warn-bg: #fff4d6;
  --warn-fg: #7a4a00;
  --error-bg: #fbe1e3;
  --error-fg: #a11d28;
  --grade-a-bg: #d6efe1;
  --grade-a-fg: #0f5a35;
  --grade-b-bg: #e3f0d2;
  --grade-b-fg: #365c10;
  --grade-c-bg: #f6ebc2;
  --grade-c-fg: #6b4c00;
  --grade-d-bg: #f9dfc9;
  --grade-d-fg: #86370a;
  --grade-f-bg: #fbe1e3;
  --grade-f-fg: #a11d28;
  --grade-none-bg: #eceef2;
  --grade-none-fg: #566072;
  --ok: #1c7a4c; /* solid ok marks: status dot, uptime ticks, met-target meter */
  --ok-bg: #dcf1e5;
  --ok-fg: #11603a;
  --breach: #b8232f; /* solid breach: Breached chip fill, breach ticks, missed meter */
  --on-breach: #ffffff;
  --bad-bg: #fbe1e3;
  --bad-fg: #a11d28;
  --neutral-bg: #eceef2;
  --neutral-fg: #566072;
  --scroll-shadow: rgb(16 20 27 / 0.16);
}

/* Dark: this exact block under the media query AND as :root[data-theme="dark"] */
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0b0e13;
  --surface: #12161d;
  --surface-2: #1a1f28;
  --border: #252b35;
  --border-strong: #5d6878;
  --grid: #222833;
  --text: #e7eaf0;
  --muted: #9ba4b4;
  --faint: #6d7585;
  --on-ink: #0b0e13;
  --accent: #86aeff;
  --accent-hover: #adc8ff;
  --focus: #8fb4ff;
  --bid: #4680ea;
  --bid-ink: #8fb4ff;
  --ask: #f6b06a;
  --ask-ink: #f6b06a;
  --series-depth: #c9d1de;
  --spread: #b49af0;
  --threshold: #f0646e;
  --warn-bg: #3b2e0c;
  --warn-fg: #f3d58a;
  --error-bg: #3d171b;
  --error-fg: #ff9ca3;
  --grade-a-bg: #12382a;
  --grade-a-fg: #86ddb2;
  --grade-b-bg: #233914;
  --grade-b-fg: #bde39a;
  --grade-c-bg: #3b3112;
  --grade-c-fg: #ecd18a;
  --grade-d-bg: #432812;
  --grade-d-fg: #f5b78a;
  --grade-f-bg: #3d171b;
  --grade-f-fg: #ff9ca3;
  --grade-none-bg: #1a1f28;
  --grade-none-fg: #9ba4b4;
  --ok: #3fbf7f;
  --ok-bg: #12352a;
  --ok-fg: #86ddb2;
  --breach: #f0646e;
  --on-breach: #1a0508;
  --bad-bg: #3d171b;
  --bad-fg: #ff9ca3;
  --neutral-bg: #1a1f28;
  --neutral-fg: #9ba4b4;
  --scroll-shadow: rgb(0 0 0 / 0.55);
}

:root {
  --sans:
    "Archivo", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono:
    "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --fs-2xs: 0.6875rem; /* 11 */
  --fs-xs: 0.75rem; /* 12 */
  --fs-sm: 0.8125rem; /* 13 */
  --fs-data: 0.875rem; /* 14 */
  --fs-base: 0.9375rem; /* 15 */
  --fs-md: 1.0625rem; /* 17 */
  --fs-lg: 1.375rem; /* 22 */
  --fs-h1: 1.75rem; /* 28; 24 px below 640 */
  --fs-xl: 2rem; /* 32; 24 px below 640 */
  --fs-hero: clamp(2rem, 1.35rem + 2.6vw, 3rem); /* 32 → 48 */
  --lh-tight: 1.1;
  --lh-snug: 1.3;
  --lh-body: 1.5;
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 24px;
  --s-6: 32px;
  --s-7: 48px;
  --s-8: 64px;
  --r-1: 2px; /* DEX chip, tags, bar ends */
  --r-2: 4px; /* grade/status chips, buttons, inputs, tooltip, code */
  --r-3: 8px; /* panels and cards */
  --wrap: 1280px;
  --tap: 44px;
}
```

`html { font-size: 100% }` replaces the current `14px`. Every size uses the tokens above (see §2).

### Migration of existing tokens and their usages

- `--bg --surface --surface-2 --border --grid --text --muted --focus`: new values only.
- `--faint`: value kept, now **non-text only**. `.faint`, `.rank` and `.panel-head .hint` switch
  to `var(--muted)`; the old `--faint` text was about 3:1.
- `--accent`: new value, and it comes off every bar and line:
  - `.bar > span` becomes `var(--text)`.
  - `.ladder-bar` becomes `var(--ask)` (the up side), and `.ladder-side.down .ladder-bar` becomes `var(--bid)`.
  - The HistoryChart depth line becomes `var(--series-depth)`.
  - ScorecardChart `depthUp` becomes `var(--ask)`.
- `--accent-soft`: **removed**. ScorecardChart `depthDown` and its swatch become `var(--bid)`.
- `--spread`: orange becomes violet. Its usages do not change (HistoryChart, the ScorecardChart spread chart,
  `.bar-spread`).
- `--threshold`, `--error-*`, `--grade-*`, `--ok-bg/-fg`, `--bad-bg/-fg`, `--neutral-*`: new values.
  `--warn-*` is unchanged. `--bad-*` stays the **soft** pair, used for text, KPI fail and marks. The solid
  Breached chip uses the new `--breach` and `--on-breach`.
- `--sans`, `--mono`: Archivo and JetBrains Mono are added at the front of the stacks.
- `:root { color-scheme: light dark }` becomes `light` on `:root` and `dark` in both dark blocks.
- New tokens: `--border-strong --accent-hover --on-ink --bid --bid-ink --ask --ask-ink --series-depth --ok
  --breach --on-breach --scroll-shadow`, plus the type, space and radius tokens.

### Measured contrast (WCAG 2.x)

All pairs below were computed from the final values. Text pairs must be ≥ 4.5:1 and graphics ≥ 3:1.

| Pair                                                         |                                   Light |                                    Dark |
| ------------------------------------------------------------ | --------------------------------------: | --------------------------------------: |
| text on bg / surface / surface-2                             |                   16.77 / 18.45 / 15.89 |                   16.04 / 15.04 / 13.71 |
| muted on bg / surface / surface-2                            |                      5.76 / 6.34 / 5.46 |                      7.70 / 7.22 / 6.58 |
| accent on bg / surface / surface-2                           |                      6.86 / 7.55 / 6.50 |                      8.76 / 8.21 / 7.49 |
| on-ink on text (primary button), on muted (hover)            |                            18.45 / 6.34 |                            16.04 / 7.70 |
| bid-ink, ask-ink, bad-fg, ok-fg on surface                   |                  7.55, 6.55, 7.72, 7.61 |                 8.76, 9.79, 9.10, 11.22 |
| grade A / B / C / D / F / none (fg on bg)                    | 6.82 / 6.55 / 6.61 / 6.41 / 6.24 / 5.46 | 8.00 / 8.77 / 8.60 / 7.75 / 7.88 / 6.58 |
| status OK / Breached (on-breach on breach) / neutral         |                      6.44 / 6.33 / 5.46 |                      8.29 / 6.32 / 6.58 |
| warn, error (fg on bg)                                       |                              6.83, 6.24 |                              9.29, 7.88 |
| graphics: bid / ask bars on surface                          |                             7.55 / 3.54 |                             4.78 / 9.79 |
| graphics: ok / breach ticks, threshold, spread, series-depth |          5.33 / 6.33, 6.33, 6.73, 13.03 |          7.74 / 5.83, 5.83, 7.62, 11.79 |
| graphics: border-strong on bg / surface, focus on bg         |                       3.38 / 3.72, 6.86 |                       3.42 / 3.21, 9.33 |
| graphics: faint on surface (ticks only)                      |                                    3.10 |                                    3.91 |

Colour-blind check (Machado 2009, severity 1, ΔE / ΔL\*):
- **Bid vs ask, light:** protan 115 / 12, deutan 127 / 25, tritan 85 / 17.
- **Bid vs ask, dark:** protan 102 / 15, deutan 114 / 27, tritan 73 / 18. Bid is always the darker of the two, so the sides also separate in greyscale.
- **OK green vs breach red:** these collapse under deutan (ΔE 23 light, 10 dark). That is why ok and breach always carry a shape cue as well (§6): the dot or diamond on the chip, and the tick above or below the line on the tape.
- **Spread violet vs bid blue:** these also collapse under CVD. They never share a chart.

## 2. Type

Add the following to `apps/web/index.html`. It renders correctly when Google Fonts is blocked: the stacks fall back to system-ui and ui-monospace, and `font-stretch` is ignored for faces that have no width axis.

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@85..100,400..700&family=JetBrains+Mono:wght@400;500&display=swap" />
```

- **Archivo** (variable, wdth 85–100 and wght 400–700) carries all words and numbers. `body { font-variant-numeric: tabular-nums }` stays.
- **JetBrains Mono** (400 and 500) is used **only** for addresses, pool ids, code and embed snippets, rank numbers, ladder rung and scale labels, and the "What we measure" scale lines. It is never used for metric values or labels.
- Body: `font: 400 var(--fs-base) / var(--lh-body) var(--sans)` and `-webkit-font-smoothing: antialiased`.

| Role                                                                | Size token                    | Weight            | Line height | Extra                                                                                   |
| ------------------------------------------------------------------- | ----------------------------- | ----------------- | ----------- | --------------------------------------------------------------------------------------- |
| Home h1                                                             | `--fs-hero`                   | 600               | 1.1         | `letter-spacing:-0.02em; font-stretch:94%; max-width:20ch; text-wrap:balance`           |
| Page h1 (pool, token, list pages)                                   | `--fs-h1` (24 px < 640)       | 600               | 1.2         | `-0.015em`                                                                              |
| Section h2                                                          | `--fs-lg`                     | 600               | 1.3         | `-0.015em`                                                                              |
| Card / panel title (h3)                                             | `--fs-md`                     | 600               | 1.3         | sentence case (the old uppercase h3 becomes a micro-label)                              |
| Lede (hero subline)                                                 | `--fs-md` (`--fs-base` < 640) | 400               | 1.5         | `--muted`, `max-width:50ch`                                                             |
| Body, nav, buttons                                                  | `--fs-base`                   | 400 / 500 / 600   | 1.5         |                                                                                         |
| Table cells, kv lists                                               | `--fs-data`                   | 400 (numbers 500) | 1.4         | numbers right-aligned                                                                   |
| Secondary text, meta, footer, status chip                           | `--fs-sm`                     | 400 / 600         | 1.45        |                                                                                         |
| Captions, chart ticks, legend, tooltip                              | `--fs-xs`                     | 400               | 1.4         | `--muted`                                                                               |
| **Micro-label** (`th`, figure labels, KPI labels, phone row labels) | `--fs-2xs`                    | 600               | 1.3         | `text-transform:uppercase; letter-spacing:0.07em; font-stretch:85%; color:var(--muted)` |
| Headline number, uptime big                                         | `--fs-xl` (24 px < 640)       | 600               | 1.15        | `-0.02em`                                                                               |
| KPI value, figure value                                             | `--fs-lg` / `--fs-md`         | 600               | 1.2         |                                                                                         |
| Wordmark                                                            | `--fs-md`                     | 650               | 1           | `-0.015em`                                                                              |

Mapping from the current CSS:
- `h1` → page h1.
- `h2` → section h2.
- `h3`, `th`, `.ladder-head`, `.figure .label`, `.kpi-head .label` → micro-label.
- `table`, `.stat-row`, `.kv`, `.score-row` → `--fs-data`.
- `.topbar-status`, `.notes`, `.state`, `.kpi-note`, `.snippet-head`, `.uptime-tile` → `--fs-sm`.
- `.chart-legend`, `.chart-tooltip`, `.panel-head .hint`, `.ladder-val small` → `--fs-xs`.
- `.figure .value` → `--fs-md`.
- `.kpi-current` → `--fs-lg`.
- `.score-total .big`, `.uptime-tile .big` → `--fs-xl`.

## 3. Spacing, radii, layout

- **Spacing:** 4-px grid (`--s-1` to `--s-8`). Gaps between panels are `--s-4`, and gaps between page sections are `--s-7` (`--s-6` below 640 px).
- **Radii:** `--r-1` 2 px, `--r-2` 4 px, `--r-3` 8 px. Nothing is pill-shaped, and there are no shadows or gradients, with two functional exceptions: the scroll-box edge shadows and the exhausted-rung hatch.
- **Breakpoints:** phone < 640, tablet 640–1023, desktop ≥ 1024.
- **`.container`:** `max-width: var(--wrap); margin: 0 auto; padding: 16px`, then `padding: 24px` inside `@media (min-width: 640px)`. Keep the base rule at `padding: 16px;`, which `styles.test.ts` pins. Every auto-fit track keeps `minmax(min(<n>px, 100%), 1fr)`.
- **Touch targets:** every link, button, input and row is at least `--tap` (44 px) tall below 640 px. On larger screens, controls inside panels may be 36 px.

## 4. Logo, wordmark, favicon

The logo mark is a mid-price axis with three bid and three ask rungs (±1/2/5 %) that lengthen downward, so it is a depth ladder. Use the class `logo-mark`, **not** `mark`, because `.mark` is the KPI mark chip.

```html
<svg class="logo-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="7" y="1" width="2" height="14" rx="0.5" fill="currentColor"/><g style="fill:var(--mark-bid,currentColor)"><rect x="4" y="3" width="2" height="2"/><rect x="2" y="7" width="4" height="2"/><rect x="0" y="11" width="6" height="2"/></g><g style="fill:var(--mark-ask,currentColor);fill-opacity:var(--mark-ask-opacity,0.5)"><rect x="10" y="3" width="2" height="2"/><rect x="10" y="7" width="4" height="2"/><rect x="10" y="11" width="6" height="2"/></g></svg>
```

- **CSS:** `.logo-mark { width:22px; height:22px; flex:none; color:var(--text); --mark-bid:var(--bid); --mark-ask:var(--ask); --mark-ask-opacity:1 }`. In the footer it is 18 px. If you render it without those variables you get a monochrome mark in which ask is shown at 50 % opacity.
- **Wordmark:** "Depthwatch" sits after the mark with a 10 px gap, in Archivo 650, `--fs-md`, `-0.015em`, `--text`. The header no longer carries the "Base liquidity observatory" small text.
- **Favicon:** inline it in `index.html` so that both the default and the static (`base: './'`) builds resolve it with no path. Its colours are fixed and follow the tab theme:

```html
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cstyle%3E.a%7Bfill:%2310141b%7D.b%7Bfill:%231d4db5%7D.c%7Bfill:%23cf6f0c%7D@media (prefers-color-scheme:dark)%7B.a%7Bfill:%23e7eaf0%7D.b%7Bfill:%234680ea%7D.c%7Bfill:%23f6b06a%7D%7D%3C/style%3E%3Crect class='a' x='7' y='1' width='2' height='14' rx='.5'/%3E%3Cpath class='b' d='M4 3h2v2H4zM2 7h4v2H2zM0 11h6v2H0z'/%3E%3Cpath class='c' d='M10 3h2v2h-2zM10 7h4v2h-4zM10 11h6v2h-6z'/%3E%3C/svg%3E" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#12161d" />
```

## 5. Home copy (final)

- **Hero h1** (7 words): **Liquidity on Base, measured pool by pool.**
- **Subline** (24 words): **We measure how many dollars it takes to move each Uniswap and Aerodrome pool's price 1, 2 or 5 %, then grade its health A–F.**
- **Secondary line** (`--fs-sm`, muted, below the buttons): "For ecosystem leads, protocol teams and market makers. Base mainnet only: Uniswap v3, Uniswap v4, Aerodrome v2 and Slipstream."
- **Actions:** primary "Explore pools" → `/pools`; secondary "How it's measured" → `/methodology`.
- **Headline-number board** (panel head: "All scored pools", with "last 24 h" on the right). Each cell has a label, a value and a caption:
  - "Pools scored": `{scored}`, captioned "Pools with a health grade right now (of {tracked} tracked)."
  - "Depth ±2 %": `{depth2Usd}`, captioned "Dollars it takes to move every scored pool 2 %, both sides, added up."
  - "24 h volume": `{volume24hUsd}`, captioned "Traded through the scored pools in the last day."
  - "Median health": grade chip + `{medianHealth}`, captioned "Out of 100. Half the scored pools score higher."
- **Gaps explainer:** "A gap is a pool that trades far more each day than the money sitting near its price, so ordinary trades move it a lot." Link: "All gaps →".
- **Scorecards explainer:** "A scorecard checks the depth a market maker promised against what is actually on chain, at every snapshot." Link: "All scorecards →".
- **What we measure** (each item links to `/methodology#…`; the scale line is in mono):
  - Depth (`±1 · 2 · 5 %`): "Dollars it takes to move the price that far, on each side."
  - Spread (`$1k · $10k · $100k`): "What a round trip of that size costs, fees included."
  - Concentration (`top-1 · top-3 · HHI`): "How much of the liquidity sits with one LP or one narrow tick range."
  - Persistence (`24 h · 7 d`): "Whether the depth is still there from one snapshot to the next."

## 6. Components

**Header** (`.topbar`):
- **Container:** `--surface`, a 1 px `--border` bottom, sticky at ≥ 640 px.
- **Inner row:** flex, `min-height:60px`, `gap:var(--s-6)`, `max-width:var(--wrap)`, 16/24 px side padding. Left to right: brand link to `/`, then the nav "Pools · Gaps · Scorecards · Methodology", then freshness, which has `margin-left:auto`.
- **Nav links:**
  - Size: `min-height:44px`, `padding:0 10px`, `--fs-base`, weight 500, `--muted`.
  - Hover: `--text` with `box-shadow: inset 0 -2px 0 var(--border-strong)`.
  - Active (`.active` / `aria-current="page"`; Pools stays active on `/pools/:id`): `--text` with `inset 0 -2px 0 var(--text)`.
- **Freshness** (`--fs-sm`, muted): an 8 px lamp (`--ok` with a 3 px `--ok-bg` ring), then "Block 52,950,000 · updated 4 min ago". If the API is unreachable, the lamp turns `--breach` and the text reads "API unreachable". The mock badge sits before the freshness text.
- **Phone (< 640):**
  - The header is not sticky. It becomes a grid: row 1 holds the brand, row 2 the nav (full width, `margin:0 -10px`, `overflow-x:auto; scrollbar-width:none`, no wrapping), and row 3 the freshness (`--fs-xs`, 10 px bottom padding).
  - At ≤ 379 px the nav links drop to `--fs-sm` with `padding:0 6px` and a 2 px gap, so all four items fit on one row at 320 px. The scroll stays only as a safety net.

**Demo banner:**
- Shown only when `source === 'demo'`. It is a strip above the header (not sticky).
- Style: `--surface-2` background, 1 px `--border` bottom, `min-height:32px`, `--fs-sm` (`--fs-xs` on phone), muted.
- Text: "**Demo data** — synthetic Base world: every number comes from the real pipeline run over a simulated week." "Demo data" is weight 600 in `--text`.
- The live mock badge (`.badge-mock`) keeps `--warn-bg` / `--warn-fg`.

**Footer:**
- Style: 1 px `--border` top, `--surface` background, `margin-top:var(--s-8)`, `--fs-sm` muted.
- Inner row: flex wrap, gap 8 px 24 px, `min-height:72px`.
- Contents in order: the 18 px mark with "Depthwatch" (650, `--fs-base`, `--text`); "Open source · no token · no custody · read-only"; the accent link "github.com/0xdeni/Base-Ops" → `https://github.com/0xdeni/Base-Ops`; and the data line, pushed right with `margin-left:auto`: "Data: Synthetic demo world" or "Data: Base mainnet".
- Phone: the items stack, left-aligned.

**Section heads:**
- `.sec-head` is a grid with columns `minmax(0,1fr) auto`. It holds the h2 and a "more" link (600 weight, ending in " →", `min-height:44px`). The one-sentence note sits on the next row, spanning both columns (muted, `max-width:72ch`), with 16 px below.
- **Home only:** sections are separated by a divider: 1 px `--border` hairlines either side of a 20 px logo mark in `--faint`, using the monochrome variables (`--mark-bid:var(--faint); --mark-ask:var(--faint)`), with 48 px above and 32 px below (32 and 24 on phone). Other pages separate sections with space alone.

**Panels and cards:**
- `.panel`, `.stat-tile`, `.kpi-card`, `.uptime-tile` and scorecard cards all use: `--surface`, a 1 px `--border`, `--r-3` radius, `padding:16px 20px` (16 px on phone), and no shadow.
- Linked cards change their border to `--border-strong` on hover.
- Panel heads use the h3 style, with hints in `--fs-xs` muted.

**Headline-number board:**
- A panel with a head row: micro-label left, `--fs-xs` muted right, and a 1 px bottom border.
- Below the head is a 2 × 2 grid of cells, separated by 1 px `--border` hairlines. The grid stays 2 × 2 at 320 px.
- Each cell, in order: the label (`--fs-sm` muted, sentence case); the value (`--fs-xl`, 600; the median-health grade chip is 32 px, or 28 px on phone); and the caption (`--fs-xs` muted).
- **Hero layout:**
  - At ≥ 1024 px the hero is a grid of `minmax(0,1.15fr) minmax(0,1fr)` with a 48 px gap and `padding-top:64px`: text on the left, the board on the right. Below 1024 px the board stacks under the text.
  - Actions have a 12 px gap. On phone the buttons are full width and stacked.

**Tables (desktop and tablet):**
- **Header row:** `min-height:36px`, micro-label type, 1 px `--border` bottom.
- **Body rows:** `min-height:52px`, `padding:0 16px`, 16 px column gap, 1 px `--border` between rows, none after the last row, and `--surface-2` on hover.
- **Pool cell:** the pair (600, `--text`), then the DEX chip, then the fee (`--fs-sm` muted).
- **Numbers:** right-aligned, weight 500, tabular. Rank is mono `--fs-sm` muted.
- **Sorting:** the active sort header is `--text`, with a `--accent` arrow ↓ or ↑ (U+2193 / U+2191).
- **Width:**
  - Never hide a column at ≥ 640 px.
  - When the columns do not fit, the table sits in `.table-wrap { overflow-x:auto }` with edge shadows that show only on the side that has more content:

```css
.table-wrap {
  overflow-x: auto;
  background:
    linear-gradient(to right, var(--surface) 40%, rgb(0 0 0 / 0)) left / 32px 100% no-repeat local,
    linear-gradient(to left, var(--surface) 40%, rgb(0 0 0 / 0)) right / 32px 100% no-repeat local,
    radial-gradient(farthest-side at 0 50%, var(--scroll-shadow), rgb(0 0 0 / 0)) left / 12px 100%
    no-repeat scroll,
    radial-gradient(farthest-side at 100% 50%, var(--scroll-shadow), rgb(0 0 0 / 0)) right / 12px
    100% no-repeat scroll;
}
```

**Phone stacked row (< 640)** for the pools, gaps, tokens and scorecards lists:
- **Markup:** each row is one `<a class="row">` with `padding:12px 16px`, a 1 px `--border` between rows, the hover style, and a focus ring inset with `outline-offset:-2px`. Recommended: one DOM for every width, with a `.k` label in each cell that is visually hidden at ≥ 640 px and shown on phone.
- **Line 1:** the pool cell (pair, DEX chip, fee; wraps if needed) on the left. On the right, the row's key:
  - pools and tokens: grade chip + score;
  - gaps: the gap meter + number;
  - scorecards: the status chip.
- **Line 2:** `display:grid; grid-template-columns:repeat(auto-fit,minmax(min(72px,100%),1fr)); gap:6px 12px`. Each cell is a micro-label above a value (`--fs-base`, 500, left-aligned). Labels are at most about 10 characters: "24H VOL", "DEPTH ±2%", "SPREAD", "TVL", "TURNOVER", "UPTIME 7D", "KPI", "STREAK". The 72 px minimum is what stops labels colliding at 320 px.
- **Metrics per list:**
  - Pools: Depth ±2 %, Spread $10k, 24 h vol, TVL.
  - Gaps: 24 h vol, Depth ±2 %, Turnover.
  - Tokens: Depth ±2 %, 24 h vol, TVL.
  - Scorecards: 7 d uptime, KPI (now vs target), Streak.
- **Sorting:** the header row is hidden on phone and replaced by a "Sort" `<select>` in the controls bar.
- **Pools page DEX summary:**
  - Desktop: one panel holding a hairline grid of "All" plus the four DEXs. Each cell shows the name, pools, depth ±2 % and median grade, and works as the DEX filter.
  - Phone: the same cells as a horizontal scroller (each at least 140 px) inside `.table-wrap`.

**Chips** (none upper-cased unless stated):
- **DEX** (`.badge`): `height:20px; padding:0 6px; border-radius:var(--r-1); background:var(--surface-2); color:var(--muted); font:600 var(--fs-2xs)/1 var(--sans); letter-spacing:0.03em`. The labels keep their case ("UNI v3", "AERO CL").
- **Grade** (`.grade.grade-a…f/none`):
  - Size: 24 × 24 in tables, 20 × 20 inline in meta lines, 32 × 32 on the board. `border-radius:var(--r-2)`, 700, `--fs-sm`, letter centred.
  - Colours: tint bg and fg per grade. An unscored pool shows "–" on `--grade-none-*`.
  - Always followed by the number in `.score-inline` (8 px gap). The title is "Grade B".
- **Status** (`.status.status-*`; labels stay "OK", "Breached", "No data", "Inactive"): `height:24px; padding:0 8px; gap:6px; border-radius:var(--r-2); font:600 var(--fs-sm)`. A leading 8 × 8 `::before` glyph carries the non-colour cue:

| Status   | Fill                                        | Text           | Glyph                                        |
| -------- | ------------------------------------------- | -------------- | -------------------------------------------- |
| ok       | `--ok-bg`                                   | `--ok-fg`      | filled circle, `--ok`                        |
| breached | `--breach` (solid)                          | `--on-breach`  | diamond (square rotated 45°), `currentColor` |
| no-data  | transparent + 1 px dashed `--border-strong` | `--neutral-fg` | hollow ring, 1.5 px `currentColor`           |
| inactive | `--neutral-bg`                              | `--neutral-fg` | 8 × 2 bar (a dash), `currentColor`           |
- **KPI marks** (`.mark-pass/fail/na`): 20 × 20 squares with `--r-2`.
  - pass: `--ok-bg` / `--ok-fg`, "✓".
  - fail: `--breach` / `--on-breach`, "✗".
  - n/a: `--neutral-bg` / `--neutral-fg`, "–".
- **Breach count** (`.badge-bad`): `--bad-bg` / `--bad-fg`. Text-only breach values (`.text-bad`, `.kpi-cell.fail`) use `--bad-fg` at 600 weight.

**Buttons and links:**
- **`.btn`:** inline-flex, `min-height:44px` (36 px allowed at ≥ 640 px inside panels), `padding:0 var(--s-5)` (`0 12px` when compact), `border-radius:var(--r-2)`, 600, `--fs-base`, `border:1px solid var(--border-strong)`, `--surface` background, `--text`. Hover: border `--text`.
- **`.btn-primary`:** `background:var(--text); color:var(--on-ink); border-color:transparent`. Hover: `background:var(--muted)`. Use one per view.
- **Links:** `--accent` with no underline. Hover: `--accent-hover` with an underline at `text-underline-offset:3px`. Links in prose (Methodology, notes) are always underlined. "More" links end with " →".
- **Inputs and selects:** `min-height:36px` (44 on phone), `border:1px solid var(--border-strong)`, `--r-2`, `--surface`, `padding:0 10px`, muted placeholder.
- **Segmented control:**
  - Container: a 1 px `--border-strong` border, `--r-2`, `overflow:hidden`.
  - Items: `--surface`, muted, 500, `padding:0 12px`, `min-height:36px` (44 on phone).
  - Active item: `--surface-2`, `--text`, 600, `box-shadow:inset 0 -2px 0 var(--text)`. Counts stay muted.

**States and notices:**
- `.state`: centred, muted, `--fs-sm`, 24 px padding.
- `.state-error`: `--error-bg` / `--error-fg`, `--r-2`, with an inline Retry `.btn`.
- Static Embed note: `--fs-sm` muted, under the preview: "Embeddable badge URLs need a running Depthwatch server."

**Charts** (Recharts):
- **Axes and grid:** horizontal grid only, `stroke var(--grid)`. Axis line `var(--border)`. Ticks `{ fill: 'var(--muted)', fontSize: 11 }`. No tick lines.
- **Lines:** no dots. The active dot is r 3, filled with the series colour, with a 2 px `var(--surface)` stroke.
- **Legend:** above the plot, `--fs-xs` muted, with 12 × 3 swatches (`--r-1`). A dashed swatch stands for a threshold.
- **Series:**

| Chart            | Series                          | Stroke                                      | Width |
| ---------------- | ------------------------------- | ------------------------------------------- | ----- |
| Pool history     | Depth ±2 % (USD, left axis)     | `var(--series-depth)`                       | 1.75  |
| Pool history     | Spread at $10k (bps, right)     | `var(--spread)`                             | 1.5   |
| Scorecard depth  | Bid side (sell, `depthDown`)    | `var(--bid)`                                | 1.5   |
| Scorecard depth  | Ask side (buy, `depthUp`)       | `var(--ask)`                                | 1.5   |
| Scorecard spread | Spread                          | `var(--spread)`                             | 1.5   |
| Any              | KPI threshold (`ReferenceLine`) | `var(--threshold)`, `strokeDasharray="4 4"` | 1.5   |
- **Threshold label:** "KPI ≥ $50.0k" or "KPI ≤ 30 bps", `--fs-xs`, in the threshold colour (6.33 / 5.83:1).
- **Tooltip** (`.chart-tooltip`): `--surface`, a 1 px `--border-strong` border, `--r-2`, `padding:8px 10px`, `--fs-xs`, tabular numbers, no shadow.
- **Empty state** (fewer than 2 points):
  - Keep the chart's height. Show a 1 px dashed `--border` box with `--r-2`, centred on a 24 px logo mark in `--faint`.
  - Title: "Not enough history yet" (`--fs-sm`, 600).
  - Line: "Charts need at least two snapshots; one is taken every 2 h." (`--fs-xs`, muted).
  - With exactly one point, add "One snapshot so far: {value} at {time}."

**Depth ladder** (restyle the existing markup and keep the test hooks, the "±2%" text, "exhausted" and "unpriced"):
- **Grid:** `.ladder-row` uses `grid-template-columns: minmax(0,1fr) 64px minmax(0,1fr)` with `min-height:36px` and a 6 px row gap.
- **Head:**
  - Bid half (right-aligned): "**Bid** · sell WETH, price down". Ask half: "**Ask** · buy WETH with USDC, price up". Both `--fs-sm` muted. "Bid" is 600 in `--bid-ink` and "Ask" is 600 in `--ask-ink`, each preceded by a 10 × 10 `--r-1` key in `--bid` or `--ask`.
  - Centre: the micro-label "MOVE".
- **Centre cell** (`.ladder-pct`): the rung label "±1%" in mono, `--fs-xs`, muted, centred.
- **Axis:** the mid-price axis is the inner edge of each track: `.ladder-side.down .ladder-track { border-right:2px solid var(--text) }` and `.ladder-side.up .ladder-track { border-left:2px solid var(--text) }`.
- **Tracks:** 24 px tall, **no fill**, with gridlines at quarters: `repeating-linear-gradient(to right, var(--grid) 0 1px, transparent 1px 25%)`, mirrored (`to left`) on the bid side.
- **Bars:** 14 px tall and vertically centred. Bid is `var(--bid)` and ask is `var(--ask)`, rounded only at the outer end (`--r-1`). Width stays proportional to the largest rung, which is 100 %.
- **Scale:** under the last rung, a scale row in mono `--fs-2xs` muted: "0" at the axis, then ½ max and max (e.g. "$6.3M", "$12.6M") on each side. Hidden below 400 px.
- **Values:** outside the bars. The USD value is 600, `--fs-data`; the token amount is `--fs-xs` muted on the line below. Unpriced shows "unpriced" in muted with no bar.
- **Exhausted:** the bar becomes `repeating-linear-gradient(135deg, <side colour> 0 3px, transparent 3px 6px)` with a 1 px border in the side colour, and the value is suffixed " · exhausted". The footer then shows a hatch key: "hatched: liquidity exhausted before the target".
- **Footer:**
  - 1 px `--border` top, 12 px top padding, `--fs-sm` muted. It always shows two plain sentences, built from the ±2 % rung (or the smallest rung if 2 % is missing).
  - Sentence 1: "It would take $5.9M of buying to lift WETH 2 % in this pool, or $5.7M of selling to push it 2 % down."
  - Sentence 2: "At ±2 % the ask side is 3.5 % deeper than the bid side."
- **Phone (< 640):**
  - `.ladder-side` becomes a column: the value sits **above** its bar, aligned toward the axis (bid value right-aligned, ask left-aligned).
  - Token amounts are hidden, the centre column is 48 px, and the head keys are hidden.

**Bars and meters:**
- **Gap score and score breakdown** (`.bar`):
  - Track: 8 px tall, `--surface-2` fill, `--r-1`. Surface-coloured 1 px separators at 25/50/75 % (an `::after` repeating gradient) cut it into four segments.
  - Fill: `var(--text)`; `.bar-spread` uses `var(--spread)`.
  - Number: right of the bar, weight 650, at least 2.2 ch wide.
  - Track width: 120 px in tables, 56 px in phone rows.

**KPI cards** (`.kpi-card`):
- Panel, with a 3 px left border: `--ok` for pass, `--breach` for fail, `--faint` for n/a. The mark chip carries the same state as a glyph, so colour is never the only cue.
- Head: the micro-label and the mark chip on the right.
- Value: `--fs-lg`, 600, in `--bad-fg` when failing.
- Target line: `--fs-xs` muted, e.g. "target ≥ $50.0k · each side".

**Uptime tiles:**
- Label: micro-label. Value: `--fs-xl`.
- Meter:
  - Track: 8 px, `--surface-2`.
  - Fill: `--ok` when the target is met, `--breach` when it is missed.
  - Target tick: a 2 px `--text` tick at the target %, so met or missed reads without colour.
- Caption: `--fs-xs` muted, e.g. "target 95.0 % · 35 / 85 samples within KPI".

**Uptime tape** (new; on Home scorecard cards and the scorecard page; fed by the 7 d samples):
- **Shape:** an SVG `width:100%; height:36px` with one tick per sample, oldest on the left, 1 px gaps between ticks, and a 1 px `--border-strong` baseline at y = 18.
- **Ticks:**
  - Within KPI: a tick **above** the baseline (y 2–16) in `--ok`.
  - Breached: a tick **below** it (y 20–34) in `--breach`.
  - Not evaluable: a 2 px stub on the baseline in `--faint`.
- **Caption** (`<figcaption>`, `--fs-xs` muted): "7 d ago", then centred "35 / 85 samples within KPI · up = within, down = breached", then "now".
- **Accessibility:** `role="img"` with `aria-label="7-day uptime: 35 of 85 samples within KPI"`.

**Home scorecard card:**
- Head: the market maker's name (`--fs-md` 600) with a muted "synthetic" tag if demo, the pool line (pair, DEX chip, position kind), and the status chip on the right.
- Below the head: a 3-cell hairline row ("KPI: depth ±2 %", "Now", "7 d uptime"; values `--fs-md` 600, failing values `--bad-fg`), then the tape.
- Foot: the badge `<img>` (20 px tall) and "Open scorecard →".
- At 320 px the head stacks: the name line first, then the status chip under it, left-aligned.

**Embed block:**
- Shows the badge preview.
- The snippet `pre` uses `--surface-2`, a 1 px `--border`, `--r-2`, mono `--fs-xs`, `white-space:pre-wrap; word-break:break-all`, with a compact Copy `.btn`.

**Badge** (fixed colours, so it still works on any README background). Change `LABEL_COLOUR` and `BADGE_COLOURS` in `apps/api/src/badge.ts` and in its byte-for-byte mirror `apps/web/src/lib/badge.ts`. Keep the layout, text and font, and add no glyph.

| Part               | Old       | New       | White text |
| ------------------ | --------- | --------- | ---------- |
| label              | `#555555` | `#2a3140` | 13.03      |
| ok                 | `#2ea44f` | `#1c7a4c` | 5.33       |
| breached           | `#d73a49` | `#b8232f` | 6.33       |
| no-data / inactive | `#9f9f9f` | `#5c6573` | 5.89       |

**Methodology page:**
- Prose `max-width:68ch` in `--fs-base` / 1.6. Each anchored section is an h2 with a `#` link that appears on hover.
- Formulas sit in `.formula`: mono `--fs-xs`, muted, `--surface-2`, `--r-2`, `padding:8px 12px`, `overflow-x:auto`.

**Focus:**
- `:focus-visible { outline:2px solid var(--focus); outline-offset:2px; border-radius:var(--r-2) }` everywhere.
- Rows, segments and anything inside a scroll box use `outline-offset:-2px` so the ring is not clipped.
- Never remove outlines.

**Motion:**
- Only `color`, `background-color` and `border-color` transition, over 120 ms.
- Nothing transitions under `prefers-reduced-motion: reduce`.
- Charts keep `isAnimationActive={false}`.

## 7. Acceptance checks for the implementation

- No horizontal page scroll at 320, 390, 820, 1024 and 1440 px: `document.documentElement.scrollWidth === clientWidth`. Check in light and dark, and with Google Fonts blocked.
- At ≥ 640 px no column is hidden. A table that overflows shows its edge shadow.
- Every text colour pair in use is one of those in §1's contrast table. In particular, `--faint` is never applied to text.
- Bid, ask, ok and breach marks appear only as specified in §6. No bar, meter or line uses `--accent`.
