"use client";

import { useMemo } from "react";
import { usePortfolioRiskBuckets } from "@/hooks/use-portfolio-risk";
import { TENOR_BUCKETS, type TenorBucket } from "@/lib/constants";
import { bucketForYears } from "@/lib/risk-buckets";
import { useSimulationStore } from "@/stores/simulation-store";
import { DeltaIndicator } from "@/components/data/delta-indicator";

function getTenorYears(tenor: string): number {
  const clean = tenor.toUpperCase();
  if (clean === "3M") return 0.25;
  if (clean === "6M") return 0.5;
  const match = /^(\d+)(Y|M)$/.exec(clean);
  if (!match) return 5;
  const val = parseInt(match[1], 10);
  const unit = match[2];
  return unit === "Y" ? val : val / 12;
}

interface MetricRow {
  label: string;
  key: string;
  current: number;
  post: number;
  delta: number;
  isRate?: boolean;
}

const ZERO_BUCKETS: Record<TenorBucket, number> = Object.fromEntries(
  TENOR_BUCKETS.map((b) => [b, 0]),
) as Record<TenorBucket, number>;

export function ImpactGrid() {
  const { sandboxTrades } = useSimulationStore();
  const { buckets, totalDv01, totalNotional } = usePortfolioRiskBuckets();

  const currentMetrics = useMemo(
    () => ({ totalNotional, totalDv01, bucketDv01: buckets ?? ZERO_BUCKETS }),
    [totalNotional, totalDv01, buckets],
  );

  const sandboxImpact = useMemo(() => {
    let notionalChange = 0;
    let dv01Change = 0;
    const bucketDv01Change: Record<TenorBucket, number> = { ...ZERO_BUCKETS };

    sandboxTrades.forEach((trade) => {
      notionalChange += trade.notionalKrwEok;
      const years = getTenorYears(trade.tenor);
      const sign = trade.direction === "Pay" || trade.direction === "Sell" ? -1 : 1;
      const tradeDv01 = sign * trade.notionalKrwEok * (years / 10);

      dv01Change += tradeDv01;
      bucketDv01Change[bucketForYears(years)] += tradeDv01;
    });

    return { notionalChange, dv01Change, bucketDv01Change };
  }, [sandboxTrades]);

  const metricsList = useMemo<MetricRow[]>(() => {
    const list: MetricRow[] = [
      {
        label: "Total Notional (100M KRW)",
        key: "notional",
        current: currentMetrics.totalNotional,
        post: currentMetrics.totalNotional + sandboxImpact.notionalChange,
        delta: sandboxImpact.notionalChange,
      },
      {
        label: "Total DV01 (KRW/bp)",
        key: "totalDv01",
        current: currentMetrics.totalDv01,
        post: currentMetrics.totalDv01 + sandboxImpact.dv01Change,
        delta: sandboxImpact.dv01Change,
      },
    ];

    TENOR_BUCKETS.forEach((bucket) => {
      const cur = currentMetrics.bucketDv01[bucket] || 0;
      const chg = sandboxImpact.bucketDv01Change[bucket] || 0;
      list.push({
        label: `DV01 Bucket ${bucket}`,
        key: `bucket-${bucket}`,
        current: cur,
        post: cur + chg,
        delta: chg,
      });
    });

    return list;
  }, [currentMetrics, sandboxImpact]);

  const chartData = useMemo(() => {
    return TENOR_BUCKETS.map((bucket) => {
      const cur = Math.round(currentMetrics.bucketDv01[bucket] || 0);
      const chg = Math.round(sandboxImpact.bucketDv01Change[bucket] || 0);
      return {
        name: bucket,
        Current: cur,
        Post: cur + chg,
      };
    });
  }, [currentMetrics, sandboxImpact]);

  // Max value for chart scaling
  const maxVal = Math.max(
    ...chartData.map(d => Math.max(Math.abs(d.Current), Math.abs(d.Post))),
    1
  );

  return (
    <div className="flex h-full flex-col p-4 gap-6 overflow-auto">
      <div className="flex items-center justify-between">
        <span className="text-h2 text-fg-primary">Live Impact Matrix</span>
        <span className="text-micro text-fg-muted">Sandbox impact is illustrative</span>
      </div>

      {/* Comparison Grid Table */}
      <div className="min-h-0 overflow-auto">
        <table className="w-full text-body text-left border-collapse">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="py-2 text-label text-fg-muted font-bold uppercase">Metric</th>
              <th className="py-2 text-right text-label text-fg-muted font-bold uppercase">Current</th>
              <th className="py-2 text-right text-label text-fg-muted font-bold uppercase">Post-Sandbox</th>
              <th className="py-2 text-right text-label text-fg-muted font-bold uppercase">Δ</th>
            </tr>
          </thead>
          <tbody>
            {metricsList.map((row) => (
              <tr key={row.key} className="border-t border-border-subtle hover:bg-bg-secondary/40">
                <td className="py-2.5 font-medium text-fg-secondary">{row.label}</td>
                <td className="py-2.5 text-right font-mono tabular-nums text-fg-secondary">
                  {Math.round(row.current).toLocaleString()}
                </td>
                <td className="py-2.5 text-right font-mono tabular-nums text-fg-primary">
                  {Math.round(row.post).toLocaleString()}
                </td>
                <td className="py-2.5 text-right">
                  <div className="flex justify-end">
                    <DeltaIndicator value={row.delta} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Chart container */}
      <div className="flex flex-col gap-2 flex-1 min-h-64">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="text-label text-fg-muted uppercase">Risk Profile (DV01 by Tenor Bucket)</span>
          <div style={{ display: "flex", gap: 12, fontSize: 11, fontFamily: "var(--font-ui)", color: "var(--fg-muted)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 12, height: 12, background: "var(--bg-tertiary)", borderRadius: 2 }} /> Current
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 12, height: 12, border: "1.5px solid var(--sem-info)", borderRadius: 2 }} /> Post
            </span>
          </div>
        </div>
        <div className="flex-1 w-full bg-bg-secondary/20 rounded p-2" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {chartData.map(d => {
            const isNegative = d.Current < 0 || d.Post < 0; // For full generic handling, but assume DV01 mostly positive
            const curWidth = `${(Math.abs(d.Current) / maxVal) * 80}%`;
            const postWidth = `${(Math.abs(d.Post) / maxVal) * 80}%`;
            return (
              <div key={d.name} style={{ display: "flex", alignItems: "center", height: 24 }}>
                <div style={{ width: 40, fontSize: 10, color: "var(--fg-dim)" }}>{d.name}</div>
                <div style={{ flex: 1, display: "flex", position: "relative", alignItems: "center", height: "100%" }}>
                  {/* Current Bar */}
                  <div style={{ position: "absolute", left: 0, height: 12, width: curWidth, background: "var(--bg-tertiary)", borderRadius: "0 2px 2px 0", zIndex: 1 }} />
                  {/* Post Bar */}
                  <div style={{ position: "absolute", left: 0, height: 12, width: postWidth, border: "1.5px solid var(--sem-info)", borderRadius: "0 2px 2px 0", zIndex: 2 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
