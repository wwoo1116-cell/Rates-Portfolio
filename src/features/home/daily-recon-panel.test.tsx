// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * RECON-DAILY panel pins. The hook is mocked at the module boundary (the
 * data plumbing has its own citations; the math has its own fixture file) —
 * these tests pin the PANEL's responsibilities:
 *  - the closure footer's arithmetic as rendered (Assumed | Realized | 잔차),
 *  - missing-pillar exclusion (— cell + visible note + excluded from Σ),
 *  - the 잔차-naming rule (테타 appears ONLY inside 비교-대상-아님 chips),
 *  - honest disabled states (no Δbp / incomplete realized decomposition).
 */

const mockRecon = vi.fn();
vi.mock("@/hooks/use-daily-recon", () => ({
  useDailyRecon: () => mockRecon(),
}));
// The extracted date control reads the range itself. useMarketDataSnapshot is
// in the import graph via pvbp-sensitivity-table → use-portfolio-analytics
// but never called here.
const mockRange = vi.fn();
vi.mock("@/hooks/use-api", async (importOriginal) => ({
  // Spread the real module: the T4a cashflow section pulls details-panel's
  // wide use-api surface into the import graph. Only what this panel's own
  // chrome calls is overridden; the price query stays idle (no request).
  ...(await importOriginal<typeof import("@/hooks/use-api")>()),
  useMarketDataRange: () => mockRange(),
  useMarketDataSnapshot: () => ({ data: undefined, isLoading: false, isError: false }),
  usePortfolioPriceQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));
// Range strip's compute hook — idle fixture; its own behavior is pinned in
// recon-range-strip.test.tsx.
const mockReconRange = vi.fn();
vi.mock("@/hooks/use-recon-range", () => ({
  useReconRange: () => mockReconRange(),
}));

const { DailyReconPanel } = await import("./daily-recon-panel");
const { TENOR_COLS } = await import("./pvbp-sensitivity-table");

/** KRD@D−1 fixture: 국고채 holds 1D mass (the unmapped pillar) + 4Y; IRS in
 * 3M. Distinct values per column so any cell/column shift shows up. */
function pvbpRow(sector: string, buckets: Record<string, number>) {
  const r: Record<string, unknown> = { sector };
  for (const c of TENOR_COLS) r[c] = buckets[c] ?? 0;
  r.total = TENOR_COLS.reduce((s, c) => s + ((r[c] as number) ?? 0), 0);
  return r;
}
const PVBP_ROWS = [
  pvbpRow("국고채", { "1D": 500_000, "4Y": 2_000_000 }),
  pvbpRow("IRS", { "3M": 1_000_000 }),
  pvbpRow("합계", { "1D": 500_000, "3M": 1_000_000, "4Y": 2_000_000 }),
];

/** Δbp fixture: 1D unmapped (null), 3M +2.0, 4Y −1.5, everything else 0. */
const DELTA_BP: Record<string, number | null> = Object.fromEntries(
  TENOR_COLS.map((c) => [c, c === "1D" ? null : c === "3M" ? 2.0 : c === "4Y" ? -1.5 : 0]),
);

/** Realized day-D buckets: 채권평가 −2.5M + 스왑평가 +1.8M = −0.7M vs
 * Assumed −1.0M (= 1M×2.0 + 2M×−1.5, 1D excluded) → 잔차 +0.3M (+42.9%). */
const TOTAL_ROW = {
  book: "Total",
  theta: 700_000,
  mtm: -700_000,
  total: 0,
  funding: -300_000,
  mtm_complete: true,
  by_class: {
    bond: { theta: 500_000, mtm: -2_500_000, total: -2_000_000, funding: -300_000, mtm_complete: true },
    swap: { theta: 200_000, mtm: 1_800_000, total: 2_000_000, funding: 0, mtm_complete: true },
  },
};

function reconRangeIdle() {
  mockReconRange.mockReturnValue({
    rows: undefined,
    running: false,
    progress: null,
    error: null,
    windowSize: 20,
    maxWindow: 3,
    canRun: true,
    run: vi.fn(),
    widen: vi.fn(),
  });
}

function recon(over: Record<string, unknown> = {}) {
  reconRangeIdle();
  mockRecon.mockReturnValue({
    hasPositions: true,
    picked: null,
    setPicked: vi.fn(),
    resolvedClose: "2026-07-14",
    asOf: "2026-07-15",
    asOfAvailable: true,
    pvbpRows: PVBP_ROWS,
    deltaBp: DELTA_BP,
    totalRow: TOTAL_ROW,
    loading: false,
    error: false,
    ...over,
  });
  mockRange.mockReturnValue({
    data: {
      min_date: "2026-07-10",
      max_date: "2026-07-15",
      available_dates: ["2026-07-10", "2026-07-13", "2026-07-14", "2026-07-15"],
    },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DailyReconPanel bridge ladder (FB3)", () => {
  // [CHANGED, FB3] fixture arithmetic under the sign fix (KRD×(−Δbp)):
  // Assumed = −(1M×2.0 + 2M×(−1.5)) = +1.0M; 테타 +0.7M → 예상 +1.7M;
  // Realized = 0.7 − 2.5 + 1.8 = −0.0M… realized 0 suppresses %, so the
  // fixture pins that edge too via the ladder identity.
  it("renders the ladder 테타 → + Assumed → = 예상 PnL → vs Realized → 잔차 with the fixture arithmetic", () => {
    recon();
    render(<DailyReconPanel />);

    const theta = screen.getByText("테타");
    expect(theta.parentElement?.textContent).toContain("(T−1 기지)");
    expect(theta.parentElement?.textContent).toContain("+700,000");
    const assumed = screen.getByText("Assumed");
    expect(assumed.parentElement?.textContent).toContain("(PVBP×Δbp)");
    expect(assumed.parentElement?.textContent).toContain("+1.0M");
    const expected = screen.getByText("예상 PnL");
    expect(expected.parentElement?.textContent).toContain("+1.7M");
    const realized = screen.getByText("Realized");
    expect(realized.parentElement?.textContent).toContain("(테타+채권평가+스왑평가)");
    const residual = screen.getByText("잔차");
    expect(residual.parentElement?.textContent).toContain("컨벡시티(+베이시스)");
    expect(residual.parentElement?.textContent).toContain("-1.7M");
  });

  it("펀딩 stays the ONLY chip outside the comparison; the old 계산 테타 chip is gone [old wording pinned absent]", () => {
    recon();
    render(<DailyReconPanel />);

    const funding = screen.getByText("펀딩");
    expect(funding.parentElement?.textContent).toContain("-300,000");
    expect(funding.parentElement?.textContent).toContain("비교 대상 아님");
    // Exactly one 비교-대상-아님 marker remains (funding's).
    expect(screen.getAllByText("비교 대상 아님").length).toBe(1);
    // The pre-FB3 outside-chip wording must not resurface.
    expect(screen.queryByText("계산 테타")).toBeNull();
  });

  it("잔차-naming: the ladder slots are 테타/Assumed/예상 PnL/Realized/잔차 — the residual is never a theta word", () => {
    recon();
    render(<DailyReconPanel />);

    const footer = screen.getByText("예상 PnL").closest("div")!;
    const labels = Array.from(
      footer.querySelectorAll("span.text-label.uppercase"),
    ).map((el) => el.textContent?.trim());
    expect(labels).toEqual(["테타", "Assumed", "예상 PnL", "Realized", "잔차"]);
    // The RESIDUAL slot (and only that rule) — 잔차 is never renamed into a
    // theta/carry word; 테타 is its own rung, a different term of the bridge.
    expect(labels[labels.length - 1]).toBe("잔차");
    expect(labels[labels.length - 1]).not.toMatch(/테타|theta|carry|캐리/i);
  });
});

describe("DailyReconPanel M2 zero-vs-unmapped distinction", () => {
  it("renders a real 0.0bp move as 0.0 and ONLY the unmapped pillar as —", () => {
    // Live-data finding (2026-07-15 capture): CD's genuine 0.0bp day rendered
    // — like an unmapped pillar, making "didn't move" look like "don't know".
    recon();
    const { container } = render(<DailyReconPanel />);

    const m2Label = screen.getByText(/M2 · Δbp/);
    const m2Table = m2Label.closest("div")!.querySelector("table")!;
    const cells = Array.from(m2Table.querySelectorAll("tbody td")).map(
      (td) => td.textContent?.trim(),
    );
    // Layout: [row label "Δbp", ...16 tenor cells, total]. Fixture: 1D null
    // (unmapped), 3M +2.0, 4Y −1.5, everything else a REAL 0.0.
    const idx = (c: string) => 1 + (TENOR_COLS as readonly string[]).indexOf(c);
    expect(cells[idx("1D")]).toBe("—");
    expect(cells[idx("3M")]).toBe("+2.0");
    expect(cells[idx("4Y")]).toBe("-1.5");
    expect(cells[idx("2Y")]).toBe("0.0");
    expect(container).toBeDefined();
  });
});

describe("DailyReconPanel missing-pillar exclusion", () => {
  it("shows the unmapped tenor as — in M3, names it in the note, and keeps it out of Σ", () => {
    recon();
    render(<DailyReconPanel />);

    // The note names 1D with its KRD mass…
    const note = screen.getByText(/미매핑 테너 제외/);
    expect(note.textContent).toContain("1D");
    expect(note.textContent).toContain("+500,000");
    expect(note.textContent).toContain("0 아님");
    // …and the Assumed figure (합계 row total) proves the exclusion: with 1D
    // zero-filled it would NOT be +1.0M ([CHANGED, FB3] sign — KRD×(−Δbp)).
    expect(screen.getByText("Assumed").parentElement?.textContent).toContain("+1.0M");
  });
});

describe("DailyReconPanel honest disabled states", () => {
  it("no day-D snapshot → M2/M3 say so and the footer is disabled, never zero-filled", () => {
    recon({ deltaBp: undefined, asOfAvailable: false });
    render(<DailyReconPanel />);

    expect(screen.getByText(/스냅샷이 아직 없어 Δbp를 산출할 수 없습니다/)).toBeDefined();
    expect(screen.getByText(/대사 불가/)).toBeDefined();
    expect(screen.queryByText("Assumed")).toBeNull();
  });

  it("incomplete realized decomposition → footer disabled with the honest message", () => {
    recon({
      totalRow: {
        ...TOTAL_ROW,
        by_class: {
          ...TOTAL_ROW.by_class,
          swap: { theta: 200_000, mtm: null, total: 200_000, funding: 0, mtm_complete: false },
        },
      },
    });
    render(<DailyReconPanel />);

    expect(screen.getByText(/부분값으로 잔차를 만들지 않습니다/)).toBeDefined();
    expect(screen.queryByText("Assumed")).toBeNull();
  });

  it("renders the upload prompt without positions", () => {
    recon({ hasPositions: false, pvbpRows: undefined, totalRow: undefined });
    render(<DailyReconPanel />);
    expect(screen.getByText(/Upload portfolio data/)).toBeDefined();
  });
});

describe("DailyReconPanel mount parity (Home vs Rates History)", () => {
  /** The two mounts are the same component over the same hook — this pin
   * proves a single fixture produces IDENTICAL closure numbers on both, and
   * that the only difference is the Rates-History-only range strip. */
  function footerText(container: HTMLElement): string[] {
    const footer = Array.from(container.querySelectorAll("div")).find((d) =>
      d.className.includes("border-t") && /Assumed/.test(d.textContent ?? ""),
    )!;
    return Array.from(footer.querySelectorAll("span.flex.items-baseline")).map(
      (el) => el.textContent?.trim() ?? "",
    );
  }

  it("renders identical closure numbers from one fixture on both mounts", () => {
    recon();
    const home = render(<DailyReconPanel />);
    const homeFooter = footerText(home.container);
    home.unmount();

    recon();
    const rh = render(<DailyReconPanel showRange />);
    const rhFooter = footerText(rh.container);

    expect(homeFooter.length).toBeGreaterThan(0);
    expect(rhFooter).toEqual(homeFooter);
    // The strip exists only on the Rates History mount.
    expect(rh.container.textContent).toContain("잔차 시계열");
    expect(home.container.textContent).not.toContain("잔차 시계열");
  });

  it("RECON2-RH is range-mode-only: the Home mount carries no Δbp toggle/chart artifacts", () => {
    recon();
    const home = render(<DailyReconPanel />);
    // No view toggle, no chart host, no D+ chip vocabulary on the single-date mount.
    expect(home.container.textContent).not.toContain("Δbp 시계열");
    expect(home.queryByTestId("deltabp-chart-host")).toBeNull();
    expect(home.container.textContent).not.toContain("D+91");
    home.unmount();

    // The RH mount offers the toggle (inside the strip).
    recon();
    const rh = render(<DailyReconPanel showRange />);
    expect(rh.getByRole("button", { name: "Δbp 시계열" })).toBeDefined();
  });
});
