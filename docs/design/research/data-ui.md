# Data-dense finance UI: how elite products present numbers

Research for the Depthwatch v3 redesign. Question: how do Uniswap, Hyperliquid, Kraken Pro, Robinhood, Coinbase,
Token Terminal, Dune, Arkham, Nansen, Messari, Bloomberg, Stripe and Linear show dense numbers without looking cheap,
and what Tufte and Few say about it. The sibling file [`product-ui.md`](product-ui.md) covers general polish (type,
spacing, surfaces, motion, copy). This file covers numbers, charts, tables, scores and the first screen.

**How this was researched (read before trusting a number).** Nothing here comes from live screenshots of the
products named. The hard numbers come from source code and design-system docs
that are public on GitHub or GitLab and were read file by file: the Uniswap web app (its pool page has a depth chart),
the Coinbase Design System (CDS), L2BEAT, Google Lighthouse, Robinhood's Spark library, GitLab Pajamas, IBM Carbon and
GitHub Primer. Everything else (Hyperliquid, Kraken, Token Terminal, Arkham, Messari, Bloomberg, Stripe, Tufte, Few)
comes from web-search excerpts of the cited pages. Those claims are marked *(secondary)*. Two sketches were built and
screenshotted to test the main recommendations. They are described in §11.

---

## 0. The rules that matter most

1. **Lead with one striking visual and one sentence, not a grid of cards.** The first viewport holds one headline
   number, one hero chart and at most 3 supporting numbers: no more than **7 data numbers**, not counting axis ticks.
   Working memory holds about **4 chunks** ([Cowan 2001][cowan]). Few defines a dashboard as the most important
   information on **one screen**, read **at a glance** ([Few, via Tableau][few-def]).
2. **Every number must answer "compared to what?"** Give it a target, a band, a baseline or a peer. A bare number is
   decoration. See Few mistake #2, "inadequate context" ([13 mistakes][few-13]), and Tufte's "compared to what"
   ([eyespan][tufte-eyespan]).
