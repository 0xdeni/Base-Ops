# Critique of dashboard v2

Dashboard v2 reads as a generic admin template: bland, with large amounts of generic-looking data at equal weight, which makes the product look cheap. This document says why, screen by screen, with causes specific enough to fix. The rules it cites are in [`principles.md`](principles.md), and the replacement structure is in [`ia-v3.md`](ia-v3.md).

## Evidence base

- **Screenshots.** 46 v2 screenshots (not kept in the repository):
  - desktop at 1440 px and phones at 390 px with 2× DPR, light and dark;
  - narrow 320 px;
  - the static build.

  Phone heights below are CSS px, which is the image height ÷ 2.
- **Source.** `apps/web/src/pages/*.tsx`, the components they render, `styles.css`, `components.css`, `detail.css`, `rows.css` and `apps/web/index.html`.
- **Research.** The four notes in [`research/`](research/). Several counts below come from them; [data-ui §1](research/data-ui.md), for example, counts about 90 numbers on the pool page.
- **Number counts are approximate.** A data number is defined as in `principles.md`, and counts were taken by reading the screenshots.

---

## 1. Summary

v2 is **correct, honest and complete**. It is also **built in the shape of the API**:
- every DTO became a bordered panel;
- every field became a labelled stat;
- every list became a table;
- every concept got a caption.

Nothing on any screen is allowed to matter more than anything else. The result reads as a competent admin template:
- equal boxes;
- equal numbers;
- small uppercase labels;
- the default chart look.

That template is the shape of a default admin kit, not of this product. The typography and colour decisions in `visual.md` were reasonable one at a time. The failure is structural: **no hierarchy, no focal point, no editing.** Styling alone will not fix it. That is why v3 starts from the information architecture.

## 2. Root causes (cross-cutting, worst first)

