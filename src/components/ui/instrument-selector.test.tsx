// @vitest-environment jsdom
/**
 * FB3 F3 / FB5-A A2 — spread coefficients are FIXED semantics (owner ruling:
 * weights carry no meaning as user input): 2-leg = +1/−1, 3-leg fly = +1/−2/+1.
 * FB5-A A2 removed the read-only +1/−1 coefficient LABELS entirely — a leg row
 * reads as the instrument alone. Pins: no weight inputs AND no coefficient
 * labels on the builder surface (label-absence pin), Add Spread still emits
 * exactly the canonical weights and the weight-encoded id (fixed coefficients
 * unchanged, reference-level pin stays green), and the old weight-sum warning
 * is unreachable (both canonical sets sum 0).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { InstrumentSelector } from "./instrument-selector";
import type { InstrumentTaxonomyOut } from "@/lib/api-client";
import type { SelectedInstrument } from "@/lib/rv-instruments";

const TAXONOMY: InstrumentTaxonomyOut = {
  sectors: [
    { sector: "IRS", ratings: [], tenors: ["3Y", "5Y"] },
    { sector: "국고채", ratings: [], tenors: ["3Y", "10Y"] },
  ],
} as InstrumentTaxonomyOut;

function renderSpreadMode(onAdd = vi.fn<(i: SelectedInstrument) => void>()) {
  const r = render(
    <InstrumentSelector taxonomy={TAXONOMY} selected={[]} onAdd={onAdd} onRemove={vi.fn()} />,
  );
  fireEvent.click(screen.getByText("Spread"));
  return { r, onAdd };
}

afterEach(cleanup);

describe("InstrumentSelector — F3 fixed spread coefficients", () => {
  it("A2 label-absence: NO weight inputs AND NO +1/−1 coefficient labels (2-leg)", () => {
    renderSpreadMode();

    expect(screen.queryByLabelText(/weight/i)).toBeNull();
    // The filter box is the only text input; no number inputs remain.
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    // A2 — the read-only coefficient labels are gone entirely: no aria-labelled
    // coefficient element and no "+1"/"-1" text on the builder surface.
    expect(screen.queryByLabelText(/coefficient/i)).toBeNull();
    expect(screen.queryByText("+1")).toBeNull();
    expect(screen.queryByText("-1")).toBeNull();
  });

  it("A2 label-absence: 3-leg (fly) shows no +1/−2/+1 coefficient labels", () => {
    renderSpreadMode();
    fireEvent.click(screen.getByText("3-leg (fly)"));

    expect(screen.queryByLabelText(/coefficient/i)).toBeNull();
    expect(screen.queryByText("+1")).toBeNull();
    expect(screen.queryByText("-2")).toBeNull();
  });

  it("Add Spread emits exactly the canonical 2-leg weights and the weight-encoded id", () => {
    const { onAdd } = renderSpreadMode();
    // LegPicker defaults every row to the first taxonomy leg (IRS 3Y) — the
    // spread is immediately addable.
    fireEvent.click(screen.getByText("Add Spread"));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const inst = onAdd.mock.calls[0][0];
    if (inst.kind !== "spread") throw new Error("expected spread");
    expect(inst.legs.map((l) => l.weight)).toEqual([1, -1]);
    expect(inst.id).toBe("S:1*IRS||3Y~-1*IRS||3Y");
  });

  it("Add Spread emits the canonical fly weights for 3 legs", () => {
    const { onAdd } = renderSpreadMode();
    fireEvent.click(screen.getByText("3-leg (fly)"));
    fireEvent.click(screen.getByText("Add Spread"));

    const inst = onAdd.mock.calls[0][0];
    if (inst.kind !== "spread") throw new Error("expected spread");
    expect(inst.legs.map((l) => l.weight)).toEqual([1, -2, 1]);
    expect(inst.id).toBe("S:1*IRS||3Y~-2*IRS||3Y~1*IRS||3Y");
  });

  it("the weight-sum warning is gone for good (canonical sets sum to zero)", () => {
    renderSpreadMode();
    expect(screen.queryByText(/가중치 합/)).toBeNull();
    fireEvent.click(screen.getByText("3-leg (fly)"));
    expect(screen.queryByText(/가중치 합/)).toBeNull();
  });
});

// FB5R R2 — the RH selector is extended with optional, DEFAULT-PRESERVING config
// so the simulation preview can import it (not mirror it). These pins protect
// (a) that no-config = the exact RH surface, and (b) the preview configuration.
const RATED_TAXONOMY: InstrumentTaxonomyOut = {
  sectors: [
    { sector: "국고채", ratings: [], tenors: ["3Y", "10Y"] },
    { sector: "여전채", ratings: ["AAA (카드)", "AA (카드)"], tenors: ["3Y"] },
  ],
} as InstrumentTaxonomyOut;

describe("InstrumentSelector — FB5R R2 config (byte-identical defaults + preview modes)", () => {
  it("default props keep the RH surface: mode toggle + filter + 3-tier dropdowns", () => {
    render(<InstrumentSelector taxonomy={TAXONOMY} selected={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Outright")).toBeTruthy();
    expect(screen.getByText("Spread")).toBeTruthy();
    expect(screen.getByPlaceholderText("Filter…")).toBeTruthy();
    expect(screen.getByLabelText("자산군")).toBeTruthy();
    expect(screen.getByLabelText("등급")).toBeTruthy();
    expect(screen.getByLabelText("테너")).toBeTruthy();
  });

  it("single-mode + no-filter config hides the Outright/Spread toggle and the filter (preview grammar)", () => {
    render(
      <InstrumentSelector
        taxonomy={TAXONOMY}
        selected={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        modes={["outright"]}
        showFilter={false}
      />,
    );
    expect(screen.queryByText("Spread")).toBeNull();
    expect(screen.queryByPlaceholderText("Filter…")).toBeNull();
    // The outright control row (dropdowns + Add) still renders.
    expect(screen.getByLabelText("자산군")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("시계열형 config (ratingDisabled): 등급 is N/A and the emitted leg carries rating:null", () => {
    const onAdd = vi.fn<(i: SelectedInstrument) => void>();
    render(
      <InstrumentSelector
        taxonomy={RATED_TAXONOMY}
        selected={[]}
        onAdd={onAdd}
        onRemove={vi.fn()}
        modes={["outright"]}
        showFilter={false}
        ratingDisabled
      />,
    );
    expect((screen.getByLabelText("등급") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("자산군"), { target: { value: "여전채" } });
    fireEvent.change(screen.getByLabelText("테너"), { target: { value: "3Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const inst = onAdd.mock.calls[0][0];
    if (inst.kind !== "outright") throw new Error("expected outright");
    expect(inst.leg.rating).toBeNull(); // rating slot locked off
    expect(inst.leg.tenor).toBe("3Y");
  });

  it("커브형 config (tenorDisabled): 테너 is N/A and the live 등급 tier flows into the emitted leg", () => {
    const onAdd = vi.fn<(i: SelectedInstrument) => void>();
    render(
      <InstrumentSelector
        taxonomy={RATED_TAXONOMY}
        selected={[]}
        onAdd={onAdd}
        onRemove={vi.fn()}
        modes={["outright"]}
        showFilter={false}
        tenorDisabled
      />,
    );
    expect((screen.getByLabelText("테너") as HTMLSelectElement).disabled).toBe(true);
    // Rated sector: the middle dropdown is LIVE (owner amendment) — pick a tier.
    fireEvent.change(screen.getByLabelText("자산군"), { target: { value: "여전채" } });
    fireEvent.change(screen.getByLabelText("등급"), { target: { value: "AA (카드)" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const inst = onAdd.mock.calls[0][0];
    if (inst.kind !== "outright") throw new Error("expected outright");
    expect(inst.leg.rating).toBe("AA (카드)");
    expect(inst.leg.tenor).toBe(""); // tenor slot locked off (whole curve)
  });

  it("colorOf overrides the chip swatch (preview colors chips by PVBP sector token)", () => {
    const stamp = "rgb(9, 9, 9)";
    render(
      <InstrumentSelector
        taxonomy={TAXONOMY}
        selected={[{ kind: "outright", id: "O:국고채||3Y", leg: { sector: "국고채", rating: null, tenor: "3Y" } }]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        colorOf={() => stamp}
      />,
    );
    const swatch = document.querySelector('span[style*="background"]') as HTMLElement;
    expect(swatch.style.backgroundColor).toBe(stamp);
  });
});
