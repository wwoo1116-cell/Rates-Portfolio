---
name: KRW FI / Rates Portfolio Management System
description: Marquee-dialect instrumentation for a KRW rates trading desk — dense, contrast-driven, semantically colored.
colors:
  bg-primary-dark: "#0F1419"
  bg-secondary-dark: "#1A2028"
  bg-tertiary-dark: "#2A323D"
  bg-elevated-dark: "#1E252F"
  bg-header-dark: "#0A0E14"
  fg-primary-dark: "#FFFFFF"
  fg-secondary-dark: "#A8B0BC"
  fg-muted-dark: "#9FA8B5"
  fg-dim-dark: "#929BA8"
  border-subtle-dark: "rgba(255,255,255,0.06)"
  border-strong-dark: "rgba(255,255,255,0.12)"
  bg-primary-light: "#FFFFFF"
  bg-secondary-light: "#F7F9FC"
  bg-tertiary-light: "#EDF1F7"
  bg-elevated-light: "#FFFFFF"
  fg-primary-light: "#0A0E14"
  fg-secondary-light: "#4B5563"
  fg-muted-light: "#5F6572"
  fg-dim-light: "#686C75"
  border-subtle-light: "rgba(0,0,0,0.06)"
  border-strong-light: "rgba(0,0,0,0.12)"
  sem-positive-dark: "#00C176"
  sem-negative-dark: "#FF4A5C"
  sem-risk-dark: "#F5A623"
  sem-info-dark: "#3B82F6"
  sem-positive-light: "#16A34A"
  sem-negative-light: "#DC2626"
  sem-risk-light: "#D97706"
  sem-info-light: "#2563EB"
  sem-positive-soft-dark: "rgba(0,193,118,0.14)"
  sem-negative-soft-dark: "rgba(255,74,92,0.14)"
  sem-risk-soft-dark: "rgba(245,166,35,0.14)"
  sem-info-soft-dark: "rgba(59,130,246,0.14)"
  sem-positive-soft-light: "#DCFCE7"
  sem-negative-soft-light: "#FEE2E2"
  sem-risk-soft-light: "#FEF3C7"
  sem-info-soft-light: "#DBEAFE"
  heat-pos-1: "#DCFCE7"
  heat-pos-2: "#4ADE80"
  heat-pos-3: "#22C55E"
  heat-pos-4: "#16A34A"
  heat-neg-1: "#FEE2E2"
  heat-neg-2: "#FCA5A5"
  heat-neg-3: "#EF4444"
  heat-neg-4: "#DC2626"
typography:
  display:
    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  h1:
    fontFamily: "var(--font-inter), Inter, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  h2:
    fontFamily: "var(--font-inter), Inter, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "var(--font-inter), Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-strong:
    fontFamily: "var(--font-inter), Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "var(--font-inter), Inter, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.06em"
  micro:
    fontFamily: "var(--font-inter), Inter, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  DEFAULT: "4px"
  md: "6px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.sem-info-dark}"
    textColor: "#FFFFFF"
    typography: "{typography.body-strong}"
    rounded: "{rounded.DEFAULT}"
    height: "32px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "rgba(59,130,246,0.9)"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.fg-primary-dark}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.DEFAULT}"
    height: "32px"
    padding: "0 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.fg-secondary-dark}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.DEFAULT}"
    height: "32px"
    padding: "0 16px"
  input-field:
    backgroundColor: "{colors.bg-tertiary-dark}"
    textColor: "{colors.fg-primary-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.DEFAULT}"
    height: "32px"
    padding: "0 12px"
  badge-soft-info:
    backgroundColor: "{colors.sem-info-soft-dark}"
    textColor: "{colors.sem-info-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.DEFAULT}"
    padding: "4px 8px"
---

# Design System: KRW FI / Rates Portfolio Management System

## 1. Overview

**Creative North Star: "The Marquee Dialect"**

This system speaks the same visual language as Goldman Sachs Marquee — not a clone, a dialect. It sits deliberately between two failure modes: Bloomberg's extreme density, where hierarchy collapses under its own information load, and Robinhood's extreme minimalism, which throws away the density this desk actually needs. The dialect's grammar is **information density with breathing room**: every pixel earns its place, and the room to breathe comes from luminance steps and typographic weight, never from empty decoration.

Two structural doctrines carry the whole system. First, **contrast-driven hierarchy** — structure is built from 2–5% luminance steps between background layers (`--bg-primary` → `--bg-secondary` → `--bg-tertiary` → `--bg-elevated`) and from type weight, never from hue. Second, **semantic color minimalism** — color is reserved for meaning (direction, state, status) and appears only as points: dots, badges, thin lines, emphasized digits. It is never a fill.

