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
import { useSimulationPort } from "../../hooks/use-simulation";
import { SegmentedButtons } from "../segmented-buttons";
import { LwLineChart, dayToTime, type LwSeriesDef } from "../charts/lw-line-chart";

const VIEWS = ["recon", "krd", "path"] as const;
type ViewKey = (typeof VIEWS)[number];
const VIEW_LABELS: Record<ViewKey, string> = {
  recon: "대사",
  krd: "KRD 그리드",
  path: "경로 매트릭스",
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
