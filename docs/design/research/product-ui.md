# Product UI research: what makes elite interfaces feel refined and calm

Input for the Depthwatch v3 redesign. v2 read as bland and generic: large amounts of generic-looking data at equal weight made the product look cheap. This file collects concrete, numeric rules from well-regarded products and writers, and it lists the template patterns to remove.

**How the sources were read.** Several hosts (linear.app, vercel.com, stripe.com, rauno.me, emilkowal.ski, refactoringui.com and others) were not read directly. The rules below come from:
- **Primary:** Apple HIG (the JSON behind developer.apple.com), Vercel's guidelines (the `vercel-labs/web-interface-guidelines` repo, which is the source of vercel.com/design/guidelines), Rauno Freiberg's `interfaces` repo, Emil Kowalski's own `skills` repo, Paco Coursey's `next-themes` repo, Radix Colors docs, Inter's v3 docs and Raycast's store guidelines. All were read as raw GitHub files or from Apple.
- **Search summaries of primary posts:** Linear, Stripe, Geist, Rauno's essay and NN/g.
- **Third-party inspections** of live sites (the VoltAgent `awesome-design-md` extractions, among others). These carry the tag _(3p)_: treat them as measurements of marketing pages, not as official specs.

Every rule names its source. Section 14 lists every URL.

---

## 0. The twelve rules that matter most for Depthwatch

