"use client";

/**
 * Results panel (dockview panel body). Reads the port's `lastRun` — the sanctioned
 * cross-panel/cross-screen data path (§1.3), not a component import from the config
 * panel. Renders the run summary; the full source result tables (BOK 이벤트 분해,
 * IRS 정산/대사 sticky grids) are ported + restyled in S5.
 */
import { useSimulationPort } from "../../hooks/use-simulation";

const fmtSigned = (n: number) => {
  const man = Math.round(n / 10000);
  return `${man >= 0 ? "+" : ""}${man.toLocaleString()}만`;
};

export function ResultsGridPanel() {
  const { lastRun, status, error } = useSimulationPort();

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-body-strong text-sem-danger">시뮬레이션 오류</p>
        <p className="text-micro text-fg-muted break-all">{error}</p>
      </div>
    );
  }

  if (!lastRun) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center">
        <p className="text-body text-fg-muted">
          {status === "running" ? "엔진 계산 중..." : "시뮬레이션을 실행하면 결과가 표시됩니다."}
        </p>
      </div>
    );
  }

  const s = lastRun.summary;
  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: "채권 MTM", value: s.finalMTM },
    { label: "채권 캐리", value: s.finalCarry },
    { label: "스왑손익", value: s.finalSwap },
    { label: "Total Return", value: s.finalTotal, strong: true },
  ];

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-4">
      <h2 className="text-h2 text-fg-primary">Total Return 요약</h2>
      <table data-num className="w-full text-body">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border-dim">
              <td className="py-1.5 text-fg-muted">{r.label}</td>
              <td
                className={`py-1.5 text-right ${r.strong ? "text-body-strong" : ""} ${
                  r.value >= 0 ? "text-chart-pnl-pos" : "text-chart-pnl-neg"
                }`}
              >
                {fmtSigned(r.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.breakEvenDay > 0 && (
        <p className="text-micro text-chart-pnl-pos">손익분기점 도달: D+{s.breakEvenDay}</p>
      )}
      <p className="mt-auto text-micro text-fg-dim">S5: BOK 이벤트 MTM 분해 · IRS 정산/일별 대사 sticky 그리드 이식.</p>
    </div>
  );
}
