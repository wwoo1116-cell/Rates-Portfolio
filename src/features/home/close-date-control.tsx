"use client";

/**
 * The v2 HOME-DATE close-date picker, extracted from book-daily-pnl-table so
 * the RECON-DAILY panel shares the SAME control instead of growing a second
 * date grammar. Recipe unchanged (Simulation's BaseDateControl, compacted for
 * a panel header): ◀/▶ step over the backend's available_dates only (no
 * fabricated dates), the date field is bounded to the range, and 오늘로 resets
 * to automatic (latest close). State is the caller's: this renders whatever
 * `closeDate` it is given and reports picks via `onPick` — the Daily P&L
 * table wires it to home-date-store's dailyPnlCloseDate, the recon panel to
 * reconCloseDate.
 */
import { useMarketDataRange } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CloseDateControl({
  closeDate,
  picked,
  onPick,
}: {
  /** The RESOLVED close date currently in effect (shown in the field). */
  closeDate: string;
  /** The raw pick (null = automatic/latest) — controls the 오늘로 chip. */
  picked: string | null;
  onPick: (date: string | null) => void;
}) {
  const { data: range } = useMarketDataRange();

  const dates = range?.available_dates ?? [];
  // Index of the latest available date ≤ current — the step anchor even when
  // the current date itself has no snapshot (free-typed weekend/holiday).
  let anchor = -1;
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] <= closeDate) anchor = i;
    else break;
  }
  const prevDate =
    anchor === -1 ? null : dates[anchor] < closeDate ? dates[anchor] : anchor > 0 ? dates[anchor - 1] : null;
  const next = anchor >= 0 && anchor < dates.length - 1 ? dates[anchor + 1] : null;

  return (
    <span className="flex items-center gap-1">
      <Button
        type="button"
        variant="icon"
        size="sm"
        aria-label="이전 영업일"
        disabled={!prevDate}
        onClick={() => prevDate && onPick(prevDate)}
      >
        ◀
      </Button>
      <Input
        type="date"
        aria-label="평가 종가일"
        data-num
        className="w-[132px]"
        value={closeDate}
        min={range?.min_date}
        max={range?.max_date}
        onChange={(e) => onPick(e.target.value || null)}
      />
      <Button
        type="button"
        variant="icon"
        size="sm"
        aria-label="다음 영업일"
        disabled={!next}
        onClick={() => next && onPick(next)}
      >
        ▶
      </Button>
      {picked && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="border border-sem-info bg-sem-info-ghost px-2 py-0.5 text-micro text-sem-info transition-colors hover:bg-sem-info-soft"
        >
          오늘로
        </button>
      )}
    </span>
  );
}
