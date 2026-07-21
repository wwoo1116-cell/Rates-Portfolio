"use client";

/**
 * Bottom-right panel: the curated-watchlist signal scan. Each row is one
 * watchlist instrument's latest rolling stats + mean-reversion signal, sorted
 * by |z| descending. Adding/removing instruments uses the same
 * InstrumentSelector as Rates History. Clicking a row focuses that instrument
 * (drives the Price / Z-Score / Backtest panels).
 */

import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef, type GetRowIdParams, type RowClassParams, type RowClickedEvent } from "ag-grid-community";
import { SegmentedControl } from "@blueprintjs/core";
import { InstrumentSelector } from "@/components/ui/instrument-selector";
import { deriveSignal, latestStats } from "@/lib/math/rolling-stats";
import { instrumentLabel } from "@/lib/rv-instruments";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";
import { useEntrySignalsData } from "../../hooks/use-entry-signals-data";
import { createSignalColumnDefs, type SignalRow } from "../signal-columns";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-balham.css";

// Required as of ag-grid v33 (see positions-grid.tsx) -- without this the grid
// silently renders zero rows (AG Grid error #272).
ModuleRegistry.registerModules([AllCommunityModule]);

const DEFAULT_COL_DEF: ColDef<SignalRow> = {
  sortable: true,
  resizable: true,
  filter: false,
  minWidth: 60,
  cellStyle: { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center" },
};

export function SignalGridPanel({
  /** s17: the Results stage hides the add/remove selector — watchlist
   * management lives on the Configure stage; the grid itself stays LIVE
   * (row click refocuses the z-score panel; the pinned backtest then shows
   * its stale marker instead of silently recomputing). */
  showSelector = true,
}: {
  showSelector?: boolean;
}) {
  const { taxonomy, seriesById } = useEntrySignalsData();
  const watchlist = useEntrySignalsStore((s) => s.watchlist);
  const focused = useEntrySignalsStore((s) => s.focused);
  const lookback = useEntrySignalsStore((s) => s.lookback);
  const entryZ = useEntrySignalsStore((s) => s.entryZ);
  const warnZ = useEntrySignalsStore((s) => s.warnZ);
  const addToWatchlist = useEntrySignalsStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useEntrySignalsStore((s) => s.removeFromWatchlist);
  const setFocused = useEntrySignalsStore((s) => s.setFocused);

  const [breachingOnly, setBreachingOnly] = useState(false);

  const rows = useMemo<SignalRow[]>(() => {
    const out = watchlist.map((inst) => {
      const series = seriesById.get(inst.id);
      const values = series ? series.lineData.map((d) => d.value) : [];
      const stats = latestStats(values, lookback);
      const z = stats?.z ?? null;
      return {
        id: inst.id,
        inst,
        label: instrumentLabel(inst),
        kind: inst.kind,
        value: stats?.value ?? null,
        mean: stats?.mean ?? null,
        std: stats?.std ?? null,
        z,
        signal: deriveSignal(z, entryZ, warnZ),
        distance: stats ? stats.value - stats.mean : null,
        absZ: z == null ? -1 : Math.abs(z),
      } satisfies SignalRow;
    });
    out.sort((a, b) => b.absZ - a.absZ);
    return out;
  }, [watchlist, seriesById, lookback, entryZ, warnZ]);

  const visibleRows = useMemo(
    () => (breachingOnly ? rows.filter((r) => r.signal !== "NONE") : rows),
    [rows, breachingOnly],
  );

  const columnDefs = useMemo(() => createSignalColumnDefs(entryZ, warnZ), [entryZ, warnZ]);
  const getRowId = useMemo(() => (p: GetRowIdParams<SignalRow>) => p.data.id, []);
  const getRowStyle = useMemo(
    () => (p: RowClassParams<SignalRow>) =>
      p.data && focused && p.data.id === focused.id ? { background: "var(--accent-soft)" } : undefined,
    [focused],
  );

  const breachCount = rows.filter((r) => r.signal !== "NONE").length;

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-bold uppercase text-fg-muted">
          Signals · {breachCount}/{rows.length} breaching
        </span>
        <SegmentedControl
          small
          options={[
            { label: "All", value: "all" },
            { label: "Breaching", value: "breaching" },
          ]}
          value={breachingOnly ? "breaching" : "all"}
          onValueChange={(v) => setBreachingOnly(v === "breaching")}
        />
      </div>

      {showSelector && (
        <InstrumentSelector
          taxonomy={taxonomy}
          selected={watchlist}
          onAdd={addToWatchlist}
          onRemove={removeFromWatchlist}
        />
      )}

      <div className="relative min-h-0 flex-1">
        {watchlist.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <span className="text-micro text-fg-muted" style={{ maxWidth: 320 }}>
              {showSelector
                ? "Add instruments above to scan them for entry signals."
                : "설정 단계에서 관심 종목을 추가하면 여기에서 신호를 스캔합니다."}
            </span>
          </div>
        ) : (
          <div className="ag-theme-balham-dark" style={{ height: "100%", width: "100%", background: "var(--bg-surface)" }}>
            <AgGridReact<SignalRow>
              theme="legacy"
              rowData={visibleRows}
              columnDefs={columnDefs}
              defaultColDef={DEFAULT_COL_DEF}
              getRowId={getRowId}
              getRowStyle={getRowStyle}
              rowHeight={28}
              headerHeight={30}
              rowSelection="single"
              suppressCellFocus
              onRowClicked={(e: RowClickedEvent<SignalRow>) => {
                if (e.data) setFocused(e.data.inst);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
