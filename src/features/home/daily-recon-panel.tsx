"use client";

/**
 * RECON-DAILY — 일별 대사 (daily reconciliation), the ONE shared component
 * behind both mounts (Home, adjacent to PVBP Sensitivity; Rates History
 * 하위탭). Same component + same endpoints + one shared date pick
 * (home-date-store.reconCloseDate) = the two mounts cannot diverge for the
 * same date by construction.
 *
 * Three matrices in the existing PVBP matrix grammar (SectorTenorMatrix —
 * owner ruling: no new matrix design), full 16-column KRD pillar grid:
 *   M1  KRD @D−1        (as-of variant of the PVBP Sensitivity panel)
 *   M2  Δbp D−1 → D     (signed, 1 decimal bp; unmapped pillar = — )
 *   M3  기여도 = M1 × (−M2) (₩; first-order P&L sign — [CHANGED, FB3])
 * plus the FB3 bridge ladder (owner spec, every 대사 surface):
 *   테타 (T−1 기지) → + Assumed (PVBP×Δbp) → = 예상 PnL
 *     → vs Realized (테타+채권평가+스왑평가) → 잔차 (컨벡시티+베이시스)
 * with 펀딩 the one chip OUTSIDE the comparison ("비교 대상 아님"). The
 * residual is 잔차, never a theta word — 테타 is the ladder's first rung,
 * not a name for the residual; pinned by RESIDUAL_LABEL and its tests.
 *
 * Blank policy: an unmapped tenor renders — and is EXCLUDED from every Σ with
 * a visible note; a missing/incomplete realized decomposition disables the
 * footer with an honest message. Never silent 0, never a partial Σ presented
 * as complete.
 */
import { Spinner } from "@blueprintjs/core";
import { useDailyRecon } from "@/hooks/use-daily-recon";
import {
  DV01_SOURCE_LABELS,
  DV01_SOURCE_ORDER,
  RESIDUAL_CAPTION,
  RESIDUAL_LABEL,
  bridgeLadder,
  contributionRows,
  dv01Meta,
  excludedTenors,
  isBlotterStale,
  realizedFromByClass,
  type BridgeLadder,
} from "@/lib/daily-recon-math";
import { CloseDateControl } from "./close-date-control";
import { formatKrwCompact } from "./pnl-format";
import { SectorTenorMatrix, type MatrixRow } from "./sector-tenor-matrix";
import { TENOR_COLS, toMatrixRows } from "./pvbp-sensitivity-table";
import { ReconRangeStrip } from "./recon-range-strip";
import { SwapCashflowRecon } from "./swap-cashflow-recon";

/** Same saturation cap as the PVBP Sensitivity panel (±10M ₩/bp). */
const KRD_CELL_RANGE = 10_000_000;

const formatBp = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
const formatKrwSigned = (v: number) => `${v > 0 ? "+" : ""}${formatKrwCompact(v)}`;

function SignedKrw({ value, emphasis = false }: { value: number; emphasis?: boolean }) {
  const color =
    value > 0 ? "var(--chart-pnl-pos)" : value < 0 ? "var(--chart-pnl-neg)" : "var(--fg-dim)";
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: 12,
        fontWeight: emphasis ? 600 : 400,
        color,
      }}
    >
      {formatKrwSigned(value)}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-label font-bold uppercase text-fg-muted">{children}</span>;
}

/** 펀딩 — the one engine figure still rendered beside the comparison but
 * outside it (FB3 diagnosis: funding is a separate response field, never
 * inside the compared theta/valuation buckets). 테타 is NOT a chip anymore —
 * it is the ladder's first rung. */
function OutsideChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1.5 border border-border-subtle px-2 py-0.5">
      <span className="text-micro uppercase text-fg-dim">{label}</span>
      <SignedKrw value={value} />
      <span className="text-micro text-fg-dim label-nowrap">비교 대상 아님</span>
    </span>
  );
}

