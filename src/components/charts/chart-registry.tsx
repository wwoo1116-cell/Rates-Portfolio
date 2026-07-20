"use client";

/**
 * Detached-chart registry (S10): maps every ChartFrame chartId to the
 * renderer the standalone /chart/[chartId] route mounts in its own window.
 *
 * Two renderer shapes:
 *  - SELF-FETCHING panels (Rate History, the three Entry Signals panels):
 *    mounted directly — their hooks refetch through the shared query cache
 *    and their zustand stores rehydrate from the same localStorage, so the
 *    detached window shows the same selection with no snapshot.
 *  - SNAPSHOT renderers: rebuild the chart from the JSON state ChartFrame
 *    wrote at detach time (detach.ts). Non-serializable props (color
 *    functions, canonical orders) are re-bound here from a discriminator.
 *
 * Imported ONLY by the /chart route — ChartFrame itself never imports this
 * module (the panels below import ChartFrame; importing back would cycle).
 */

import type { ReactNode } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { maturityColor } from "@/lib/chart-colors";
import type { AllocationSeries } from "@/lib/api-types";
import { RateHistoryChart } from "@/features/home/rate-history-chart";
import { PnlTracePanel, type PnlTracePanelParams } from "@/features/home/pnl-trace-panel";
import {
  SpreadPositionPanel,
  type SpreadPositionPanelParams,
} from "@/features/home/spread-position-panel";
import {
  AllocationChart,
  MATURITY_ORDER,
  MERGED_SECTOR_ORDER,
  mergedSectorColor,
  type AllocationDetachState,
} from "@/features/home/portfolio-overview";
import { MtmHistoryChart } from "@/features/portfolio/details-panel";
import { PricePanel } from "@/features/entry-signals/components/panels/price-panel";
import { ZScoreOscillatorPanel } from "@/features/entry-signals/components/panels/zscore-oscillator-panel";
import { EquityCurvePanel } from "@/features/entry-signals/components/panels/equity-curve-panel";
import type { NpvTracePointOut } from "@/lib/api-client";

export interface DetachedChartEntry {
  title: string;
  render: (state: unknown) => ReactNode;
}

function MissingSnapshot({ what }: { what: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <span className="text-body text-fg-muted" style={{ maxWidth: 420 }}>
        This detached {what} chart&apos;s data snapshot is missing or expired — close this window
        and detach the chart again from the main window.
      </span>
    </div>
  );
}

function DetachedAllocation({ state }: { state: unknown }) {
  const s = state as Partial<AllocationDetachState> | undefined;
  if (!s?.series || (s.kind !== "sector" && s.kind !== "maturity")) {
    return <MissingSnapshot what="allocation" />;
  }
  return (
    <div className="flex h-full flex-col p-4">
      <AllocationChart
        kind={s.kind}
        title={s.title ?? ""}
        basis={s.basis ?? ""}
        series={s.series as AllocationSeries}
        canonical={s.kind === "sector" ? MERGED_SECTOR_ORDER : MATURITY_ORDER}
        colorFor={s.kind === "sector" ? mergedSectorColor : maturityColor}
      />
    </div>
  );
}

function DetachedMtm({ state }: { state: unknown }) {
  const s = state as { points?: NpvTracePointOut[]; label?: string } | undefined;
  if (!s?.points || s.points.length === 0) return <MissingSnapshot what="MtM" />;
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      {s.label && <span className="text-label text-fg-muted">{s.label} · MTM (Last 1Y)</span>}
      <div className="relative min-h-0 flex-1">
        <MtmHistoryChart points={s.points} />
      </div>
    </div>
  );
}

function DetachedPnlTrace({ state }: { state: unknown }) {
  const s = state as Partial<PnlTracePanelParams> | undefined;
  if (!s?.point) return <MissingSnapshot what="PnL trace" />;
  // PnlTracePanel reads only props.params from its dockview prop surface;
  // outside dockview there is no panel api to hand it.
  const props = { params: { point: s.point } } as IDockviewPanelProps<PnlTracePanelParams>;
  return <PnlTracePanel {...props} />;
}

function DetachedSpreadPosition({ state }: { state: unknown }) {
  const s = state as Partial<SpreadPositionPanelParams> | undefined;
  if (!s?.instrument || !s.entryDate) return <MissingSnapshot what="spread position" />;
  return <SpreadPositionPanel params={s as SpreadPositionPanelParams} />;
}

export const DETACHED_CHARTS: Record<string, DetachedChartEntry> = {
  "rates-history": {
    title: "Rate History",
    render: () => <RateHistoryChart />,
  },
  "pnl-trace": {
    title: "PnL Trace",
    render: (state) => <DetachedPnlTrace state={state} />,
  },
  "spread-position": {
    title: "Position",
    render: (state) => <DetachedSpreadPosition state={state} />,
  },
  "portfolio-mtm": {
    title: "Position MTM (1Y)",
    render: (state) => <DetachedMtm state={state} />,
  },
  "home-allocation-sector": {
    title: "섹터 배분",
    render: (state) => <DetachedAllocation state={state} />,
  },
  "home-allocation-maturity": {
    title: "만기 배분",
    render: (state) => <DetachedAllocation state={state} />,
  },
  "es-price": {
    title: "Price / Spread",
    render: () => <PricePanel />,
  },
  "es-zscore": {
    title: "Z-Score Oscillator",
    render: () => <ZScoreOscillatorPanel />,
  },
  "es-equity": {
    title: "Backtest — Cumulative P&L",
    render: () => <EquityCurvePanel />,
  },
};