| #   | Cause                                                                                                                 | Evidence in v2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Rules broken                     |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| R1  | **No focal point.** Each screen opens with a grid of equal-weight figures, and nothing answers the screen's question. | **Home:** the H1 is a slogan with no number, set beside a 2×2 board of four 32 px numbers that each carry a caption. **Pools:** 5 DEX tiles × 3 metrics come before the table. **Pool:** 8 equal stats, including an inverse price `0.0004065` and a gap score `0`. **Scorecard:** a 4-stat header, then 3 KPI cards, then 3 uptime tiles.                                                                                                                                                                                           | P1, P3, D2                       |
| R2  | **The card kit.** Every block is a bordered white box with the same radius on a grey page. Boxes nest.                | The pool page has 7 bordered panels. The scorecard page has 7 panels plus 6 cards inside them (KPI cards inside "KPIs", uptime tiles inside "Uptime"). Home has 8 boxes: a board with 4 bordered cells, a gaps panel, 2 scorecard cards and 4 identical "What we measure" cards.                                                                                                                                                                                                                                                     | E1, E2, tells 6–9                |
| R3  | **Tables as the default answer.** Lists, feeds, key-value data and two-row comparisons are all tables.                | **Home:** gaps table. **Pools:** pools table and gaps table. **Pool:** spread table and persistence table. **Scorecard:** excursions and breaches tables. **Token:** a 9-column table for 2 rows. On phones, the spread and persistence tables clip inside their panels (`BUY AVG (US…`, `STABIL…`, phone pool detail).                                                                                                                                                                                                              | TB1, TB2, TB7                    |
| R4  | **Too many numbers, at one size, with too much precision.**                                                           | First viewport at 1440×900: Home about 22, Pools about 70, Pool about 50 (about 90 on the page), Scorecard about 35. Formatting: `$31.5k` next to `$1.6M` (mixed case), `$50.0k`, `$1.0k`, `100.0%`, `88.2` beside `35.0 / 35`, token amounts `2,938,646 USDC` and `4,283.79 WETH` printed permanently next to USD, `318.1 bps`, `50.8×`.                                                                                                                                                                                            | P2, P4, N1–N6, N11               |
| R5  | **Template-chrome typography.**                                                                                       | 4 CSS rules set `text-transform: uppercase; letter-spacing: 0.07em` at 11 px (`--fs-2xs`, below the 12 px floor). The pool page alone has 20 uppercase labels. Mono is used for decoration (`±1 · 2 · 5 %`, `$1k · $10k · $100k`, axis ticks). Middle-dot meta strings appear in the footer, header, legends and captions. The banner reads `Demo data — synthetic…`. `→` is glued to every section link. A logo-glyph divider appears 3 times on Home.                                                                              | T5, T11, CP6, CP7, tells 1–5, 15 |
| R6  | **Colour in the wrong places, with one colour meaning two things.**                                                   | `--accent` and `--bid` are both `#1d4db5`, so links, the pool H1 (token links) and the bid bars are the same blue. Spread bars add a third data hue, purple `#6d3fc0`, that means nothing. The most saturated pixels on Home are the red/green uptime barcodes and the red "Breached" pill of a demo mandate, not the product's answer. Grade chips are filled colour on every row.                                                                                                                                                  | C2, C3, C5, tells 21–22          |
| R7  | **Default chart styling.**                                                                                            | The pool history chart has dual y axes (USD left, bps right) whose crossing means nothing, axis floors of `$0.00` and `0.0`, x ticks at `06:56 / 13:53 / 20:50`, and 250 px of plot where both lines are almost flat. The depth "ladder" is three separate horizontal bar pairs with mono ticks instead of a depth curve. Scorecard charts have a red dashed KPI line, nearly identical bid and ask lines, and a purple spread chart for a mandate with "no spread KPI". The 84-cell red/green strip is split into up and down rows. | CH1–CH8, tell 17                 |
| R8  | **Everything explained everywhere.**                                                                                  | Every board stat has a two-line caption. Every section heading has an explainer paragraph. Panel heads carry hints ("round trip, fees included", "0–100, A–F", "latest sample vs the agreed targets"). The Gaps and Scorecards leads are 3–4 line methodology paragraphs, including the gap-score mapping formula.                                                                                                                                                                                                                   | P8                               |
| R9  | **Duplication.**                                                                                                      | The gaps list appears on Home (5 rows), Pools (6 rows) and Gaps (6 rows). On the AERO scorecard the 7 d uptime `42.9%` appears 4 times: KPI card, uptime tile, tape caption and badge. The KPI threshold `$50.0k` appears in 7 places. "depth up / depth down" chips repeat 24 times in one table. "just now" fills a column 6 times. "synthetic" appears in the banner, every card, every row and the footer.                                                                                                                       | P7, TB6, D7, tell 20             |
| R10 | **Heavy chrome and long phone pages.**                                                                                | On a phone the demo banner wraps to 2 lines, and the header stacks logo, nav and freshness in 3 rows: about 172 CSS px (20 % of an 844 px screen) before the first heading. Phone heights: Home 3,564 px (4.2 screens), Pool 2,668, Scorecard 4,273 (5.1 screens), Methodology 4,483. The Pools DEX tiles become a sideways carousel cut off mid-word ("Uniswa").                                                                                                                                                                    | P9, S8, PH2                      |
| R11 | **No craft layer.**                                                                                                   | Fonts come from Google Fonts (Archivo plus JetBrains Mono). That subset strips OpenType features and does not cover `→` or `≥`, both of which v2 uses. At UI sizes Archivo reads close to Inter. Headings are weight 600 everywhere. There is no press feedback and no route transition: the only motion is a 120 ms colour fade. `--faint` fails contrast: 3.10:1 on white and 2.82:1 on `--bg` in light, and 3.91:1 in dark ([type-a11y §6.3](research/type-a11y.md)). The dark canvas `#0b0e13` is the generic near-black.        | T1, T2, C6, C7, M5               |
| R12 | **Copy that sells or describes the audience instead of answering.**                                                   | "Liquidity on Base, measured pool by pool." (slogan). "We measure…" (the "we" voice). "For ecosystem leads, protocol teams and market makers." (the audience described, not served). A generic CTA pair, "Explore pools" (filled) and "How it's measured" (outline).                                                                                                                                                                                                                                                                 | CP2, CP5, tells 18, 26           |

