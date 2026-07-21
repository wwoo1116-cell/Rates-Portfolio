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
