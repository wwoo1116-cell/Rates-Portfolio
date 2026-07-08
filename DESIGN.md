---
name: KRW IRS NPV Pricer
description: Institutional swap-pricing terminal — flat, hairline-bordered, one confident blue.
colors:
  primary: "oklch(0.528 0.263 262.9)"
  primary-foreground: "oklch(1 0 0)"
  accent-tint: "oklch(0.960 0.019 263.0)"
  background: "oklch(0.985 0.004 247.9)"
  card: "oklch(1 0 0)"
  foreground: "oklch(0.240 0.020 255)"
  muted: "oklch(0.960 0.006 247.9)"
  muted-foreground: "oklch(0.480 0.020 255)"
  border: "oklch(0.872 0.009 258.3)"
  positive: "oklch(0.500 0.153 160.9)"
  negative: "oklch(0.557 0.200 27.7)"
typography:
  display:
    fontFamily: "Inter, Pretendard Variable, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
  headline:
    fontFamily: "Inter, Pretendard Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, Pretendard Variable, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    fontFeature: "tabular-nums"
  label:
    fontFamily: "Inter, Pretendard Variable, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.08em"
  body:
    fontFamily: "Inter, Pretendard Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, SF Mono, Fira Code, Menlo, Consolas, monospace"
    fontFeature: "tabular-nums"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "20px"
---

# Design System: KRW IRS NPV Pricer

## 1. Overview

**Creative North Star: "The Trading Terminal"**

This is a desk tool, not a marketing surface: a trader reads a number, trusts it, and moves on. The system is built around one rule — surfaces are flat, separated only by a hairline border or a shift in background tone, never by a shadow. The only saturated color in the whole interface is a single confident blue, spent on the handful of things that are actually actionable (the primary CTA, an active toggle, a selected state); everything else is ink, paper, and hairline gray. Numbers are always tabular so a column of rates or a book of NPVs lines up and scans in a glance, the way a real terminal does.

This system explicitly rejects the generic AI-dashboard reflex: identical bordered cards nested inside other cards, tiny uppercase "eyebrow" labels glued above every section out of habit rather than intent, gradients, and glow-shadows standing in for hierarchy. Hierarchy here comes from type weight, size, and whitespace — the box is the exception, not the default.

**Key Characteristics:**
- Flat by default; no shadow except on true floating overlays (popover, tooltip)
- One accent color (Coinbase Blue), spent sparingly and only on actionable elements
- Hairline (1px solid) borders as the only separator between adjacent surfaces
- All monetary/rate figures set in tabular numerals
- 8px corner radius as the single, uniform rounding value across buttons, inputs, and cards

## 2. Colors

Quiet institutional neutrals carry the interface; one saturated blue marks everything actionable.

### Primary
- **Coinbase Blue** (`#0052FF` / `oklch(0.528 0.263 262.9)`): the single accent. Primary CTA (`포트폴리오 계산`), the active/selected state of every toggle (True/CCP data source, pay/receive, chart-type switch), active nav item, focus rings. Never used decoratively — its presence always means "this is selected" or "this is the action."

### Neutral
- **Paper** (`oklch(0.985 0.004 247.9)` ≈ `#FAFAFC`): page background.
- **Surface** (`oklch(1 0 0)` / `#FFFFFF`): card and panel background — one step brighter than Paper so panels read as distinct without a border being required to prove it.
- **Ink** (`oklch(0.240 0.020 255)` ≈ `#1C2333`): primary text.
- **Ink Muted** (`oklch(0.480 0.020 255)` ≈ `#5B616E`): secondary text, field labels, eyebrow labels, units.
- **Fill** (`oklch(0.960 0.006 247.9)` ≈ `#F3F4F6`): subtle background tint for inline highlights (e.g. the CD rate strip) and the CCP curve-entry grid.
- **Hairline** (`oklch(0.872 0.009 258.3)` / `#D1D5DB`): the one and only border color. Deliberately a shade darker than the previous system's near-invisible border — a hairline must actually be visible to do its job as a structural separator instead of a shadow.
- **Accent Tint** (`oklch(0.960 0.019 263.0)` ≈ `#EBF2FF`): pale blue, used only for hover/selected backgrounds on flat (unbordered) toggle buttons — keeps hover states tied to the one brand hue instead of a generic neutral gray.