## 3. Screen by screen

### 3.1 Home (`/`)

**First 3 seconds:** the eye bounces between a large slogan on the left and a box of four big numbers on the right, then drops into a table. Nothing says what is notable about Base's liquidity today.
- **No focal element.**
  - The 48 px H1 contains no data, and the board's four 32 px values (`6`, `$26.1M`, `$28.2M`, `82.4`) compete with it at nearly the same weight.
  - The board is the stat-tile hero: big number, small label, caption.
  - The only striking visual idea Depthwatch owns, two sides of a book, is absent from the page.
- **The board is 4 numbers with 4 captions** ("Pools with a health grade right now (of 6 tracked).", "Out of 100. Half the scored pools score higher."). The captions explain instead of compare: none says whether `$26.1M` is a lot.
- **"Biggest liquidity gaps" is mostly not gaps.**
  - Of 5 rows, 3 have gap scores of 0, 9 and 10, drawn as empty bar tracks.
  - The demo world has one real gap (USDC / AERO, 50.8×), and the table buries it among non-events with 30 numbers.
  - The rows carry a DEX chip plus a fee.
- **The scorecard cards are the loudest thing on the page.**
  - Each card stacks a status pill, a "synthetic" label, a 3-cell stat strip, a red/green barcode split into two rows, a caption with middle dots, a coloured badge and "Open scorecard →".
  - In light mode the saturated red of the demo mandate dominates the lower half.
- **"What we measure" is the four identical feature cards tell**, with decorative mono scales (`±1 · 2 · 5 %`, `top-1 · top-3 · HHI`). The same content is the Methodology table of contents.
- **Decoration.** The logo-glyph divider is repeated 3 times between sections.
- **Phone.** 3,564 px long. The H1 starts at about 200 px because of the chrome (R10). The board becomes a 2×2 grid of captioned cells. The gaps become 5 cards with 3 uppercase labels each.

### 3.2 Pools (`/pools`)

**First 3 seconds:** a row of five DEX boxes holding 20 small numbers, then a long search field, then a 9-column table, then the same gaps table again.
- **The DEX tiles come first and say little.**
  - Five tiles, each with three label/value rows ("Pools scored 1 / 1", "Depth ±2% $11.2M", "Median health A 88.2"), are 20 numbers of navigation chrome.
  - They double as a filter, but nothing about them looks like a control except the selected tile's bottom border.
  - On a phone they become a sideways carousel, cut mid-word.
- **The table shows every column at once:** pool, health, depth ±2 %, spread $10K, 24 h volume, gap, TVL, top LP and updated.
  - The pool cell adds up to two chips (DEX, "stable") plus the fee, and the grade is a third chip.
  - "Updated: just now" repeats on all 6 rows.
  - The table heading says "Top pools" while listing every pool.
- **Duplicate gaps table.** The same `GapsList` rendered at the bottom (6 rows × 6 numbers) repeats `/gaps`.
- **Controls.** A full-width (1,190 px) search box for 6 rows. On a phone, sort is a native `<select>` labelled "Sort".
- **Phone.** Each pool becomes a card with 4 uppercase labels: 24 labels for 6 pools before the duplicate gaps (18 more labels). The page is 2,150 px long.

### 3.3 Pool detail (`/pools/:id`)

**First 3 seconds:** a blue title, a line of seven metadata fragments, then eight equal stats, then bars. The question "is this pool deep enough, and on which side is it thin?" is answered in the right words, but in 13 px text under the chart.
- **The header has 8 stats of identical weight:**
  - price;
  - **inverse price** `0.0004065`;
  - TVL;
  - depth ±2 %;
  - spread $10K;
  - 24 h volume;
  - **gap score `0`**;
  - health.

  Two of these are noise for this pool.
