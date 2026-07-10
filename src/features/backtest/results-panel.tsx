"use client";

import { DeltaIndicator } from "@/components/data/delta-indicator";
import { PriceDisplay } from "@/components/data/price-display";
import { NonIdealState, Spinner } from "@blueprintjs/core";
import { useBacktestStore } from "@/stores/backtest-store";
import type { BacktestMetrics } from "@/mocks/backtest";

const METRIC_DEFS: { key: keyof BacktestMetrics; label: string; unit: string }[] = [
  { key: "pnl", label: "Total P&L", unit: " 100M" },
  { key: "dv01", label: "Total DV01", unit: "" },
  { key: "duration", label: "Portfolio Duration", unit: " Y" },
  { key: "var", label: "VaR (mock)", unit: " 100M" },
];

function MetricCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col gap-1 rounded bg-bg-secondary p-3">
      <span className="text-label font-bold text-fg-muted">{label}</span>
      <PriceDisplay value={value} unit={unit} />
    </div>
  );
}

export function ResultsPanel() {
  const result = useBacktestStore((s) => s.result);
  const isRunning = useBacktestStore((s) => s.isRunning);

  if (isRunning) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>
        <NonIdealState
          icon={<Spinner size={32} />}
          title="Running Backtest"
          description="Computing scenario impact across the portfolio..."
        />
      </div>
    );
  }

  if (!result) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>
        <NonIdealState
          icon="chart"
          title="No Results"
          description="Select a scenario and run a backtest to see results"
        />
      </div>
    );
  }

  const { pre, post, scenario } = result;

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-4">
      <div className="flex flex-col gap-3">
        <span className="text-h2 text-fg-primary">{scenario.label}</span>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 gap-y-3">
          <span className="text-label text-fg-muted">PRE-SHOCK</span>
          <span />
          <span className="text-label text-fg-muted">POST-SHOCK</span>

          {METRIC_DEFS.map((metric) => {
            const preValue = pre[metric.key];
            const postValue = post[metric.key];
            const delta = postValue - preValue;
            return (
              <div key={metric.key} className="contents">
                <MetricCard label={metric.label} value={preValue} unit={metric.unit} />
                <div className="flex items-center justify-center px-2">
                  <DeltaIndicator value={delta} suffix={metric.unit.trim()} />
                </div>
                <MetricCard label={metric.label} value={postValue} unit={metric.unit} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-muted">Diff</span>
        <table className="w-full text-body">
          <thead>
            <tr>
              <th className="py-2 text-left text-label font-bold text-fg-muted">Metric</th>
              <th className="py-2 text-right text-label font-bold text-fg-muted">Pre</th>
              <th className="py-2 text-right text-label font-bold text-fg-muted">Post</th>
              <th className="py-2 text-right text-label font-bold text-fg-muted">Δ</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_DEFS.map((metric) => {
              const preValue = pre[metric.key];
              const postValue = post[metric.key];
              const delta = postValue - preValue;
              return (
                <tr key={metric.key} className="border-t border-border-subtle">
                  <td className="py-2 text-fg-secondary">{metric.label}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-fg-secondary">
                    {preValue.toFixed(2)}
                    {metric.unit}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-fg-primary">
                    {postValue.toFixed(2)}
                    {metric.unit}
                  </td>
                  <td
                    className={`py-2 text-right font-mono tabular-nums ${
                      delta >= 0 ? "text-sem-positive" : "text-sem-negative"
                    }`}
                  >
                    {delta >= 0 ? "+" : ""}
                    {delta.toFixed(2)}
                    {metric.unit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