### Semantic
- **Positive** (`oklch(0.500 0.153 160.9)` / `#007C45`): positive NPV / P&L. Darkened from the initial `#00B67A` pick — that only cleared 2.63:1 against white (fails WCAG AA); this shade clears 5.29:1.
- **Negative** (`oklch(0.557 0.200 27.7)` / `#CF2B27`): negative NPV / P&L, error text on Paper/Surface. 5.21:1 against white.
- **Negative (on Primary)** (`oklch(0.98 0.02 27.7)` / `#FFF4F1`): the *same semantic* error color, re-tuned for the one place error text sits directly on Coinbase Blue (the header's market-data-error banner) — `--negative` itself is ~1.1:1 there and unreadable. This near-white red tint clears 4.5:1 against both the light- and dark-mode primary.

### Named Rules
**The One Blue Rule.** Coinbase Blue appears only on elements the user can act on (submit, active toggle, focus ring, active nav). If it's not clickable or currently selected, it isn't blue.

## 3. Typography

**Body/UI Font:** Inter (Latin/numerals), Pretendard Variable (Korean), system sans fallback
**Mono Font:** ui-monospace / SF Mono / Fira Code — every monetary and rate value, always with `font-variant-numeric: tabular-nums`

**Character:** Functional and dense. Korean field labels sit at body weight; the only "display" moment in the whole system is the Net NPV headline figure — this is a terminal, not a magazine, so scale is spent on the number that matters, not on decorative headings.

### Hierarchy
- **Display** (700, 1.875rem/30px, tabular-nums): the single Net NPV headline figure — the one number the whole screen exists to produce.
- **Title** (600, 1.125rem/18px, tabular-nums): secondary stat values (Payer NPV, Receiver NPV) — visibly subordinate to Display, still clearly larger than body so the reader doesn't have to squint to compare them.
- **Headline** (600, 0.875rem/14px, tracking -0.01em, full Ink not muted): section titles (`포지션 입력`, `가격 결과`, `Historical PnL`). Same size as Body — the contrast is weight and color, not size; a section title is structure, not a bigger font.
- **Body** (400, 0.875rem/14px): field values, table cells, breakdown rows.
- **Label** (600, 0.6875rem/11px, tracking 0.08em, uppercase, Ink Muted): field labels and eyebrow captions (`NPV`, `NPV Breakdown`, `Net NPV`, `포지션 N` index) — used deliberately for specific recurring roles, not glued above every section by reflex.

Scale ratio note: Headline and Body share one size on purpose (14px) — for this dense, product-register UI, weight + color carry the section-title contrast so the scale doesn't need a size step there. The real size steps are Label(11px) → Body/Headline(14px) → Title(18px) → Display(30px), each with enough gap to read as a distinct tier at a glance.

### Named Rules
**The Tabular Rule.** Any element displaying a monetary amount, a rate, or a P&L figure sets `font-variant-numeric: tabular-nums` (or the app's monospace stack, which is tabular by construction) so stacked figures align column-for-column. Never proportional numerals for a number a trader has to scan down a list.

## 4. Elevation

Flat by default. This system uses zero ambient shadows on structural surfaces — cards and panels are separated from the page and from each other by a 1px solid Hairline border, full stop. No shadow, no tonal-only separation. Depth is reserved for genuine floating overlays that sit *above* the page rather than *within* it.

### Shadow Vocabulary
- **overlay** (`box-shadow: 0 4px 16px rgb(0 0 0 / 0.12)`): the calendar date-picker popover — a real floating layer above page content.
- **tooltip** (`box-shadow: 0 2px 8px rgb(0 0 0 / 0.08)`): the chart crosshair tooltip — lighter than `overlay` since it trails the cursor rather than anchoring a click target.

### Named Rules
**The Flat-By-Default Rule.** If it sits in the document flow, it gets a hairline border, not a shadow. Shadows are earned only by elements that visually float above the page (popovers, tooltips) — never applied to a card just to make it "pop."

## 5. Components

Buttons, inputs, and cards share one visual grammar: 8px corners, a single 1px hairline, no shadow, no gradient.

### Buttons
- **Shape:** 8px radius (`{rounded.md}`), uniform across all variants.
- **Primary:** Coinbase Blue fill, white text, no border — the one filled, unbordered surface in the system, reserved for the single most important action per view (submit).
- **Outline / Toggle (unselected):** transparent background, Ink Muted text, no border at rest; `Accent Tint` background on hover. Selected state swaps to the Primary fill (no border either state — selection is communicated by fill, not by a ring).
- **Ghost (icon-only, e.g. remove row):** transparent, Ink Muted, `Fill` background on hover.

### Cards / Containers
- **Corner Style:** 8px (`{rounded.md}`), matching buttons/inputs so the whole surface reads as one system.
- **Background:** Surface (`#FFFFFF`) on Paper (`#FAFAFC`).
- **Shadow Strategy:** none (see Elevation → Flat-By-Default Rule).
- **Border:** 1px solid Hairline (`#D1D5DB` / `oklch(0.872 0.009 258.3)`) on every top-level card — this is the system's *only* separator, so it does the full job alone. Nested rows within a card use the Hairline as a `divide-y` separator instead of a second bordered box; never a bordered card inside a bordered card.
- **Internal Padding:** 20px (`{spacing.lg}`-ish; matches the codebase's existing `p-5` card padding).

### Inputs / Fields
- **Style:** Hairline bottom-border or full 1px hairline box (form fields use the full box; the CCP curve-entry grid uses an underline-only style since it's a dense spreadsheet-like grid, not a form).
- **Focus:** border shifts to Coinbase Blue; no glow/ring — the color change alone is the signal.
- **Error:** Negative-colored helper text beneath the field, not a red border (keeps Coinbase Blue as the only border-color change reserved for focus).

### Segmented Toggle (signature component)
The recurring pay/receive, True-Data/CCP-Data, and chart-type/granularity switches. Flat pill group: unselected segments are transparent with Ink Muted text; the selected segment is a solid Coinbase Blue fill with white text. No borders in either state — the fill alone communicates selection, keeping the system's "no border to prove a border" discipline where fill already does the job.

## 6. Do's and Don'ts

### Do:
- **Do** use exactly one hairline border color (`#D1D5DB` / `oklch(0.872 0.009 258.3)`) for every structural separator — cards, table rows, dividers.
- **Do** round every interactive surface (button, input, card) to the same 8px radius.
- **Do** set `font-variant-numeric: tabular-nums` on every monetary/rate/P&L value, no exceptions.
- **Do** reserve Coinbase Blue for actionable/selected elements only (The One Blue Rule).
- **Do** separate related rows within one panel with a hairline `divide-y`, not by wrapping each row in its own bordered card.

### Don't:
- **Don't** nest a bordered card inside another bordered card — one hairline is enough to say "this is a group."
- **Don't** add a drop shadow to any card, panel, button, or badge that isn't a genuine floating overlay (popover/tooltip).
- **Don't** use a gradient background or gradient text anywhere in the product.
- **Don't** glue a tiny uppercase tracked "eyebrow" label above every section reflexively — use the Headline type role for real section titles instead.
- **Don't** show related totals (e.g. Net/Payer/Receiver NPV) as identical equal-weight boxes; express the relationship through type scale (Display for the headline figure, Title for its supporting breakdown).
- **Don't** color-code positive/negative values by hue alone — always pair with a leading `+`/`-` sign for colorblind-safe legibility (per PRODUCT.md Accessibility).
- **Don't** pick a brand color at face value without checking contrast against its actual background — dark mode's primary is capped at `oklch(0.550 0.200 262.9)` specifically because a lighter, more "poppy" blue drops white button text below 4.5:1.