1. **One focal point per screen.** Make one number or one visual the obvious answer and quiet everything around it ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI): "de-emphasize the things around it"). Every extra unit of information weakens the visibility of the units that matter ([NN/g heuristic 8](https://www.nngroup.com/articles/aesthetic-minimalist-design/)).
2. **Three text colours and two weights.** Use dark for primary, grey for secondary and lighter grey for tertiary. Use 400–500 for text and 600–700 only for emphasis ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)). Display type stays at or below 600 ([Linear](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md) (3p), [Vercel](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/vercel/DESIGN.md) (3p)). Never go below 400 for UI text ([Rauno](https://github.com/raunofreiberg/interfaces)).
3. **Tracking tightens as size grows.** Body text sits at 0 to −0.01 em, 20–24 px at about −0.02 em and 32–48 px at −0.022 to −0.04 em ([Inter dynamic metrics](https://d.rsms.me/inter-website/v3/dynmetrics/); Vercel and Linear (3p)). All-caps is the only text that gets positive tracking. Better still, set no all-caps at all.
4. **No ALL-CAPS eyebrows, no `A · B · C` meta strings, no `→` glued to links, no mono for decorative labels, no `WORD — fragment` labels.** These are the "template chrome" cluster (§11, SD4). v2 uses all five.
5. **Use one accent hue, used rarely.** It marks the primary action, selection, focus and links. Status colours appear only where they carry state ([Apple HIG Branding](https://developer.apple.com/design/human-interface-guidelines/branding): "apply your app's accent color judiciously"; [Linear](https://linear.app/now/behind-the-latest-design-refresh) removed coloured team-icon backgrounds).
6. **Build neutrals as a 10–12 step ramp in a perceptual space (LCH/OKLCH), tinted slightly toward the brand hue.** Linear generates whole themes from three inputs: base, accent and contrast, in LCH ([Linear part II](https://linear.app/now/how-we-redesigned-the-linear-ui)). Radix uses 12 steps and Geist uses 10, each step with a fixed job ([Radix](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale), [Geist colors](https://vercel.com/geist/colors)).
7. **Data surfaces stay flat.** Separate them with background steps, spacing or one quiet hairline. Shadows belong only to things that float (menus, popovers, dialogs) ([Linear](https://linear.app/now/behind-the-latest-design-refresh): borders "had quietly proliferated", so Linear softened them; [Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI): "use fewer borders"). Allow one level of containment and never put a card inside a card (§11, K11).
8. **Radius follows role, and nested radii are concentric.** Use a 4/6/8/12 px scale. A child's radius is at most its parent's ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Never put one radius on everything (§11).
9. **Numbers are the content, so typeset them like it.** Use `tabular-nums` and right-align them ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines), [Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)). Put a non-breaking space between number and unit, as in `10 bps`. Within one context, show currency with either 0 or 2 decimals, never both ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Do not show more precision than the decision needs ([Stephen Few](https://learn.saylor.org/mod/book/tool/print/index.php?id=82385)).
10. **Keep motion short and rare.** UI motion stays under 300 ms, and interactions run 100–200 ms with a strong ease-out. Animate only `transform` and `opacity`, and never use `transition: all` ([Emil Kowalski](https://github.com/emilkowalski/skills), [Rauno](https://github.com/raunofreiberg/interfaces), [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). No count-up numbers, and no fade-up on every section (§8, §11).
11. **Design every state.** Delay a loading indicator by 150–300 ms and, once shown, keep it for 300–500 ms. Skeletons mirror the final layout exactly. No empty-state flicker before data arrives. Every screen offers a next step ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines), [Raycast](https://github.com/raycast/extensions/blob/main/docs/basics/prepare-an-extension-for-store.md)).
12. **Write plainly.** Use sentence case, verb + noun buttons with no end punctuation, no "we", no "click here", and errors that say how to recover ([Stripe button docs](https://docs.stripe.com/stripe-apps/components/button), [Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing), [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).

---

## 1. First impression, hierarchy and how much goes on a screen

- **People judge visual appeal within about 50 ms, and that judgement matches their later one.** In Lindgaard et al. (2006, _Behaviour & IT_ 25(2)), ratings after 50 ms agreed with ratings after longer viewing ([Nature news](https://www.nature.com/news/2006/060109/full/news060109-13.html); [NN/g](https://www.nngroup.com/articles/aesthetic-minimalist-design/) cites the same figure). The first viewport therefore has to look composed before anyone reads a number.
- **Minimalism means no irrelevant or rarely needed information. It is not a visual style.** "Every extra unit of information … diminishes [the] relative visibility" of the relevant ones ([NN/g heuristic 8](https://www.nngroup.com/articles/aesthetic-minimalist-design/)).
- **Progressive disclosure.** "An interface with too much content and too many choices makes it harder to find information quickly." Use disclosure, menus or nested views to reduce what shows initially ([Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout)).
- **Order by importance.** Put the most important item at the top leading edge. Use alignment and indentation to show what belongs to what, and group with space before reaching for boxes ([Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout)).
- **Hierarchy without size inflation.** "Relying too much on size makes primary content too large and secondary content too small: use colour and weight instead." "Labels are a last resort: try context, format and supporting text." Semantic hierarchy (an h2) does not have to be visual hierarchy. Many section titles should look like quiet labels ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **One prominent action per view.** Give the most likely action the prominent style. "Refrain from adding color to the background of multiple controls." Distinguish the preferred choice by style, not by size ([Apple HIG Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Color](https://developer.apple.com/design/human-interface-guidelines/color)). Mercury and Stripe both keep one filled primary button per group ((3p) [Mercury](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/mercury/DESIGN.md), [Stripe](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/stripe/DESIGN.md)).
- **Chrome recedes and content advances.** Linear's 2024 redesign changed the sidebar, tabs, headers and panels "to reduce visual noise, maintain visual alignment, and increase the hierarchy and density of navigation elements" ([Linear part II](https://linear.app/now/how-we-redesigned-the-linear-ui)). The 2026 refresh made the sidebar "a few notches dimmer" so the work area takes precedence, and made the tab bar more compact with smaller icons and text ([Linear: A calmer interface](https://linear.app/now/behind-the-latest-design-refresh)). Branding defers to content ([Apple HIG Branding](https://developer.apple.com/design/human-interface-guidelines/branding)).
- **Dashboards are read at a glance.** Few defines a dashboard as the most important information "consolidated and arranged on a single screen so it can be monitored at a glance". His 13 common mistakes include exceeding one screen, excessive detail or precision, and "meaningless variety" of display media. Maximise data-ink and remove non-data ink ([Few, summarised by Saylor Academy](https://learn.saylor.org/mod/book/tool/print/index.php?id=82385)).
- **A chart is not always needed.** "Not every collection of data needs to be displayed in a chart." Keep a chart simple and let people ask for detail ([Apple HIG Charting data](https://developer.apple.com/design/human-interface-guidelines/charting-data)).
- **Element budget per viewport (synthesis of the above).** Allow 1 focal element, ≤ 3 text colours, ≤ 2 body weights, ≤ 1 filled button, ≤ 1 chip per table row and ≤ 4 headline numbers above the fold. Never put two tables of the same data on one page.

## 2. Typography

### 2.1 Typefaces

- **Use one or two families.** Mixing typefaces "can obscure your information hierarchy" ([Apple HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography)). One family is fine if the scale does the work.
- **Elite products give headings an optical "display" cut.** Linear moved headings to Inter Display "to add more expression to our headings while maintaining their readability" ([Linear part II](https://linear.app/now/how-we-redesigned-the-linear-ui)). Mercury uses Arcadia and Arcadia Display, and Stripe uses Söhne ((3p)). Inter 4 ships the display cut as an `opsz` axis (text to display) ([Inter docs](https://github.com/rsms/inter/blob/master/docs/index.html)). In CSS that means `font-optical-sizing: auto` plus a variable font that has `opsz`.
- **Inter, Roboto, system-ui, or Geist used alone are the most common generic tell.** They are the defaults of the most used scaffolds (`create-next-app` ships Geist and shadcn/ui ships Inter; [type-a11y §1.4](./type-a11y.md)), so a page set in one of them with no further choices looks like every other such page. The tension: Linear itself uses Inter. The tell is a default left unchosen, not the face. If Depthwatch keeps a neutral grotesk, its character has to come from the optical display cut, tight display tracking, tabular figures and a few deliberate OpenType features (Raycast enables `ss03` site-wide; Stripe enables `ss01` and `tnum`; both (3p)).
- **A typeface needs at least 5 weights** (filter for 10+ to count italics) ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **Mono is for code, addresses, hashes and columns people actually scan,** not for decorative small labels (§11, SD4; [Vercel](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/vercel/DESIGN.md) (3p): "don't set body paragraphs in the mono face").
- **Ship the font; don't hope for it.** Self-host and subset, then preload only the critical faces ([Vercel WIG, Performance](https://github.com/vercel-labs/web-interface-guidelines)). Google Fonts may not load in a CI browser, so tune every tracking value for the shipped face and check the fallback (`system-ui`) render for line breaks and table widths.

### 2.2 Scale

| Source                                                                                                           | Steps (px)                                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)                                   | 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72 (hand-picked, not a ratio; use px or rem, never em) |
| [Apple macOS text styles](https://developer.apple.com/design/human-interface-guidelines/typography)              | 10, 11, 12, 13 (body), 15, 17, 22, 26 (large title); minimum 10                                |
| [Apple iOS (Large, default)](https://developer.apple.com/design/human-interface-guidelines/typography)           | 11, 12, 13, 15, 16, 17 (body), 20, 22, 28, 34; minimum 11                                      |
| [Vercel marketing](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/vercel/DESIGN.md) (3p)     | 12, 13 (code), 14, 16, 18, 20, 24, 32, 48                                                      |
| [Linear marketing](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md) (3p) | 12, 13, 14, 16, 18, 20, 22, 28, 40, 56, 80                                                     |
- **Product UIs are smaller than marketing pages.** Body text is 13 pt on macOS and the Linear app body is 13–14 px. Reading text is 15–17. Data products should not run their table text at a marketing body size.
- **Line length:** 45–75 characters. Refactoring UI gives 20–35 em; WCAG 1.4.8 sets 80 characters as the limit ([type-a11y §2.2](./type-a11y.md)).
- **Fluid display sizes:** `clamp(48px, 5vw, 72px)` style ([Rauno](https://github.com/raunofreiberg/interfaces)).
- **Weights.** Medium headings look best at 500–600 ([Rauno](https://github.com/raunofreiberg/interfaces)). Mercury's display is 480 and its body 360–420; Stripe's display is 300; Vercel caps display at 600 (all (3p)). Calm products use **low weights with large sizes**, not 700–900 bold. Weight extremes (100/200 against 800/900) and 3× size jumps suit landing pages. For a data product, express the contrast through size, as a large light number against small labels, rather than weight.
- **Weight never changes on hover or selection,** because it causes layout shift ([Rauno](https://github.com/raunofreiberg/interfaces)).

### 2.3 Letter-spacing by size

[Inter dynamic metrics](https://d.rsms.me/inter-website/v3/dynmetrics/) (rsms, constants dated 2019-02-07, from [`rsms/inter` v3.19](https://github.com/rsms/inter/blob/v3.19/docs/dynmetrics/index.html)) gives tracking = −0.0223 + 0.185 × e^(−0.1745 × size), in em, with line-height 1.4 × size:

| size px | 11      | 12  | 13      | 14      | 16      | 18      | 20      | 24      | 32      | 48+     |
| ------- | ------- | --- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| em      | +0.0048 | 0   | −0.0032 | −0.0062 | −0.0110 | −0.0143 | −0.0167 | −0.0195 | −0.0216 | −0.0223 |

Cross-checks:
- **Apple (SF Pro, macOS):** +6/1000 em at 11 pt, 0 at 12, −6 at 13, −11 at 14, −20 at 16 and −26 at 17. SF Display then turns positive from 24 pt, which is specific to SF ([HIG tracking table](https://developer.apple.com/design/human-interface-guidelines/typography)).
- **Vercel/Geist (3p):** −0.05 em at 48 px, −0.04 em at 24–32, −0.03 em at 20, −0.02 em at 14, 0 at 16.
- **Linear (3p):** −0.0375 em at 80 px, −0.032 at 56, −0.025 at 40, −0.021 at 28, −0.018 at 22 and about 0 at 14–16.
- **Rule:** text 12–16 px gets 0 to −0.01 em, 20–28 px gets −0.015 to −0.025 em, and 32 px and up gets −0.02 to −0.04 em (tighter for geometric faces such as Geist, looser for Inter). Small text at 11–12 px gets 0 to +0.01 em. All-caps needs positive tracking "to account for lack of variance in x-height" ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)), but see §11 before setting any.

### 2.4 Line-height

- **Proportional:** larger sizes and shorter lines need less leading; smaller sizes and longer lines need more ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)). Use three or more lines of loose leading for reading text, and avoid tight leading when text runs to three or more lines ([Apple HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography)).
- **Values seen:**
  - macOS 13/16 (1.23) and 10/13 (1.3).
  - iOS 17/22 (1.29) and 34/41 (1.2).
  - Vercel (3p) 14/20 (1.43), 16/24 (1.5), 24/32 (1.33), 32/40 (1.25) and 48/48 (1.0).
  - Linear (3p) body 1.5, 28 px at 1.2 and 56–80 px at 1.05–1.1.
  - Inter's formula uses 1.4 throughout.
- **Rule:**
  - Single-line UI labels and table cells: 1.2–1.3.
  - Reading copy: 1.45–1.55.
  - Headings at 20–28 px: 1.2–1.3.
  - Display at 32 px and up: 1.0–1.15.
- **Geist splits styles into two families:** "Label" for single-line UI and "Copy" for multi-line text with a higher line-height. Label 14 is "the most common text style of all" ([Geist typography](https://vercel.com/geist/typography)).

## 3. Spacing and density

- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48, 64, 96, 128 px. No two values sit closer than about 25%. Steps are dense at the small end and sparse at the large end ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)). Stripe uses an 8 px base with 2/4/12 for fine work (3p).
- **Proximity:** related things sit closer, and groups have more space around them than within them ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **Start with too much white space** and remove it until it is right ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **Rhythm, not uniform padding.** Equal `gap` and padding everywhere flattens hierarchy. Crowd some things and isolate others. Squint test: at 25% zoom, if every section weighs the same, the density is flat (§11, S1).
- **Section spacing (3p):** 32–48 px on Stripe's dashboard and product surfaces against 64–96 px on marketing pages; 96 px at Linear and Raycast. Raycast keeps in-card padding tight at 16–24 px and "don't pad cards with 32px+".
- **Width:** "You don't have to fill the whole screen." Prefer fixed max-widths for content over stretching across the grid ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **Density comes from alignment and restraint, not from cramming.** Linear increased navigation density while reducing noise ([Linear part II](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- **Hit targets:** at least 24 px on pointer devices and 44 px on mobile ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). The HIG recommends 44 × 44 pt on iOS (28 × 28 pt minimum) and 28 × 28 pt on macOS (20 × 20 minimum) ([Apple HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)). Lists have no dead zones between items: increase padding, not margin ([Rauno](https://github.com/raunofreiberg/interfaces)).
- **Safe areas, ultra-wide, and only useful scrollbars.** Test at 50% zoom for ultra-wide screens ([Vercel WIG, Layout](https://github.com/vercel-labs/web-interface-guidelines)).

## 4. Colour

### 4.1 How many hues

- **Refactoring UI's kit** is 8–10 greys, 1–2 primaries with 5–10 shades each, and accents only for meaning: red for destructive, yellow for warning, green for positive ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **Elite products are close to monochrome.** Linear's marketing has one lavender accent "never decorative" and its 2025 site moved further to black and white (3p). Raycast has one "white is the brand action" and saturated accents only inside illustrations (3p). Ramp is black-and-white with one highlighter yellow ([refero](https://styles.refero.design/style/b38702a0-75ab-474c-9106-00b624535825) (3p)). Mercury keeps status greens and oranges out of the chrome (3p).
- **Commit to a dominant colour with one sharp accent** rather than an evenly distributed palette: roughly 60/30/10 between the dominant neutral, the secondary surfaces and the accent.
- **One colour, one meaning.** "Avoid using the same color to mean different things." If the brand colour marks interactivity, do not also use it on non-interactive text ([Apple HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)).
- **Data colours are separate from UI colours.** Series hues live inside charts. Use colour-blind-safe palettes and never rely on colour alone ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines), [Apple HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)).

### 4.2 How scales are built

- **Use perceptual spaces.**
  - Stripe moved to CIELAB because HSL lightness is not perceptual (yellow and blue at the same HSL L look different). Its levels have uniform lightness across hues. In the secondary account, any two colours at least five levels apart pass 4.5:1 and at least four apart pass 3:1. Its badges shift background and text up one level together ([Stripe](https://stripe.com/blog/accessible-color-systems), via search summaries).
  - Linear moved theme generation from HSL to LCH because it is "perpetually uniform" ([Linear part II](https://linear.app/now/how-we-redesigned-the-linear-ui)).
  - In CSS today, author tokens in `oklch()`.
- **Steps have jobs.**
  - Radix (12 steps): 1–2 app backgrounds; 3/4/5 component background at rest, hover and pressed; 6/7/8 borders (non-interactive, interactive, strong/focus); 9/10 solid fills and their hover; 11/12 low- and high-contrast text. Steps 11 and 12 reach APCA Lc 60 and Lc 90 on step 2 ([Radix](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)).
  - Geist (10 steps): 1–3 component backgrounds, 4–6 borders (default, hover, active), 7–8 high-contrast backgrounds, 9 secondary text and icons, 10 primary text. Gray is the default for text, icons, fills, borders and dividers. Gray-alpha is used only when the background must show through ([Geist colors](https://vercel.com/geist/colors)).
- **Shading.** Saturation rises toward both ends of a ramp, and a hue may rotate up to 20–30° toward a lighter or darker hue. Greys can be warm or cool through saturation ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **Tinted surfaces get tinted ink.** On a coloured background, hand-pick text of the same hue rather than putting grey on top ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)). Tint borders, shadows and text toward the same hue on non-neutral backgrounds ([Vercel WIG, Design](https://github.com/vercel-labs/web-interface-guidelines)).

### 4.3 Contrast

- **Thresholds:** 4.5:1 for small text and 3:1 for large text (WCAG 2, cited by [Stripe](https://stripe.com/blog/accessible-color-systems)), and 3:1 for UI graphics. Apple's floor is 4.5:1, and it asks you to "strive for 7:1, especially in small text" for custom colours ([HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)). Vercel prefers APCA to WCAG 2 for perceptual accuracy ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- **Interaction states increase contrast:** `:hover`, `:active` and `:focus` have more contrast than rest ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).

### 4.4 Dark mode

- **Dark is not an inversion.** Use dimmer backgrounds and brighter foregrounds. The system has **base** colours (dimmer, recede) and **elevated** colours (brighter, advance) for layered UI ([Apple HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)).
- **Elevation in dark mode is lighter surface, not shadow.** Material 2 overlays white at 0% for 0 dp, 5% for 1 dp, 9% for 4 dp, 12% for 8 dp and 16% for 24 dp on a dark grey, not black ([Material dark theme](https://m2.material.io/design/color/dark-theme)). Raycast builds elevation from a surface ladder, never drop shadows (3p).
- **No pure black:** "true black feels unnatural" ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)). But a default `#0B0B0B` or `#111` is itself a tell (§11, SD4). Derive the dark base from the tinted neutral ramp deliberately.
- **Plumbing.** Set `color-scheme: dark` on `<html>`, `<meta name="theme-color">` matching the page background, and explicit `background-color` and `color` on native `<select>` ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Switching themes must not fire transitions: disable them during the switch ([Paco Coursey, next-themes `disableTransitionOnChange`](https://github.com/pacocoursey/next-themes); [Rauno](https://github.com/raunofreiberg/interfaces)).
- **Don't offer an app-specific appearance setting;** follow the system ([Apple HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)). This is a judgement call for the web, where a toggle is common. If one is kept, default to the system.

## 5. Surfaces: fills, borders, shadows, radii

- **Prefer fewer borders.** Borders "make a layout very busy and cluttered". The alternatives are a different background colour, more space, or a subtle shadow ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)). Linear's 2026 refresh softened the contrast of borders and separators because they "had quietly proliferated" ([Linear](https://linear.app/now/behind-the-latest-design-refresh)).
- **Two tiers.** The flat, tiled data layer has no shadow. Floating layers (popover, menu, dialog, command palette) get radius and shadow ([Linear, as read by marcus-skills](https://github.com/marcus/marcus-skills/blob/main/skills/linear-design-patterns/references/linear-design-system.md) (3p)). Mercury's elevation is tonal and its cards are separated by fill, not borders (3p).
- **When shadows are used, layer them.** Use at least two layers, ambient and direct ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). The large soft layer is direct light and the small, tight, dark layer is ambient. As an element rises, the soft layer grows and the tight one fades. Define about 5 shadows from smallest to largest: small for buttons, medium for dropdowns, large for modals ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)). Combine a semi-transparent border with the shadow for crisp edges ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- **Radius scale:** 4/6/8/12/16 px plus pill at Linear (3p) and Vercel (3p), and 4/6/8/10/16 at Raycast (3p).
  - Controls use 6–8 px, panels 8–12 px, chips 4 px or a pill.
  - Nested radii are concentric (inner = outer − padding) and the child's radius is at most the parent's ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
  - Radius signals personality: none reads as serious and formal, small as neutral, large as playful ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
  - Mixing a 100 px pill CTA with a 6 px nav radius on the same screen is a "don't" at Vercel (3p).
- **The anti-pattern is the SaaS card kit:** every block in an identical rounded card, one radius everywhere, the same soft grey `rgba(0,0,0,.1)` shadow and gradient washes (§11). The 1 px grey border around every card is the same instinct.

## 6. Icons

- **Fewer, smaller icons with no chip backgrounds.** Linear's refresh "reduces icon usage, scales their sizes down, and removes unnecessary visual treatments like colored team icon backgrounds" ([Linear](https://linear.app/now/behind-the-latest-design-refresh)). The stock "icon in a tinted rounded square" is a tell (§11).
- **Consistency.** Keep one size, level of detail, stroke weight and perspective across all interface icons. "Match the weights of interface icons and adjacent text." Optically centre asymmetric icons ([Apple HIG Icons](https://developer.apple.com/design/human-interface-guidelines/icons)). When an icon and text sit side by side, balance their weight: a thin icon next to medium text needs a heavier stroke ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Icons carry a lot of pixel weight, so reduce their contrast or thicken the line ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **All or none in a list.** "Avoid having a list of actions where some have icons and some don't" ([Raycast store guidelines](https://github.com/raycast/extensions/blob/main/docs/basics/prepare-an-extension-for-store.md)).
- **Prefer a word when it is clearer;** icon-only buttons need an `aria-label` ([Apple HIG Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Never use emoji as icons ([Apple HIG Icons](https://developer.apple.com/design/human-interface-guidelines/icons)).
- **Synthesis:** icon box about 1.15–1.25 × the text size (16 px icon with 13–14 px text, 20 px with 16 px), and stroke 1.25–1.5 px at 16 px to match 400–500 text.

## 7. Data display: numbers, tables, charts

- **Numbers.**
  - `font-variant-numeric: tabular-nums` for comparisons ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines), [Rauno](https://github.com/raunofreiberg/interfaces)).
  - Right-align numbers, left-align everything else, never centre long text ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
  - Numerals for counts ("8 pools"), a non-breaking space between number and unit (`10 MB` → `10&nbsp;MB`), currency with 0 or 2 decimals but never both in one context, and locale-aware formatting ([Vercel WIG, Content & Copywriting](https://github.com/vercel-labs/web-interface-guidelines)).
  - Stripe sets `tnum` on every money cell (3p).
- **Precision:** "excessive detail or precision" is one of Few's dashboard mistakes ([Few](https://learn.saylor.org/mod/book/tool/print/index.php?id=82385)). Use about 3 significant figures for headline money ($26.1M) and 1 decimal for scores, and don't show values like "1,071.11 WETH" next to "$2.6M" unless the user asks.
- **Charts.** Bars start at zero. Use familiar tick sequences (0, 5, 10). Tailor gridlines: too many overwhelm, too few prevent estimation. Align a chart's leading edge with the surrounding views. Add separators between stacked colour segments. Give each chart a descriptive title or caption that states the takeaway. Several charts of one dataset share type, colours and annotations ([Apple HIG Charts](https://developer.apple.com/design/human-interface-guidelines/charts), [Charting data](https://developer.apple.com/design/human-interface-guidelines/charting-data)).
- **Status needs redundant cues:** text or shape as well as colour ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines), [Apple HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)).
- **Show chips only for real, changing state,** in one visual language. "Status-chip soup" is a tell (§11, K12).
- **Use a real table for genuinely columnar data;** content and feeds become styled row lists ((3p) [marcus-skills Linear](https://github.com/marcus/marcus-skills/blob/main/skills/linear-design-patterns/references/linear-design-system.md)). Table cells may carry hierarchy (weight, secondary line, colour) instead of every column shouting at equal weight ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **Deep-link every filter, sort, tab and pagination state,** and restore the scroll position on Back ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).

## 8. Motion, transitions and interaction feedback

Durations, all under 300 ms for UI ([Emil Kowalski, emil-design-eng](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md); [Great animations](https://emilkowal.ski/ui/great-animations)):

| Element                | Duration   |
| ---------------------- | ---------- |
| Button press feedback  | 100–160 ms |
| Tooltip, small popover | 125–200 ms |
| Dropdown, select       | 150–250 ms |
| Modal, drawer          | 200–500 ms |
- **Interactions** should stay at 200 ms or less to feel immediate ([Rauno](https://github.com/raunofreiberg/interfaces)).
- **Easing.**
  - Entering and exiting use ease-out. Movement on screen uses ease-in-out. Colour and hover changes use `ease`. Never use ease-in for UI.
  - Use strong custom curves: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` and `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)).
  - Bounce and elastic easing is a tell (§11).
- **Size of motion.** Press with `scale(0.97)` (range 0.95–0.98) and never scale a button to 0.8 ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md); [Rauno](https://github.com/raunofreiberg/interfaces): about 0.96). Enter from `scale(0.95)` with `opacity: 0`, never from `scale(0)`. Dialogs start at about 0.8 or more ([Rauno](https://github.com/raunofreiberg/interfaces)). Popovers scale from their trigger (`transform-origin`), while modals stay centred.
- **Frequency rule.**
  - Actions performed 100+ times a day get no animation. Actions performed tens of times a day (hover, list navigation) get reduced or no animation. Occasional moments (modals, toasts) get standard motion. Only rare moments get "delight".
  - Never animate keyboard-initiated actions.
  - Raycast has no open/close animation ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)).
  - Right-click menus, list add/remove and trivial hovers should not animate in ([Rauno](https://github.com/raunofreiberg/interfaces)).
  - "Avoid adding motion to UI interactions that occur frequently" ([Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)).
- **Purpose test:** spatial consistency, state change, feedback, or preventing a jarring jump. "It looks cool" fails for anything seen often ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)).
- **One orchestrated moment beats scattered effects.** Fade-and-slide-up on every section and hover lifts on every card read as template defaults (§11). Stagger 30–80 ms between items when there is a stagger at all, and never block input while it plays ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)). Do not use count-up numbers (§11).
- **Implementation.**
  - Animate only `transform` and `opacity`, and never use `transition: all` ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
  - Use CSS transitions rather than keyframes for anything that can be interrupted ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)). Prefer CSS, then WAAPI, then a JS library.
  - Animations must be interruptible ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines); [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion): "let people cancel motion").
  - Exit runs faster than enter ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)).
- **Hover and touch.**
  - Gate hover effects behind `@media (hover: hover) and (pointer: fine)` ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md), [Rauno](https://github.com/raunofreiberg/interfaces)).
  - Set `touch-action: manipulation` on controls and replace the tap highlight with a designed one ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- **Tooltips:** delay the first one, then open its peers instantly with no animation ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines), [Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)). Prefer inline help, with tooltips as a last resort ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- **Focus.** Show a visible `:focus-visible` ring and never cover the focused element with sticky UI ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). A box-shadow ring follows the radius ([Rauno](https://github.com/raunofreiberg/interfaces)).
- **Reduced motion means fewer, gentler animations, not zero.** Keep opacity and colour, and drop movement ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)).
- **Feedback appears next to its trigger,** for example an inline check after Copy rather than a toast ([Rauno](https://github.com/raunofreiberg/interfaces)).

## 9. Empty, loading and error states

- **Loading.**
  - Wait 150–300 ms before showing a spinner or skeleton, then keep it for at least 300–500 ms so it doesn't flicker ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
  - Skeletons "mirror final content exactly to avoid layout shift" ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
  - Show something as soon as possible ([Apple HIG Loading](https://developer.apple.com/design/human-interface-guidelines/loading)).
  - Don't render "No results" before the data has loaded ([Raycast](https://github.com/raycast/extensions/blob/main/docs/basics/prepare-an-extension-for-store.md)).
  - A loading button keeps its label and adds an indicator. Loading text ends with "…" ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- **Empty.** Every screen offers a next step or a way to recover ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). An empty state prompts the next action and hides chrome for actions the user cannot take yet ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI), [Rauno](https://github.com/raunofreiberg/interfaces)).
- **Errors.**
  - Say what happened and how to fix it, and don't apologise ([Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
  - Example: "Your API key is incorrect or expired. Generate a new key…" ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
  - Avoid "we": "Unable to load content" beats "We're having trouble…" ([Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
- **Design every state:** empty, sparse, dense and error ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). Layouts must survive short, average and very long content.

## 10. Copy tone

- **Plain and specific.** Name things by what users understand, describe rather than sell, and be specific over clever. "Check each word to be sure it needs to be there" ([Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
- **Buttons.** Use verb + noun ("Update customer"), sentence case and no end punctuation. Single-word exceptions are Done, Close, Cancel, Add and Delete ([Stripe button docs](https://docs.stripe.com/stripe-apps/components/button)). "Save API key" beats "Continue" ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)). An action keeps its name through the flow: "Publish" leads to a confirmation reading "Published".
- **Case:** choose one case per element type and apply it everywhere ([Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)). Vercel uses Title Case for product headings, which it calls Vercel-specific, and sentence case on marketing pages. For Depthwatch, use sentence case throughout.
- **Voice.**
  - Use active voice and the second person, and avoid "we" ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines), [Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
  - Use possessives ("Your…") sparingly.
  - Don't write "click here"; links describe their destination ([Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
- **Typographic details:** curly quotes, the `…` character, and non-breaking spaces in glued terms ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines)).
- **Hollow copy:**
  - Vague aspirational headlines, tricolon slogans ("Fast. Simple. Powerful.") and generic CTAs.
  - A band of round stats ("10,000+ users · 99.9% uptime") built from hollow numbers.
  - The stat-tile hero: a big number with a small label, supporting stats and a gradient accent is the default landing-page hero.

## 11. Template patterns

These are the patterns a page acquires by taking framework and scaffold defaults without choosing anything. The IDs (SD1–SD6, K11, K12, S1, X1) are the labels used across these notes and in [principles.md §16](../principles.md). A Reddit study of 3.2M posts across 47 subreddits found the loudest complaint about such pages is "they all look the same" (about 13% of on-topic posts), with shadcn/Tailwind defaults and purple gradients ranked first ([vibecoded-design-tells](https://github.com/JCarterJohnson/vibecoded-design-tells)).

**First-order defaults:** purple-to-blue gradients, gradient headline text, Inter or system-ui for everything, untouched shadcn (`rounded-2xl shadow-lg`, the default `--radius`), a centred hero over three identical icon cards, icons in tinted rounded squares, emoji bullets, glassmorphism by reflex, coloured glow shadows, the default four-column footer, and count-up stats.

**Second-order "tasteful" defaults** (where a first pass away from the first-order defaults usually lands):
- SD1: cream with terracotta.
- SD2: near-black with one acid-green or vermilion accent.
- SD3: broadsheet cosplay with hairlines, 0 radius and dense columns.
- SD4: template chrome — tracked ALL-CAPS eyebrows, `A · B · C` meta, `WORD — fragment` labels, mono for small labels, `#111` near-black and a `→` on every link.
- SD5: one accented word in the headline.
- SD6: decorative 01/02/03 markers.
- K11: cards inside cards.
- K12: status-chip soup.
- S1: uniform padding.
- X1: design drift across pages.

**Squint and silhouette tests:** shrink a screenshot to 25%. If every section weighs the same, or the block silhouette could belong to any product, it fails (S1).

### Observed in the v2 dashboard

| Tell                                  | Where in v2                                                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Big number + small label stat block   | The Home hero's right-hand "ALL SCORED POOLS" box has 4 stats, each with a caption, beside the headline.                                                                                                             |
| ALL-CAPS tracked labels (SD4/T5)      | Every table header ("24H VOLUME", "DEPTH ±2%", "GAP SCORE"), "ALL SCORED POOLS", the pool-header stats ("PRICE (USDC PER WETH)") and "WINDOW / SAMPLES". There are 4 uppercase CSS rules at +0.07 em.                |
| Middle-dot meta (SD4d)                | Footer "Open source · no token · no custody · read-only", "Block 52,950,000 · updated just now", "±1 · 2 · 5 %", and "36 / 84 samples within KPI · up = within, down = breached".                                    |
| Mono for small labels (SD4m)          | "$1k · $10k · $100k", "top-1 · top-3 · HHI" and "24 h · 7 d" in the "What we measure" cards; axis ticks.                                                                                                             |
| `→` stapled to links (CP3)            | "All gaps →", "All scorecards →", "Methodology →", "Open scorecard →".                                                                                                                                               |
| `WORD — fragment` (SD4w)              | Banner "Demo data — synthetic Base world: …".                                                                                                                                                                        |
| Identical cards / card kit (L2/K2)    | Four identical "What we measure" cards. Every section is a bordered white box with the same radius. Pools opens with 5 identical DEX tiles × 3 metrics (15 numbers) before the table.                                |
| Chip soup (K12)                       | Rows carry a DEX chip + fee + "stable" chip + grade chip. Scorecards add "synthetic" + a status pill + the badge.                                                                                                    |
| Decorative device                     | The section-divider glyph is repeated 3× on Home.                                                                                                                                                                    |
| Flat hierarchy / everything explained | Captions sit under every stat and an explainer under every heading. The pool header shows 8 equal-weight stats and the pool page 6 equal panels, with no single answer ("is this pool healthy and how deep is it?"). |
| Duplicated content                    | The gaps table appears on both Home and Pools.                                                                                                                                                                       |
| Colour weight in the wrong place      | The most saturated pixels on Home are the red/green uptime tapes and the red "Breached" pill of a _demo_ scorecard, not the product's core answer.                                                                   |
| Length                                | Phone Home is about 3,560 CSS px tall, about 4.2 screens at 844 px.                                                                                                                                                  |

## 12. Product notes (what to take from each)

- **Linear.**
  - The redesign targeted noise, alignment, and the hierarchy and density of navigation.
  - The theme comes from 3 inputs (base, accent, contrast) in LCH, replacing 98 variables.
  - Headings use Inter Display.
  - The default themes gained contrast ([part II](https://linear.app/now/how-we-redesigned-the-linear-ui), [changelog 2024-03-20](https://linear.app/changelog/2024-03-20-new-linear-ui)).
  - 2026: the sidebar is dimmer, there are fewer and smaller icons with no coloured icon backgrounds, borders are softer, and the tab bar is more compact ([A calmer interface](https://linear.app/now/behind-the-latest-design-refresh)).
  - Redesigns are best done in big sweeps, not one view at a time ([A design reset](https://linear.app/now/a-design-reset)).
- **Vercel / Geist.**
  - The Web Interface Guidelines cover nearly every rule in §§3–10.
  - Geist has 10-step colour scales with fixed jobs, Label versus Copy text styles, and gray-alpha only for see-through layers ([guidelines repo](https://github.com/vercel-labs/web-interface-guidelines), [Geist colors](https://vercel.com/geist/colors), [Geist typography](https://vercel.com/geist/typography)).
  - The marketing type is weight 600 with tight tracking and sentence case, the display ceiling is 600, and shadows are stacked with an inset hairline (3p).
- **Stripe.**
  - Perceptual (CIELAB) colour levels give contrast that is predictable from the level distance alone.
  - Badges shift background and text up one level together ([accessible color systems](https://stripe.com/blog/accessible-color-systems)).
  - `tnum` is on all money cells, display weight is 300, and there is one filled CTA per band (3p).
  - Button copy rules ([Stripe Apps button](https://docs.stripe.com/stripe-apps/components/button)).
- **Mercury (3p).**
  - Light weights: body 360–420, headlines 480, never above 500.
  - One solid indigo action per group, with secondary actions translucent.
  - Cards are separated by fill, not borders or heavy shadows; elevation is tonal.
  - Status colours are kept out of the chrome ([extraction](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/mercury/DESIGN.md)).
- **Ramp (3p).** A black-and-white editorial system with one highlighter-yellow accent (#e4f222) and Lausanne; the interface is near-monochrome with hairline borders ([refero](https://styles.refero.design/style/b38702a0-75ab-474c-9106-00b624535825), [Bakken & Bæck](https://bakkenbaeck.com/case/ramp)). No official design write-up was found.
- **Raycast.**
  - No open or close animation for a tool used hundreds of times a day ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)).
  - Icons are all-or-none in action lists, and there is no empty-state flicker ([store guidelines](https://github.com/raycast/extensions/blob/main/docs/basics/prepare-an-extension-for-store.md)).
  - Elevation comes from a surface ladder, card padding is 16–24 px, and saturated accents appear only inside illustrations (3p).
- **Arc.**
  - Meant to feel "calming", with a sidebar-first layout and a command bar ([Product Salon](https://productsalon.substack.com/p/piece-no-1-arc-browser)).
  - Panes are separated by tinted washes rather than borders ([open-design](https://open-design.ai/plugins/design-system-arc/), (3p)).
  - No official design write-up was found.
- **Apple HIG.**
  - Minimum and default text sizes and the tracking tables.
  - The accent colour "judiciously", plus base and elevated dark backgrounds.
  - 4.5:1 minimum contrast, striving for 7:1.
  - Avoid motion on frequent interactions; icon weight matches text; use "Unable to…" instead of "We're having trouble…" ([HIG](https://developer.apple.com/design/human-interface-guidelines)).
- **Refactoring UI.**
  - Spacing and type scales, 3 text colours and 2 weights, 9-step greys and fewer borders.
  - Two-part shadows; right-aligned numbers; empty states.
  - Choose from 3 options in your system rather than inventing values ([notes](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **Rauno Freiberg.**
  - "Invisible Details of Interaction Design": frequent, low-novelty actions deserve no flourish, gestures keep their momentum, and metaphors are reused so learning compounds; Fitts's law ([essay](https://rauno.me/craft/interaction-design), via search).
  - His interfaces list: ≤ 200 ms, press scale about 0.96, never weights below 400, headings at 500–600, tabular figures, and hover gated on `(hover: hover)` ([repo](https://github.com/raunofreiberg/interfaces)).
- **Paco Coursey.** Disable transitions during a theme change, never flash the wrong theme on load ([next-themes](https://github.com/pacocoursey/next-themes), [paco.me/writing/disable-theme-transitions](https://paco.me/writing/disable-theme-transitions)), and offer a ⌘K command menu ([cmdk](https://github.com/pacocoursey/cmdk)).
- **Emil Kowalski.** Durations, curves, the frequency rule, `scale(0.97)` on press, never `scale(0)`, origin-aware popovers, stagger of 30–80 ms, and "a professional dashboard should be crisp and fast" ([skills](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md), [Great animations](https://emilkowal.ski/ui/great-animations)).

## 13. Recommendations for Depthwatch v3 (synthesis)

- **Type.**
  - One neutral grotesk with an optical display cut (or a second, clearly distinct display face) plus a mono used only for addresses and code.
  - Scale: 12 / 13 / 14 / 16 / 20 / 24 / 32 / 48 px.
  - Weights: 400, 500 and 600 (display ≤ 600).
  - Tracking: 0 at ≤ 16 px, −0.015 em at 20, −0.02 em at 24, −0.025 em at 32 and −0.03 em at 48.
  - Line-height: 1.25 for UI, 1.5 for copy and 1.05–1.15 for display.
  - No uppercase labels; table headers are 12–13 px, sentence case, at secondary text colour.
- **Spacing.** Use 4/8/12/16/24/32/48/64/96 px. Within a group, use 4–12. Between groups, use 24–32. Between sections, use 64–96 on the landing page and 48 inside the product.
- **Colour.**
  - A 12-step tinted neutral ramp in OKLCH for each theme.
  - One accent for links, focus and selection.
  - Bid and ask hues used only in depth marks.
  - Green, amber and red appear only on grade and breach states. Keep grades as small, quiet glyphs; reserve fills for the single focal grade.
  - Dark mode is built from base and elevated steps, with no shadows.
- **Surfaces.** The page background equals the table background; there is no "white card on grey page" for every section. Use a hairline only between rows and between major regions. Radii are 6 px for controls, 10 px for the rare panel and 4 px for chips, concentric when nested. Shadows only for popovers and menus.
- **Information budget.**
  - Home opens with one answer: Base's total ±2 % depth and a single visual of where it sits. Gaps and scorecards follow as short lists of 3–5 items each.
  - Explanations move into one "How to read this" disclosure per page, not a caption under every number.
  - Pools shows a single table with about 6 columns by default; more columns are behind a toggle and the DEX summary tiles are removed.
  - The pool page opens on the depth ladder and grade, and other panels follow in order of importance.
- **Motion.**
  - Route change: none, or a 120–150 ms opacity crossfade.
  - Hover: colour or background in 120 ms ease.
  - Press: `scale(0.97)` over 120 ms.
  - Popovers: 150–200 ms with `cubic-bezier(0.23, 1, 0.32, 1)` from `scale(0.96)`.
  - No scroll reveals, no count-ups, no transitions on theme switch.
- **States.** Skeletons that match the final layout, 200 ms show-delay, 400 ms minimum display, and empty states that say what to do next.
- **Copy.** Sentence case, no "we", no arrows in links, no middle-dot strings (use real separators or layout), and verb + noun buttons.

## 14. Sources

| Source                                                                      | URL                                                                                                                                                                                            | Read via                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Linear, How we redesigned the Linear UI (part II)                           | https://linear.app/now/how-we-redesigned-the-linear-ui                                                                                                                                         | search summaries              |
| Linear, A design reset (part I)                                             | https://linear.app/now/a-design-reset                                                                                                                                                          | search summaries              |
| Linear changelog, Welcome to the new Linear (2024-03-20)                    | https://linear.app/changelog/2024-03-20-new-linear-ui                                                                                                                                          | search summaries              |
| Linear, A calmer interface for a product in motion                          | https://linear.app/now/behind-the-latest-design-refresh                                                                                                                                        | search summaries              |
| Vercel Web Interface Guidelines                                             | https://vercel.com/design/guidelines · https://github.com/vercel-labs/web-interface-guidelines                                                                                                 | raw GitHub (full text)        |
| Geist colors / typography                                                   | https://vercel.com/geist/colors · https://vercel.com/geist/typography                                                                                                                          | search summaries              |
| Stripe, Designing accessible color systems (2019)                           | https://stripe.com/blog/accessible-color-systems                                                                                                                                               | search summaries              |
| Stripe Apps button guidelines                                               | https://docs.stripe.com/stripe-apps/components/button                                                                                                                                          | search summaries              |
| Apple Human Interface Guidelines                                            | https://developer.apple.com/design/human-interface-guidelines (typography, color, dark-mode, layout, motion, writing, charts, charting-data, buttons, icons, accessibility, branding, loading) | Apple JSON (full text)        |
| Refactoring UI (Wathan & Schoger), notes                                    | https://www.refactoringui.com · https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI                                                                                                   | raw GitHub wiki               |
| Rauno Freiberg, Invisible Details of Interaction Design                     | https://rauno.me/craft/interaction-design                                                                                                                                                      | search summaries              |
| Rauno Freiberg, interfaces                                                  | https://github.com/raunofreiberg/interfaces                                                                                                                                                    | raw GitHub (full text)        |
| Emil Kowalski, skills (emil-design-eng) / Great animations                  | https://github.com/emilkowalski/skills · https://emilkowal.ski/ui/great-animations                                                                                                             | raw GitHub; search summaries  |
| Paco Coursey, next-themes / cmdk / disable theme transitions                | https://github.com/pacocoursey/next-themes · https://github.com/pacocoursey/cmdk · https://paco.me/writing/disable-theme-transitions                                                           | raw GitHub                    |
| Radix Colors, Understanding the scale                                       | https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale                                                                                                               | raw GitHub (radix-ui/website) |
| Inter dynamic metrics (v3)                                                  | https://d.rsms.me/inter-website/v3/dynmetrics/ · https://github.com/rsms/inter/blob/v3.19/docs/dynmetrics/index.html                                                                           | raw GitHub                    |
| Material Design 2, Dark theme                                               | https://m2.material.io/design/color/dark-theme                                                                                                                                                 | search summaries              |
| Raycast, Prepare an extension for the Store                                 | https://github.com/raycast/extensions/blob/main/docs/basics/prepare-an-extension-for-store.md                                                                                                  | raw GitHub                    |
| vibecoded-design-tells (Reddit study)                                       | https://github.com/JCarterJohnson/vibecoded-design-tells                                                                                                                                       | raw GitHub                    |
| VoltAgent awesome-design-md (Linear, Vercel, Stripe, Mercury, Raycast) (3p) | https://github.com/VoltAgent/awesome-design-md                                                                                                                                                 | raw GitHub                    |
| marcus-skills, Linear design system reference (3p)                          | https://github.com/marcus/marcus-skills/blob/main/skills/linear-design-patterns/references/linear-design-system.md                                                                             | raw GitHub                    |
| NN/g, Aesthetic and minimalist design                                       | https://www.nngroup.com/articles/aesthetic-minimalist-design/                                                                                                                                  | search summaries              |
| Lindgaard et al. 2006 (Nature news)                                         | https://www.nature.com/news/2006/060109/full/news060109-13.html                                                                                                                                | search summaries              |
| Stephen Few, dashboard principles (summary)                                 | https://learn.saylor.org/mod/book/tool/print/index.php?id=82385                                                                                                                                | search summaries              |
| Ramp (3p)                                                                   | https://styles.refero.design/style/b38702a0-75ab-474c-9106-00b624535825 · https://bakkenbaeck.com/case/ramp                                                                                    | search summaries              |
| Arc (3p)                                                                    | https://productsalon.substack.com/p/piece-no-1-arc-browser · https://open-design.ai/plugins/design-system-arc/                                                                                 | search summaries              |