function LadderOp({ children }: { children: string }) {
  return <span className="text-label text-fg-dim">{children}</span>;
}

/** FB3 — the bridge ladder (owner spec, every 대사 surface):
 * 테타 → + Assumed → = 예상 PnL → vs Realized → 잔차 (컨벡시티+베이시스). */
function BridgeLadderRow({ ladder, funding }: { ladder: BridgeLadder; funding: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-dim pt-2">
      <span className="flex items-baseline gap-1.5">
        <span className="text-label uppercase text-fg-muted">테타</span>
        <span className="text-micro text-fg-dim label-nowrap">(T−1 기지)</span>
        <SignedKrw value={ladder.theta} emphasis />
      </span>
      <LadderOp>+</LadderOp>
      <span className="flex items-baseline gap-1.5">
        <span className="text-label uppercase text-fg-muted">Assumed</span>
        <span className="text-micro text-fg-dim label-nowrap">(PVBP×Δbp)</span>
        <SignedKrw value={ladder.assumed} emphasis />
      </span>
      <LadderOp>=</LadderOp>
      <span className="flex items-baseline gap-1.5">
        <span className="text-label uppercase text-fg-muted label-nowrap">예상 PnL</span>
        <SignedKrw value={ladder.expected} emphasis />
      </span>
      <LadderOp>vs</LadderOp>
      <span className="flex items-baseline gap-1.5">
        <span className="text-label uppercase text-fg-muted">Realized</span>
        <span className="text-micro text-fg-dim label-nowrap">(테타+채권평가+스왑평가)</span>
        <SignedKrw value={ladder.realized} emphasis />
      </span>
      <LadderOp>→</LadderOp>
      <span className="flex items-baseline gap-1.5">
        <span className="text-label uppercase text-fg-muted">{RESIDUAL_LABEL}</span>
        <span className="text-micro text-fg-dim label-nowrap">{RESIDUAL_CAPTION}</span>
        <SignedKrw value={ladder.residual} emphasis />
        {ladder.residualPct !== null && (
          <span className="text-micro text-fg-dim">
            ({ladder.residualPct > 0 ? "+" : ""}
            {ladder.residualPct.toFixed(1)}%)
          </span>
        )}
      </span>
      <OutsideChip label="펀딩" value={funding} />
    </div>
  );
}

