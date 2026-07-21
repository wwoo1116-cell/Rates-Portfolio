"use client";

/**
 * RECON-DAILY T4a — realized swap cashflow reconciliation (Rates History
 * mount only; swaps only, bond cashflows deferred).
 *
 * For the picked window (D−1, D]: the SCHEDULED swap net settlements — the
 * price response's cashflow schedule priced off the D−1 close snapshot, so
 * window payments are still on the schedule and floating amounts are the
 * fixings known at D−1 (s6/s10 conventions) — against the REALIZED 결제현금
 * term of the daily identity (ΔNPV(dirty) + 결제현금 == MtM + Theta): the
 * daily-pnl Total row's swap-class realized_cash.
 *
 * Match (s11 ₩1 tolerance) → ONE reconciled row; mismatch → both values +
 * the difference, never silently netted. No settlements in the window →
 * honest empty state. The window's cashflow lines render through the
 * Portfolio Management tab's CashflowTable — reused, never forked (guard:
 * scripts/check_cashflow_component_reuse.test.ts).
 */
import { useMemo } from "react";
import { Spinner } from "@blueprintjs/core";
import { CashflowTable } from "@/features/portfolio/details-panel";
import { usePortfolioPriceQuery } from "@/hooks/use-api";
import { useManualPositionsStore } from "@/stores/manual-positions-store";
import { buildManualPortfolioPriceRequest } from "@/lib/manual-portfolio-request";
import {
  SETTLEMENT_TOLERANCE_KRW,
  netSwapSettlements,
} from "@/lib/daily-recon-math";
import { formatPnlKrw } from "./pnl-format";
import type { DailyPnlBookRow, MarketDataResponse } from "@/lib/api-types";

function Amount({ value }: { value: number }) {
  const color =
    value > 0 ? "var(--chart-pnl-pos)" : value < 0 ? "var(--chart-pnl-neg)" : "var(--fg-dim)";
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: 12,
        fontWeight: 600,
        color,
      }}
    >
      {value > 0 ? "+" : ""}
      {formatPnlKrw(value)}
    </span>
  );
}

export function SwapCashflowRecon({
  closeSnapshot,
  asOf,
  totalRow,
}: {
  closeSnapshot: MarketDataResponse | undefined;
  asOf: string | undefined;
  totalRow: DailyPnlBookRow | undefined;
}) {
  const manualPositions = useManualPositionsStore((s) => s.positions);
  // The same request builder Portfolio Management's valuation uses, pointed
  // at the D−1 close snapshot instead of the latest one.
  const request = useMemo(
    () => buildManualPortfolioPriceRequest(manualPositions, closeSnapshot),
    [manualPositions, closeSnapshot],
  );
  const priceQuery = usePortfolioPriceQuery(request);

  const payFixedById = useMemo(
    () => Object.fromEntries(manualPositions.map((p) => [p.id, p.payFixed])),
    [manualPositions],
  );

  const close = closeSnapshot?.valuation_date;
  const windowCashflows = useMemo(
    () =>
      close && asOf
        ? (priceQuery.data?.cashflows ?? []).filter(
            (cf) => cf.payment_date > close && cf.payment_date <= asOf,
          )
        : [],
    [priceQuery.data, close, asOf],
  );

  const scheduled = useMemo(
    () =>
      close && asOf
        ? netSwapSettlements(priceQuery.data?.cashflows ?? [], payFixedById, close, asOf)
        : undefined,
    [priceQuery.data, payFixedById, close, asOf],
  );

  const realizedCash = totalRow?.by_class?.swap?.realized_cash;

  return (
    <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-3">
      <span className="text-label font-bold uppercase text-fg-muted">
        스왑 결제현금 대사 ({close ?? "—"} → {asOf ?? "—"}]
      </span>

      {manualPositions.length === 0 ? (
        <span className="text-label text-fg-dim">스왑 포지션이 없습니다.</span>
      ) : !close || !asOf ? (
        <span className="text-label text-fg-dim">평가일을 확정하는 중입니다.</span>
      ) : priceQuery.isLoading ? (
        <span className="flex items-center gap-2 text-label text-fg-muted">
          <Spinner size={12} /> 스케줄 산출 중…
        </span>
      ) : priceQuery.isError ? (
        <span className="text-label text-sem-danger">스왑 스케줄을 불러오지 못했습니다.</span>
      ) : windowCashflows.length === 0 ? (
        /* Honest empty state: no scheduled settlement dates fell in the
           window — a normal non-settlement day, not an error and not a 0. */
        <span className="text-label text-fg-dim">
          이 창에 도래하는 스왑 결제일이 없습니다 — 대사할 결제현금이 없는 날입니다.
        </span>
      ) : (
        <>
          <CashflowTable cashflows={windowCashflows} />
          {scheduled && scheduled.unknownCount > 0 && (
            <span className="text-label text-sem-danger">
              창 내 미확정 변동금리 흐름 {scheduled.unknownCount}건 — 순결제액을 확정할 수
              없습니다.
            </span>
          )}
          {scheduled && scheduled.unknownCount === 0 && (
            realizedCash === undefined ? (
              <span className="text-label text-fg-dim">
                실현 결제현금(daily identity의 결제현금 항)이 응답에 없어 비교할 수 없습니다.
              </span>
            ) : Math.abs(scheduled.totalNet - realizedCash) <= SETTLEMENT_TOLERANCE_KRW ? (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border-dim pt-1.5">
                <span className="text-label uppercase text-fg-muted">대사 일치</span>
                <Amount value={scheduled.totalNet} />
                <span className="text-micro text-fg-dim">
                  예정 순결제 = 실현 결제현금 (±₩{SETTLEMENT_TOLERANCE_KRW})
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border-dim pt-1.5">
                <span className="text-label uppercase text-sem-danger">대사 불일치</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-micro uppercase text-fg-dim">예정</span>
                  <Amount value={scheduled.totalNet} />
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-micro uppercase text-fg-dim">실현</span>
                  <Amount value={realizedCash} />
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-micro uppercase text-fg-dim">차이</span>
                  <Amount value={scheduled.totalNet - realizedCash} />
                </span>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