This system explicitly rejects: any card that "looks designed" (gradient, shadow, thick border, `rounded-lg`), decorative panel-background color used "for visual interest," gradient text, glassmorphism as a default treatment, numbers in a proportional font, and color used as the primary signal for hierarchy or meaning. Dark and light are not one palette inverted — dark is the trading/monitoring surface, light is the analysis/reporting surface, and each has its own deliberately tuned neutral and semantic ramp.

**Key Characteristics:**
- Backgrounds separated by luminance steps, never by borders
- Semantic color (green/red/amber/blue) used only as a meaningful point, never a fill
- Tabular, monospace numerics everywhere a number appears
- Big-figure notation (3-digit) for every rate and price display
- Dark = trading surface, Light = analysis surface — two tuned palettes, not an inversion

## 2. Colors

The palette is a controlled, mostly-neutral instrument panel with a single accent (Marquee Blue) and four reserved semantic signals — nothing else is permitted to carry color.

### Primary
- **Marquee Blue** (`#3B82F6` dark / `#2563EB` light): the single accent. Used for the primary CTA button, active nav indicator (2px left bar), input focus rings, selected-row background (`info-soft`), and the `info` semantic signal (status: connection state, category badges). This is the only color allowed to "lead" a screen.

### Neutral
- **Void Ink** (`#0F1419`, dark `bg-primary`): base canvas, dark mode.
- **Slate Panel** (`#1A2028`, dark `bg-secondary`): cards, panels, alternate table rows.
- **Graphite Field** (`#2A323D`, dark `bg-tertiary`): input fields, hover states.
- **Elevated Slate** (`#1E252F`, dark `bg-elevated`): modals, popovers.
- **Terminal Black** (`#0A0E14`, `bg-header-dark`): the dockview panel header bar — stays dark in *both* modes, the one deliberate Marquee signature exception to dual-mode separation.
- **Paper White** (`#FFFFFF`, light `bg-primary` / `bg-elevated`): base canvas, light mode.
- **Cool Mist** (`#F7F9FC`, light `bg-secondary`): panels, alternate table rows.
- **Frost Field** (`#EDF1F7`, light `bg-tertiary`): input fields, hover states.
- **Pure White text** (`#FFFFFF`, dark `fg-primary`) / **Terminal Black text** (`#0A0E14`, light `fg-primary`): primary reading text per mode.
- **Steel Grey** (`#A8B0BC`, dark `fg-secondary`) / **Dim Slate** (`#4B5563`, light `fg-secondary`): secondary text, labels.
- **Muted Slate** (`#9FA8B5` dark / `#5F6572` light, `fg-muted`): placeholders, de-emphasized labels, column headers. Tuned to clear 4.5:1 against `bg-tertiary` (the tightest surface in each mode) — the original `#6B7280` value measured as low as 2.7:1 there and has been retired.
- **Ash Slate** (`#929BA8` dark / `#686C75` light, `fg-dim`): the dimmest text tier still used for real text — big-figure base/unit digits, footnotes. Also tuned to clear 4.5:1 against `bg-tertiary`; the original dark value (`#4B5563`) measured as low as 1.7:1 there.

### Semantic
- **Trading Green** (`#00C176` dark / **Ledger Green** `#16A34A` light) — positive direction: gains, Buy/Sell-positive, `LIVE` status.
- **Trading Red** (`#FF4A5C` dark / **Ledger Red** `#DC2626` light) — negative direction: losses, `OFFLINE` status.
- **Signal Amber** (`#F5A623` dark / **Ledger Amber** `#D97706` light) — risk/caution: `STALE` status, warning states.
- **Marquee Blue** (see Primary) — info/neutral-positive signal: `info` badges, selection state.
- Soft variants (`-soft` suffix, 14% alpha in dark / flat pastel in light) exist **only** as badge backgrounds — never as panel fills.
- **Heatmap ramp** (`heat-pos-1..4` light greens, `heat-neg-1..4` light reds): reserved exclusively for Key Rate Duration heatmap pills inside the positions grid. Opacity/step encodes magnitude, hue encodes direction — this is the one place a color *gradient* is legitimate, because the gradient itself is the datum.

### Named Rules
**The Points-Not-Fills Rule.** Semantic color renders as a dot, badge, thin line, or emphasized digit. The moment a semantic color becomes a panel or card background, it has become decoration — revert it.

**The Two-Palette Rule.** Dark and light are not `filter: invert()` of each other. Each mode's neutral ramp and semantic ramp is independently tuned (compare `sem-positive-dark #00C176` to `sem-positive-light #16A34A` — deliberately different, not a lightness flip) because they serve two different desk activities.

## 3. Typography

**UI Font:** Inter (`var(--font-inter)`), self-hosted via `next/font`. Used for every word AND every number on screen — there is no separate numeric/mono face.