- **The header meta line has 7 fragments:**
  - a DEX chip;
  - the DEX name;
  - fee;
  - tick spacing;
  - a mono contract link;
  - "snapshot just now";
  - "scored just now".

  The pair title is accent-blue because each token is a link, so the H1 reads as a hyperlink.
- **The depth chart is a ladder of separate bars**, not a depth curve.
  - It carries 12 permanent labels: USD plus token amounts with 2 decimals, or whole units (`14,335,396 USDC`).
  - It has mono axis ticks `$14.3M / $7.2M / 0`, an uppercase `MOVE` column header and a legend with middle dots.
  - The best sentence on the page, "It would take $6.1M of buying to lift WETH 2 % in this pool, or $5.1M of selling to push it 2 % down.", sits at the bottom in small grey text.
- **Six panels of equal size** in a 2-column grid (spread, health, concentration, persistence, history) read as a dashboard of tiles. None states a takeaway.
- **Spread.** Purple segmented bars (a third hue) beside `10.0 bps`, with `$1.0k` / `$10.0k` notional labels and buy and sell average prices that only a market maker needs.
- **Health.**
  - The panel shows `88.2 / 100` with a chip, then four black bars with fractions `35.0 / 35`, `24.7 / 25`, `9.4 / 20` and `19.1 / 20`.
  - That is 10 numbers for one score.
  - It does not say the one useful thing: "concentration is the weak part".
  - The `notes` the API returns are the explanations of caps, and they are not visible.
- **Concentration** is a 7-row key-value list with an uppercase `OWNERS` sub-label. "Range HHI 0.24" and "Owner HHI 0.38" appear with no reference point.
- **Persistence** is a 2-row table with six uppercase headers and `100.0%`.
- **History.** Dual y axes, `$0.00` and `0.0` floors, odd x ticks, a 2-series legend with "(USD, left)" and "(bps, right)", and 250 px of nearly flat lines.
- **Phone.** 2,668 px. The spread and persistence tables clip inside their panels, so the last columns are unreachable without discovering a sideways scroll. The 8 header stats become a 2-column grid of uppercase labels.

### 3.4 Gaps (`/gaps`)

**First 3 seconds:** a dense explanatory paragraph, then a clean table. This is v2's least bad list screen. It still fails to say the answer.
- **The lead is a 3-line paragraph** that includes the scoring formula ("gap score 0 at 1×, 50 at 10×, 100 at 100×"). That belongs in Methodology.
- **No signal/noise separation.** One pool has a real gap (score 85). The other five (scores 0–10) get identical rows with empty bar tracks. The page never states "1 pool trades more than 10× its depth".
- **The table has 9 columns**, including health chips (a peach `D`, green `A`s) that pull the eye away from the gap score, which is the subject.
- **Uppercase headers.** Below the table, about 30 % of the viewport is empty: the sparse state is not designed.

### 3.5 Scorecards list (`/mm`)

**First 3 seconds:** a four-line paragraph of methodology, then a red pill.
- **The lead runs 4 lines**, explaining mandates, samples and attribution. That is Methodology content.
- **10 columns for 2 rows:** scorecard, pool, status, uptime 24 h / 7 d / 30 d, MM depth up and down, spread and last sample.
  - Depth cells stack two numbers (`$7.7k` over `/ ≥ $50.0k`), coloured red.
  - The spread column says "no KPI".
- **Colour.** The filled red "Breached" pill is the most saturated element on the page. The status shape (◆) is good, but the fill is loud.
- **Repetition.** "Last sample: just now" on every row.

### 3.6 Scorecard detail (`/mm/:id`)

**First 3 seconds:** red everywhere. Three KPI cards with red left borders and red ✕ icons, then three uptime tiles with red bars, then a red/green barcode. The alarm is said about 10 times before the reader learns what the mandate is.
- **The header.**
  - The H1 carries the data's "Demo:" prefix.
  - A meta line holds 7 fragments, including "alerts after 3 samples · no webhook".
  - A mono address sits on its own line, then a notes paragraph.
  - A 4-stat strip shows "LP share · 1 holder", "49.2%", "$15.6k up · $15.9k down" and "breached × 8".
