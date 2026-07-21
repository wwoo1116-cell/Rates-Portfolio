// @vitest-environment jsdom
/**
 * FB3 F3 — spread coefficients are FIXED semantics (owner ruling: weights
 * carry no meaning as user input): 2-leg = +1/−1, 3-leg fly = +1/−2/+1.
 * Pins: the weight INPUTS are gone (read-only coefficient labels instead),
 * Add Spread emits exactly the canonical weights and the weight-encoded id,
 * and the old weight-sum warning is unreachable (both canonical sets sum 0).
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
  it("renders NO weight inputs; 2-leg shows read-only +1/−1 coefficients", () => {
    renderSpreadMode();

    expect(screen.queryByLabelText(/weight/i)).toBeNull();
    // The filter box is the only text input; no number inputs remain.
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.getByLabelText("Leg 1 coefficient").textContent).toBe("+1");
    expect(screen.getByLabelText("Leg 2 coefficient").textContent).toBe("-1");
  });

  it("3-leg (fly) shows +1/−2/+1", () => {
    renderSpreadMode();
    fireEvent.click(screen.getByText("3-leg (fly)"));

    expect(screen.getByLabelText("Leg 1 coefficient").textContent).toBe("+1");
    expect(screen.getByLabelText("Leg 2 coefficient").textContent).toBe("-2");
    expect(screen.getByLabelText("Leg 3 coefficient").textContent).toBe("+1");
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
