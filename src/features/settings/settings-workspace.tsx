"use client";

/**
 * Settings tab — dashboard-wide analytical assumptions.
 *
 * First (and currently only) setting: the funding-rate spread over BOK base
 * rate. The value lives in settings-store ("dashboard-settings", persisted)
 * and is sent to the backend book-daily-pnl endpoint via
 * use-portfolio-analytics, which applies BOK base + spread to bond funding
 * cost. Future dashboard-level settings should be added as sibling sections.
 *
 * Plain form page (no dockview) — a settings surface has no need for the
 * draggable panel workspace the data views use.
 */
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSettingsStore, DEFAULT_FUNDING_SPREAD_BP } from "@/stores/settings-store";
import { useMarketDataRange, useRateHistory } from "@/hooks/use-api";

/** decimal rate (e.g. 0.025) -> "2.50%" */
function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function FundingRateSection() {
  const fundingSpreadBp = useSettingsStore((s) => s.fundingSpreadBp);
  const setFundingSpreadBp = useSettingsStore((s) => s.setFundingSpreadBp);
  const resetFundingSpreadBp = useSettingsStore((s) => s.resetFundingSpreadBp);

  // Draft string so the field can be cleared / partially typed without the
  // store thrashing (and refetching Home) on every keystroke; commit on blur
  // or Enter. Re-sync during render (React's endorsed alternative to a
  // setState effect) whenever the store value changes underneath us -- e.g.
  // persisted-value hydration or the Reset button -- without clobbering an
  // in-progress edit (which leaves the store value untouched).
  const [draft, setDraft] = useState(String(fundingSpreadBp));
  const [syncedSpread, setSyncedSpread] = useState(fundingSpreadBp);
  if (syncedSpread !== fundingSpreadBp) {
    setSyncedSpread(fundingSpreadBp);
    setDraft(String(fundingSpreadBp));
  }

  const commit = () => {
    const v = Number(draft);
    if (Number.isFinite(v)) setFundingSpreadBp(v);
    else setDraft(String(fundingSpreadBp)); // reject non-numeric, restore
  };

  // Latest BOK base rate, read from the most recent rate-history point so the
  // effective funding rate can be shown. Purely informational here — the
  // backend loads the same base rate itself when computing funding cost.
  const range = useMarketDataRange();
  const maxDate = range.data?.max_date;
  const rateHistory = useRateHistory(maxDate ?? "", maxDate ?? "");
  const baseRate = useMemo<number | null>(() => {
    const points = rateHistory.data?.points ?? [];
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].base_rate != null) return points[i].base_rate as number;
    }
    return null;
  }, [rateHistory.data]);

  const effectiveRate =
    baseRate != null ? baseRate + fundingSpreadBp / 10000 : null;
  const isDefault = fundingSpreadBp === DEFAULT_FUNDING_SPREAD_BP;

  return (
    <section className="rounded border border-border-subtle bg-bg-secondary p-6">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-sem-info" aria-hidden />
        <h2 className="text-h2 text-fg-primary">Funding Rate</h2>
      </div>
      <p className="mt-2 max-w-prose text-body text-fg-muted">
        Funding rate = BOK 기준금리 + 스프레드. Home의 Daily P&amp;L by Book에서
        채권 Funding cost 계산에 적용됩니다. 실무 관행상 기본값은 +10bp입니다.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-8">
        {/* Spread input */}
        <div className="w-40">
          <Input
            label="Spread over base"
            type="number"
            inputMode="numeric"
            step={1}
            suffix="bp"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="tabular-nums"
          />
        </div>

        {/* Effective rate readout — the hero figure */}
        <div className="flex flex-col gap-1">
          <span className="text-label uppercase text-fg-muted">Effective funding rate</span>
          <span className="text-h1 tabular-nums text-fg-primary">
            {effectiveRate != null ? fmtPct(effectiveRate) : "—"}
          </span>
          <span className="text-micro tabular-nums text-fg-dim">
            {baseRate != null
              ? `BOK 기준금리 ${fmtPct(baseRate)} + ${fundingSpreadBp} bp`
              : rateHistory.isLoading
                ? "기준금리 불러오는 중…"
                : `기준금리 데이터 없음 · 스프레드 ${fundingSpreadBp} bp`}
          </span>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3 border-t border-border-dim pt-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={resetFundingSpreadBp}
          disabled={isDefault}
        >
          <RotateCcw size={13} strokeWidth={1.5} />
          Reset to default ({DEFAULT_FUNDING_SPREAD_BP} bp)
        </Button>
        <span className="text-micro text-fg-dim">
          변경 사항은 자동 저장되어 대시보드에 즉시 반영됩니다.
        </span>
      </div>
    </section>
  );
}

export function SettingsWorkspace() {
  return (
    <div className="h-full overflow-auto bg-bg-primary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-h1 text-fg-primary">Settings</h1>
          <p className="text-body text-fg-muted">
            대시보드 전역에서 사용하는 분석 가정을 설정합니다.
          </p>
        </header>

        <FundingRateSection />
      </div>
    </div>
  );
}