- **KPIs as cards inside a panel:**
  - three bordered cards;
  - each with an uppercase label, a red value, a target line with a middle dot, and a red ✕ chip.
- **Uptime as cards inside a panel:** three more cards, each with a 32 px percentage, a red bar with a target tick, and a caption ("target 95.0% · 4 of 12 samples within KPI"). Then a separate sentence about the target, then the barcode.
- **Samples chart.**
  - Bid and ask lines that nearly overlap.
  - A red dashed KPI line.
  - A `$0.00` floor and odd ticks (`18 Oct, 07:33`).
  - A second purple spread chart with "no spread KPI": a chart about a KPI that does not exist.
- **Recent breaches.**
  - 12 rows, each with two red chips ("depth up", "depth down"), so the chip appears 24 times.
  - USD with lowercase `k`, `318.1 bps`, and mono block numbers without grouping (`#52950000`).
  - The useful sentence "Breached for 8 consecutive samples since 14h ago" is a small red line above the table.
- **Worst excursions** is a second table that repeats the same kind of information.
- **Embed.**
  - Two full-width mono code blocks of localhost URLs with "Copy" buttons.
  - A sentence explaining what the badge says, "depthwatch | status · 7d uptime".
  - The badge preview itself is good (shields pattern).
- **Length.** 2,707 px on desktop and 4,273 px on a phone, the longest page after Methodology.

### 3.7 Token (`/tokens/:address`)

**First 3 seconds:** a header with three stats, then a 9-column table with 2 rows, then 40 % empty viewport.
- **The question goes unanswered.** The question is how liquid WETH is on Base, and where. There is no total depth for the token and no visual. The table is the whole page.
- **The header meta strip** lists name, mono address, "18 decimals" and "price updated just now". The stats are "USD PRICE", "PRICED VIA" (a pool cell with a DEX chip) and "POOLS SCORED 2 / 2 discovered".
- **The table shows every column for 2 rows.** "Updated: just now" appears twice.
- **The sparse state is not designed.** A token with 1–2 pools gives a page that looks broken.

### 3.8 Methodology (`/methodology`)

**First 3 seconds:** a sensible document. This is v2's best-composed page, and its content is the product's credibility.
- **The formulas dominate.**
  - Each section ends in a grey mono code block, the heaviest visual element in that section, before the reader has finished the prose.
  - The grade legend is a row of five coloured chips.
- **Template chrome.** The table of contents is headed with uppercase "ON THIS PAGE". The lead names repository files ("METRICS.md and SCORECARDS.md") in its first sentence.
- **Length.** 3,276 px on desktop and 4,483 px on a phone, with no way to collapse formulas.
- **Missing visuals.** A small diagram would explain depth or the weighted grade faster than prose, and there is none.

### 3.9 Global chrome (every page)

- **Demo banner.**
  - A full-width grey strip with `Demo data — synthetic Base world: every number comes from the real pipeline run over a simulated week.`
  - That is 99 characters with an em-dash label (tell 5).
  - It wraps to 2 lines on phones.
- **Header.**
  - The logo and nav are fine.
  - The freshness reads `● Block 52,950,000 · updated just now`: a status lamp, a middle dot, and "just now" frozen by the demo clock.
  - On phones it takes its own row.
- **Footer.** `Open source · no token · no custody · read-only` as a middle-dot slogan (tells 2 and 18), plus a repository link and "Data: Synthetic demo world" (the third mention of demo).
- **Page background.** A grey `--bg` (`#f3f4f6`) behind white bordered panels: the card-kit silhouette at 25 % zoom.

### 3.10 Dark theme

- **Canvas.** `#0b0e13` with `#12161d` panels and `#252b35` borders reads as the generic dark dashboard. Elevation comes from borders, not from a surface ladder.
- **Saturated status.** The green `#3fbf7f` and red barcodes glow against near-black and dominate every page that shows them.
- **Contrast.** `--faint #6d7585` measures 3.91:1 on the surface, below 4.5:1 (APCA Lc −28.6). `--muted` passes WCAG but sits at Lc −51.8, too low for 13–15 px body text ([type-a11y §6.3](research/type-a11y.md)).
- **The theme has no identity of its own.** It is the light theme with values swapped.

