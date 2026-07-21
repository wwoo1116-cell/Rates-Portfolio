"use client";

/**
 * RECON-SCEN — 시나리오 대사 section on the Results stage. Three-matrix
 * grammar over the finished run (lastRunRequest + lastRun), all client-side
 * selectors (lib/recon) — no network, no engine call, nothing recomputed:
 *
 *  - 대사 (M3): assumed path (Σ KRD@baseDate × designed cumΔbp) vs the
 *    engine's valuation path (decompositionDaily bondMtm+swapMtm) vs the
 *    잔차 path, on the run's business-day calendar axis (weekend/holiday
 *    slots stay empty — s15 whitespace rule). Below it, the engine's OWN
 *    SIM2-4 daily recon table (irsDailyReconciliation) is surfaced verbatim.
 *  - KRD 그리드 (M1): the KRD grid @ baseDate, full pillar set, in the Home
 *    PVBP matrix grammar (shared MatrixGrid).
 *  - 경로 매트릭스 (M2): the designed day × tenor cumulative-Δbp matrix —
 *    the same lib/recon/path-matrix rows the Configure 시계열형 preview draws.
 */
import { useMemo, useState } from "react";

import { MatrixGrid, type MatrixGridRow } from "@/components/ui/matrix-grid";
import { formatKrwAxisSigned } from "@/lib/format";

import type { IrsDailyReconRow } from "../../api/simulate-dto";

import { getSimulationChartTheme } from "../../lib/chart-theme";
import { buildPathMatrix } from "../../lib/recon/path-matrix";
import {
  ASSUMED_LABEL,
  ENGINE_LABEL,
  LINEARITY_CAPTION,
  RESIDUAL_LABEL,
  buildScenarioRecon,
} from "../../lib/recon/scenario-recon";
import { buildSettlementLane } from "../../lib/recon/settlement-lane";
import { useSimulationPort } from "../../hooks/use-simulation";
import { SegmentedButtons } from "../segmented-buttons";
import { LwLineChart, dayToTime, type LwSeriesDef } from "../charts/lw-line-chart";

const VIEWS = ["recon", "krd", "path", "cash"] as const;
type ViewKey = (typeof VIEWS)[number];
const VIEW_LABELS: Record<ViewKey, string> = {
  recon: "대사",
  krd: "KRD 그리드",
  path: "경로 매트릭스",
  cash: "정산 CF",
};

/** Home PVBP grammar: fill scale saturates at ±10M ₩/bp. */
const KRD_CELL_RANGE = 10_000_000;

const formatBpCell = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

function LegendSwatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-muted">
      <span
        className="inline-block h-0.5 w-4"
        style={dashed ? { borderTop: `2px dashed ${color}` } : { backgroundColor: color }}
      />
      {label}
    </span>
  );
}

export function ScenarioReconPanel() {
  const { lastRun, lastRunRequest } = useSimulationPort();
  const [view, setView] = useState<ViewKey>("recon");

  const recon = useMemo(
    () => (lastRun && lastRunRequest ? buildScenarioRecon(lastRunRequest, lastRun) : null),
    [lastRun, lastRunRequest],
  );
  const pathMatrix = useMemo(() => {
    if (!lastRunRequest || !recon || recon.points.length === 0) return null;
    return buildPathMatrix(lastRunRequest, "국채", recon.points.map((p) => p.day));
  }, [lastRunRequest, recon]);

  if (!lastRun || !lastRunRequest) return null;

  const baseDate = lastRunRequest.baseDate;
  const reconRows = lastRun.irsDailyReconciliation ?? [];

  return (
    <div className="bg-bg-secondary p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h2 text-fg-primary">시나리오 대사</h2>
        <div className="w-72">
          <SegmentedButtons
            choices={VIEWS}
            value={view}
            onChange={setView}
            format={(v) => VIEW_LABELS[v]}
            label="대사 보기"
          />
        </div>
      </div>

      {!recon || recon.points.length === 0 ? (
        <p className="py-6 text-center text-body text-fg-muted">
          이 실행에는 일별 성분 분해(decompositionDaily)가 없습니다 — 조건 수정 후 재실행하면
          대사가 표시됩니다.
        </p>
      ) : view === "recon" ? (
        <ReconView recon={recon} baseDate={baseDate} reconRows={reconRows} />
      ) : view === "cash" ? (
        <CashLaneView lane={buildSettlementLane(lastRun)} />
      ) : view === "krd" ? (
        <>
          <MatrixGrid
            columns={recon.grid.pillarLabels}
            rows={[
              ...recon.grid.rows.map(
                (r): MatrixGridRow => ({
                  key: r.sector,
                  label: r.sector,
                  cells: recon.grid.pillarLabels.map((c) => r.cells[c] ?? null),
                  total: r.total,
                }),
              ),
              {
                key: "합계",
                label: "합계",
                cells: recon.grid.pillarLabels.map((c) => recon.grid.totalRow.cells[c] ?? null),
                total: recon.grid.totalRow.total,
                emphasis: true,
              },
            ]}
            cellRange={KRD_CELL_RANGE}
            leadHeader="Sector"
          />
          <p data-num className="mt-2 text-micro text-fg-dim">
            KRD @ {baseDate} (₩/bp · 000) — 전체 필러, 축약 없음.{" "}
            {recon.grid.derivedBondRows
              ? "채권 행은 요청 포지션의 PVBP를 테너 버킷으로 합산해 재구성한 값입니다 (라이브 브리지는 채권 krdMap을 싣지 않음); 스왑 행은 엔진 보강(enrich) KRD."
              : "엔진 응답(pvbpSensitivity)의 KRD 그대로."}
          </p>
        </>
      ) : (
        pathMatrix && (
          <>
            <MatrixGrid
              columns={pathMatrix.pillars.map((p) => p.label)}
              rows={pathMatrix.days.map(
                (d, i): MatrixGridRow => ({
                  key: String(d),
                  label: recon.points[i]?.date ?? `D+${d}`,
                  cells: pathMatrix.cumBp[i],
                }),
              )}
              cellRange={Math.max(1, ...pathMatrix.cumBp.flat().map(Math.abs))}
              formatCell={formatBpCell}
              leadHeader="일자"
              totalHeader={null}
            />
            <p className="mt-2 text-micro text-fg-dim">
              설계 경로(국채 커브)의 일자 × 테너 누적 Δbp — 웨이포인트/온라인 보간 경로를 각
              테너가 실제로 따르는 값 (시계열형 미리보기와 동일한 원천). 영업일만 표시.
            </p>
          </>
        )
      )}
    </div>
  );
}

