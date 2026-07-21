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
 *   M3  기여도 = M1 × M2 (₩; row/column sums; Jade/Berry heat)
 * plus the closure footer:  Assumed | Realized (채권평가+스왑평가) | 잔차 —
 * and the engine-supplied 계산 테타/펀딩 chips OUTSIDE the comparison
 * ("비교 대상 아님"). The residual is 잔차, never a theta word — pinned by
 * RESIDUAL_LABEL and its test.
 *
 * Blank policy: an unmapped tenor renders — and is EXCLUDED from every Σ with
 * a visible note; a missing/incomplete realized decomposition disables the
 * footer with an honest message. Never silent 0, never a partial Σ presented
 * as complete.
 */
import { Spinner } from "@blueprintjs/core";
import { useDailyRecon } from "@/hooks/use-daily-recon";
import {
  RESIDUAL_LABEL,
  closureFooter,
  contributionRows,
  excludedTenors,
  realizedFromByClass,
  type ClosureFooter,
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

/** 계산 테타/펀딩 — engine figures rendered beside the comparison but outside
 * it. The label says so explicitly; these are NOT what 잔차 reconciles. */
function OutsideChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1.5 border border-border-subtle px-2 py-0.5">
      <span className="text-micro uppercase text-fg-dim">{label}</span>
      <SignedKrw value={value} />
      <span className="text-micro text-fg-dim">비교 대상 아님</span>
    </span>
  );
}

function ClosureFooterRow({
  footer,
  theta,
  funding,
}: {
  footer: ClosureFooter;
  theta: number;
  funding: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border-dim pt-2">
      <span className="flex items-baseline gap-1.5">
        <span className="text-label uppercase text-fg-muted">Assumed</span>
        <SignedKrw value={footer.assumed} emphasis />
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-label uppercase text-fg-muted">Realized</span>
        <span className="text-micro text-fg-dim">(채권평가+스왑평가)</span>
        <SignedKrw value={footer.realized} emphasis />
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-label uppercase text-fg-muted">{RESIDUAL_LABEL}</span>
        <SignedKrw value={footer.residual} emphasis />
        {footer.residualPct !== null && (
          <span className="text-micro text-fg-dim">
            ({footer.residualPct > 0 ? "+" : ""}
            {footer.residualPct.toFixed(1)}%)
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <OutsideChip label="계산 테타" value={theta} />
        <OutsideChip label="펀딩" value={funding} />
      </span>
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

  const assumedRow = contrib.find((r) => r.sector === "합계");
  const realized = realizedFromByClass(totalRow?.by_class);
  const footer =
    assumedRow && "bondMtm" in realized
      ? closureFooter(assumedRow.total, realized.bondMtm, realized.swapMtm)
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
        가정 MtM = Σ<sub>테너</sub> KRD@D−1 × Δbp — D일 실현 평가(채권평가+스왑평가)와
        대사합니다. 채권 KRD는 블로터의 정적 PVBP(버킷별)이며 IRS 행만 D−1 커브로
        재평가됩니다. 차이는 {RESIDUAL_LABEL}로만 표기합니다.
      </p>

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

          {footer && totalRow ? (
            <ClosureFooterRow footer={footer} theta={totalRow.theta} funding={totalRow.funding} />
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