### 3.11 Phone, summarised

| Page             | v2 height (CSS px) | Screens at 844 |              v3 budget (P9) |
| ---------------- | -----------------: | -------------: | --------------------------: |
| Home             |              3,564 |            4.2 |                     ≤ 2,100 |
| Pools            |              2,150 |            2.5 |                     ≤ 1,600 |
| Pool detail      |              2,668 |            3.2 |                     ≤ 2,600 |
| Gaps             |              1,210 |            1.4 |                     ≤ 1,600 |
| Scorecard (AERO) |              4,273 |            5.1 |                     ≤ 2,600 |
| Token            |              1,033 |            1.2 |                     ≤ 1,600 |
| Methodology      |              4,483 |            5.3 | exempt (formulas collapsed) |

Other phone failures:
- Chrome takes about 172 px before content.
- Tables clip inside panels.
- Every card repeats uppercase labels.
- No focal element appears in the first viewport of any page.

## 4. First-viewport number counts (desktop 1440×900, approximate)

| Screen           |                    v2 | v3 budget (P2) |
| ---------------- | --------------------: | -------------: |
| Home             |                   ~22 |              7 |
| Pools            |                   ~70 |  3 + 2 per row |
| Pool detail      | ~50 (~90 on the page) |              8 |
| Gaps             |                   ~46 |  3 + 2 per row |
| Scorecards list  |                   ~20 |  3 + 2 per row |
| Scorecard detail |                   ~35 |              6 |
| Token            |                   ~22 |              6 |

## 5. What v2 got right (keep in v3)

These are real strengths. v3 must not lose them while removing the noise.
- **Honest data handling.**
  - Unknown values are "—", never 0.
  - Exhausted liquidity is marked.
  - "Not tracked" pools are labelled.
  - Persistence is null below 3 samples.
  - The demo world is disclosed.
- **Blue and orange for the two sides of the book.** Colour-blind-safe and not red/green. It becomes the v3 identity.
- **Plain-language takeaway sentences** already exist in two places:
  - the depth ladder's "It would take $6.1M of buying to lift WETH 2 %…";
  - the breach streak's "Breached for 8 consecutive samples since 14h ago".

  v3 promotes these from footnotes to headlines.
- **Tabular figures and right-aligned numeric columns.**
- **Status with redundant cues.** "◆ Breached" and "● OK" carry text and shape, not colour alone.
- **The shields-style badge.**
- **URL state** for search, sort, direction, DEX and active filter. Works under the static build's hash router.
- **No chart animation** (`isAnimationActive={false}`).
- **`keepPreviousData` on parameter changes.**
- **No page-level overflow** and no console errors on any route or width.
- **Methodology content.** Precise, reproducible, plain-spoken. It needs layout, not rewriting.
- **Accessible basics.** `header`, `nav`, `main` and `footer` landmarks, `aria-pressed` segmented buttons and `:focus-visible` rings. There is no skip link yet; `principles.md` A4 adds one.

## 6. What this means for v3

The problems are an editing problem before they are a styling problem. v3 therefore does three things in order:
1. **Decide each screen's single job and focal element** ([`ia-v3.md`](ia-v3.md)). The focal element is a depth signature or a ranked answer, under a sentence that states the number.
2. **Move everything else down a level.** It goes into sections with one visual and one takeaway each, then into "Details" disclosures and "About" lists. Nothing is deleted: §5 of `ia-v3.md` maps every v2 field to its new home.
3. **Apply the bar in [`principles.md`](principles.md):**
   - monochrome chrome;
   - colour only for data;
   - one self-hosted grotesk, large and light;
   - no boxes;
   - charts without defaults;
   - motion only where it explains.

   Every tell listed in §2 is forbidden there by name.