export function DailyReconPanel({ showRange = false }: { showRange?: boolean } = {}) {
  const {
    hasPositions,
    picked,
    setPicked,
    resolvedClose,
    closeSnapshot,
    asOf,
    asOfAvailable,
    pvbpRows,
    deltaBp,
    totalRow,
    loading,
    error,
  } = useDailyRecon();

  const ready = Boolean(pvbpRows && totalRow && resolvedClose && asOf);

  // ---- derived matrices (pure lib math; both mounts render these) ---------
  const m1Rows: MatrixRow[] = pvbpRows ? toMatrixRows(pvbpRows) : [];
  const m2Rows: MatrixRow[] = deltaBp
    ? [{ label: "Δbp", cells: TENOR_COLS.map((c) => deltaBp[c]), total: null }]
    : [];
  const contrib = pvbpRows && deltaBp ? contributionRows(TENOR_COLS, pvbpRows, deltaBp) : [];
  const m3Rows: MatrixRow[] = contrib.map((r) => ({
    label: r.sector,
    cells: TENOR_COLS.map((c) => r.cells[c]),
    total: r.total,
    emphasized: r.sector === "합계",
  }));
  const m3Range = contrib.reduce(
    (m, r) => Math.max(m, ...TENOR_COLS.map((c) => Math.abs(r.cells[c] ?? 0))),
    0,
  );

  const totalPvbpRow = pvbpRows?.find((r) => r.sector === "합계");
  const excluded = deltaBp ? excludedTenors(TENOR_COLS, totalPvbpRow, deltaBp) : [];

  // A3.2/A3.3 — DV01-FIX basis metadata off the 합계 row: the mixed-basis
  // counts (always surfaced when present) and the blotter as-of (surfaced only
  // when it lags the priced close — a fresh export stays silent).
  const dv01 = dv01Meta(pvbpRows);
  const dv01SourceChips = DV01_SOURCE_ORDER.filter((k) => dv01.sources[k]).map(
    (k) => `${DV01_SOURCE_LABELS[k]} ${dv01.sources[k]}`,
  );
  const blotterStale = isBlotterStale(dv01.blotterAsOf, resolvedClose ?? null);

  const assumedRow = contrib.find((r) => r.sector === "합계");
  const realized = realizedFromByClass(totalRow?.by_class);
  const ladder: BridgeLadder | undefined =
    assumedRow && totalRow && "bondMtm" in realized
      ? bridgeLadder(totalRow.theta, assumedRow.total, realized.bondMtm, realized.swapMtm)
      : undefined;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-h2 text-fg-primary whitespace-nowrap">일별 대사</span>
        <div className="flex flex-wrap items-center gap-2">
          {hasPositions && resolvedClose && (
            <CloseDateControl closeDate={resolvedClose} picked={picked} onPick={setPicked} />
          )}
          {asOf && (
            <span className="text-label text-fg-muted whitespace-nowrap">
              D = {asOf} · D−1 = {resolvedClose}
            </span>
          )}
        </div>
      </div>
      <p className="text-micro text-fg-dim">
        예상 PnL = 테타(T−1 기지) + Σ<sub>테너</sub> KRD@D−1 × (−Δbp) — D일 Realized
        (테타+채권평가+스왑평가)와 대사하는 브리지입니다. 차이는 {RESIDUAL_LABEL}(
        {RESIDUAL_CAPTION})로만 표기합니다. 채권 KRD는 고정쿠폰 채권은 D−1 커브로 서버
        재평가(reval DV01), FRN은 리셋 연동 시트 듀레이션, 재평가 불가 행은 시트
        PVBP(fallback)로 산출되며, IRS 행은 D−1 커브로 재평가됩니다.
      </p>

      {/* A3.2/A3.3 — the mixed-basis is made explicit: source counts always,
          and the blotter as-of only when it lags the priced close (a fresh
          export keeps it hidden). */}
      {(dv01SourceChips.length > 0 || (blotterStale && dv01.blotterAsOf)) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {dv01SourceChips.length > 0 && (
            <span
              className="inline-flex items-center gap-1.5 border border-border-subtle px-2 py-0.5 text-micro text-fg-muted label-nowrap"
              data-testid="dv01-sources-chip"
            >
              <span className="uppercase text-fg-dim">혼합 근거</span>
              {dv01SourceChips.join(" · ")}
            </span>
          )}
          {blotterStale && dv01.blotterAsOf && (
            <span
              className="inline-flex items-center gap-1.5 border border-sem-risk px-2 py-0.5 text-micro text-sem-risk label-nowrap"
              data-testid="blotter-asof-chip"
              title="블로터(채권 시트) 스냅샷 기준일 — D−1 대비 과거이므로 채권 잔존만기·시트 PVBP가 이 시점 기준입니다."
            >
              블로터 기준일 {dv01.blotterAsOf}
            </span>
          )}
        </div>
      )}

      {!hasPositions ? (
        <div className="flex flex-1 items-center justify-center text-center text-body text-fg-muted">
          Upload portfolio data to view reconciliation.
        </div>
      ) : loading && !ready ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-body text-fg-muted">
          <Spinner size={16} /> Computing…
        </div>
      ) : error && !ready ? (
        <div className="flex flex-1 items-center justify-center text-body text-sem-danger">
          Failed to load reconciliation data.
        </div>
      ) : (
        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <SectionLabel>M1 · KRD @ D−1 {resolvedClose} (₩/bp · 000)</SectionLabel>
            <div className="overflow-x-auto">
              <SectorTenorMatrix columns={TENOR_COLS} rows={m1Rows} cellRange={KRD_CELL_RANGE} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <SectionLabel>
              M2 · Δbp {resolvedClose} → {asOf}
            </SectionLabel>
            {deltaBp ? (
              <div className="overflow-x-auto">
                <SectorTenorMatrix
                  columns={TENOR_COLS}
                  rows={m2Rows}
                  cellRange={0}
                  formatCell={formatBp}
                  leadHeader=""
                  totalHeader=""
                  // A 0.0bp move is a MEASUREMENT, not absent mass — it must
                  // not render like an unmapped pillar's em-dash.
                  zeroAsDash={false}
                />
              </div>
            ) : (
              <span className="text-label text-fg-dim">
                {asOf
                  ? `${asOf} 스냅샷이 아직 없어 Δbp를 산출할 수 없습니다 — 0이 아니라 미확정입니다.`
                  : "평가일(D)을 확정하는 중입니다."}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <SectionLabel>M3 · 기여도 = M1 × M2 (₩)</SectionLabel>
            {deltaBp ? (
              <>
                <div className="overflow-x-auto">
                  <SectorTenorMatrix
                    columns={TENOR_COLS}
                    rows={m3Rows}
                    cellRange={m3Range}
                    formatCell={formatKrwSigned}
                    // A3.4 honest-zero: a cell with KRD present and Δbp exactly
                    // 0.0 is a real ₩0 (contributionRows yields numeric 0),
                    // rendered 0 — not —. The em-dash stays reserved for null
                    // cells (unmapped Δbp / no-KRD), which this flag never
                    // touches. Aligns with the M2 Δbp row's zeroAsDash={false}.
                    zeroAsDash={false}
                  />
                </div>
                <p className="text-micro text-fg-dim">
                  섹터 행은 가정(Assumed) <span className="text-fg-muted">배분</span>일 뿐입니다 —
                  섹터별 실현 평가 버킷이 없어 {RESIDUAL_LABEL}는 북/자산군 수준에서만 닫힙니다.
                </p>
                {excluded.length > 0 && (
                  <p className="text-micro text-fg-dim">
                    미매핑 테너 제외:{" "}
                    {excluded
                      .map((e) => `${e.tenor} (KRD ${formatKrwSigned(e.krd)}/bp)`)
                      .join(" · ")}{" "}
                    — 해당 열은 Δbp 피팅이 없어 모든 Σ에서 제외되었습니다 (0 아님).
                  </p>
                )}
              </>
            ) : (
              <span className="text-label text-fg-dim">Δbp 없이 기여도를 만들 수 없습니다.</span>
            )}
          </div>

          {ladder && totalRow ? (
            <BridgeLadderRow ladder={ladder} funding={totalRow.funding} />
          ) : (
            <div className="border-t border-border-dim pt-2 text-label text-fg-dim">
              {!deltaBp
                ? `대사 불가 — ${asOfAvailable ? "스냅샷 로딩 중" : `평가일(D) 스냅샷 부재`}로 Assumed를 산출할 수 없습니다.`
                : "disabledReason" in realized
                  ? realized.disabledReason
                  : "실현 평가 분해가 없어 대사를 표시하지 않습니다."}
            </div>
          )}

          {/* Range mode (Rates History mount only): per-day residual strip.
              Same lib arithmetic as the footer above — a strip row and the
              single-date view cannot disagree about a date. */}
          {showRange && <ReconRangeStrip />}

          {/* T4a (Rates History mount only): scheduled vs realized swap
              settlements for the same (D−1, D] window. */}
          {showRange && (
            <SwapCashflowRecon closeSnapshot={closeSnapshot} asOf={asOf} totalRow={totalRow} />
          )}
        </div>
      )}
    </div>
  );
}
