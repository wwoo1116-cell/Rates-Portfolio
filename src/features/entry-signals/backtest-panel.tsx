"use client";

/**
 * Bottom-right (below Signals) panel: the backtest summary stat tiles + trade
 * list for the focused instrument, plus the backtest-only parameter controls
 * (exit / stop / cost / notional). Uses the client-side sim (useFocusedBacktest),
 * so it works for any spread or outright.
 */

import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import type { BtSummary, BtTrade } from "@/lib/math/backtest";
import { useEntrySignalsStore } from "@/stores/entry-signals-store";
import { NumberField } from "./panel-shell";
import { useEntrySignalsData } from "./use-entry-signals-data";
import { useFocusedBacktest } from "./use-backtest";
import { createTradeColumnDefs } from "./trades-columns";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-balham.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const DEFAULT_COL_DEF: ColDef<BtTrade> = {
  sortable: true,
  resizable: true,
  filter: false,
  minWidth: 60,
  cellStyle: { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center" },
};

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  // Chart P&L pair (S10) — these tiles summarize the equity-curve chart, so
  // they carry its Jade/Berry convention, not the app-wide sem green/red.
  const color = tone === "positive" ? "var(--chart-pnl-pos)" : tone === "negative" ? "var(--chart-pnl-neg)" : "var(--fg-primary)";
  return (
    <div className="flex flex-col gap-1 bg-bg-raised px-3 py-2" style={{ minWidth: 96 }}>
      <span className="text-label uppercase text-fg-muted">{label}</span>
      <span className="num text-body-strong" style={{ color, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

function SummaryTiles({ summary }: { summary: BtSummary }) {
  const pnl = Math.round(summary.totalPnl).toLocaleString();
  const dd = Math.round(summary.maxDrawdown).toLocaleString();
  const win = summary.winRate == null ? "—" : `${(summary.winRate * 100).toFixed(0)}%`;
  const sharpe = summary.sharpe == null ? "—" : summary.sharpe.toFixed(2);
  return (
    <div className="flex flex-wrap gap-2">
      <StatTile label="Total P&L" value={pnl} tone={summary.totalPnl >= 0 ? "positive" : "negative"} />
      <StatTile label="Max Drawdown" value={dd} tone={summary.maxDrawdown > 0 ? "negative" : undefined} />
      <StatTile label="Win Rate" value={win} />
      <StatTile label="Sharpe" value={sharpe} />
      <StatTile label="Trades" value={String(summary.numTrades)} />
    </div>
  );
}

function BacktestParams() {
  const exitZ = useEntrySignalsStore((s) => s.exitZ);
  const stopZ = useEntrySignalsStore((s) => s.stopZ);
  const costBp = useEntrySignalsStore((s) => s.costBp);
  const notional = useEntrySignalsStore((s) => s.notional);
  const setExitZ = useEntrySignalsStore((s) => s.setExitZ);
  const setStopZ = useEntrySignalsStore((s) => s.setStopZ);
  const setCostBp = useEntrySignalsStore((s) => s.setCostBp);
  const setNotional = useEntrySignalsStore((s) => s.setNotional);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <NumberField label="EXIT ±σ" value={exitZ} step="0.1" min={0} onCommit={setExitZ} className="w-20" />
      <NumberField label="STOP ±σ" value={stopZ} step="0.1" min={0} onCommit={setStopZ} className="w-20" />
      <NumberField label="COST (BP)" value={costBp} step="0.01" min={0} onCommit={setCostBp} className="w-24" />
      <NumberField label="NOTIONAL" value={notional} step="100000" min={0} onCommit={setNotional} className="w-32" />
    </div>
  );
}

export function BacktestPanel() {
  const { focusedSeries } = useEntrySignalsData();
  const focused = useEntrySignalsStore((s) => s.focused);
  const result = useFocusedBacktest(focusedSeries);
  const columnDefs = useMemo(() => createTradeColumnDefs(), []);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-bold uppercase text-fg-muted">Backtest · Trades &amp; Summary</span>
      </div>

      <BacktestParams />

      {!focused || !result ? (
        <div className="flex flex-1 items-center justify-center text-center">
          <span className="text-micro text-fg-muted" style={{ maxWidth: 320 }}>
            Focus an instrument in the Signals panel to run its mean-reversion backtest.
          </span>
        </div>
      ) : (
        <>
          <SummaryTiles summary={result.summary} />
          <div className="min-h-0 flex-1">
            <div className="ag-theme-balham-dark" style={{ height: "100%", width: "100%", background: "var(--bg-surface)" }}>
              <AgGridReact<BtTrade>
                theme="legacy"
                rowData={result.trades}
                columnDefs={columnDefs}
                defaultColDef={DEFAULT_COL_DEF}
                rowHeight={28}
                headerHeight={30}
                suppressCellFocus
                overlayNoRowsTemplate={`<span style="color:var(--fg-muted);font-size:var(--text-sm)">No trades in this window</span>`}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