**Character:** Inter carries labels, titles, body, category tags, and all numeric figures alike. `font-variant-numeric: tabular-nums` is set globally on `body` (and on every element via `.num`/`[data-num]`/AG Grid's numeric columns), so every price, delta, timestamp, and KPI figure still aligns digit-for-digit across rows — Inter's own tabular-figure metrics do this work instead of a distinct monospace face. Emphasis within a number (e.g. `PriceDisplay`'s big-figure span) comes from font-weight and color only, never a font-family or font-size switch within the same string.

### Hierarchy
- **Display** (700, 36px, 1.1 line-height, -0.02em tracking, Inter): hero KPI numbers, `PriceDisplay`'s big-figure span. The single largest, boldest element on any screen — reserved for the number that matters most in a panel.
- **H1** (600, 20px, 1.3 line-height, -0.01em tracking, Inter): page title.
- **H2** (600, 16px, 1.4 line-height, Inter): section title within a panel.
- **Body** (400, 14px, 1.5 line-height, Inter): default UI text. Max ~70ch where prose appears (rare in this product).
- **Body-strong** (500, 14px, 1.5 line-height, Inter): table cell emphasis, button labels, active nav item.
- **Label** (500, 11px, 1.3 line-height, +0.06em tracking, uppercase, Inter): category tags only — `RISK`, `IRS`, `CRS`, `KTB`, filter chip labels, column headers.
- **Micro** (400, 11px, 1.3 line-height, Inter, muted color): timestamps, footnotes, percentage markers, input suffixes.

### Named Rules
**The Case Invariant Rule.** Category tags (`RISK`, `IRS`, `KTB`) are always uppercase with wide tracking; values (numbers, names, dates) are always mixed case. Uppercase on a value or mixed-case on a category tag is a bug, not a style choice — there is no exception.

**The Tabular-Everywhere Rule.** Any element that renders a number is `tabular-nums` (Inter's own tabular-figure metrics, not a separate monospace face). A number that isn't `tabular-nums` in a data-dense grid is an instant tell that the grid wasn't built to this system.

**The Weight-Carries-the-Pair Rule.** Within a single label/value pairing (a `Field`/`StatField`/`MetricCard`'s caption over its data, a grid's column header over its cells), the label is bold (700) and the value is regular (400) — weight alone marks which is the name and which is the data, size and color stay as already specified above. This applies *within* an established label/value pair; it doesn't collapse the Display/H1/H2/Body/Label/Micro scale itself, which still differentiates by size for its own (page-title vs. section-title vs. hero-KPI) purposes.

## 4. Elevation

Flat by default; depth comes from luminance layering, not shadow. Backgrounds separate regions via 2–5% luminance steps (`bg-primary` → `bg-secondary` → `bg-tertiary` → `bg-elevated`) and borders are never used to separate cards. Shadow is reserved for genuinely floating surfaces — things that visually detach from the layout flow.

### Shadow Vocabulary
- **sm** (`box-shadow: 0 1px 3px rgba(0,0,0,0.4)`): dark-mode popovers, dropdown menus, floating/dragged dockview panels.
- **md** (`box-shadow: 0 4px 12px rgba(0,0,0,0.16)`): light-mode popovers and modals (needs more spread than dark mode to read against a white canvas).

### Named Rules
**The Flat-Panel Rule.** Cards and panels never receive a shadow at rest. Shadow appears only on transient/overlay surfaces — popover, modal, dropdown, a dockview panel mid-drag — never on static layout.

## 5. Components

Dense and mechanical: every primitive is built for a trader's hand doing this hundreds of times a session, not for a first-time visitor's eye. Hit targets are compact (28–36px), transitions are quick color/background swaps with no easing flourish, and nothing waits on an animation to become usable.

### Buttons
- **Shape:** `rounded` (4px), no exceptions.
- **Sizes:** `sm` 28px / `md` 32px / `lg` 36px height, horizontal padding 12–16px (`space-3`/`space-4`).
- **Primary:** solid Marquee Blue (`bg-sem-info`) fill, white text, `body-strong` typography. The *only* button variant permitted a solid color fill — reserved for the single blue submit action per screen (Run Backtest, Add to Sandbox, Run Optimization).
- **Secondary:** transparent background, `border-subtle` border, primary text color.
- **Ghost:** transparent background, secondary text color, background shift only on hover.
- **Icon:** square (28/32/36px), transparent, muted icon color that brightens on hover.
- **Hover / Focus:** primary darkens to 90% opacity; all variants get a background-color hover shift only (`bg-secondary`), never a border or shadow change; focus-visible gets a 1px Marquee Blue ring.

### Chips
- **Style:** three-part composite — uppercase `label` segment on `bg-tertiary` (slightly darker than the body), mixed-case `value` segment on `bg-secondary`, optional 12px close icon. No standalone border; the two-tone fill *is* the boundary.
- **State:** overflow beyond one value collapses to `+N` with the full list on hover/title tooltip.

### Cards / Containers
- **Corner Style:** `rounded` (4px) at most; KPI cards and panels typically have no radius call at all since they're separated by background, not by a boxed shape.
- **Background:** one luminance step above their parent (`bg-secondary` on `bg-primary`).
- **Shadow Strategy:** none at rest — see Elevation. Static panels are always flat.
- **Border:** none for separation. `border-subtle` appears only as a genuine divider (e.g. sidebar bottom section) or table cell rule.
- **Internal Padding:** `space-4` (16px) card interior, `space-6` (24px) between sections, `space-8` (32px) between panels.

### Inputs / Fields
- **Style:** filled `bg-tertiary`, transparent border by default, `rounded` (4px), 32px height, `body` typography.
- **Focus:** border shifts to 1px Marquee Blue — no glow, no ring beyond the border itself.
- **Error / Disabled:** error border shifts to `sem-negative`; disabled state drops to 40% opacity and disables pointer events.

### Navigation
- **Sidebar:** 240px expanded / 56px collapsed, fixed left, full height, `Void Ink` background. Nav item = 18px Lucide icon (stroke 1.5) + `body-strong` label, 36px row height. Active state: 2px Marquee Blue vertical bar on the left edge + `bg-secondary` fill — no color shift on the icon or label itself, hierarchy comes from the bar and fill, not from tinting the text. Hover: `bg-secondary` fill only.
- **Top Bar:** 40px height, no decorative separator lines between sections — spacing (`gap`) alone divides workspace selector, connection-status dot, live clock, search, notifications, and user menu.
- **Panel headers (dockview):** 32px, `Terminal Black` background in *both* modes — the one Marquee-signature exception to the dual-mode rule, deliberately dark to read as chrome rather than content.

### Signature Component: PriceDisplay (Big-Figure Notation)
Every rate or price in the system renders through `PriceDisplay`, never as a plain number. The digit string splits into three visual weights inside one right-aligned, fixed-width, tabular-mono container: base digits dim (`fg-dim`), the 3-digit big figure bold and at full size/emphasis (`fg-primary`, bold, `display` or `body-strong` scale depending on context), unit dim. Example: `3.4|567|%` → `3.4` dim · `567` bold/large · `%` dim. This is uniform across IRS, KTB, and CRS — there is no per-asset-class exception, and consecutive rows always align on the big figure because the container is fixed-width and right-aligned.

## 6. Do's and Don'ts

### Do:
- **Do** build hierarchy from background luminance steps (2–5%) and type weight — never from color.
- **Do** keep semantic color (`positive`/`negative`/`risk`/`info`) to points: dots, badges, thin lines, emphasized digits.
- **Do** render every number as tabular-nums, and every rate/price through `PriceDisplay`'s 3-digit big-figure convention.
- **Do** treat dark and light as two independently-tuned palettes serving two different desk activities (trading/monitoring vs. analysis/reporting) — not one inverted from the other.
- **Do** keep the dockview panel header (`Terminal Black`, `#0A0E14`) dark in both modes; it's chrome, not content.
- **Do** use only the 8px spacing scale (`space-1` through `space-8`, skipping 5/7/9) and only `rounded` (4px) / `rounded-md` (6px).
- **Do** use `shadow-sm` / `shadow-md` exclusively on popovers, modals, dropdowns, and dragged dockview panels — never on static cards.

### Don't:
- **Don't** add a gradient, thick border, or `rounded-lg` to a card to make it "look designed" — reject on sight per WORK_ORDER.md §9.
- **Don't** use a colored panel background "for visual interest" — color only appears where it carries meaning.
- **Don't** use `border-left`/`border-right` as a colored accent stripe anywhere outside two sanctioned, functional exceptions: the sidebar's 2px active-nav-item bar, and the Backtest scenario card's 2px selected-state bar (`src/features/backtest/scenario-selection.tsx`). Both mark a real selection state, not decoration — the stripe is banned as a decorative default, not as a category.
- **Don't** render a number in a proportional font, or leave it non-tabular.
- **Don't** use uppercase on a value or mixed-case on a category tag — the case rule is invariant, not contextual.
- **Don't** use `rounded-full` anywhere except status dots and the user avatar.
- **Don't** put emoji anywhere in the UI.
- **Don't** conflate the KTB cash-curve tenor set (`3Y/5Y/10Y/20Y/30Y`) with the fuller IRS/CRS tenor set (`3M`–`30Y`) — they are visually and semantically distinct axes, per WORK_ORDER.md §10(2).
- **Don't** apply a gradient-text treatment (`background-clip: text`) anywhere — this system has no use for it.
