"use client";

/**
 * 3-tier instrument selector for the Rates History RV chart: Sector -> Rating
 * -> Tenor cascading dropdowns, in either "Outright" mode (one leg) or
 * "Spread" mode (2 or 3 signed-weight legs, e.g. a butterfly). Rating is
 * auto-N/A (dropdown disabled) for unrated sectors (국고채, IRS). Selected
 * instruments render as removable color-coded chips.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { HTMLSelect, SegmentedControl } from "@blueprintjs/core";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InstrumentTaxonomyOut, TaxonomySectorOut } from "@/lib/api-client";
import { colorForId } from "@/lib/chart-colors";
import {
  DEFAULT_SPREAD_WEIGHTS,
  instrumentLabel,
  outrightId,
  spreadId,
  type Leg,
  type SelectedInstrument,
  type SpreadLeg,
} from "@/lib/rv-instruments";

const NO_RATING_LABEL = "N/A";

function filtered(options: string[], filter: string, current: string): string[] {
  if (!filter) return options;
  const f = filter.toLowerCase();
  const out = options.filter((o) => o.toLowerCase().includes(f));
  // Never let the currently-selected value vanish from its own dropdown.
  if (current && !out.includes(current) && options.includes(current)) out.unshift(current);
  return out;
}

interface LegPickerProps {
  sectors: TaxonomySectorOut[];
  filter: string;
  onChange: (leg: Leg | null) => void;
}

/** One sector/rating/tenor picker. Emits a complete Leg via onChange whenever
 * its selection is valid (or null while incomplete). Selections are stored as
 * the user's raw choice; the *effective* value is derived each render with a
 * fallback to the sector's first option (and re-validated when the sector
 * changes), so no cascading setState-in-effect is needed to keep the three
 * dropdowns consistent. */
