"use client";

/**
 * 3-tier instrument selector for the Rates History RV chart: Sector -> Rating
 * -> Tenor cascading dropdowns, in either "Outright" mode (one leg) or
 * "Spread" mode (Leg A / Leg B). Replaces the old fixed toggle-button row.
 * Rating is auto-N/A (dropdown disabled) for unrated sectors (국고채, IRS).
 * Selected instruments render as removable color-coded chips.
 */
import { useEffect, useMemo, useState } from "react";
import { HTMLSelect, SegmentedControl } from "@blueprintjs/core";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InstrumentTaxonomyOut, TaxonomySectorOut } from "@/lib/api-client";
import { colorForId } from "@/lib/chart-colors";
import {
  instrumentLabel,
  outrightId,
  spreadId,
  type Leg,
  type SelectedInstrument,
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
  const [legA, setLegA] = useState<Leg | null>(null);
  const [legB, setLegB] = useState<Leg | null>(null);

  const sectors = taxonomy?.sectors ?? [];

  function handleAddOutright() {
    if (!outrightLeg) return;
    onAdd({ kind: "outright", id: outrightId(outrightLeg), leg: outrightLeg });
  }

  function handleAddSpread() {
    if (!legA || !legB) return;
    onAdd({ kind: "spread", id: spreadId(legA, legB), legA, legB });
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
          className="h-7 w-32 border border-border-subtle bg-bg-overlay px-2 text-body text-fg-primary placeholder:text-fg-dim"
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
            <div className="flex items-center gap-1.5">
              <span className="text-micro font-bold text-fg-muted">B</span>
              <LegPicker sectors={sectors} filter={filter} onChange={setLegB} />
              <span className="text-micro font-bold text-fg-muted">−  A</span>
              <LegPicker sectors={sectors} filter={filter} onChange={setLegA} />
            </div>
            <Button variant="secondary" size="sm" onClick={handleAddSpread} disabled={!legA || !legB}>
              Add Spread
            </Button>
          </>
        )}
      </div>

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
