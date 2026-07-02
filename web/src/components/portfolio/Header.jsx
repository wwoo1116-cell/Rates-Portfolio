import { Link } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'

// Text-only brand mark -- no image asset dependency, so the build never fails
// on a missing logo file. Swap the span below for a real <img> once a logo
// asset is actually placed under src/assets/.
export function Header({ valuationDate, dateRange, onValuationDateChange, marketDataError }) {
  return (
    <header className="bg-primary text-primary-foreground px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="flex items-center justify-center h-7 w-7 rounded-sm bg-primary-foreground/15 text-[11px] font-bold tracking-wide">
          PF
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-primary-foreground/70">
          Project Future
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Link
          to="/pricer"
          className="text-xs text-primary-foreground/70 hover:text-primary-foreground underline underline-offset-2"
        >
          단일 스왑 계산기
        </Link>
        {marketDataError && <span className="text-xs text-red-300">{marketDataError}</span>}
        <input
          type="date"
          value={valuationDate}
          min={dateRange.min}
          max={dateRange.max}
          onChange={(e) => onValuationDateChange(e.target.value)}
          className="bg-primary/80 border border-primary-foreground/20 text-primary-foreground text-xs rounded-sm px-2 py-1.5 focus:outline-none focus:border-primary-foreground/50 [color-scheme:dark]"
        />
        <ThemeToggle />
      </div>
    </header>
  )
}
