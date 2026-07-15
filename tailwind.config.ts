import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          tertiary: "var(--bg-tertiary)",
          elevated: "var(--bg-elevated)",
          "header-dark": "var(--bg-header-dark)",
        },
        fg: {
          primary: "var(--fg-primary)",
          secondary: "var(--fg-secondary)",
          muted: "var(--fg-muted)",
          dim: "var(--fg-dim)",
        },
        border: {
          subtle: "var(--border-subtle)",
          strong: "var(--border-strong)",
          // Wired for the simulation migration (Phase 2): --border-dim already
          // existed in tokens.css (used by AG Grid / dockview) but was never
          // exposed as a Tailwind utility. Hairline table/row dividers use it.
          dim: "var(--border-dim)",
        },
        sem: {
          positive: "var(--sem-positive)",
          negative: "var(--sem-negative)",
          risk: "var(--sem-risk)",
          info: "var(--sem-info)",
          "positive-soft": "var(--sem-positive-soft)",
          "negative-soft": "var(--sem-negative-soft)",
          "risk-soft": "var(--sem-risk-soft)",
          "info-soft": "var(--sem-info-soft)",
          // Subtlest accent tint (7% alpha), for hover/selection backgrounds —
          // the target's --accent-ghost, matching AG Grid row-hover / dockview
          // drag-over. Fills the one gap when remapping the source's accent-ghost.
          "info-ghost": "var(--accent-ghost)",
        },
        // Chart series palette exposed as utilities so DOM swatches/legends use
        // named tokens (bg-chart-berry) instead of arbitrary bg-[var(--chart-*)].
        // Canvas/SVG series colors are read at runtime via features/simulation/
        // lib/chart-theme.ts (canvas can't resolve CSS vars). Same --chart-* vars.
        chart: {
          ocean: "var(--chart-ocean)",
          aqua: "var(--chart-aqua)",
          purple: "var(--chart-purple)",
          tangerine: "var(--chart-tangerine)",
          berry: "var(--chart-berry)",
          // S7 MS-palette semantic chart tokens (tokens.css) — chart surfaces
          // only. DOM text/swatches on charts use these; canvas series colors
          // go through src/lib/chart-colors.ts mirrors instead.
          "pnl-pos": "var(--chart-pnl-pos)",
          "pnl-neg": "var(--chart-pnl-neg)",
          "pnl-pos-fill": "var(--chart-pnl-pos-fill)",
          "pnl-neg-fill": "var(--chart-pnl-neg-fill)",
        },
        heat: {
          "pos-1": "var(--heat-pos-1)",
          "pos-2": "var(--heat-pos-2)",
          "pos-3": "var(--heat-pos-3)",
          "pos-4": "var(--heat-pos-4)",
          "neg-1": "var(--heat-neg-1)",
          "neg-2": "var(--heat-neg-2)",
          "neg-3": "var(--heat-neg-3)",
          "neg-4": "var(--heat-neg-4)",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)"],
        // Numerics font unification: Tailwind's `font-mono` utility now also
        // resolves to Inter (see tokens.css --font-mono) -- tabular-nums
        // handles digit alignment instead of a separate monospace face.
        mono: ["var(--font-inter)"],
      },
      fontSize: {
        display: [
          "36px",
          { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" },
        ],
        h1: ["20px", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
        h2: ["16px", { lineHeight: "1.4", fontWeight: "600" }],
        body: ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        "body-strong": ["14px", { lineHeight: "1.5", fontWeight: "500" }],
        label: [
          "11px",
          { lineHeight: "1.3", letterSpacing: "0.06em", fontWeight: "500" },
        ],
        micro: ["11px", { lineHeight: "1.3", fontWeight: "400" }],
      },
      spacing: {
        "1": "4px",
        "2": "8px",
        "3": "12px",
        "4": "16px",
        "6": "24px",
        "8": "32px",
      },
      borderRadius: {
        DEFAULT: "4px",
        md: "6px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(0, 0, 0, 0.4)",
        md: "0 4px 12px rgba(0, 0, 0, 0.16)",
      },
    },
  },
  plugins: [],
};

export default config;
