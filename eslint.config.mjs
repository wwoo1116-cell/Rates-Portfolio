import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // ---------------------------------------------------------------------------
  // Migration boundary — features/simulation is an isolated vertical slice
  // (Migration Protocol §1.2). One-way dependency: slice -> app design system,
  // never the reverse. Enforced with core no-restricted-imports.
  // ---------------------------------------------------------------------------

  // (A) The rest of the app must NOT reach into the slice's internals. The slice
  // is consumed only via its index.ts barrel, and only from the Simulation tab
  // mount point — which gets added to this block's `ignores` when it's wired in
  // Phase 3. Until then nothing outside the slice may import it.
  {
    files: ["src/**/*.{ts,tsx}"],
    // The slice itself, plus its ONE sanctioned mount point — the Simulation route
    // (Phase 3). The route composes the slice's panels into the dockview tab, so it's
    // allowed to import @/features/simulation; nothing else in the app may.
    ignores: ["src/features/simulation/**", "src/app/**/simulation/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/features/simulation",
                "@/features/simulation/*",
                "@/features/simulation/**",
              ],
              message:
                "Do not import simulation slice internals. The slice is mounted only via the Simulation tab/route (Phase 3). Cross-screen data goes through selectSimulationResults on the store, never a component import.",
            },
          ],
        },
      ],
    },
  },

  // (B) The slice may import from the app ONLY the design system (@/components/ui)
  // and shared lib/theme/format (@/lib). Everything else under @/ (other features,
  // stores, hooks, app routes, non-ui components) is off-limits so the slice stays
  // self-contained. External packages (e.g. @tanstack/react-query, zustand) are
  // unaffected. Intra-slice imports use relative paths, so they never hit @/.
  {
    files: ["src/features/simulation/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/*",
                "@/**",
                // gitignore semantics (the `ignore` package): a path can't be
                // re-included while its parent directory is excluded, so the
                // ui allowlist needs @/components itself re-included first.
                // Direct imports of other @/components/* stay blocked — they
                // only match @/**, which nothing below un-ignores.
                "!@/components",
                "!@/components/ui",
                "!@/components/ui/**",
                // S7 owner decision: the canonical SeriesChart (and its chart
                // primitives) is the one sanctioned charting surface shared by
                // every screen, Simulation included — same one-way direction
                // (slice -> app design system) as @/components/ui.
                "!@/components/charts",
                "!@/components/charts/**",
                "!@/lib",
                "!@/lib/**",
              ],
              message:
                "features/simulation is an isolated slice: from the app import only @/components/ui/* and @/lib/*. Other app internals (@/features/*, @/stores/*, @/hooks/*, @/app/*) are off-limits — keep the slice self-contained.",
            },
          ],
        },
      ],
    },
  },

  // (C) Style verification (Migration Protocol §2.3): inside the slice, block raw
  // hex color literals and arbitrary Tailwind COLOR values (bg-[#..], bg-[var(--..)])
  // so every color goes through a theme token. Structural arbitraries (w-[420px],
  // h-[280px]) are intentionally NOT blocked — only color. Excludes chart-theme.ts
  // (the sanctioned single home for literal hex fallbacks, mirroring the app's
  // lib/chart-colors.ts).
  {
    files: ["src/features/simulation/**/*.{ts,tsx}"],
    ignores: [
      "src/features/simulation/lib/chart-theme.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}/]",
          message:
            "No raw hex colors in the simulation slice (protocol §2.2). Use a theme token: chart colors resolve through lib/chart-theme.ts; DOM elements use bg-chart-*/text-sem-*/text-fg-*/bg-bg-* utilities.",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}/]",
          message:
            "No raw hex colors in the simulation slice (protocol §2.2). Use a theme token instead.",
        },
        {
          selector: "Literal[value=/\\[(#|var\\(--)/]",
          message:
            "No arbitrary color values (bg-[#..], bg-[var(--..)]) in the simulation slice (protocol §2.3). Use a named theme utility, e.g. bg-chart-berry, bg-sem-info-soft.",
        },
        {
          selector: "TemplateElement[value.raw=/\\[(#|var\\(--)/]",
          message:
            "No arbitrary color values (bg-[#..], bg-[var(--..)]) in the simulation slice (protocol §2.3). Use a named theme utility instead.",
        },
      ],
    },
  },
]);

export default eslintConfig;