/**
 * F-VMP-1 (owner ruling: transparency, threshold unchanged) — the RAW signed
 * difference behind a 불일치 verdict, full precision down to sub-won float
 * drift. VMP's live capture printed six windows as "예상 +1.5억 vs 엔진
 * +1.5억": both sides rounded identically at the 억/만 display grain while
 * the ±₩1 pin had tripped on drift the reader could not see. This makes the
 * drift self-explaining ("불일치 (Δ ₩0.42)") without touching the comparison
 * math or the verdict threshold.
 */
export function formatRawDeltaKrw(delta: number): string {
  const abs = Math.abs(delta);
  const text =
    abs >= 1
      ? // Whole-won scale: thousands-grouped, 2dp so fractional drift survives.
        delta.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : // Sub-won drift (the VMP case): 2dp normally; drift so small it would
        // round to 0.00 gets 4dp — a 불일치 verdict must never display Δ ₩0.
        abs > 0 && abs < 0.005
        ? delta.toFixed(4)
        : delta.toFixed(2);
  return delta > 0 ? `+${text}` : text;
}

/**
 * T4b — the swap settlement-cash lane in the PM CashflowTable grammar
 * (features/portfolio/details-panel.tsx CashflowTable: rounded bg-bg-tertiary
 * scroll box, Payment-Date/Leg/Rate/Cashflow column shapes, mono tabular
 * cells). Mirrored, not imported: CashflowTable is file-local to a
 * lane-A-owned file this session — unification recorded in the report.
 */
