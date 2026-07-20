"use client";

/**
 * Dockview panel opened by clicking a SPREAD series in rate-history-chart.
 * Sizes a position in that spread at the clicked date, then traces the
 * package's P&L forward from it.
 *
 * Handles 2-leg and 3-leg (fly) spreads through B3's generalized leg array --
 * there is no per-N branching here or in lib/math/pvbp-sizing.ts.
 *
 * Market data comes from the same hooks (and therefore the same TanStack Query
 * cache entries) the chart already populated, so opening this panel costs no
 * extra fetch.
 */
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { SegmentedControl } from "@blueprintjs/core";

import { ChartFrame } from "@/components/charts/chart-frame";
import { useCreditCurveSeries, useMarketDataRange, useRateHistory } from "@/hooks/use-api";
import { formatKrwAxisSigned } from "@/lib/format";
import { formatPnlKrw } from "./pnl-format";
import {
  creditLegsOf,
  instrumentLabel,
  legLabel,
  spreadLegValueMaps,
  type SelectedInstrument,
} from "@/lib/rv-instruments";
import {
  parseTenorYears,
  pvbpPerUnitNotional,
  sizeManual,
  sizePvbpNeutral,
  spreadPnlPath,
  sumWeights,
  type SizingLeg,
} from "@/lib/math/pvbp-sizing";

// Canvas touches window; keep it off the SSR path like the other chart panels.
const SpreadPnlChart = dynamic(() => import("./spread-pnl-chart").then((m) => m.SpreadPnlChart), {
  ssr: false,
});

/** 억 (100M KRW) is the ledger's unit everywhere else in this app. */
const EOK = 100_000_000;