3. **Show 3 significant digits at most, in one compact style.** Use `$11.2M`, `$31.5K` and `10.4 bps`. Never mix `k`
   and `K`, never write `$50.0k`, never show `$0.00` on an axis ([Uniswap formatter][uni-format];
   [Few #3 excessive precision][few-13]).
4. **Use tabular figures, right-align numbers and keep decimals the same down a column.** Use a monospace font only
   where alignment does real work, such as ladders, addresses and block numbers
   ([CDS label fonts are tabular by default][cds-text]; [Pajamas table][paj-table]; [Hyperliquid *(secondary)*][hl-design]).
5. **Draw charts without gridlines, axis borders or tick marks.** Use a 1 px crosshair at 8 % ink, and let the page
   scroll instead of zooming the chart on mouse wheel ([Uniswap ChartModelCore][uni-core]).
6. **Draw depth as two mirrored filled areas meeting at mid.** Use a 2 px line and a fill that fades from 40 % to 0 %
   opacity. If there is too little data, refuse to draw rather than show a misleading shape: Uniswap requires **≥ 4
   bars per side** ([Uniswap DepthChart][uni-depth]; [helpers][uni-depth-helpers]).
7. **Use blue and orange for the bid and ask sides. Reserve red and green for status, and always add a shape or word.**
   About 8 % of men have a colour-vision deficiency ([Sigma][sigma-cvd]). Bloomberg counts about **20,000** affected
   Terminal users and ships alternate schemes ([Bloomberg][bbg-cvd]). The Okabe–Ito blue `#0072B2` and orange
   `#E69F00` / vermillion `#D55E00` are safe for every common type ([Okabe–Ito][okabe]).
8. **Give chart marks ≥ 3:1 contrast against the background, and text ≥ 4.5:1** ([CDS colours][cds-colors];
   [Primer][primer-dv]; [WCAG 1.4.11][wcag-1411]).
9. **Small multiples must share one scale.** In our sketch, glyphs normalised per row all looked identical, and a
   shared scale made the gap pool jump out (§11). Tufte: comparisons "must be enforced within the scope of the
   eyespan" ([eyespan][tufte-eyespan]).
10. **Table rows are 56 px on desktop and 48 px on mobile, inside a 1200 px max width.** The sort icon shows only on
    the sorted column, others reveal it on hover. Nulls go last in both sort directions ([Uniswap table][uni-table];
    [Carbon][carbon-dt-usage]; [Pajamas][paj-table]).
11. **Show the grade as one shape: number, letter and a weighted bar whose filled length equals the score.** Encode
    rating bands with redundant shapes, like Lighthouse's circle, square and triangle ([Lighthouse][lh-css]).
12. **Show KPI against target as a bullet graph or reference line, not a red card.** A bullet graph has a bar, a target
    tick and 2–5 bands in one hue ([Few bullet spec][bullet-wiki]; [CDS ReferenceLine][cds-refline]).
13. **Choose one chart with a type switch over four charts.** Uniswap's pool page has one **356 px** chart and a
    Volume / Price / Liquidity / Depth toggle stored in the URL (`?chart=depth`) ([Uniswap ChartSection][uni-chartsection]).
14. **Scrubbing updates the headline; it does not open a floating box.** Hovering a time series rewrites the big
    number and date above the chart. Animate the value only when the user is not scrubbing ([Uniswap ChartHeader][uni-header];
    [Robinhood Spark][spark]).
15. **Say an alarm once.** Collapse repeated breaches into episodes. On a status strip, colour the breaches and leave
    the normal cells neutral (Few: "highlighting important information ineffectively", [13 mistakes][few-13]).

---

## 1. First impression: one visual beats many cards

### What the references do

- **Hyperliquid** keeps four core modules (order book, chart, order entry, positions), each in its own area. A review
  contrasts this with CEX screens that show **more than ten modules** by default ([OneKey *(secondary)*][hl-onekey]). Its
  palette is a near-black canvas, **one** mint accent (`#97FCE4`) and nothing else chromatic except up/down
  ([design.md *(secondary)*][hl-design]).
- **Robinhood** builds on black, white and neutrals plus **one** neon accent ([DesignCompass][rh-rebrand]). Its 2024–26
  product work centres on three connected charts (allocation ring, performance, returns) rather than many tiles
  ([DesignCompass][rh-2026]). It removed its trade confetti in 2021, under regulatory pressure, and a 2024 consent order
  bans it permanently ([CNBC][rh-confetti]). In finance, celebration reads as manipulation.
- **Stripe** puts a single KPI value **above** one trend chart. Standard metric cards use a **180 px** chart area and
  featured charts **320 px** ([Stripe Apps chart layout][stripe-chart]). A teardown credits Stripe's hierarchy to
  "typography and whitespace, not colour" ([925 Studios *(secondary)*][stripe-925]).
- **Bloomberg** describes its job as "concealing complexity", so users are not overwhelmed. Its own UX lead says the
  dense screen "makes it hard to clarify the information hierarchy" ([Bloomberg][bbg-conceal] *(secondary)*).
- **Token Terminal**'s Terminal redesign aimed at "data density" with legibility from "sharper typeface and colour
  contrast". Its home page leads with weekly movers and key metrics. A heatmap gives the sector overview, then one
  configurable chart per project ([changelog][tt-003]; [newsletter][tt-news]) *(secondary)*.
- **Messari** and **Arkham** consolidate into one page per asset or entity, with modules users can rearrange. Arkham's
  grid grew from **4×4 to 6×4** ([Messari docs][messari]; [Arkham][arkham]) *(secondary)*. These are tools for repeat
  users. Depthwatch's audience (ecosystem leads on a first visit) needs the opposite: a fixed, curated story.
- **Linear Insights** opens as a panel *beside* the list being analysed instead of on a separate dashboard. The chart
  appears only when asked for ([Linear docs][linear-insights]) *(secondary)*.

### Principles behind it

- **Few's definition.** A dashboard is "the most important information needed to achieve one or more objectives,
  consolidated and arranged on a single screen so the information can be monitored at a glance"
  ([Few, via Tableau][few-def]). Several of his 13 mistakes describe v2 directly:
  #1 exceeding one screen, #2 inadequate context, #3 excessive detail or precision, #6 meaningless variety,
  #10 ineffective highlighting, #13 an unattractive display ([13 mistakes][few-13]).
- **Progressive disclosure.** "Initially, show users only a few of the most important options". The very fact that
  something appears on the first display "tells users that it's important" ([NN/g][nng-pd]).
- **Hierarchy by contrast and area.** The most important data gets "the highest contrast and occupy the largest
  area", and follows the F-pattern ([Carbon dashboards][carbon-dash]).
- **Meeting-ready.** A dashboard should survive a screenshot or a screen share. Start high-level, allow drill-down and
  show change over time, "not just a current snapshot" ([Pajamas dashboards][paj-dash]). Ecosystem leads will screenshot
  Depthwatch.
- **Length and 2-D position** carry quantity fastest, preattentively ([NN/g][nng-dash] *(secondary)*). So the hero
  should be bars or areas, not a grid of digits.

### Budget for numbers (our rule, derived from the sources above)

| Surface | Max data numbers in first viewport | What they are |
| --- | --- | --- |
| Home | 7 | 1 headline (Base-wide ±2 % depth) + 3 KPIs + ≤ 3 direct labels on the hero |
| Pool page | 8 | price + grade/score + 3 headline stats + ≤ 3 labels on the depth chart |
| Gaps | 1 per row in the hero + table | the gap ratio is the hero; other columns sit behind it |
| Scorecard | 4 | status sentence, KPI value vs target, 7 d uptime, streak |

v2 for comparison, counted from the pool page screenshot (desktop, dark): the pool page shows about **90
numbers**, all at the same weight. There are 8 header stats, 12 depth labels (USD and token units), 6 + 3 axis
labels, 6 in a sentence, 12 spread cells, 10 score figures, 8 concentration figures, 12 persistence cells and 15
history axis labels. The scorecard page repeats "depth up / depth down" in red **24 times** in one table.

### Hero visual candidates for Depthwatch (tested in §11)

- **Home: a depth butterfly.** One row per pool, sell-side bar to the left and buy-side bar to the right of a shared
  centre line, all on **one scale**, sorted by depth. It looks like a market-depth chart, shows asymmetry, and makes a
  liquidity gap visible as a sliver. Pair it with a sentence-headline: "**$26.1M** moves Base 2 %." A Kaiko-style
  "±2 % depth" framing is standard in the industry ([Kaiko][kaiko-2pct]; [Paradigm ±2 %][paradigm]; [Tenderly
  "pressure to move price ±1 %"][tenderly]).
- **Pool page: a mirrored depth curve.** Bids fill to the left of mid and asks to the right. This is the standard
  depth-chart form: two cumulative areas meeting at mid, with the gap between them as the spread
  ([QuestDB][questdb-depth]; [amCharts][amcharts-depth]; [Uniswap DepthChart][uni-depth]). Depthwatch measures only
  ±1/2/5 %, so draw straight segments between **measured points only**, mark each with a dot, and do not extrapolate
  past ±5 %. On the x axis, space 1/2/5 roughly logarithmically, so the inner 2 % band is not squeezed into 40 % of the
  width.
- **Grade: a single weighted bar** (§7) in place of four separate score rows.

---

## 2. Progressive disclosure ladder

| Level | Content | Reference pattern |
| --- | --- | --- |
| L0 | One sentence with the answer ("It takes $11.2M to move WETH/USDC 2 %.") | Uniswap headline "1 ETH = 2,460 USDC ($2,460)" ([ChartHeader][uni-header]) |
| L1 | Hero chart + 3–5 stats | Uniswap pool page: one 356 px chart + stats column (TVL, 24 h volume, 24 h fees, pool balance bar) ([PoolDetailsStats][uni-stats]) |
| L2 | One section per metric, each with one visual | Token Terminal: one configurable chart per project ([newsletter][tt-news]) |
| L3 | Raw rows, CSV, methodology | Primer: charts offer "preview the data in a table and download … CSV" ([Primer][primer-dv]); Pajamas: export CSV, image or PDF ([Pajamas][paj-dash]) |

Rules:

- **One chart with a type toggle** instead of stacked charts. Uniswap lists `VOLUME, PRICE, LIQUIDITY, DEPTH` and
  persists the choice in the URL query `chart=` ([ChartSection][uni-chartsection]).
- **Snapshot charts get zoom controls, time series get range pills.** Uniswap hides the time selector on depth and
  liquidity charts and shows zoom in, zoom out and reset instead. It also removes a range the data cannot serve (1H for
  price), and clicking the active pill re-fits the chart ([ChartSection][uni-chartsection]).
- **Tooltips repeat both axes plus context** ([Carbon anatomy][carbon-anatomy]). They are the L3 of a chart: Uniswap's
  depth tooltip holds Range (+x.x %), Price, Fee tier, Amount and Amount in USD ([DepthChartTooltip][uni-depth-tooltip]).
  Token amounts belong there, not as permanent labels.

---

## 3. Number formatting

### Uniswap's production rules (`localeBasedFormats.ts`, [source][uni-format])

| Kind | Rule |
| --- | --- |
| Fiat stat (TVL, volume) | `0` → `-` (treated as "no data") · `< 0.01` → `<$0.01` · `< 1,000` → 2 decimals · `≥ 1,000` → compact, exactly 1 decimal (`$28.2M`) · above ~1e18 → `>$999,999T` |
| Fiat price | `< 1e-8` → `<$0.00000001` · `< 1` → 3 significant digits · `< 1e6` → 2 decimals · else compact 2 decimals |
| Token amount | `0` → `0` · `< 0.001` → `<0.001` · `< 1` → 3 decimals · `< 1e6` → 2 decimals · `< 1e15` → compact 2 decimals · else `>999T` |
| Percent | "whole or two decimals" by default; 1-decimal and 2-decimal variants exist |
| Tiny prices | subscript-zero notation (`0.0₃4065`) above a threshold ([formatPriceWithSubscript][uni-subscript]) |

### Rules for Depthwatch

| Quantity | Format | Examples | Source / reason |
| --- | --- | --- | --- |
| USD | `Intl.NumberFormat('en-US', {style:'currency', currency:'USD', notation:'compact', maximumSignificantDigits:3})`. Compact suffixes are uppercase `K M B`. Below $1,000, whole dollars. | `$11.2M`, `$31.5K`, `$260K`, `$412` | [MDN][mdn-intl]; [Uniswap][uni-format]; Few #3 |
| bps | < 100 → 1 decimal; ≥ 100 → integer; thin space before `bps` | `10.4 bps`, `187 bps` | Few #3 |
| Shares (top-LP, active range) | integer % | `53%` | Few #3 |
| Uptime / stability | 1 decimal; show `100%` without `.0` | `96.4%`, `100%` | v2 shows `100.0%` |
| Ratios | `×` (U+00D7); 1 decimal under 10, integer ≥ 10 | `1.6×`, `51×` | v2 shows `50.8×`, an unneeded third digit |
| Deltas | explicit `+`, true minus `−` (U+2212); colour the **arrow**, not the digits; zero is neutral grey | `↑ 3.2%` | [Uniswap DeltaArrow][uni-delta] (16 px arrow, `neutral3` at zero; the value stays `neutral2`) |
| Unknown | `—` (em dash) in `ink-3`, with a tooltip saying why; never `0`, never `$0.00` | `—` | Uniswap shows `-` for 0, but Depthwatch has real nulls ([dto.ts](../../../apps/api/src/dto.ts)) |
| Block numbers | grouped digits, in a smaller, lighter size | `#52,950,000` | v2 prints `#52950000` in mono |
| Times | relative under 24 h (`2h ago`), absolute after; full timestamp in a tooltip | | [Uniswap TimestampCell][uni-table] |
| Price + inverse | show one; the inverse goes behind a ⇄ toggle | | Uniswap reverses the pair instead of printing both ([DepthChart][uni-depth]) |

- **Same decimals down a column, right-aligned, tabular figures**: "right-align the numeric data with a consistent
  number of decimal places to improve scannability" ([Pajamas table][paj-table]; [Alberta DS][alberta]).
- **`font-variant-numeric: tabular-nums`** makes digits equal width in a proportional font
  ([Amit Merchant][tnum-amit]). CDS sets its Label and Caption fonts to tabular figures by default, for "presenting
  numbers" ([CDS Text][cds-text]). Use the UI sans with `tnum`, not a monospace font, for numbers in tables and KPIs.
  Hyperliquid reportedly drops to monospace "only where alignment is functional": order book, price ladders, PnL
  ([design.md *(secondary)*][hl-design]). v2 uses JetBrains Mono for axis ticks, `±1 · 2 · 5 %` legends and block
  numbers, which makes it read like a developer tool.
- **Units are quieter than values.** Uniswap renders `(USD price)` and other secondary values in `neutral2` next to
  the heading-size value ([DepthChart header][uni-depth]). In our §11 sketch, a muted `/ 100` beside a 56 px score
  works well.
- **Big-number style.** Carbon calls a KPI "a number with a single word description"
  ([Carbon anatomy][carbon-anatomy]). Pajamas' single stat is title + value + optional meta badge with a delta
  ([Pajamas single stat][paj-single]).
- **Heading weight.** Uniswap sets every heading, up to 52 px, in **Book 400**. Medium 500 is for button labels only
  ([Uniswap fonts.ts][uni-fonts]). Letter-spacing is `-2%` at 52 px, `-1%` at 36 px and `-0.5%` at 24 px. Big numbers
  look expensive when they are light and large, not bold. With a fallback font, 500 often renders as 400 (§11), so
  hierarchy must come from size and colour.

---

## 4. Colour: up/down, bid/ask, status, colour-blind safety

- **The conventional depth palette is green bids on the left and red asks on the right.** Uniswap uses
  `statusSuccess` and `statusCritical` (light `#0C8911` / `#E10F0F`; dark `#21C95E` / red)
  ([DepthChart][uni-depth]; [colors.ts][uni-colors]). Kraken shades its order-book ladder by cumulative or per-level
  volume, one at a time ([Kraken guide][kraken]).
- **Do not copy that convention in Depthwatch.** Here the sides are not good or bad, and red/green is needed for
  status (within KPI or breached). Use **blue for the sell side (price down) and orange for the buy side (price up)**,
  as v2 already does. Okabe–Ito: blue `#0072B2`, orange `#E69F00`, vermillion `#D55E00`, bluish green `#009E73`
  ([Okabe–Ito][okabe]). Blue/orange is the standard colour-blind replacement for red/green ([Data School][ds-redgreen];
  [Sigma][sigma-cvd]).
- **Prevalence and precedent.** About 1 in 12 men and 1 in 200 women have a colour-vision deficiency
  ([Sigma][sigma-cvd]). Bloomberg ships deuteranopia and protanomaly schemes through the `PDFU COLORS` command
  ([Bloomberg accessibility][bbg-a11y]). Futubull added adjustments for red-green colour blindness ([Futu][futu]).
- **Up = green is cultural.** In mainland China red means up. Moomoo lets users switch under Settings → Quote
  Preference → Quote Color ([Moomoo][moomoo]; [Benzinga][benzinga-red]). Depthwatch's audience is mostly Western, but
  the blue/orange side colours avoid the problem entirely.
- **Contrast.** Text needs 4.5:1 and graphical marks 3:1 ([CDS colours][cds-colors]; [Primer][primer-dv];
  [WCAG 1.4.11][wcag-1411]). Pajamas meets 3:1 on both themes by choosing steps 500–950 on light and 50–500 on dark,
  and by separating adjacent coloured marks with a **1 px gap** in the surface colour ([Pajamas colour][paj-color]).
  Primer adds a "high contrast divider line" between stacked segments ([Primer][primer-dv]).
- **Status needs a second channel.** Lighthouse draws pass ≥ 90 as a green **circle**, average 50–89 as an orange
  **square** and fail < 50 as a red **triangle** ([Lighthouse util.js][lh-util]; [styles.css][lh-css]). Pajamas
  single stats pair the colour with a meta icon ([Pajamas single stat][paj-single]).
- **Hue budget.** Use one brand accent, two side colours and two status colours (positive and critical, with amber as
  the only warning). Anything categorical beyond that goes grey. Carbon: "always use consistent colours for each data
  set within a dashboard" ([Carbon dashboards][carbon-dash]). Few #12: misusing or overusing colour
  ([13 mistakes][few-13]).
- **Use sequential ramps for magnitude, not rainbows.** For gap or health heat, use steps of one hue: lighter is lower
  on light UIs, brighter is higher on dark UIs ([Pajamas colour][paj-color]).
- **Use perceptual colour spaces.** Stripe built its accessible palette in perceptually uniform spaces (CIELAB), so
  equal steps look equal ([Stripe][stripe-color]). Do the same with OKLCH tokens.

---

## 5. Chart styling, with numbers

### Frame (Uniswap `ChartModelCore`, [source][uni-core])

- Vertical and horizontal gridlines: **off**. Axis border: **off**. Tick marks: **off**. Axis text: `neutral2`.
- Price scale: shown only on large screens (`visible: isLargeScreen`). On phones the header value replaces it.
- Crosshair: vertical and horizontal, **1 px solid**, colour `surface3` (**8 % ink** on light, 12 % on dark), magnet
  mode, axis labels **off**.
- Mouse wheel scroll and zoom are **disabled**, so the page scrolls. Pinch zoom and horizontal drag stay on.
- Texture: a **1 px dot on a 20 px grid** at `surface3Hovered` behind depth and liquidity charts, plus a **40 px**
  left-edge fade into the surface ([useApplyChartTextureEffects][uni-texture]). This is the subtle detail that makes
  the chart feel designed.
- Height: **356 px** on the pool page ([ChartSection][uni-chartsection]). Stripe uses 180 px for card charts and
  320 px for featured ones ([Stripe][stripe-chart]).

### Depth chart (Uniswap, [DepthChart][uni-depth], [helpers][uni-depth-helpers], [model][uni-depth-model], [tooltip][uni-depth-tooltip])

- Two area series, `LineType.WithSteps`, `lineWidth: 2`, fill gradient `topColor` at **40 %** opacity to
  `bottomColor` at **0 %**.
- A **mid line** of 1 px solid in the crosshair colour, plus a **mirror line** of 1 px dashed. Hovering one side
  draws a second tooltip at the same % distance on the other side, so bid and ask can be compared without moving
  ("mirror tooltip").
- Tooltip box: `minWidth 150`, padding 8, radius 12, 1 px `surface3` border, `surface2` background, 12 px body text.
  Rows are label (`neutral2`) and value, and the "Range" value is coloured by side.
- **Refuse to mislead.** With fewer than 4 real bars per side, show the chart-error skeleton instead of "a sparse,
  misleading staircase".
- Header: `1 WETH = 2,460.32 USDC ($2,460.32)` plus a period delta, in place of a title.

### Time series

- **Scrub instead of floating tooltips.** Robinhood's Spark: scrubbing "is when the user taps and drags… useful to
  display additional detail about the point" ([Spark README][spark]). Uniswap's chart header shows the value at
  **36 px** (`heading2`) with the date below at 16 px `neutral2`. While scrubbing, animation is turned off so fast
  updates do not stutter ([ChartHeader][uni-header]).
- **Spark defaults:** line **2 dp**, corner radius **3 dp** (rounded joins), baseline **1 dp**, scrub line **2 dp**,
  fill **off**, animate changes **on** ([dimens.xml][spark-dimens]; [styles.xml][spark-styles]).
- **Coinbase CDS:** a Scrubber with a "beacon" dot on each series, optionally pulsing when idle. An overlay
  "de-emphasizes future data" to the right of the scrub point. ReferenceLines with labels mark a target or threshold.
  A PeriodSelector has a transparent background, a "primary wash" active state and full width by default, with a
  `LiveTabLabel` for the live period ([Scrubber][cds-scrubber]; [ReferenceLine][cds-refline];
  [PeriodSelector][cds-period]). Accessibility labels go on the chart (overview) and on the scrubber (current point)
  ([LineChart][cds-line]).
- **Range pills:** Uniswap uses 1H / 1D / 1W / 1M / 1Y, full width on mobile ([ChartSection][uni-chartsection]).
  Depthwatch has 24 h and 7 d of history, so offer exactly those two and add more only when the data exists.
- **No dual y-axes.** v2's history chart puts depth on the left and spread on the right, which makes crossings
  meaningless. Stack two charts that share the x axis instead (small multiples). Pajamas allows two y-axes only
  "occasionally", for different orders of magnitude ([Pajamas charts][paj-charts]).
- **Baselines.** Bars and areas start at zero. Line charts may crop the y axis to show direction ([Carbon axes][carbon-axes]).
- **Gaps in data.** Never interpolate across missing periods ([Carbon axes][carbon-axes]). Draw a gap as a dashed grey
  line with no data point ([Pajamas charts][paj-charts]). Carbon uses a fixed **16 px** axis break.
- **Axis labels.** Labels are never rotated, and are truncated before they are hidden ([Datawrapper][dw-ticks]). When
  the time crosses a new day or month, set that label semibold as a "landmark" ([Carbon axes][carbon-axes]). Direct
  value labels can remove the need for a y axis and grid altogether ([Datawrapper][dw-labels]). Datawrapper's small
  multiples ship with **no gridlines** by default ([Datawrapper][dw-multiples]).
- **Legend only when there are 2 or more series** ([Primer][primer-dv]; [Pajamas charts][paj-charts]). Otherwise
  label directly on the line ([Carbon anatomy][carbon-anatomy]).
- **Units go in the axis title in parentheses**, e.g. "Depth (USD)" ([Pajamas charts][paj-charts]).

### Tufte

- **Data-ink.** Maximise the share of ink that shows data. Labels, axes and grids "distract attention from the most
  important part" ([R Journal on Tufte][rjournal]).
- **Sparklines** are "small, intense, simple, word-sized graphics" that can go anywhere a word or number can,
  including tables. Tufte's glucose example shows a **grey band for the normal range** and ties the final value to its
  number with a colour accent ([Tufte notebook][tufte-spark] *(secondary)*). For Depthwatch, draw the KPI band, or the
  ±2 % target, as a grey band behind a persistence sparkline, and colour only the last point.
- **Aspect ratio.** Bank line slopes to about 45°. Visual judgement is enough, and it is "not some natural law"
  ([eagereyes][eagereyes]; [Heer & Agrawala][heer-banking]).
- **Small multiples** repeat one design "within the eyespan" on one scale ([eyespan][tufte-eyespan]). Token Terminal
  compares up to **20** projects in one chart ([changelog][tt-003] *(secondary)*). Depthwatch has 6–50 pools, so use a
  shared-scale butterfly, not 6–50 separate cards.

---

## 6. Tables

- **Row height.** Uniswap uses **56 px** on desktop and **48 px** on mobile web ([constants.ts][uni-table]). Carbon
  offers 24 / 32 / 40 / 48 / 64 px, and the header row always matches the body rows ([Carbon style][carbon-dt-style]).
  For Depthwatch, use 56 px for pools and gaps and 44–48 px for dense sub-tables.
- **Type and padding.** Carbon uses a 14 px semibold column header, 14 px regular row text, **16 px** column padding,
  an 8 px sort-icon pad and a 20 px table title ([Carbon style][carbon-dt-style]). Uniswap headers use `body3` (14 px)
  in `neutral2` when inactive and `neutral1` when sorted ([SortableHeader][uni-sort]). v2 uses 11 px tracked uppercase
  headers; drop them for sentence-case 13–14 px in the secondary ink colour.
- **Width.** Explore tables max out at **1200 px** ([TokensTable][uni-tokens]). Wide tables make small content hard
  to scan ([Pajamas table][paj-table]).
- **Hover.** The row background moves to `surface1Hovered` (`#FCFCFC` on white, `#1A1A1A` on `#131313`) with a
  **0.1 s** transition. The selected row uses `surface3` ([styled.tsx][uni-table-styled]). The sort-icon hover is
  opacity 50 % over **80 ms** ([SortableHeader][uni-sort]).
- **Sort affordance.** Only the sorted column shows an icon; unsorted columns reveal theirs on hover. There are three
  states: unsorted, up and down ([Carbon usage][carbon-dt-usage]). Pajamas sorts ascending on the first click and
  then toggles. Nulls go **last in both directions**, row actions stay visible (not hover-only), and sort icons hide on
  responsive tables ([Pajamas table][paj-table]). For metric tables, sort descending on the first click, since
  "biggest first" is the usual question.
- **Alignment.** Text is left-aligned and numbers right-aligned with consistent decimals. Multi-line rows align to
  the top, and alignment within a table matters more than consistency between tables ([Pajamas table][paj-table]).
- **Sticky header** with a **12 px** clearance under the app bar ([constants.ts][uni-table]). On horizontal scroll,
  pin the first column and add a scroll fade mask and side scroll buttons ([Uniswap Table/][uni-table-dir]).
- **In-cell graphics.** Uniswap's token sparkline is **80 × 20 px** ([TokensTable][uni-tokens]). L2BEAT's risk
  rosette is **24 px** on mobile and **32 px** at md and up ([PizzaRosetteCell][l2b-cell]). L2BEAT's stage badge has
  a **fixed width** of 60 px (66 px at md) and a height of 18 px (22 px at md), so badges line up in a column
  ([StageBadge][l2b-stage]). Give the grade chip in Depthwatch a fixed width for the same reason.
- **Zebra striping** is optional ([Pajamas][paj-table]). Prefer 1 px rules at 8 % ink, which Uniswap's `surface3` uses.
- **Repeated values.** v2's "Updated" column says "just now" 6 times. Move a value that is the same on every row into
  the table caption.

---

## 7. Scores and grades

| Product | Visual | Numbers |
| --- | --- | --- |
| Lighthouse | circular gauge + number; per-audit shape icons | gauge **96 px** (big) / **48 px** / 32 px; score text **38 px** in the big gauge; pass ≥ 0.9, average ≥ 0.5 ([util.js][lh-util]; [styles.css][lh-css]) |
| SSL Labs | big letter + 0–100 sub-scores (protocol 30 %, key exchange 30 %, cipher 40 %) | A ≥ 80; **caps** with stated reasons (RC4 → max C); A+ needs extras ([Qualys][ssllabs-2017]; [SSL247][ssllabs-kb]) *(secondary)* |
| L2BEAT | 5-slice "pizza rosette", each slice coloured by sentiment; hovering a slice shows its risk and links to the section | **180 × 180** SVG on the project page, 24 / 32 px in tables ([PizzaRosetteIcon][l2b-rosette]; [cell][l2b-cell]) |
| Few's bullet graph | bar = actual, thin tick = target, 2–5 background bands in shades of one hue | replaced gauges in 2005 ([Wikipedia][bullet-wiki]; [BetterEvaluation][bullet-be]; [spec PDF][bullet-spec]) |

Rules for Depthwatch (grades: A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, F below; components weighted 35 / 25 / 20 / 20,
[METRICS.md](../../METRICS.md)):

- **One weighted bar.** Split a 100-unit bar into four segments sized **35 / 25 / 20 / 20**, each filled to its
  component score, with 2 px gaps between them. The total filled length is the score itself (88 of 100), and the
  weakest part (concentration 9 / 20) is visible at once. This was tested in §11 and replaces v2's four separate bars
  plus a big number.
- **Number first, letter second.** Show the number large (40–56 px, light weight) with a muted `/ 100`, and the letter
  as a small fixed-width chip. Use at most **three colour bands** for five letters, following Lighthouse's 3-band
  logic: A–B positive, C neutral or amber, D–F critical, each with a shape or icon as well.
- **Explain caps and notes beside the grade**, as SSL Labs does with its grade caps. Depthwatch already produces
  `notes`, such as "persistence neutral: fewer than 3 samples". Show them as one muted line under the grade, not in a
  separate card.
- **In tables**, show a fixed-width chip with the number, or a 24–32 px mini glyph (a rosette or the weighted bar at
  80 × 6 px). Never show a full gauge in a row.
- **Avoid gauges and donuts for single values.** Few designed the bullet graph to replace them ([Wikipedia][bullet-wiki]).
  Primer does not support donuts ([Primer][primer-dv]).

### Market-maker scorecards

- **KPI vs target:** show a bullet graph (a value bar with a target tick) or a CDS-style ReferenceLine at the KPI on
  the depth series ([ReferenceLine][cds-refline]). A breach is then a fact read off the chart, not three red cards.
- **Uptime strip:** 84 cells over 7 days, one every 2 h. Draw the cells that are within KPI in neutral ink or a muted
  positive tint, and colour only breaches. In our sketch, 84 saturated red and green cells looked like a warning
  sign, not a status record.
- **Breach log:** collapse consecutive breached samples into **episodes** (start, duration, number of samples, worst
  value). v2 lists 12 near-identical rows with 24 red chips.
- **Embeddable badge:** keep it as a two-part pill (`depthwatch | ok · 7d 96.4%`). This is the shields.io pattern,
  and v2 already gets it right.

---

## 8. Motion for live numbers

- **Animated numbers.** Pajamas `GlAnimatedNumber` defaults to **1000 ms** ([Pajamas][paj-anim]). Uniswap animates
  the header value only when the user is not scrubbing ([ChartHeader][uni-header]). Use 600–1000 ms for value changes
  on refresh, and none on hover.
- **Chart entry and update.** CDS charts use a clip-path reveal on enter and a morph on data update, and both can be
  disabled ([LineChart][cds-line]). Respect `prefers-reduced-motion`.
- **"Live" signals.** CDS beacons can pulse when idle, and a `LiveTabLabel` marks the live period
  ([Scrubber][cds-scrubber]; [PeriodSelector][cds-period]). Depthwatch's "Block N · updated just now" dot should
  pulse at most once per new block.
- **No celebration.** No confetti, no bounce on numbers ([Robinhood 2021][rh-confetti]). Few #11: "cluttering the
  display with visual effects" ([13 mistakes][few-13]).

---

## 9. What v2 does against these rules

| Area | v2 | Rule broken | Fix |
| --- | --- | --- | --- |
| Home first screen | 4 equal KPI cards (6 / $26.1M / $28.2M / 82.4), each with a two-line caption | §1 one visual; Few #10 | one headline sentence + depth butterfly + ≤ 3 KPIs |
| Pool page | ~90 numbers at one weight; 7 cards | §1 budget; Few #1, #3 | depth curve hero, 1 headline stat row, sections below |
| Depth chart | separate horizontal bars per level; 6 USD + 6 token labels; mono axis | §5 depth convention; §3 token amounts in tooltip | mirrored area with dots at ±1/2/5, 2 direct labels, tooltip for the rest |
| Number style | `$31.5k` and `$1.6M` mixed case; `$50.0k`; `100.0%`; `$0.00` axis; `50.8×` | §3 | Intl compact, 3 significant digits, `K M B` |
| Type | 11 px uppercase tracked labels everywhere; mono for legends and axis | §3, §6 | sentence-case 13 px secondary ink; tnum sans |
| History chart | dual y-axis (USD left, bps right) | §5 | two stacked small multiples, shared x |
| Health | 88.2 + "/100" + chip + 4 bars + 4 fractions | §7 | one weighted bar, number + letter |
| Scorecard | 3 red KPI cards + 3 uptime cards + red/green strip + 24 red chips | §7 alarm once | bullet graph + reference line + neutral strip + episodes |
| Tables | "just now" ×6; tags (`AERO CL`) as grey boxes in every row | §6 | caption the shared value; protocol as a muted text suffix |

---

## 10. Recommendations for v3 (synthesis, to be validated in the design pass)

1. **Home.** Show an eyebrow line ("Base liquidity · 6 pools · block 52,950,000"). Then a headline with the number in
   ink and the predicate in `ink-3`: "**$26.1M** moves Base 2 %." Then the **depth butterfly** of all pools on one
   scale, with sell-side bars left and buy-side bars right, 14 px tall in 40 px rows, values inside a bar when it is
   wider than 70 px and outside otherwise. Then three KPIs (24 h volume with "1.1× depth", median health, biggest gap).
   Nothing else above the fold. Gaps and scorecards follow as one line each with a link, not as tables.
2. **Pool page.** The headline is the pair, a muted protocol suffix, then one sentence: "It takes **$6.1M** to lift
   WETH 2 % and **$5.1M** to push it down." The hero is a mirrored depth curve on log-spaced ±1/2/5 with the ±2 % band
   shaded. Show one stat row (Health 88 A · Spread $10k 10.4 bps · 24 h volume $9.8M · TVL $85.3M) and the weighted
   health bar. Sections follow, each with one visual: spread (3 points as a tiny line), concentration (top-1 / top-3
   share bar), persistence (sparkline with KPI band). Then history as two small multiples with 24 h / 7 d pills.
3. **Tables.** Use 56 px rows, sentence-case 13 px headers, right-aligned tnum numbers, a fixed-width grade chip and
   an 80 × 20 px glyph column on a shared scale. Sticky header, nulls last, max width 1200 px.
4. **Colour tokens.** Sell side is blue `#0072B2`-family, buy side is orange `#E69F00`-family; positive is a muted
   green; critical is vermillion `#D55E00`-family; amber warns. All are tuned in OKLCH for ≥ 3:1 on both themes.
   There is one brand accent, and everything else is neutral.
5. **Charts.** No grid, no axis borders, no tick marks. A 1 px crosshair at 8 % ink. Scrubbing updates the header. A
   2 px line with a 40 → 0 % gradient fill. A 1 px dotted texture on a 20 px grid only behind the depth hero. 356 px
   tall on desktop and 220–260 px on phones.

---

## 11. Sketch evidence

Built outside the repository with demo-like values and screenshotted with Playwright at 1440 px light and dark and
at 390 px:

- **Sketch A:** linear ±5 % axis, per-row normalised glyphs. **Finding:** on a linear x axis the ±1/2 % region is
  cramped and the curve is a plain "V". Glyphs normalised per row all look the same and carry no information.
- **Sketch B:** log-spaced 1/2/5 axis and a shared-scale butterfly. **Finding:** the butterfly is the most striking
  and honest visual. The gap pool (USDC/AERO, $15k / $17k) shows as a 1 px sliver next to $5.1M / $6.1M, and that
  tells the "where are market makers missing" story without words. At 390 px, put each pool label on its own line
  above its bar and use 52 px rows.
- **Score sketch:** the weighted 35/25/20/20 bar reads well. A saturated 84-cell red/green strip is too loud, so
  colour breaches only.
- **Fallback fonts.** Renders forcing DejaVu Sans, which is wider than Inter and has no 500 weight: nothing
  overflows at 390 px (`scrollWidth = 390`), but the 500-weight headline renders at 400, so size and colour must
  carry hierarchy. Where `sans-serif` resolves to Inter, the fallback render looks like Inter
  ([type-a11y fallback note](type-a11y.md)).

**Gaps in this research:** no live look at Hyperliquid, Kraken Pro, Coinbase Advanced, Dune, Arkham or Nansen
(sites not read directly). No primary source was found for Dune counters, Nansen's redesign or Stripe's comparison-period line
styling. Those products are cited only where a search excerpt gave something concrete.

---

## Sources

Primary (source code or design-system docs read directly):

- `uni-depth`: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChart.tsx
- `uni-depth-helpers`: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChartModel.helpers.ts
- `uni-depth-model`: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChartModel.ts
- `uni-depth-tooltip`: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChartTooltip.tsx
- `uni-chartsection`: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/index.tsx
- `uni-stats`: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/PoolDetailsStats.tsx
- `uni-subscript`: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/formatPriceWithSubscript.ts
- `uni-core`: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/ChartModelCore.ts
- `uni-header`: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/ChartHeader.tsx
- `uni-texture`: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/hooks/useApplyChartTextureEffects.ts
- `uni-table`: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Table/constants.ts
- `uni-table-styled`: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Table/styled.tsx
- `uni-table-dir`: https://github.com/Uniswap/interface/tree/main/apps/web/src/components/Table
- `uni-sort`: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Table/shared/SortableHeader.tsx
- `uni-tokens`: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/Explore/tables/Tokens/TokensTable.tsx
- `uni-delta`: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/DeltaArrow/DeltaArrow.tsx
- `uni-format`: https://github.com/Uniswap/interface/blob/main/packages/utilities/src/format/localeBasedFormats.ts
- `uni-fonts`: https://github.com/Uniswap/interface/blob/main/packages/ui/src/theme/fonts.ts
- `uni-colors`: https://github.com/Uniswap/interface/blob/main/packages/ui/src/theme/color/colors.ts
- `cds-scrubber`: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/Scrubber/_webExamples.mdx
- `cds-refline`: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/ReferenceLine/_webExamples.mdx
- `cds-period`: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/PeriodSelector/_webExamples.mdx
- `cds-line`: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/LineChart/_webExamples.mdx
- `cds-colors`: https://github.com/coinbase/cds/blob/master/apps/docs/docs/getting-started/colors.mdx
- `cds-text`: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/typography/Text/_webExamples.mdx
- `l2b-rosette`: https://github.com/l2beat/l2beat/blob/main/packages/frontend/src/components/rosette/pizza/PizzaRosetteIcon.tsx
- `l2b-cell`: https://github.com/l2beat/l2beat/blob/main/packages/frontend/src/components/rosette/pizza/PizzaRosetteCell.tsx
- `l2b-stage`: https://github.com/l2beat/l2beat/blob/main/packages/frontend/src/components/badge/StageBadge.tsx
- `lh-util`: https://github.com/GoogleChrome/lighthouse/blob/main/shared/util.js
- `lh-css`: https://github.com/GoogleChrome/lighthouse/blob/main/report/assets/styles.css
- `spark`: https://github.com/robinhood/spark/blob/master/README.md
- `spark-dimens`: https://raw.githubusercontent.com/robinhood/spark/master/spark/src/main/res/values/dimens.xml
- `spark-styles`: https://raw.githubusercontent.com/robinhood/spark/master/spark/src/main/res/values/styles.xml
- `paj-charts`: https://design.gitlab.com/data-visualization/charts (source: https://gitlab.com/gitlab-org/gitlab-services/design.gitlab.com/-/blob/main/contents/data-visualization/charts.md)
- `paj-color`: https://design.gitlab.com/data-visualization/color
- `paj-single`: https://design.gitlab.com/data-visualization/single-stat
- `paj-dash`: https://design.gitlab.com/patterns/dashboards
- `paj-table`: https://design.gitlab.com/components/table
- `paj-anim`: https://design.gitlab.com/components/utility-animated-number
- `carbon-axes`: https://carbondesignsystem.com/data-visualization/axes-and-labels/ (source: https://github.com/carbon-design-system/carbon-website/blob/main/src/pages/data-visualization/axes-and-labels/index.mdx)
- `carbon-anatomy`: https://carbondesignsystem.com/data-visualization/chart-anatomy/
- `carbon-dash`: https://carbondesignsystem.com/data-visualization/dashboards/
- `carbon-dt-style`: https://carbondesignsystem.com/components/data-table/style/
- `carbon-dt-usage`: https://carbondesignsystem.com/components/data-table/usage/
- `primer-dv`: https://github.com/primer/design/blob/main/content/ui-patterns/data-visualization.mdx

Secondary (web-search excerpts of these pages, unverified in full):

- `few-def`: https://www.tableau.com/sites/default/files/webinars/what_the_heck_is_a_dashboard_anyways.pdf
- `few-13`: https://www.thedataschool.co.uk/anh-vu/are-you-making-these-13-dashboard-design-mistakes/ · Few white paper: https://support.itrsgroup.com/hc/en-us/article_attachments/115004392393
- `bullet-wiki`: https://en.wikipedia.org/wiki/Bullet_graph
- `bullet-be`: https://betterevaluation.org/node/1784
- `bullet-spec`: http://www.perceptualedge.com/articles/misc/Bullet_Graph_Design_Spec.pdf
- `tufte-spark`: https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/
- `tufte-eyespan`: https://kraft.blog/2006/02/envisioning-information-multiples-and-colors/
- `rjournal`: https://journal.r-project.org/articles/RJ-2015-003/RJ-2015-003.pdf
- `eagereyes`: https://eagereyes.org/basics/banking-45-degrees
- `heer-banking`: https://homes.cs.washington.edu/~jheer/files/2006-Banking-InfoVis.pdf
- `cowan`: https://memory.psych.missouri.edu/assets/doc/articles/2001/cowan-bbs-2001.pdf
- `nng-pd`: https://www.nngroup.com/articles/progressive-disclosure/
- `nng-dash`: https://www.nngroup.com/articles/dashboards-preattentive/
- `stripe-chart`: https://docs.stripe.com/stripe-apps/patterns/chart-layout
- `stripe-925`: https://www.925studios.co/blog/stripe-dashboard-design-breakdown
- `stripe-color`: https://stripe.com/blog/accessible-color-systems
- `bbg-conceal`: https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity
- `bbg-cvd`: https://www.techatbloomberg.com/blog/designing-the-terminal-for-color-accessibility/
- `bbg-a11y`: https://www.bloomberg.com/ux/accessibility/
- `hl-onekey`: https://onekey.so/blog/ecosystem/hyperliquid-cex-ux-comparison/
- `hl-design`: https://www.webdesignhot.com/design.md/hyperliquid/
- `kraken`: https://support.kraken.com/hc/en-us/articles/360022627732-Trading-interface-guide
- `rh-rebrand`: https://designcompass.org/en/robinhood-rebranding/
- `rh-2026`: https://designcompass.org/en/archive/robinhood-2026/
- `rh-confetti`: https://www.cnbc.com/2021/03/31/robinhood-gets-rid-of-confetti-feature-amid-scrutiny-over-gamification.html
- `tt-003`: https://tokenterminal.com/changelog/003
- `tt-news`: https://tokenterminal.beehiiv.com/p/product-update-our-new-market-sector-and-project-pages-are-live
- `messari`: https://docs.messari.io/user-guides/messari-features/project-page
- `arkham`: https://info.arkm.com/announcements/arkhams-dashboards-v2-are-now-live
- `linear-insights`: https://linear.app/docs/insights
- `kaiko-2pct`: https://docs.kaiko.com/getting-started/kaiko-examples/compare-market-depth-between-exchanges
- `paradigm`: https://www.paradigm.xyz/2022/05/the-dominance-of-uniswap-v3-liquidity
- `tenderly`: https://docs.tenderly.co/defi-modules/uniswap
- `questdb-depth`: https://questdb.com/blog/market-depth-grafana-questdb-plotly/
- `amcharts-depth`: https://www.amcharts.com/demos/live-order-book-depth-chart/
- `mdn-intl`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/NumberFormat/NumberFormat
- `tnum-amit`: https://amitmerchant.com/one-css-property-that-makes-numbers-look-instantly-better/
- `alberta`: https://design.alberta.ca/examples/display-numbers-in-a-table-so-they-can-be-scanned-easily
- `dw-ticks`: https://www.datawrapper.de/blog/new-axis-ticks
- `dw-labels`: https://www.datawrapper.de/blog/automatically-label-values-in-line-charts
- `dw-multiples`: https://www.datawrapper.de/academy/customizing-your-small-multiple-line-chart
- `okabe`: https://siegal.bio.nyu.edu/color-palette/
- `sigma-cvd`: https://www.sigmacomputing.com/blog/data-charts-color-blindness
- `ds-redgreen`: https://thedataschool.co.uk/vivek-patel/untitled-245
- `wcag-1411`: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
- `moomoo`: https://www.moomooapp.com/us/support/topic3_41
- `futu`: https://developer.android.google.cn/stories/apps/futu?hl=en
- `benzinga-red`: https://www.benzinga.com/general/education/21/10/23258001/did-you-know-you-dont-want-to-be-in-the-green-if-youre-trading-in-china-japan-or-taiwan
- `ssllabs-2017`: https://blog.qualys.com/product-tech/2016/11/16/announcing-ssl-labs-grading-changes-for-2017
- `ssllabs-kb`: https://myssl.ssl247.com/kb/ssl-certificates/manage/ssl-labs-grading

[uni-depth]: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChart.tsx
[uni-depth-helpers]: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChartModel.helpers.ts
[uni-depth-model]: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChartModel.ts
[uni-depth-tooltip]: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChartTooltip.tsx
[uni-chartsection]: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/index.tsx
[uni-stats]: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/PoolDetailsStats.tsx
[uni-subscript]: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/formatPriceWithSubscript.ts
[uni-core]: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/ChartModelCore.ts
[uni-header]: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/ChartHeader.tsx
[uni-texture]: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/hooks/useApplyChartTextureEffects.ts
[uni-table]: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Table/constants.ts
[uni-table-styled]: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Table/styled.tsx
[uni-table-dir]: https://github.com/Uniswap/interface/tree/main/apps/web/src/components/Table
[uni-sort]: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Table/shared/SortableHeader.tsx
[uni-tokens]: https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/Explore/tables/Tokens/TokensTable.tsx
[uni-delta]: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/DeltaArrow/DeltaArrow.tsx
[uni-format]: https://github.com/Uniswap/interface/blob/main/packages/utilities/src/format/localeBasedFormats.ts
[uni-fonts]: https://github.com/Uniswap/interface/blob/main/packages/ui/src/theme/fonts.ts
[uni-colors]: https://github.com/Uniswap/interface/blob/main/packages/ui/src/theme/color/colors.ts
[cds-scrubber]: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/Scrubber/_webExamples.mdx
[cds-refline]: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/ReferenceLine/_webExamples.mdx
[cds-period]: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/PeriodSelector/_webExamples.mdx
[cds-line]: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/LineChart/_webExamples.mdx
[cds-colors]: https://github.com/coinbase/cds/blob/master/apps/docs/docs/getting-started/colors.mdx
[cds-text]: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/typography/Text/_webExamples.mdx
[l2b-rosette]: https://github.com/l2beat/l2beat/blob/main/packages/frontend/src/components/rosette/pizza/PizzaRosetteIcon.tsx
[l2b-cell]: https://github.com/l2beat/l2beat/blob/main/packages/frontend/src/components/rosette/pizza/PizzaRosetteCell.tsx
[l2b-stage]: https://github.com/l2beat/l2beat/blob/main/packages/frontend/src/components/badge/StageBadge.tsx
[lh-util]: https://github.com/GoogleChrome/lighthouse/blob/main/shared/util.js
[lh-css]: https://github.com/GoogleChrome/lighthouse/blob/main/report/assets/styles.css
[spark]: https://github.com/robinhood/spark/blob/master/README.md
[spark-dimens]: https://raw.githubusercontent.com/robinhood/spark/master/spark/src/main/res/values/dimens.xml
[spark-styles]: https://raw.githubusercontent.com/robinhood/spark/master/spark/src/main/res/values/styles.xml
[paj-charts]: https://design.gitlab.com/data-visualization/charts
[paj-color]: https://design.gitlab.com/data-visualization/color
[paj-single]: https://design.gitlab.com/data-visualization/single-stat
[paj-dash]: https://design.gitlab.com/patterns/dashboards
[paj-table]: https://design.gitlab.com/components/table
[paj-anim]: https://design.gitlab.com/components/utility-animated-number
[carbon-axes]: https://carbondesignsystem.com/data-visualization/axes-and-labels/
[carbon-anatomy]: https://carbondesignsystem.com/data-visualization/chart-anatomy/
[carbon-dash]: https://carbondesignsystem.com/data-visualization/dashboards/
[carbon-dt-style]: https://carbondesignsystem.com/components/data-table/style/
[carbon-dt-usage]: https://carbondesignsystem.com/components/data-table/usage/
[primer-dv]: https://github.com/primer/design/blob/main/content/ui-patterns/data-visualization.mdx
[few-def]: https://www.tableau.com/sites/default/files/webinars/what_the_heck_is_a_dashboard_anyways.pdf
[few-13]: https://www.thedataschool.co.uk/anh-vu/are-you-making-these-13-dashboard-design-mistakes/
[bullet-wiki]: https://en.wikipedia.org/wiki/Bullet_graph
[bullet-be]: https://betterevaluation.org/node/1784
[bullet-spec]: http://www.perceptualedge.com/articles/misc/Bullet_Graph_Design_Spec.pdf
[tufte-spark]: https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/
[tufte-eyespan]: https://kraft.blog/2006/02/envisioning-information-multiples-and-colors/
[rjournal]: https://journal.r-project.org/articles/RJ-2015-003/RJ-2015-003.pdf
[eagereyes]: https://eagereyes.org/basics/banking-45-degrees
[heer-banking]: https://homes.cs.washington.edu/~jheer/files/2006-Banking-InfoVis.pdf
[cowan]: https://memory.psych.missouri.edu/assets/doc/articles/2001/cowan-bbs-2001.pdf
[nng-pd]: https://www.nngroup.com/articles/progressive-disclosure/
[nng-dash]: https://www.nngroup.com/articles/dashboards-preattentive/
[stripe-chart]: https://docs.stripe.com/stripe-apps/patterns/chart-layout
[stripe-925]: https://www.925studios.co/blog/stripe-dashboard-design-breakdown
[stripe-color]: https://stripe.com/blog/accessible-color-systems
[bbg-conceal]: https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity
[bbg-cvd]: https://www.techatbloomberg.com/blog/designing-the-terminal-for-color-accessibility/
[bbg-a11y]: https://www.bloomberg.com/ux/accessibility/
[hl-onekey]: https://onekey.so/blog/ecosystem/hyperliquid-cex-ux-comparison/
[hl-design]: https://www.webdesignhot.com/design.md/hyperliquid/
[kraken]: https://support.kraken.com/hc/en-us/articles/360022627732-Trading-interface-guide
[rh-rebrand]: https://designcompass.org/en/robinhood-rebranding/
[rh-2026]: https://designcompass.org/en/archive/robinhood-2026/
[rh-confetti]: https://www.cnbc.com/2021/03/31/robinhood-gets-rid-of-confetti-feature-amid-scrutiny-over-gamification.html
[tt-003]: https://tokenterminal.com/changelog/003
[tt-news]: https://tokenterminal.beehiiv.com/p/product-update-our-new-market-sector-and-project-pages-are-live
[messari]: https://docs.messari.io/user-guides/messari-features/project-page
[arkham]: https://info.arkm.com/announcements/arkhams-dashboards-v2-are-now-live
[linear-insights]: https://linear.app/docs/insights
[kaiko-2pct]: https://docs.kaiko.com/getting-started/kaiko-examples/compare-market-depth-between-exchanges
[paradigm]: https://www.paradigm.xyz/2022/05/the-dominance-of-uniswap-v3-liquidity
[tenderly]: https://docs.tenderly.co/defi-modules/uniswap
[questdb-depth]: https://questdb.com/blog/market-depth-grafana-questdb-plotly/
[amcharts-depth]: https://www.amcharts.com/demos/live-order-book-depth-chart/
[mdn-intl]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/NumberFormat/NumberFormat
[tnum-amit]: https://amitmerchant.com/one-css-property-that-makes-numbers-look-instantly-better/
[alberta]: https://design.alberta.ca/examples/display-numbers-in-a-table-so-they-can-be-scanned-easily
[dw-ticks]: https://www.datawrapper.de/blog/new-axis-ticks
[dw-labels]: https://www.datawrapper.de/blog/automatically-label-values-in-line-charts
[dw-multiples]: https://www.datawrapper.de/academy/customizing-your-small-multiple-line-chart
[okabe]: https://siegal.bio.nyu.edu/color-palette/
[sigma-cvd]: https://www.sigmacomputing.com/blog/data-charts-color-blindness
[ds-redgreen]: https://thedataschool.co.uk/vivek-patel/untitled-245
[wcag-1411]: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
[moomoo]: https://www.moomooapp.com/us/support/topic3_41
[futu]: https://developer.android.google.cn/stories/apps/futu?hl=en
[benzinga-red]: https://www.benzinga.com/general/education/21/10/23258001/did-you-know-you-dont-want-to-be-in-the-green-if-youre-trading-in-china-japan-or-taiwan
[ssllabs-2017]: https://blog.qualys.com/product-tech/2016/11/16/announcing-ssl-labs-grading-changes-for-2017
[ssllabs-kb]: https://myssl.ssl247.com/kb/ssl-certificates/manage/ssl-labs-grading