function CashLaneView({ lane }: { lane: ReturnType<typeof buildSettlementLane> }) {
  return (
    <>
      {lane.days.length === 0 ? (
        <div className="flex h-16 items-center justify-center rounded bg-bg-tertiary text-micro text-fg-dim">
          구간 내 스왑 정산일 없음 — 정산일만 표시합니다 (정산 없는 날은 빈칸이 정직한 상태).
        </div>
      ) : (
        <div className="max-h-64 overflow-auto rounded bg-bg-tertiary">
          <table data-num className="w-full text-body">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="py-1.5 px-2 text-left text-label font-bold text-fg-muted">결제일</th>
                <th className="py-1.5 px-2 text-left text-label font-bold text-fg-muted">포지션</th>
                <th className="py-1.5 px-2 text-right text-label font-bold text-fg-muted">고정금리</th>
                <th className="py-1.5 px-2 text-right text-label font-bold text-fg-muted">정산 CF</th>
              </tr>
            </thead>
            <tbody>
              {lane.days.flatMap((d) =>
                d.rows.map((r, i) => (
                  <tr key={`${d.day}-${r.positionId}-${i}`} className="border-t border-border-subtle">
                    <td className="py-1.5 px-2 font-mono tabular-nums text-fg-secondary">
                      {r.date ?? `D+${r.day}`}
                    </td>
                    <td className="py-1.5 px-2 text-fg-muted">{r.positionName || r.positionId}</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums text-fg-secondary">
                      {r.fixedRate.toFixed(4)}%
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums text-fg-primary">
                      {Math.round(r.settledCf).toLocaleString()}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {lane.windows.length > 0 &&
        (lane.allMatch ? (
          <p className="mt-2 text-micro text-fg-dim">
            엔진 정산-현금 레인(일별 대사 settleCf)과 창구별 대사 일치 (±₩1).
          </p>
        ) : (
          <div className="mt-2 text-micro text-sem-danger">
            엔진 정산-현금 레인과 불일치:
            {lane.windows
              .filter((w) => !w.match)
              .map((w) => (
                <span key={w.reconDay} data-num className="ml-2">
                  {w.date} 예상 {formatKrwAxisSigned(w.projectedSum)} vs 엔진{" "}
                  {formatKrwAxisSigned(w.engineSettleCf)} (Δ ₩
                  {formatRawDeltaKrw(w.projectedSum - w.engineSettleCf)})
                </span>
              ))}
          </div>
        ))}
      <p className="mt-1 text-micro text-fg-dim">
        시나리오 픽싱 기준 예상 스왑 순정산 — 엔진 FM 경로가 산출한 정산 이벤트(scf) 그대로이며,
        이미 픽싱된 구간은 시나리오와 무관하게 실현 정산과 같습니다. 채권 현금흐름은 보류
        (스왑 전용 레인).
      </p>
    </>
  );
}

function ReconView({
  recon,
  baseDate,
  reconRows,
}: {
  recon: ReturnType<typeof buildScenarioRecon>;
  baseDate: string;
  reconRows: IrsDailyReconRow[];
}) {
  const t = getSimulationChartTheme();
  const series: LwSeriesDef[] = [
    {
      color: t.previewPalette[0], // Ocean — assumed (designed linear path)
      lineWidth: 2,
      data: recon.points.map((p) => ({ time: dayToTime(baseDate, p.day), value: p.assumed })),
    },
    {
      color: t.previewPalette[2], // Tangerine — engine valuation path
      lineWidth: 2,
      data: recon.points.map((p) => ({ time: dayToTime(baseDate, p.day), value: p.engine })),
    },
    {
      color: t.previewPalette[4], // Purple — 잔차, dashed (a derived gap, not a P&L lane)
      lineWidth: 1,
      dashed: true,
      data: recon.points.map((p) => ({ time: dayToTime(baseDate, p.day), value: p.residual })),
    },
  ];

  return (
    <>
      <div className="h-64 w-full">
        <LwLineChart series={series} zeroLine formatValue={formatKrwAxisSigned} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-micro">
        <LegendSwatch color={t.previewPalette[0]} label={ASSUMED_LABEL} />
        <LegendSwatch color={t.previewPalette[2]} label={ENGINE_LABEL} />
        <LegendSwatch color={t.previewPalette[4]} label={RESIDUAL_LABEL} dashed />
      </div>
      <p className="mt-1.5 text-micro text-fg-dim">{LINEARITY_CAPTION}</p>
      {recon.swapsExcluded && (
        <p className="mt-1 text-micro text-fg-dim">
          스왑 제외 실행 — 두 경로 모두 채권 성분만으로 비교합니다 (스왑 KRD 행 제외).
        </p>
      )}

      {reconRows.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-label font-bold uppercase text-fg-muted">
            IRS 일별 대사 — 엔진 내부 머시너리 (SIM2-4)
          </p>
          <div className="max-h-48 overflow-auto rounded bg-bg-tertiary">
            <table data-num className="w-full text-body" style={{ fontSize: 12 }}>
              <thead>
                <tr className="border-b border-border-subtle">
                  {["일자", "추정 P&L", "실제 P&L", "정산 CF", "NPV 변화", "세타", "평가", "일별 잔차"].map(
                    (h) => (
                      <th
                        key={h}
                        className={`py-1.5 px-2 text-label font-bold text-fg-muted ${h === "일자" ? "text-left" : "text-right"}`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {reconRows.map((r) => (
                  <tr key={r.date} className="border-t border-border-subtle">
                    <td className="py-1 px-2 font-mono tabular-nums text-fg-secondary">{r.date}</td>
                    {[r.totalEstPnl, r.totalActual, r.settleCf, r.npvChange, r.thetaPnl, r.valuationPnl, r.residual].map(
                      (v, i) => (
                        <td key={i} className="py-1 px-2 text-right font-mono tabular-nums text-fg-primary">
                          {formatKrwAxisSigned(v)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-micro text-fg-dim">
            엔진이 매 영업일 재계산한 KRD × 일별 Δbp 추정과 FM 실측의 대사 — 여기의 일별 잔차는
            일별 선형화 잔차로, 위 차트의 기준일-KRD {RESIDUAL_LABEL} 경로와 정의가 다릅니다.
          </p>
        </div>
      )}
    </>
  );
}