function formatEok(value: number): string {
  return (value / EOK).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export interface SpreadPositionPanelParams {
  instrument: SelectedInstrument;
  entryDate: string;
}

export function SpreadPositionPanel({ params }: { params: SpreadPositionPanelParams }) {
  const { instrument, entryDate } = params;

  const rangeQuery = useMarketDataRange();
  const minDate = rangeQuery.data?.min_date ?? "";
  const maxDate = rangeQuery.data?.max_date ?? "";
  const historyQuery = useRateHistory(minDate, maxDate);
  const points = useMemo(() => historyQuery.data?.points ?? [], [historyQuery.data]);

  const creditLegs = useMemo(() => creditLegsOf([instrument]), [instrument]);
  const creditQuery = useCreditCurveSeries(creditLegs, minDate, maxDate);
  const creditResults = useMemo(() => creditQuery.data?.results ?? [], [creditQuery.data]);

  // Memoized: the `: []` branch would otherwise mint a new array every render
  // and churn every useMemo below it.
  const legs = useMemo(
    () => (instrument.kind === "spread" ? instrument.legs : []),
    [instrument],
  );

  const legYields = useMemo(
    () => spreadLegValueMaps(legs, points, creditResults),
    [legs, points, creditResults],
  );

  const [mode, setMode] = useState<"neutral" | "manual">("neutral");
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [anchorEok, setAnchorEok] = useState("100");
  const [manualEok, setManualEok] = useState<string[]>(() => legs.map(() => "0"));

  /** PVBP per unit notional per leg, at the entry date. */
  const sizingLegs = useMemo<SizingLeg[] | null>(() => {
    const out: SizingLeg[] = [];
    for (let i = 0; i < legs.length; i++) {
      const tenorYears = parseTenorYears(legs[i].leg.tenor);
      const y = legYields[i]?.get(entryDate);
      // A leg with no tenor or no print on this date can't be sized -- bail
      // rather than substitute a guess.
      if (tenorYears == null || y == null) return null;
      out.push({
        label: legLabel(legs[i].leg),
        weight: legs[i].weight,
        pvbpUnit: pvbpPerUnitNotional(tenorYears, y),
      });
    }
    return out;
  }, [legs, legYields, entryDate]);

  const result = useMemo(() => {
    if (!sizingLegs) return null;
    if (mode === "manual") {
      return sizeManual(sizingLegs, manualEok.map((v) => (Number(v) || 0) * EOK));
    }
    return sizePvbpNeutral(sizingLegs, anchorIndex, (Number(anchorEok) || 0) * EOK);
  }, [sizingLegs, mode, manualEok, anchorIndex, anchorEok]);

  const pnlPath = useMemo(() => {
    if (!result) return [];
    return spreadPnlPath(result.legs, legYields, entryDate);
  }, [result, legYields, entryDate]);

  const weightSum = sumWeights(legs);
  const lastPnl = pnlPath.at(-1);

  if (instrument.kind !== "spread") {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-body text-fg-muted">스프레드 상품이 아닙니다.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-h2 text-fg-primary">Position</span>
        <span className="text-body text-fg-secondary">{instrumentLabel(instrument)}</span>
        <span data-num className="text-micro text-fg-muted">
          @ {entryDate}
        </span>
      </div>

      {/* Sizing mode */}
      <div className="flex flex-col gap-2 border-b border-border-subtle pb-3">
        <span className="text-label font-bold text-fg-muted uppercase">Sizing</span>
        <div className="flex flex-wrap items-end gap-3">
          {/* Blueprint SegmentedControl, matching instrument-selector's mode
              toggle. The first cut hand-rolled this with a bg-sem-info active
              fill, which DESIGN.md's Points-Not-Fills rule forbids (semantic
              color "is never a fill"; solid bg-sem-info is reserved for the one
              primary submit button per screen). */}
          <SegmentedControl
            small
            options={[
              { label: "PVBP-NEUTRAL", value: "neutral" },
              { label: "MANUAL", value: "manual" },
            ]}
            value={mode}
            onValueChange={(v) => setMode(v as "neutral" | "manual")}
          />

          {mode === "neutral" && (
            <>
              <label className="flex flex-col gap-1 text-micro font-bold text-fg-muted">
                Anchor Leg
                <select
                  value={anchorIndex}
                  onChange={(e) => setAnchorIndex(Number(e.target.value))}
                  className="h-7 w-40 border border-border-subtle bg-bg-elevated px-2 text-body font-normal text-fg-primary"
                >
                  {legs.map((l, i) => (
                    <option key={i} value={i}>
                      {legLabel(l.leg)} ({l.weight > 0 ? "+" : ""}
                      {l.weight})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-micro font-bold text-fg-muted">
                Anchor Notional (억)
                <input
                  type="number"
                  step="10"
                  value={anchorEok}
                  onChange={(e) => setAnchorEok(e.target.value)}
                  data-num
                  className="h-7 w-24 border border-border-subtle bg-bg-elevated px-2 text-body font-normal text-fg-primary"
                />
              </label>
            </>
          )}
        </div>

        {mode === "neutral" && (
          // The convention the work order asked to be stated in the UI.
          <p className="text-micro text-fg-dim">
            앵커 레그 사이즈를 고정하고 나머지를 <span data-num>nᵢ = c·wᵢ/pᵢ</span> 로 풉니다 —
            가중치 비율({legs.map((l) => (l.weight > 0 ? `+${l.weight}` : l.weight)).join(" : ")})을
            <strong className="text-fg-muted"> PVBP 기준으로</strong> 부과합니다. 그 결과 net PVBP =
            c·Σwᵢ 이므로 가중치 합이 0일 때만 중립이 됩니다. 명목금액 자체를 가중치 비율로 고정하면
            중립을 만족하는 해가 전부 0뿐이라 불가능합니다.
          </p>
        )}
      </div>

      {/* Per-leg table */}
      {!sizingLegs && (
        <p className="text-micro text-sem-risk">
          이 날짜에 값이 없는 레그가 있어 사이징할 수 없습니다 ({entryDate}).
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 border-b border-border-dim pb-1">
            {["Leg", "Weight", "Notional (억)", "PVBP (KRW/bp)"].map((h) => (
              <span key={h} className="text-label font-bold text-fg-muted uppercase">
                {h}
              </span>
            ))}
          </div>
          {result.legs.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4">
              <span className="text-body text-fg-primary">{l.label}</span>
              <span data-num className="text-body text-fg-secondary text-right">
                {l.weight > 0 ? `+${l.weight}` : l.weight}
              </span>
              {mode === "manual" ? (
                <input
                  type="number"
                  step="10"
                  value={manualEok[i] ?? "0"}
                  onChange={(e) =>
                    setManualEok((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  aria-label={`${l.label} notional`}
                  data-num
                  className="h-7 w-24 border border-border-subtle bg-bg-elevated px-2 text-right text-body text-fg-primary"
                />
              ) : (
                <span
                  data-num
                  className={`text-body text-right ${l.notional < 0 ? "text-chart-pnl-neg" : "text-fg-primary"}`}
                >
                  {formatEok(l.notional)}
                </span>
              )}
              <span data-num className="text-body text-fg-secondary text-right">
                {formatPnlKrw(l.pvbp)}
              </span>
            </div>
          ))}

          {/* Residual */}
          <div className="mt-1 flex items-center justify-between border-t border-border-subtle pt-2">
            <span className="text-label font-bold text-fg-muted uppercase">Net PVBP (residual)</span>
            {/* S12: "residual ≈ 0" is a SUCCESS state, not a signed value —
                Jade is now locked to signed semantics, so the ok-state drops
                to calm fg-primary; only the non-neutral warning keeps accent.
                (Old: green = ok. Flagged in REPORT_s12.md.) */}
            <span
              data-num
              className={`text-body ${Math.abs(result.netPvbp) < 1 ? "text-fg-primary" : "text-sem-risk"}`}
            >
              {formatPnlKrw(result.netPvbp)} KRW/bp
            </span>
          </div>

          {result.warning && <p className="text-micro text-sem-risk">{result.warning}</p>}
          {weightSum !== 0 && mode === "neutral" && (
            <p className="text-micro text-fg-dim">
              가중치 합 = {weightSum}. PVBP 중립을 원하면 합이 0이 되도록 가중치를 조정하세요.
            </p>
          )}
        </div>
      )}

      {/* P&L path */}
      {pnlPath.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2 border-b border-border-subtle pb-2 text-micro text-fg-muted">
            <span className="font-bold uppercase">Strategy P&L from {entryDate}</span>
            <span
              data-num
              className={`font-normal ${(lastPnl?.value ?? 0) >= 0 ? "text-chart-pnl-pos" : "text-chart-pnl-neg"}`}
            >
              {/* Chart-surface badge: signed 억/만 like the chart's own axis/
                  tooltip (s14) — full-digit formatPnlKrw stays table-only. */}
              {lastPnl ? `${formatKrwAxisSigned(lastPnl.value)} KRW` : "—"}
            </span>
          </div>
          <ChartFrame
            chartId="spread-position"
            title={`Position — ${instrumentLabel(instrument)}`}
            detachState={() => ({ instrument, entryDate }) satisfies SpreadPositionPanelParams}
            className="min-h-0 flex-1"
          >
            <SpreadPnlChart data={pnlPath} />
          </ChartFrame>
        </div>
      )}
    </div>
  );
}
