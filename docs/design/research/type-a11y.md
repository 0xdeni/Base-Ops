# Typography, responsive layout and accessibility: research for Depthwatch v3

Scope: typefaces, type scale, numerals, responsive layout, touch targets, focus, contrast (WCAG 2.2 and APCA), dark-mode palettes, phone safe areas and mobile navigation. This complements [`product-ui.md`](./product-ui.md) (§2 has the Inter tracking formula and Apple/Vercel/Linear scales), [`data-ui.md`](./data-ui.md) (number formatting) and [`motion.md`](./motion.md) (focus timing). Where they overlap, this file gives the exact tokens.

**How the numbers were obtained (2026-10-24):**
- **[measured-font]** Upright font files were downloaded from [`google/fonts` @ main](https://github.com/google/fonts/tree/main/ofl). Each file was inspected with fontTools 4.67 for axes, x-height, default digit widths, GSUB features and coverage of `± × − → ↑ ≥ ≈ Δ` and the thin, figure and narrow no-break spaces.
- **[measured-render]** Specimens were rendered in Playwright Chromium from local TTFs: three sans specimen sheets and one mono sheet, plus a dark dashboard card set in 8 candidate faces. The renders are not kept in the repository.
- **[measured-contrast]** WCAG 2 ratios and APCA-W3 0.0.98G-4g Lc were computed with a script (self-test: black on white Lc 106.0 and 21:1). OKLCH was converted to sRGB with Björn Ottosson's matrices.
- **[measured-delivery]** The Google Fonts CSS2 API and Fontsource 5.3 were fetched, and the latin subset files they serve were inspected.
- **Fallback note.** On a Linux desktop where `fc-match system-ui` and `fc-match sans-serif` resolve to **Inter** and `monospace` to DejaVu Sans Mono (the fontconfig behind the renders above), any screenshot taken with the web font missing looks like Inter, the most generic default face, so a fallback render cannot be used to judge the chosen face. Check `document.fonts` status before trusting a screenshot.

---

## 0. Rules that matter most

1. **Choose one sans family for words and numbers, and a mono face only for on-chain identifiers.** Recommended: **Hanken Grotesk** (variable 100–900) with **IBM Plex Mono** 400/500 (§1.5). Do not use Inter, Geist, Space Grotesk, DM Sans, Plus Jakarta Sans or Manrope as the visible voice (§1.4).
2. **Self-host a custom subset; never ship the Google Fonts or Fontsource latin subset.** Those subsets strip `zero`, `case`, `ss*` and `cv*`, and they drop `→` and `≥` [measured-delivery] (§1.6).
3. **Use tabular figures in every column and KPI, right-align them, and keep the same decimals down a column** ([MDN font-variant-numeric](https://developer.mozilla.org/docs/Web/CSS/font-variant-numeric); [data-ui.md §3](./data-ui.md)). DM Sans has **no tabular figures at all** [measured-font].
4. **Type floor is 12 px.** Use 12/13/14/15(16 on phones)/16/18 px fixed steps, plus fluid h2, h1, KPI and display (§2.1). Avoid the Tailwind default scale 12/14/16/18/24/30/36/48/60/72, which marks a page that took the framework default.
5. **Fluid type uses `clamp(rem, rem + vw, rem)` with max ≤ 2.5 × min.** Above that ratio, 500% zoom cannot reach 2× (WCAG 1.4.4) ([utopia-core `checkWCAG`](https://github.com/trys/utopia-core/blob/main/src/index.ts), after Maxwell Barvian).
6. **Line-height:** 1.33–1.43 for UI text, 1.5–1.63 for reading text, 1.15–1.25 for headings and 1.04–1.05 for display and KPIs. Snap all line-heights to a 2 px grid (§2.1).
7. **Measure:** prose at most 66ch (45–75; WCAG 1.4.8 allows at most 80), lead text at most 56ch and display at most 18ch, with `text-wrap: balance` on headings ([Viget](https://www.viget.com/articles/the-line-length-misconception); [WCAG 1.4.8](https://github.com/w3c/wcag/blob/main/guidelines/sc/20/visual-presentation.html)).
8. **Breakpoints:** `min-width` 600 / 840 / 1200 / 1600 px, authored in em. Gutters are 16 / 24 / 32 px plus `env(safe-area-inset-*)` ([Android window classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)).
9. **Reflow at 320 CSS px:** no 2-D scrolling except inside data tables ([WCAG 1.4.10](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/reflow.html)).
10. **Targets:** at least 24×24 CSS px everywhere (WCAG 2.5.8 AA) and at least 44×44 under `(pointer: coarse)`, with 8 px between targets ([Apple](https://developer.apple.com/design/human-interface-guidelines/accessibility); [WCAG 2.5.5](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/target-size-enhanced.html); [Google](https://support.google.com/accessibility/android/answer/7101858)).
11. **Focus:** `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`. The ring must reach at least 3:1 against the adjacent colour; that meets WCAG 2.4.13 AAA. Set `scroll-padding-top` to the sticky header height plus 8 px (WCAG 2.4.11).
12. **Contrast tiers, as WCAG and APCA together:**

    | Tier                                                | WCAG    | APCA        |
    | --------------------------------------------------- | ------- | ----------- |
    | text-1                                              | ≥ 15:1  | \|Lc\| ≥ 95 |
    | text-2 (body, table cells, essential labels)        | ≥ 7:1   | \|Lc\| ≥ 75 |
    | text-3 (non-essential metadata, ≥ 13 px / 500 only) | ≥ 4.5:1 | \|Lc\| ≥ 55 |
    | Control borders                                     | ≥ 3:1   | —           |

    In v2, `--faint` fails in both themes (§6.3).
13. **Rich dark mode:**
    - Base everything on a hue-tinted neutral at OKLCH chroma 0.018–0.021 and hue 264.
    - Show elevation by lightness: canvas L\* 6, card 9, raised 12, overlay 16 (Material dark tones 4/6/10/12/17/22), never by shadows.
    - Text is never pure white.
    - Accents get lighter and less saturated in dark (§7).
14. **Phones:** `viewport-fit=cover`, `max(16px, env(safe-area-inset-left/right))` gutters, `calc(8px + env(safe-area-inset-bottom))` under anything fixed, and `100dvh` and `100svh` instead of `100vh` (§8).
15. **Mobile nav:** a visible top tab strip with the 4 destinations, not a hamburger, and no fixed bottom tab bar in the Safari tab. Use a bottom bar only in `display-mode: standalone`. Use sheets only for secondary controls (§9).
16. **Remove the v2 typographic "template chrome":**
    - ALL-CAPS tracked labels.
    - `A · B · C` meta strings.
    - `Word — fragment` labels.
    - Mono for small labels.
    - `→` appended to link text.

    All five are template chrome: default patterns that appear whatever the subject ([product-ui.md §11](./product-ui.md)).

---

## 1. Typefaces

### 1.1 Observed in the v2 dashboard

- **Faces.** Archivo (wdth 85–100) is paired with JetBrains Mono (`apps/web/index.html`). The face itself is acceptable: it has tnum, zero, case and onum [measured-font]. In the mock it reads wide and soft, and close to Inter at UI sizes [measured-render].
- **The problem is the treatment, not the file.** v2 shows these template defaults:
  - Uppercase tracked micro-labels: `24H VOLUME`, `ALL SCORED POOLS`, `DEPTH ±2%`.
  - Mono used for decoration: `±1 · 2 · 5 %` and `top-1 · top-3 · HHI` on the home cards.
  - Middle-dot meta strings: `Open source · no token · no custody · read-only`.
  - An em-dash label: `Demo data — synthetic…`.
  - `→` appended to every link: `All gaps →`, `Open scorecard →`.

  These are template chrome: patterns that appear whatever the subject ([product-ui.md §11](./product-ui.md)).
- **Body sizes are too uniform.** About 13–15 px is used everywhere, with 600-weight headings and many small paragraphs, so nothing anchors the eye. Weight inflation is a known tell: semibold on body-sized text leaves headings nothing to be heavier than.

### 1.2 Measured comparison (Google Fonts builds, upright) [measured-font]

Column key:
- **x/UPM**: x-height as a fraction of the em.
- **Digits**: the default figure width (T = tabular by default, P = proportional by default), then the width of the tabular zero in em.
- **tnum / zero / case**: whether the GSUB feature exists in the full font.
- **Missing**: which of the glyphs Depthwatch uses are absent.

| Family                | Axes on GF                                 | x/UPM | Digits        |         tnum         | zero                                        | case | Missing glyphs (of ± × − → ↑ ≥ ≈ Δ, thin/figure/NNBSP) | Default-face risk                                  |
| --------------------- | ------------------------------------------ | ----: | ------------- | :------------------: | ------------------------------------------- | :--: | ------------------------------------------------------ | -------------------------------------------------- |
| Inter 4.001           | opsz 14–32, wght 100–900                   | 0.546 | P / 0.648     |          ✓           | ✓                                           |  ✓   | none                                                   | **highest**                                        |
| Inter Tight 3.004     | wght 100–900                               | 0.546 | P / 0.601     |          ✓           | ✓                                           |  ✓   | none                                                   | high                                               |
| Geist 1.800           | wght 100–900                               | 0.530 | P / 0.600     |          ✓           | – (ss09 alt numbers)                        |  ✓   | thin/fig/NNBSP, Δ                                      | **highest** (create-next-app, shadcn)              |
| Manrope 4.505         | wght 200–800                               | 0.540 | P / 0.620     |          ✓           | –                                           |  ✓   | thin/fig/NNBSP                                         | high (web3 landing default, observation)           |
| Figtree 2.002         | wght 300–900                               | 0.500 | P / 0.620     |          ✓           | –                                           |  ✓   | thin/fig/NNBSP, ≈, Δ                                   | medium                                             |
| Onest 2.001           | wght 100–900                               | 0.527 | P / 0.672     |          ✓           | –                                           |  ✓   | figure space, Δ                                        | low                                                |
| Instrument Sans 1.000 | wdth 75–100, wght 400–700                  | 0.510 | P / 0.600     |          ✓           | –                                           |  ✓   | **±, ≥**, ≈, Δ, thin/fig/NNBSP, no `frac`              | medium (Instrument Serif trend)                    |
| Hanken Grotesk 3.013  | wght 100–900                               | 0.493 | **T** / 0.560 | n/a (always tabular) | –                                           |  ✓   | ↑, thin/fig/NNBSP                                      | **low**                                            |
| Schibsted Grotesk 1.1 | wght 400–900                               | 0.527 | P / 0.635     |          ✓           | ✓                                           |  ✓   | thin/fig/NNBSP                                         | low                                                |
| IBM Plex Sans 3.201   | wdth 75–100, wght 100–700                  | 0.516 | **T** / 0.600 |         n/a          | ✓ (ss03/ss04)                               |  –   | none                                                   | medium (a common "technical" pick)                 |
| Space Grotesk 2.000   | wght 300–700                               | 0.486 | P / 0.620     |          ✓           | ✓                                           |  ✓   | NNBSP                                                  | **highest** (a convergent pick on templated pages) |
| DM Sans 4.004         | opsz 9–40, wght 100–1000                   | 0.526 | P only        |        **✗**         | –                                           |  ✓   | thin/fig/NNBSP, Δ                                      | high                                               |
| Familjen Grotesk 2.0  | wght 400–700                               | 0.500 | **T** / 0.567 |          ✓           | ✓                                           |  ✓   | NNBSP, Δ                                               | low                                                |
| Archivo 2.001 (v2)    | wdth 62–125, wght 100–900                  | 0.526 | P / 0.579     |          ✓           | ✓                                           |  ✓   | fig/NNBSP                                              | low                                                |
| Mona Sans 2.000       | wdth 75–125, wght 200–900                  | 0.517 | P / 0.600     |          ✓           | – (tnum zero is slashed; ss08 straight bar) |  ✓   | thin/fig/NNBSP, Δ                                      | low–medium                                         |
| Host Grotesk 1.003    | wght 300–800                               | 0.496 | **T** / 0.650 |          –           | –                                           |  ✓   | fig/NNBSP, Δ                                           | low                                                |
| Google Sans Flex 5.0  | opsz 1–144, wdth 25–151, wght 1–1000, ROND | 0.510 | P / 0.645     |          ✓           | ✓                                           |  –   | **→, ↑**, figure space, Δ                              | reads as Google                                    |
| Funnel Sans           | wght 300–800                               | 0.500 | T / 0.550     |          ✓           | –                                           |  ✓   | **→ ↑ ≥ ≈** and others                                 | low                                                |

Mono faces:

| Mono                 | Axes                      | Zero default                          | Notes                                                                                                                                           |
| -------------------- | ------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Geist Mono 1.701     | wght 100–900              | slashed (`ss09` = plain)              | create-next-app default ([template](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/app-tw/ts/app/layout.tsx)) |
| JetBrains Mono 2.211 | wght 100–800              | `zero` feature                        | x-height 0.550, loud at small sizes; the common "code aesthetic" pick                                                                          |
| IBM Plex Mono 2.3    | static 100–700            | dotted (`zero` = slashed, ss04 plain) | humanist, quiet; 14.4 KB per weight subset                                                                                                      |
| DM Mono              | static 300/400/500        | slashed                               | missing → ↑ Δ                                                                                                                                   |
| Martian Mono         | wdth 75–112, wght 100–800 | –                                     | very wide (0.75 em digits)                                                                                                                      |
| Fragment Mono        | Regular only              | `zero`                                | Helvetica-based; one weight                                                                                                                     |
| Azeret Mono          | wght 100–900              | `zero`                                | geometric; zero reads like O                                                                                                                    |

Behaviour notes from the render [measured-render]:
- **Schibsted Grotesk's `tnum` also tabularises `.` and `,`.** `$1.60M` renders as `$1 .60M`, and `$28.2M` at 56 px shows gaps [measured-render]. Use it only with `pnum` outside aligned columns.
- **Mona Sans's tabular zero is slashed by default** (`0.05%` in a tnum cell). Prose zeros are plain.
- **Inter with `cv11` (single-storey a) and `ss01` (open digits) gives the most "Linear-like" result.** At 32 px the opsz display cut engages automatically, because `font-optical-sizing: auto` is the default ([Inter docs](https://github.com/rsms/inter/blob/master/docs/index.html); Linear moved headings to Inter Display, [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- **Hanken Grotesk is the quietest, most editorial grotesque here.** Its digits are 14% narrower than Inter's tabular figures (0.560 against 0.648 em), so columns are denser at the same point size. Its lower x-height (0.493 against 0.546) reads less like a UI kit, but it needs 14 px or more for table text.

### 1.3 Character, in one line each

- **Inter.** Neutral, tall x-height, the most complete feature set (opsz, cv01–cv14, ss01–ss08, zero, case). It is the most-used face on templated pages and the fallback of most scaffolds. Recognised instantly.
- **Inter Tight.** Inter spaced for display. Same recognition problem.
- **Geist.** Geometric, Swiss-derived. Its README says it is "designed to be used in headlines, logos, posters, and other large display sizes" ([geist-font](https://github.com/vercel/geist-font)). It is the default of `create-next-app` and of the shadcn/ui site ([template](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/app-tw/ts/app/layout.tsx), [shadcn fonts.ts](https://github.com/shadcn-ui/ui/blob/main/apps/v4/lib/fonts.ts)).
- **Manrope.** Semi-geometric with wide `$` and rounded terminals. No slashed zero and no stylistic sets.
- **Figtree.** Friendly geometric. Too casual for a measurement product.
- **Onest.** Soft and rounded. Wide digits (0.672 em) waste table width.
- **Instrument Sans.** An elegant neo-grotesque with 12 stylistic sets, but it lacks ± and ≥ (fatal for "±2 %" and "≥ $50k").
- **Hanken Grotesk.** Classic grotesque, calm, tabular by default with 100–900 weights. "Inspired by the classic grotesques … for … Interface, Websites and Mobile Applications" ([GF description](https://github.com/google/fonts/blob/main/ofl/hankengrotesk/DESCRIPTION.en_us.html)).
- **Schibsted Grotesk.** A "digital-first font family crafted for user interfaces" ([GF description](https://github.com/google/fonts/blob/main/ofl/schibstedgrotesk/DESCRIPTION.en_us.html)). Newsroom authority, no weights below 400, and tnum punctuation is wide.
- **IBM Plex Sans.** Engineered and slightly mechanical. Full coverage, tabular by default and condensed widths. Reads as "IBM / terminal", and it is a common "technical" pick, so it is becoming a second-order default.
- **Space Grotesk.** Quirky, derived from Space Mono. A convergent choice on generated and templated pages, so it reads as a default.
- **DM Sans.** Geometric with an opsz axis, but **no tabular figures**; `tabular-nums` does nothing [measured-font]. Disqualified for data.
- **Familjen Grotesk.** Ink traps and closed apertures ([GF description](https://github.com/google/fonts/blob/main/ofl/familjengrotesk/DESCRIPTION.en_us.html)). Characterful, but only 400–700, and the ink traps get noisy in dense tables.
- **Mona Sans.** GitHub's "strong and versatile typeface … inspired by industrial-era grotesques" with width, weight and slant axes ([GitHub blog](https://github.blog/news-insights/company-news/introducing-mona-sans-and-hubot-sans/)). Strong voice, recognisable from github.com, and the wdth+wght subset weighs 118 KB.

### 1.4 Overused default choices (avoid as the visible voice)

| Face                                    | Evidence                                                                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inter, Roboto, Arial, system fonts      | The defaults of browsers, operating systems and most scaffolds, and therefore the most used faces on templated pages.                                                      |
| Geist + Geist Mono                      | Scaffolded by `create-next-app` and the shadcn/ui site (links above), so a page set in untouched Geist reads as a Next.js default.                                          |
| Space Grotesk, JetBrains Mono, IBM Plex | Convergent "code aesthetic" and "technical" picks, now second-order defaults.                                                                                               |
| Plus Jakarta Sans                       | A frequent default of landing-page templates.                                                                                                                              |
| Serif display plus mono labels          | A high-contrast serif display face paired with a monospace face for small data labels is a second-order default ([product-ui.md §11](./product-ui.md), SD3).               |

Caveat: the tell is a default that nobody chose, not the face itself ([product-ui.md §2.1](./product-ui.md)). Linear uses Inter. Even so, Depthwatch should not lead with any face in this table.

### 1.5 Recommended pairings for Depthwatch

| Option                                                                       | Roles                                                                                                                                                   | Why                                                                                                                                                                                                                                                                                               | Cost                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A (recommended): Hanken Grotesk + IBM Plex Mono**                          | Hanken for every word and number, including display and KPIs. Plex Mono 400/500 **only** for addresses, tx hashes, block numbers and the badge snippet. | Calm, editorial grotesque that is rarely seen in templated UIs. Digits are always tabular and compact (0.560 em). Weights 100–900 allow "large and light" KPIs (400–500 at 40 px), which [data-ui.md §3](./data-ui.md) says look expensive. Plex Mono's dotted or slashed zero disambiguates hex. | No proportional figures (fine for a data product). No `zero`. x-height 0.493, so the data floor is 14 px. Missing `↑` and the thin/figure/NNBSP spaces; use U+00A0. About 64 KB of woff2 in total. |
| **B (more voice): Mona Sans + IBM Plex Mono**                                | Mona Sans wdth 100 for UI, wdth 108–112 at 500 for the home display line only, and wdth 90 for dense table headers if needed.                           | One family with real range (width + weight). Industrial-grotesque confidence. The tabular zero is slashed out of the box.                                                                                                                                                                         | Recognisable from GitHub. The 118 KB variable subset needs instancing to wdth 90–112.                                                                                                              |
| **C (maximum capability, highest default-face risk): Inter + IBM Plex Mono** | Inter Variable with `opsz` (Display cut ≥ 32 px automatically) and `font-feature-settings: "cv11", "ss01"` or `"ss02"`.                                 | Most complete feature set and coverage. The Linear-proven approach.                                                                                                                                                                                                                               | Instantly read as default unless the alternates, display cut and tracking are all deliberate. Must be self-hosted to keep the cv/ss features. About 93 KB.                                         |

Do not use: DM Sans (no tnum), Instrument Sans (no ± ≥), Space Grotesk, Geist, a serif display, mono for labels, or more than two families.

### 1.6 Delivery: the subset problem (important)

- **Google Fonts and Fontsource latin subsets strip features.** The latin woff2 served by the CSS2 API to Chrome 130 keeps only these features [measured-delivery]:

  | Family            | Features kept in the GF latin subset        |
  | ----------------- | ------------------------------------------- |
  | Inter             | `calt ccmp dnom frac locl numr pnum tnum`   |
  | Geist             | `ccmp dnom frac liga locl numr pnum tnum`   |
  | IBM Plex Sans     | `ccmp dnom frac liga numr rvrn` (no `zero`) |
  | Hanken Grotesk    | `ccmp dnom frac liga locl numr`             |
  | JetBrains Mono    | `calt ccmp frac locl` (no `zero`)           |
  | Geist Mono        | `ccmp dnom frac locl numr` (no ss09)        |
  | Schibsted Grotesk | `ccmp dnom frac liga locl numr pnum tnum`   |

  `@fontsource-variable/inter` 5.3.0 ships the same 8 features. As a result, `slashed-zero`, `case`, `ss01`, `cv11` and every other stylistic set silently do nothing.
- **The latin `unicode-range` omits U+2192 (→) and U+2265 (≥).** No subset of Inter on Google Fonts covers them, so they render in a fallback face. v2 uses both.
- **Fix: self-host one subset per face built from the `google/fonts` TTF (OFL).** Use:

  `pyftsubset Face.ttf --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+2248,U+2264-2265,U+25B2,U+25BC" --layout-features='kern,liga,calt,ccmp,locl,mark,mkmk,tnum,pnum,lnum,zero,case,frac,numr,dnom,sups,ss01,ss02,ss03,ss04,ss08' --flavor=woff2`

  Measured sizes:

  | Subset                    | Size     | Compared with the GF latin subset |
  | ------------------------- | -------- | --------------------------------- |
  | Hanken Grotesk variable   | 35.7 KB  | GF 34.7 KB                        |
  | IBM Plex Mono, per weight | 14.4 KB  | —                                 |
  | Inter opsz+wght           | 92.9 KB  | GF 73.0 KB                        |
  | Geist                     | 29.8 KB  | —                                 |
  | Mona Sans wdth+wght       | 117.8 KB | —                                 |

  Removing the Google Fonts `<link>` also removes the third-party request and makes CI screenshots deterministic.
- **Loading.** `<link rel="preload" as="font" type="font/woff2" crossorigin>` the sans file only. Use `font-display: swap` with a metric-matched fallback `@font-face` (`src: local("Arial")` plus `size-adjust`, `ascent-override` and `descent-override`, computed with Capsize or Fontaine) so the swap does not shift layout ([Chrome: framework tools for font fallback](https://developer.chrome.com/blog/framework-tools-font-fallback/)). Browser support:

  | Descriptor        | Chrome | Firefox | Safari       |
  | ----------------- | ------ | ------- | ------------ |
  | `size-adjust`     | 92     | 92      | 17           |
  | `ascent-override` | 87     | 89      | preview only |

  Source: [MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/font-face.json). Safari will therefore get only the size match.
- **Fallback stacks:** `--sans: "Hanken Grotesk", "Hanken Fallback", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`; `--mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

### 1.7 Numerals and symbols

- **Tabular figures.** Turn on `font-variant-numeric: tabular-nums` on `td`, KPI values, axes and timers. Right-align numeric columns and keep the same decimals per column ([data-ui.md §3](./data-ui.md); [MDN](https://developer.mozilla.org/docs/Web/CSS/font-variant-numeric)). Only about 16% of web fonts ship both tabular and proportional sets (Web Almanac via [wpDataTables](https://wpdatatables.com/best-fonts-for-tables/)), so verify with fontTools; do not assume.
- **Proportional figures.** Use them in prose and in a lone display number only when the face has `pnum` (Inter, Geist, Schibsted). Hanken and Plex are tabular-only.
- **Slashed zero.** Use it only in the mono face, for hex and hashes. In sans numbers it adds noise.
- **Characters.**
  - True minus `−` (U+2212), not a hyphen.
  - Multiplication sign `×` for turnover.
  - `≥` and `±` as real glyphs.
  - No-break space between number and unit (`2 %`, `10 bps`), per [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines).
  - Never a trailing `→` on link text (§0 rule 16). Use an icon with `aria-hidden` and a gap, or nothing.
- **All caps.** If a cap-height context is ever needed, `font-feature-settings: "case"` raises hyphens and parentheses (Hanken, Inter, Geist and Schibsted have it; Plex does not). Prefer sentence case everywhere.

---

## 2. Type scale and text layout

### 2.1 Tokens (root `font-size: 100%`; px shown for clarity; author in rem)

| Token         | Size px (rem)                                            | Line-height    | Weight                        | Tracking | Use                                                            |
| ------------- | -------------------------------------------------------- | -------------- | ----------------------------- | -------- | -------------------------------------------------------------- |
| `--t-caption` | 12 (0.75)                                                | 16 (1.333)     | 500                           | +0.01em  | Table headers, chart ticks, badges, timestamps. Sentence case. |
| `--t-small`   | 13 (0.8125)                                              | 18 (1.385)     | 400                           | +0.005em | Secondary metadata, footnotes, helper text                     |
| `--t-data`    | 14 (0.875)                                               | 20 (1.429)     | 400 (cells), 500 (pool names) | 0        | Table cells, nav links, buttons, inputs ≥ 600 px               |
| `--t-body`    | 15 (0.9375) at ≥ 600 px; **16 (1) below 600 px**         | 24 (1.6 / 1.5) | 400                           | −0.003em | UI copy, card descriptions                                     |
| `--t-prose`   | 16 (1)                                                   | 26 (1.625)     | 400                           | 0        | Methodology long-form                                          |
| `--t-lead`    | 18 (1.125)                                               | 28 (1.556)     | 400                           | −0.01em  | Page intro, one paragraph                                      |
| `--t-title`   | 16 (1)                                                   | 22 (1.375)     | 600                           | −0.008em | Card and panel titles                                          |
| `--t-h2`      | `clamp(1.25rem, 1.152rem + 0.4348vw, 1.5rem)` (20→24)    | 1.25           | 600                           | −0.015em | Section headings                                               |
| `--t-h1`      | `clamp(1.625rem, 1.429rem + 0.8696vw, 2.125rem)` (26→34) | 1.15           | 600                           | −0.02em  | Page titles                                                    |
| `--t-kpi`     | `clamp(1.75rem, 1.457rem + 1.304vw, 2.5rem)` (28→40)     | 1.05           | 400–500                       | −0.025em | KPI values, tabular figures                                    |
| `--t-display` | `clamp(2.25rem, 1.761rem + 2.174vw, 3.5rem)` (36→56)     | 1.04           | 500 (600 maximum)             | −0.03em  | Home hero line only, at most 18ch                              |
- **Fluid interpolation.** Clamps interpolate between 360 and 1280 px viewports. All max/min ratios are 1.20–1.56, and none fails the 1.4.4 zoom check [measured with a port of `checkWCAG`]. Counter-example: 16→48 px (ratio 3.0) fails between 1050 and 2260 px.
- **Sizes and floor.** Steps are 12/13/14/15/16/18, then fluid 20–24/26–34/28–40/36–56. That is a hand-tuned ratio of about 1.08 at the small end and about 1.25 at the top (Refactoring UI's advice: hand-picked, not a strict ratio; [product-ui.md §2.2](./product-ui.md)). The floor is 12 px, above Apple's iOS minimum of 11 pt; iOS default body is 17 pt and macOS body is 13 pt ([Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).
- **Weights.**
  - Four weights: 400, 500 and 600, plus 400–500 for large numbers.
  - No 700+ except the grade letter.
  - Weight never changes on hover or selection ([product-ui.md §2.2](./product-ui.md)).
  - Large and light beats bold for figures ([data-ui.md](./data-ui.md), from Uniswap's `fonts.ts`).
- **Letter-spacing.** Use the size table in [product-ui.md §2.3](./product-ui.md): 12–16 px gets 0 to −0.01em, 20–28 px gets −0.015 to −0.025em, and 32 px and up gets −0.02 to −0.04em. Uniswap's production values, −2% at 52 px, −1% at 36 px and −0.5% at 24 px ([data-ui.md](./data-ui.md)), cross-check the display rows. For a low-x-height face like Hanken, stay at the loose end of each range, then tune by eye in ±0.005em steps.
- **ALL-CAPS.** If ever unavoidable: 11–12 px, +0.06em, `font-feature-settings: "case"`.
- **Text-spacing robustness (WCAG 1.4.12 AA).** Layouts must survive line-height 1.5×, paragraph spacing 2×, letter-spacing 0.12em and word-spacing 0.16em with no clipping ([SC 1.4.12](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/text-spacing.html)). So: no fixed heights on text containers; buttons use `min-height`, not `height`.
- **Wrapping.**
  - `text-wrap: balance` on h1–h3 and the display line. It applies to ≤ 6 lines in Chromium and ≤ 10 in Firefox. Support for the shorthand: Chrome 114, Firefox 121, Safari 17.5.
  - `text-wrap: pretty` on prose. Support: Chrome 117 and Safari 26; Firefox has none, and falls back harmlessly.
  - Sources: [MDN](https://developer.mozilla.org/docs/Web/CSS/text-wrap-style), [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/text-wrap.json).
- **Optical vertical centring in buttons and badges.** `text-box: trim-both cap alphabetic` (Chrome 133, Firefox 154, Safari 18.2; [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/text-box-trim.json)) removes the extra space above the cap height. Keep the padding values working without it.

### 2.2 Measure

| Text                | Max width                                              | Source                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prose (methodology) | 66ch (45–75)                                           | Bringhurst's 45–75, with 66 as the ideal, via [Viget](https://www.viget.com/articles/the-line-length-misconception). AAA limit 80 characters ([WCAG 1.4.8](https://github.com/w3c/wcag/blob/main/guidelines/sc/20/visual-presentation.html)).                                                                                                                             |
| Lead / intro        | 56ch                                                   | Shorter lines for larger text ([product-ui.md §2.4](./product-ui.md))                                                                                                                                                                                                                                                                                                                            |
| Card description    | 48ch                                                   | Two lines at most on desktop cards                                                                                                                                                                                                                                                                                                                                                               |
| Display / h1        | 18ch / 24ch                                            | With `text-wrap: balance`                                                                                                                                                                                                                                                                                                                                                                        |
| Table cell text     | No wrap, truncate with a full-value `title` or tooltip | Hover content must be dismissible, hoverable and persistent ([WCAG 1.4.13](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/content-on-hover-or-focus.html))                                                                                                                                                                                                                               |

Never justify text (WCAG 1.4.8).

---

## 3. Responsive layout

| Range (min-width, author in em)       | Name        | Columns | Gutter (side padding)                        | Column gap | Notes                                                                                                                                                |
| ------------------------------------- | ----------- | ------: | -------------------------------------------- | ---------: | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 (test 320, 360, 375, 390, 412, 430) | compact     |       4 | `max(16px, env(safe-area-inset-left/right))` |   12–16 px | Covers 99.96% of phones in portrait (<600 dp) ([Android](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)) |
| 37.5em (600)                          | medium      |       8 | 24 px                                        |      16 px | Tablets in portrait (93.73%)                                                                                                                         |
| 52.5em (840)                          | expanded    |      12 | 24 px                                        |      24 px | Tablets in landscape (97.22%); side-by-side panels start here                                                                                        |
| 75em (1200)                           | large       |      12 | 32 px                                        |      24 px | Desktop; content max-width 1200–1280 px                                                                                                              |
| 100em (1600)                          | extra-large |      12 | 32 px, centred                               |      32 px | Do not stretch tables; cap at 1280 px                                                                                                                |
- **Author media queries in `em`.** Then breakpoints move with the user's default font size and zoom. v2 currently mixes 379/399/639/1023/1279 px; consolidate it to these four.
- **Use container queries for components.** Card, KPI strip and table switch on their own width (`@container`; Chrome 105, Firefox 110, Safari 16; [BCD](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/container.json)), so a component behaves the same in a sidebar and in the main column.
- **Reflow (1.4.10 AA).** At 320 CSS px, which equals 1280 px at 400% zoom, nothing scrolls in two dimensions except "data tables (not individual cells)" ([SC 1.4.10](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/reflow.html)). Tables may scroll horizontally inside their own wrapper; the page must not.
- **Tables on phones (our rule).** At most 3 data columns per row below 600 px: pool, the one metric the page is about, and grade. Other columns go behind a row tap (detail) or a "Columns" sheet. If a table must scroll, make the first column sticky and add a visible edge fade. Row hit height is at least 48 px on coarse pointers.
- **Zoom.** Never disable zoom. MDN says "WCAG requires a minimum of 2× scaling; however, the best practice is to enable a 5× zoom" ([MDN viewport meta](https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/meta/name/viewport)). Reject Vercel WIG's `maximum-scale=1` option; use 16 px inputs instead ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- **Viewport check.** Apple allows people to "enlarge text by at least 200 percent" ([Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)). Test at 200% browser zoom on 1280 px and at 320 px.

---

## 4. Touch targets and pointer

| Rule                                                                                                          | Number                                                                                         | Source                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every pointer target                                                                                          | ≥ 24×24 CSS px, or undersized targets spaced so 24 px circles centred on them do not intersect | [WCAG 2.5.8 AA](https://github.com/w3c/wcag/blob/main/guidelines/sc/22/target-size-minimum.html)                                                                                                                                                                                       |
| Coarse pointer (`@media (pointer: coarse)`)                                                                   | ≥ 44×44 CSS px hit area                                                                        | [WCAG 2.5.5 AAA](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/target-size-enhanced.html); Apple iOS default 44×44 pt, minimum 28×28 ([Apple](https://developer.apple.com/design/human-interface-guidelines/accessibility)); Vercel WIG "On mobile, the minimum size is 44px" |
| Primary nav items on phones                                                                                   | 48 px tall, ≥ 8 px apart                                                                       | Google: 48 dp (≈ 9 mm) with 8 dp spacing ([Android a11y](https://support.google.com/accessibility/android/answer/7101858))                                                                                                                                                             |
| Spacing around targets                                                                                        | About 12 px around bezelled controls, about 24 px around bezel-less ones                       | [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)                                                                                                                                                                                     |
| Visual can be smaller than the hit area                                                                       | e.g. a 32 px icon button with an `::after { inset: -6px }` hit area                            | "if the visual target is < 24px, expand its hit target to ≥ 24px" ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines))                                                                                                                                              |
| Clickable table rows                                                                                          | 44 px (fine pointer, 14/20 text plus 12 px padding) or 36 px compact; ≥ 48 px coarse           | Our rule from the above                                                                                                                                                                                                                                                                |
| Mobile inputs                                                                                                 | `font-size` ≥ 16 px                                                                            | Prevents iOS auto-zoom ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines))                                                                                                                                                                                         |
| `touch-action: manipulation` on controls; own `:active` state with `-webkit-tap-highlight-color: transparent` | —                                                                                              | [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)                                                                                                                                                                                                                  |
| Thumb reach                                                                                                   | 49% of observed users held the phone one-handed (n = 780 touching the screen)                  | [Hoober, UXmatters 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)                                                                                                                                                                    |

---

## 5. Focus-visible

- **Base ring:** `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }`.
  - Use `:focus-visible`, not `:focus` ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Support: Chrome 86, Firefox 85, Safari 15.4.
  - The outline follows `border-radius` from Chrome 94, Firefox 88 and Safari 16.4 ([BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/outline.json)), so no box-shadow hack is needed.
- **Size and contrast (WCAG 2.4.13 AAA).** The indicator area must be at least a 2 CSS px perimeter of the component and reach at least 3:1 between focused and unfocused pixels ([SC 2.4.13](https://github.com/w3c/wcag/blob/main/guidelines/sc/22/focus-appearance.html)). A 2 px solid outline in a colour that is at least 3:1 against the canvas meets it.
  - Our tokens: dark `#8fcdff` on canvas `#0e131c` is 10.94:1. Light `#1f5ed9` on `#f8f9fc` is 5.45:1 [measured-contrast].
  - Ring and accent may share a hue, but the ring is lighter in dark mode.
- **Two-tone ring** for focus on coloured fills (grade chips, status badges, chart marks): `outline: 2px solid var(--focus)` plus `box-shadow: 0 0 0 4px var(--canvas)`. If the two colours are at least 9:1 apart, one of them is guaranteed 3:1 against any solid background ([WCAG technique C40](https://github.com/w3c/wcag/blob/main/techniques/css/C40.html)).
- **Never rely on box-shadow alone,** because forced-colours modes suppress it. When box-shadow is required, add `outline: 2px solid transparent` (C40). `forced-colors` support: Chrome 89, Firefox 89, Safari 16.
- **Clipped containers.** Inside `overflow: hidden` or `auto` containers (table wrapper, horizontal tab strip), use `outline-offset: -2px` so the ring is not cut.
- **Not obscured (WCAG 2.4.11 AA).** A focused element must not be entirely hidden by author content ([SC 2.4.11](https://github.com/w3c/wcag/blob/main/guidelines/sc/22/focus-not-obscured-minimum.html)). Set `html { scroll-padding-top: calc(var(--header-h) + 8px); scroll-padding-bottom: calc(var(--bottom-bar-h, 0px) + env(safe-area-inset-bottom) + 8px) }`.
- **No animation.** The ring appears instantly; no transition on `outline` ([motion.md §8](./motion.md)).
- **Skip link.** "Skip to content" is the first focusable element. It is visible on focus, 44 px tall and pinned top-left.
- **Interaction states increase contrast** (hover, active and focus all exceed rest) ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).

---

## 6. Colour contrast

### 6.1 WCAG 2.2 (normative, AA unless noted)

| Criterion                     | Requirement                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.4.3 Contrast (Minimum)      | Text ≥ 4.5:1. Large text ≥ 3:1. Large means ≥ 18 pt (24 CSS px), or ≥ 14 pt bold (18.66 px) ([SC](https://github.com/w3c/wcag/blob/main/guidelines/sc/20/contrast-minimum.html), [large-scale](https://github.com/w3c/wcag/blob/main/guidelines/terms/20/large-scale.html)). Inactive, decorative and logotype text is exempt. |
| 1.4.11 Non-text Contrast      | UI component boundaries and states needed to identify them, and graphics needed to understand content (chart lines, bars, the uptime tape), ≥ 3:1 against adjacent colours ([SC](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/non-text-contrast.html)).                                                              |
| 1.4.6 Contrast (Enhanced) AAA | 7:1 and 4.5:1. Apple: minimum 4.5:1, and "strive for a contrast ratio of 7:1, especially in small text" ([Apple dark mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)).                                                                                                                          |

### 6.2 APCA (Bronze simple mode; not yet a standard, use alongside WCAG)

From [APCA in a Nutshell](https://github.com/Myndex/SAPC-APCA/blob/master/documentation/APCA_in_a_Nutshell.md). Sizes assume an x-height ratio of 0.52 and Helvetica-like weights.

| \|Lc\| | Use                                                                                                                                                   |
| -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
|     90 | Preferred for body text (≥ 18 px/300 or 14 px/400) and for non-body text ≥ 12 px/400. Suggested **maximum** for very large, bold text (> 36 px bold). |
|     75 | Minimum for body columns (24/300, 18/400, 16/500, 14/700). Non-body text ≥ 15 px/400.                                                                 |
|     60 | Minimum for other content text: 48/200, 36/300, 24/400, 21/500, 18/600, 16/700.                                                                       |
|     45 | Large headlines (36/400, 24/700), and fine pictograms and outline icons.                                                                              |
|     30 | Absolute minimum for spot-readable text: placeholders, disabled text and solid icons.                                                                 |
|     15 | Absolute minimum for non-text that must be discernible (dividers, thick focus outlines). "Treat anything below this level as invisible."              |
- **APCA is better for dark mode.** WCAG 2 "overstates contrast for dark colors … [it] cannot be used for guidance designing 'dark mode'" (same source). Vercel prefers APCA ([WIG](https://github.com/vercel-labs/web-interface-guidelines)). Apple lists both standards ([Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).
- **Radix calibration.** Radix's text steps 11 and 12 are "guaranteed to Lc 60 and Lc 90" on step 2 ([Radix scale](https://github.com/radix-ui/website/blob/main/data/colors/docs/palette-composition/understanding-the-scale.mdx)). This is a useful calibration for low- and high-contrast text.

### 6.3 What v2 fails [measured-contrast]

| v2 token                | On                  | WCAG                   | APCA                                    |
| ----------------------- | ------------------- | ---------------------- | --------------------------------------- |
| dark `--faint #6d7585`  | `--surface #12161d` | **3.91:1** (fails 4.5) | Lc −28.6 (below the Lc 30 floor)        |
| light `--faint #8a93a1` | `#ffffff`           | **3.10:1**             | Lc 58.0                                 |
| light `--faint #8a93a1` | `--bg #f3f4f6`      | **2.82:1**             | Lc 51.4                                 |
| dark `--muted #9ba4b4`  | surface             | 7.22:1 (passes WCAG)   | **Lc −51.8**, too low for 13–15 px body |

The dark `--muted` case is exactly the dark-mode gap that WCAG 2 hides.

### 6.4 Token targets for v3 (testable)

| Token                           | Allowed use                                                             | WCAG    | \|Lc\|                                                      |
| ------------------------------- | ----------------------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| `text-1`                        | Headings, KPIs, primary cells                                           | ≥ 15:1  | ≥ 95                                                        |
| `text-2`                        | Body, table cells, **all essential labels** (table headers, KPI labels) | ≥ 7:1   | ≥ 75                                                        |
| `text-3`                        | Non-essential metadata at ≥ 13 px / 500 only (timestamps, "synthetic")  | ≥ 4.5:1 | ≥ 55                                                        |
| `disabled`, placeholder         | Inactive controls only                                                  | exempt  | ≥ 30                                                        |
| `control` border, chart strokes | Inputs, toggles, series lines                                           | ≥ 3:1   | —                                                           |
| Divider                         | Decorative separators only. Structure must also come from spacing.      | —       | Dividers in dark fall below Lc 15; treat them as decoration |
| Accent link text                | Inline links                                                            | ≥ 4.5:1 | ≥ 60, and underlined in prose                               |
| White label on accent fill      | Primary button                                                          | ≥ 4.5:1 | ≥ 70                                                        |

---

## 7. Dark mode that looks rich, not flat grey

**Rules**
1. **Tint every neutral.** Use one hue: OKLCH h 264, close to Base blue, with chroma 0.018–0.021 for surfaces and 0.005–0.018 for text. Pure greys (`#111`, `#0b0b0b`) are a template tell ([product-ui.md §11](./product-ui.md)). Radix's dark neutrals are tinted too: slate1 `#111113`, slate2 `#18191b`, slate12 `#edeef0` ([Radix dark.ts](https://github.com/radix-ui/colors/blob/main/src/dark.ts)). OKLCH keeps lightness perceptually even across hues ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)). Linear moved theme generation from HSL to LCH (summary of [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)).
2. **Show elevation by lightness.** Each step up is about +3 L\*.
   - Material 3 dark surface tones: container-lowest 4, surface/dim 6, low 10, container 12, high 17, highest 22, bright 24 ([material-color-utilities `color_spec_2021.ts`](https://github.com/material-foundation/material-color-utilities/blob/main/typescript/dynamiccolor/color_spec_2021.ts)).
   - Apple: "base colors are dimmer … elevated colors are brighter, making foreground interfaces appear to advance" ([Apple dark mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)).
   - Drop shadows read as nothing on dark surfaces; use a 1 px border one step lighter instead.
3. **Text is not white.** text-1 is OKLCH L 0.96. Apple: dark-mode colours "aren't necessarily inversions".
4. **Accents shift in dark.** In dark they get lighter and less saturated (L 0.80 / C 0.12, against L 0.50 / C 0.19 in light). Solid fills keep a mid-lightness (L 0.54) so white labels still pass.
5. **Status colours** use a tinted fill at L 0.30 / C 0.05–0.06 and a foreground at L 0.80–0.86. This mirrors Radix steps 3 and 11.
6. **Plumbing.** `color-scheme: dark` on `<html>`, `<meta name="theme-color">` equal to the canvas, an explicit `background-color` and `color` on `<select>`, and no transitions during a theme switch ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines); [product-ui.md §4.4](./product-ui.md)).
7. **High-contrast mode.** Honour `prefers-contrast: more` (Chrome 96, Firefox 101, Safari 14.1) by mapping text-3 to text-2 and borders to `control`. Apple asks for "a higher contrast color scheme when … Increase Contrast is turned on" ([Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).

**Proposed dark palette** (computed [measured-contrast]; contrast measured against `surface-1` unless noted):

| Token                      | OKLCH                         | Hex                   |  L\* | Contrast on surface-1 (WCAG / Lc) |
| -------------------------- | ----------------------------- | --------------------- | ---: | --------------------------------- |
| canvas                     | 0.185 0.020 264               | `#0e131c`             |  5.8 | text-1 16.59:1 / −98.6            |
| surface-1 (card)           | 0.215 0.021 264               | `#141923`             |  8.7 | —                                 |
| surface-2 (raised, inputs) | 0.243 0.021 264               | `#1b202a`             | 12.2 | —                                 |
| surface-3 (popover, sheet) | 0.272 0.021 264               | `#222731`             | 15.6 | text-1 13.35:1 / −96.0            |
| hover                      | 0.290 0.020 264               | `#262b36`             | 17.5 | —                                 |
| border-subtle              | 0.300 0.019 264               | `#292e38`             | 18.8 | Decorative                        |
| border                     | 0.345 0.019 264               | `#343943`             | 23.9 | Decorative                        |
| control                    | 0.530 0.020 264               | `#666c78`             | 45.5 | 3.34:1                            |
| text-1                     | 0.960 0.005 264               | `#f0f2f5`             | 95.4 | 15.69:1 / −98.0                   |
| text-2                     | 0.870 0.012 264               | `#d0d4dc`             | 84.8 | 11.85:1 / −79.1                   |
| text-3                     | 0.755 0.018 264               | `#aab0bb`             | 71.7 | 8.08:1 / −58.1                    |
| disabled                   | 0.580 0.018 264               | `#757a85`             | 51.1 | 4.09:1 / −30.6                    |
| accent (text, links)       | 0.800 0.120 256               | `#8ac0ff`             | 76.3 | 9.27:1 / −65.2                    |
| focus                      | 0.830 0.110 250               | `#8fcdff`             | 80.0 | 10.94:1 on canvas                 |
| accent-solid               | 0.540 0.190 262               | `#2a66db`             | 45.8 | White label 4.66:1 / −72.0        |
| ok fg / bg                 | 0.82 0.13 155 / 0.30 0.05 155 | `#79dd9f` / `#173523` |    — | 8.06:1                            |
| bad fg / bg                | 0.80 0.12 22 / 0.30 0.06 22   | `#ff9e9b` / `#472020` |    — | 7.10:1                            |
| warn fg / bg               | 0.86 0.12 85 / 0.31 0.05 85   | `#f5cb70` / `#3c2e0f` |    — | 8.59:1                            |

**Proposed light palette:**

| Token         | OKLCH           | Hex                   | Contrast (WCAG / Lc)          |
| ------------- | --------------- | --------------------- | ----------------------------- |
| canvas        | 0.982 0.004 264 | `#f8f9fc`             | —                             |
| surface-1     | 1.000 0 264     | `#ffffff`             | —                             |
| surface-2     | 0.965 0.005 264 | `#f2f3f7`             | —                             |
| hover         | 0.950 0.006 264 | `#eceef3`             | —                             |
| border-subtle | 0.930 0.007 264 | `#e5e8ed`             | —                             |
| border        | 0.890 0.009 264 | `#d8dbe1`             | —                             |
| control       | 0.640 0.016 264 | `#878c96`             | 3.38:1                        |
| text-1        | 0.220 0.018 264 | `#161b23`             | 17.28:1 / 104.2               |
| text-2        | 0.450 0.020 264 | `#505561`             | 7.47:1 / 86.0                 |
| text-3        | 0.530 0.018 264 | `#666c77`             | 5.28:1 / 76.3                 |
| disabled      | 0.700 0.012 264 | `#9b9ea6`             | 2.68:1 / 52.1 (inactive only) |
| accent        | 0.500 0.190 262 | `#1e59cd`             | 6.24:1 / 80.4                 |
| focus         | 0.520 0.200 262 | `#1f5ed9`             | 5.45:1 on canvas              |
| ok fg / bg    | —               | `#036639` / `#daf7e3` | 6.21:1                        |
| bad fg / bg   | —               | `#b02a2d` / `#ffe7e5` | 5.54:1                        |
| warn fg / bg  | —               | `#875814` / `#fff0cc` | 5.41:1                        |

---

## 8. Phones: safe areas and viewport units

1. **Viewport meta:** `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. `cover` fills the display and makes `env(safe-area-inset-*)` non-zero ([MDN viewport meta](https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/meta/name/viewport); [MDN env()](https://developer.mozilla.org/docs/Web/CSS/env)). `env()` support: Chrome 69, Firefox 65, Safari 11.
2. **Side gutters:** `padding-inline: max(16px, env(safe-area-inset-left)) max(16px, env(safe-area-inset-right))`. This handles the landscape notch.
3. **Anything fixed to the bottom:** `padding-bottom: calc(8px + env(safe-area-inset-bottom))`. This is MDN's pattern, `calc(1em + env(safe-area-inset-bottom))`. Desktop insets are 0.
4. **Sticky header:** add `padding-top: env(safe-area-inset-top)`. It is 0 in a Safari tab and non-zero in standalone mode.
5. **Heights:**
   - `min-height: 100svh` for a hero, so it does not jump when the toolbar collapses.
   - `100dvh` for sheets and overlays.
   - Declare `100vh` first as the fallback.

   The units shipped in Chrome 108 and in Safari and Firefox before that ([web.dev viewport units](https://web.dev/blog/viewport-units)).
6. **Sheets:** `overscroll-behavior: contain` ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)), and `max-height: calc(100dvh - env(safe-area-inset-top) - 24px)`. Material caps bottom sheets at 640 dp wide ([BottomSheet.md](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md)).
7. **Known WebKit issues** with fixed bottom elements and Safari's bottom toolbar:
   - The iOS 15 bottom bar overlaps ([Samuel Kraft](https://dev.to/samuelkraft/using-bottom-tab-bars-on-safari-ios-15-53fa)).
   - On iOS 18, an auto-expanding address bar overlaps fixed content ([WebKit bug 281071](https://bugs.webkit.org/show_bug.cgi?id=281071)).

   Avoid fixed bottom UI in the browser tab (§9).
8. **Theme colour:** `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0e131c">`, with a light twin. Keep it equal to the canvas tokens.

---

## 9. Mobile navigation

| Pattern                                                | Platform guidance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Fit for Depthwatch (4 destinations: Overview, Pools, Gaps, Scorecards; Methodology secondary)                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bottom tab bar**                                     | **Apple:** "Use a tab bar to support navigation, not to provide actions". Keep it visible, use single-word labels, avoid a "More" overflow, and when tabs are customisable "aim for a default list of five or fewer" ([Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)).**Material:** 3–5 destinations; height 80 dp, or 64 dp in M3 Expressive ([BottomNavigation.md](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md)). | Native-app idiom. In a Safari tab it stacks on the browser's own bottom toolbar and hits the WebKit bugs in §8. **Use only in `@media (display-mode: standalone)`** (installed PWA): 4 tabs, 56 px + bottom inset, icon + label at 12 px / 500.                                                                                                                                                                              |
| **Top tab strip (segmented, horizontally scrollable)** | Visible navigation beats hidden: NN/g found hidden navigation less discoverable and slower. Secondary reports put mobile 15% slower and discoverability about 20% lower ([NN/g](https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/); [Smart Insights summary](https://www.smartinsights.com/digital-marketing-strategy/are-hamburger-menus-hidden-navigation-good-for-ux/)).                                                                                                                                    | **Recommended in the browser.** Sticky 52 px bar with the logo mark left and a theme/menu button right. Directly under it, a 44 px strip with the 4 labels at 15 px / 500 and a 2 px active indicator, 20 px apart. It scrolls horizontally below 360 px with a fade edge. Total chrome is at most 96 px, under 15% of a 667 px viewport. The strip may hide on scroll-down and return on scroll-up; never hide the top bar. |
| **Hamburger to full-screen menu or sheet**             | Hidden; lowest discoverability (NN/g above). Apple: the "More tab makes it harder for people to reach and notice content".                                                                                                                                                                                                                                                                                                                                                                                                           | Only for secondary links: Methodology, GitHub, API, theme.                                                                                                                                                                                                                                                                                                                                                                   |
| **Bottom sheet**                                       | Apple: medium (about half) and large detents, a grabber, swipe to dismiss ([Apple sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)). Material: modal sheets sit above a scrim; maximum width 640 dp.                                                                                                                                                                                                                                                                                                    | Use for **secondary controls**: filters, sort, column picker, metric explainer and the row peek on phones. Open at the medium detent with focus moved into the sheet, and return focus on close.                                                                                                                                                                                                                             |
| **Navigation rail (≥ 600 px)**                         | Material: rail on medium and larger windows, 80–96 dp wide ([NavigationRail.md](https://github.com/material-components/material-components-android/blob/master/docs/components/NavigationRail.md)).                                                                                                                                                                                                                                                                                                                                  | Not needed. With 4 items, a top horizontal nav works from 600 px up.                                                                                                                                                                                                                                                                                                                                                         |

---

## 10. QA checklist (all testable)

1. `document.fonts` shows the sans and mono faces with status `loaded` before any screenshot is taken.
2. No request to `fonts.googleapis.com` is made, and the woff2 files are self-hosted.
3. The sans subset contains `tnum`, `case` and the glyphs `→ ≥ ± × −`; verify with fontTools.
4. No text renders below 12 px. Use `getComputedStyle` over all text nodes.
5. All `font-size` values come from §2.1 tokens.
6. Every fluid clamp has max/min ≤ 2.5.
7. No line of prose exceeds 75 characters, and no headline exceeds 24ch.
8. No `text-transform: uppercase` outside the grade letter.
9. No mono face outside the address, hash, block and badge-snippet elements.
10. No `→` appended inside link text nodes.
11. At 320, 360, 390, 600, 840, 1200 and 1600 px, `document.documentElement.scrollWidth === clientWidth`. Repeat at 200% zoom on 1280 px.
12. With WCAG 1.4.12 spacing injected (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em, paragraph spacing 2em), nothing clips or overlaps.
13. Every interactive element's bounding box is at least 24×24 px.
14. Under `pointer: coarse` emulation, every hit area is at least 44×44 px and nav items are at least 48 px tall.
15. Tab through every page:
    - each focused element shows an outline at least 2 px wide;
    - its colour is at least 3:1 against the canvas;
    - it is never fully under the sticky header (WCAG 2.4.11).
16. All text pairs meet the §6.4 targets in both themes: WCAG ≥ 4.5:1 for text, plus the APCA tier. The v2 `--faint` values are gone.
17. Under `prefers-contrast: more`, text-3 maps to text-2. Under `forced-colors: active`, focus rings and status glyphs stay visible.
18. On iOS Safari, with notch landscape emulation, nothing sits under the insets, and no fixed bottom UI exists in the browser tab.
19. `theme-color` equals the canvas in both themes, and `color-scheme` is set.
20. DOM order matches visual order, and the skip link is first.

---

## Sources

**Fonts and families**
- Google Fonts repo, per family (METADATA.pb, TTFs, descriptions): https://github.com/google/fonts/tree/main/ofl (for example `/hankengrotesk`, `/monasans`, `/inter`, `/geist`, `/schibstedgrotesk`, `/familjengrotesk`, `/ibmplexsans`, `/ibmplexmono`, `/dmsans`, `/instrumentsans`)
- Inter documentation and feature list: https://github.com/rsms/inter/blob/master/docs/index.html; releases: https://github.com/rsms/inter/releases
- Geist README: https://github.com/vercel/geist-font
- create-next-app layout template: https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/app-tw/ts/app/layout.tsx
- shadcn/ui fonts: https://github.com/shadcn-ui/ui/blob/main/apps/v4/lib/fonts.ts
- GitHub, "Introducing Mona Sans and Hubot Sans": https://github.blog/news-insights/company-news/introducing-mona-sans-and-hubot-sans/
- Fontsource Inter variable: https://www.npmjs.com/package/@fontsource-variable/inter
- Chrome, framework tools for font fallback: https://developer.chrome.com/blog/framework-tools-font-fallback/

**Linear**
- https://linear.app/now/how-we-redesigned-the-linear-ui

**Measure, numbers and fluid type**
- Viget, line length: https://www.viget.com/articles/the-line-length-misconception
- MDN font-variant-numeric: https://developer.mozilla.org/docs/Web/CSS/font-variant-numeric
- wpDataTables (Web Almanac figure on tabular figures): https://wpdatatables.com/best-fonts-for-tables/
- utopia-core `checkWCAG`: https://github.com/trys/utopia-core/blob/main/src/index.ts
- Maxwell Barvian, Smashing Magazine: https://www.smashingmagazine.com/2023/11/addressing-accessibility-concerns-fluid-type/
- Adrian Roselli, responsive type and zoom: https://adrianroselli.com/2019/12/responsive-type-and-zoom.html

**WCAG 2.2 success criteria, from the w3c/wcag source**
- 2.5.8 Target Size (Minimum): https://github.com/w3c/wcag/blob/main/guidelines/sc/22/target-size-minimum.html
- 2.5.5 Target Size (Enhanced): https://github.com/w3c/wcag/blob/main/guidelines/sc/21/target-size-enhanced.html
- 2.4.11 Focus Not Obscured: https://github.com/w3c/wcag/blob/main/guidelines/sc/22/focus-not-obscured-minimum.html
- 2.4.13 Focus Appearance: https://github.com/w3c/wcag/blob/main/guidelines/sc/22/focus-appearance.html
- 1.4.3 Contrast (Minimum): https://github.com/w3c/wcag/blob/main/guidelines/sc/20/contrast-minimum.html
- Large-scale text definition: https://github.com/w3c/wcag/blob/main/guidelines/terms/20/large-scale.html
- 1.4.11 Non-text Contrast: https://github.com/w3c/wcag/blob/main/guidelines/sc/21/non-text-contrast.html
- 1.4.10 Reflow: https://github.com/w3c/wcag/blob/main/guidelines/sc/21/reflow.html
- 1.4.12 Text Spacing: https://github.com/w3c/wcag/blob/main/guidelines/sc/21/text-spacing.html
- 1.4.4 Resize Text: https://github.com/w3c/wcag/blob/main/guidelines/sc/20/resize-text.html
- 1.4.8 Visual Presentation: https://github.com/w3c/wcag/blob/main/guidelines/sc/20/visual-presentation.html
- 1.4.13 Content on Hover or Focus: https://github.com/w3c/wcag/blob/main/guidelines/sc/21/content-on-hover-or-focus.html
- Technique C40, two-colour focus indicator: https://github.com/w3c/wcag/blob/main/techniques/css/C40.html
- Published recommendation: https://www.w3.org/TR/WCAG22/

**APCA**
- https://github.com/Myndex/SAPC-APCA/blob/master/documentation/APCA_in_a_Nutshell.md

**Apple Human Interface Guidelines**
- Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Dark mode: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Sheets: https://developer.apple.com/design/human-interface-guidelines/sheets

**Material and Android**
- Navigation bar: https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md
- Navigation rail: https://github.com/material-components/material-components-android/blob/master/docs/components/NavigationRail.md
- Bottom sheet: https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md
- Window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
- Touch target size: https://support.google.com/accessibility/android/answer/7101858
- Surface tones in `color_spec_2021.ts`: https://github.com/material-foundation/material-color-utilities/blob/main/typescript/dynamiccolor/color_spec_2021.ts

**Colour systems**
- Radix dark scales: https://github.com/radix-ui/colors/blob/main/src/dark.ts
- Radix, understanding the scale: https://github.com/radix-ui/website/blob/main/data/colors/docs/palette-composition/understanding-the-scale.mdx
- Evil Martians, OKLCH in CSS: https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl

**Web platform**
- MDN env(): https://developer.mozilla.org/docs/Web/CSS/env
- MDN viewport meta: https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/meta/name/viewport
- MDN text-wrap-style: https://developer.mozilla.org/docs/Web/CSS/text-wrap-style
- MDN browser-compat-data: https://github.com/mdn/browser-compat-data
- web.dev, viewport units: https://web.dev/blog/viewport-units
- Vercel Web Interface Guidelines: https://github.com/vercel-labs/web-interface-guidelines

**Mobile behaviour and navigation**
- Samuel Kraft, bottom tab bars on Safari iOS 15: https://dev.to/samuelkraft/using-bottom-tab-bars-on-safari-ios-15-53fa
- WebKit bug 281071: https://bugs.webkit.org/show_bug.cgi?id=281071
- NN/g, hidden navigation on mobile: https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/
- Smart Insights summary of the NN/g study: https://www.smartinsights.com/digital-marketing-strategy/are-hamburger-menus-hidden-navigation-good-for-ux/
- Steven Hoober, how users hold mobile devices: https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