function LegPicker({ sectors, filter, onChange }: LegPickerProps) {
  const [sectorSel, setSectorSel] = useState("");
  const [ratingSel, setRatingSel] = useState("");
  const [tenorSel, setTenorSel] = useState("");

  // Effective (validated, defaulted) values used for both display and emit.
  const sector = sectorSel && sectors.some((s) => s.sector === sectorSel)
    ? sectorSel
    : sectors[0]?.sector ?? "";
  const sectorDef = useMemo(() => sectors.find((s) => s.sector === sector), [sectors, sector]);
  const ratings = sectorDef?.ratings ?? [];
  const tenors = sectorDef?.tenors ?? [];
  const hasRatings = ratings.length > 0;

  const rating = hasRatings ? (ratings.includes(ratingSel) ? ratingSel : ratings[0]) : "";
  const tenor = tenors.includes(tenorSel) ? tenorSel : (tenors[0] ?? "");

  // Emit the current leg to the parent (an external-state sync -- the only
  // effect here, and it never sets this component's own state).
  useEffect(() => {
    if (!sector || !tenor || (hasRatings && !rating)) {
      onChange(null);
      return;
    }
    onChange({ sector, rating: hasRatings ? rating : null, tenor });
  }, [sector, rating, tenor, hasRatings, onChange]);

  const setSector = setSectorSel;
  const setRating = setRatingSel;
  const setTenor = setTenorSel;
  const selectStyle = { minWidth: 96 };

  return (
    <div className="flex items-center gap-1.5">
      <HTMLSelect
        value={sector}
        onChange={(e) => setSector(e.currentTarget.value)}
        style={selectStyle}
      >
        {filtered(sectors.map((s) => s.sector), filter, sector).map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </HTMLSelect>

      <HTMLSelect
        value={hasRatings ? rating : NO_RATING_LABEL}
        disabled={!hasRatings}
        onChange={(e) => setRating(e.currentTarget.value)}
        style={{ ...selectStyle, minWidth: 120 }}
      >
        {hasRatings ? (
          filtered(sectorDef?.ratings ?? [], filter, rating).map((r) => (
            <option key={r} value={r}>{r}</option>
          ))
        ) : (
          <option value={NO_RATING_LABEL}>{NO_RATING_LABEL}</option>
        )}
      </HTMLSelect>

      <HTMLSelect
        value={tenor}
        onChange={(e) => setTenor(e.currentTarget.value)}
        style={{ ...selectStyle, minWidth: 80 }}
      >
        {filtered(sectorDef?.tenors ?? [], filter, tenor).map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </HTMLSelect>
    </div>
  );
}

interface SpreadLegRowProps {
  index: number;
  sectors: TaxonomySectorOut[];
  filter: string;
  /** FB3 F3 (owner ruling: weights carry no meaning) — the coefficient is
   * FIXED by leg count (2-leg = +1/−1, 3-leg fly = +1/−2/+1) and rendered as
   * a read-only label; the numeric weight input is gone. */
  weight: number;
  onLegChange: (index: number, leg: Leg | null) => void;
}

/** One term of the spread expression. Exists as its own component so
 * each row can hand LegPicker an identity-stable onChange -- LegPicker keeps
 * onChange in an effect dependency list, so an inline arrow here would re-fire
 * that effect every render and loop through the parent's setState. */
function SpreadLegRow({ index, sectors, filter, weight, onLegChange }: SpreadLegRowProps) {
  const handleLeg = useCallback((leg: Leg | null) => onLegChange(index, leg), [index, onLegChange]);

  return (
    <div className="flex items-center gap-1.5">
      <span
        data-num
        aria-label={`Leg ${index + 1} coefficient`}
        className="inline-flex h-7 min-w-9 items-center justify-center border border-border-subtle bg-bg-tertiary px-1.5 text-body tabular-nums text-fg-secondary"
      >
        {weight > 0 ? `+${weight}` : weight}
      </span>
      <span className="text-micro text-fg-dim">×</span>
      <LegPicker sectors={sectors} filter={filter} onChange={handleLeg} />
    </div>
  );
}

interface InstrumentSelectorProps {
  taxonomy?: InstrumentTaxonomyOut;
  selected: SelectedInstrument[];
  onAdd: (inst: SelectedInstrument) => void;
  onRemove: (id: string) => void;
}

export function InstrumentSelector({ taxonomy, selected, onAdd, onRemove }: InstrumentSelectorProps) {
  const [mode, setMode] = useState<"outright" | "spread">("outright");
  const [filter, setFilter] = useState("");
  const [outrightLeg, setOutrightLeg] = useState<Leg | null>(null);
  // 2-leg stays the default; 3 turns the expression into a fly.
  const [legCount, setLegCount] = useState(2);
  const [spreadLegs, setSpreadLegs] = useState<(Leg | null)[]>([null, null]);
  // FB3 F3 (owner ruling): weights carry no meaning as USER INPUT — the
  // coefficients are fixed by leg count (2-leg = +1/−1, 3-leg fly =
  // +1/−2/+1, the DEFAULT_SPREAD_WEIGHTS that were already the defaults).
  // Derived, not state; both canonical sets sum to 0, so the PVBP-neutral
  // sizing (B4: net PVBP = c·Σwᵢ) is always satisfiable and the old
  // weight-sum warning path is unreachable by construction.
  const spreadWeights = DEFAULT_SPREAD_WEIGHTS[legCount] ?? [];

  const sectors = taxonomy?.sectors ?? [];

  const handleLegChange = useCallback((index: number, leg: Leg | null) => {
    setSpreadLegs((prev) => {
      if (prev[index] === leg) return prev; // no-op keeps LegPicker's emit from looping
      const next = [...prev];
      next[index] = leg;
      return next;
    });
  }, []);

  const handleLegCount = useCallback((count: number) => {
    setLegCount(count);
    setSpreadLegs((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push(null);
      return next;
    });
  }, []);

  const activeLegs = spreadLegs.slice(0, legCount);
  const spreadReady = activeLegs.length === legCount && activeLegs.every((l) => l != null);

  function handleAddOutright() {
    if (!outrightLeg) return;
    onAdd({ kind: "outright", id: outrightId(outrightLeg), leg: outrightLeg });
  }

  function handleAddSpread() {
    if (!spreadReady) return;
    const legs: SpreadLeg[] = activeLegs.map((leg, i) => ({ leg: leg as Leg, weight: spreadWeights[i] }));
    onAdd({ kind: "spread", id: spreadId(legs), legs });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          small
          options={[
            { label: "Outright", value: "outright" },
            { label: "Spread", value: "spread" },
          ]}
          value={mode}
          onValueChange={(v) => setMode(v as "outright" | "spread")}
        />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="h-7 w-32 border border-border-subtle bg-bg-elevated px-2 text-body text-fg-primary placeholder:text-fg-dim"
        />

        {mode === "outright" ? (
          <>
            <LegPicker sectors={sectors} filter={filter} onChange={setOutrightLeg} />
            <Button variant="secondary" size="sm" onClick={handleAddOutright} disabled={!outrightLeg}>
              Add
            </Button>
          </>
        ) : (
          <>
            <SegmentedControl
              small
              options={[
                { label: "2-leg", value: "2" },
                { label: "3-leg (fly)", value: "3" },
              ]}
              value={String(legCount)}
              onValueChange={(v) => handleLegCount(Number(v))}
            />
            <div className="flex flex-wrap items-center gap-2">
              {activeLegs.map((_, i) => (
                <SpreadLegRow
                  key={i}
                  index={i}
                  sectors={sectors}
                  filter={filter}
                  weight={spreadWeights[i] ?? 0}
                  onLegChange={handleLegChange}
                />
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={handleAddSpread} disabled={!spreadReady}>
              Add Spread
            </Button>
          </>
        )}
      </div>

      {/* FB3 F3: the weight-sum warning is gone WITH its cause — both fixed
          coefficient sets (+1/−1, +1/−2/+1) sum to 0, so PVBP-neutral sizing
          is always satisfiable. */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((inst) => (
            <span
              key={inst.id}
              className="inline-flex h-7 items-center gap-1.5 rounded bg-bg-secondary px-2"
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: colorForId(inst.id) }}
              />
              <span className="text-body text-fg-primary">{instrumentLabel(inst)}</span>
              {inst.kind === "spread" && (
                <span className="text-label text-fg-muted">bp</span>
              )}
              <button
                type="button"
                onClick={() => onRemove(inst.id)}
                aria-label={`Remove ${instrumentLabel(inst)}`}
                className="flex items-center text-fg-dim hover:text-fg-secondary"
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
