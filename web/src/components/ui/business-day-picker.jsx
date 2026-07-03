import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useNonBusinessDays } from '@/lib/useCalendar'
import { addMonths, buildMonthGrid, isoFromParts, partsFromIso } from '@/lib/dateGrid'

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function todayParts() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/**
 * Calendar-only date picker: the trigger is a <button>, never a text input,
 * so there is no keyboard surface to type an arbitrary date into. A day can
 * only be set by clicking an enabled cell in the popup grid.
 *
 * Weekend and KRX-holiday cells are sourced from GET /api/calendar/business-days
 * (backed by the same QuantLib SouthKorea calendar the pricer uses), so the
 * picker can never offer a date the backend would reject. Until that fetch
 * resolves for the displayed month, every cell is disabled rather than risk
 * allowing a click the calendar hasn't cleared yet.
 */
export function BusinessDayPicker({ id, value, onChange, minDateExclusive, disabled, placeholder }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => (value ? partsFromIso(value) : todayParts()))
  const rootRef = useRef(null)

  useEffect(() => {
    if (value) {
      setView(partsFromIso(value))
    } else if (minDateExclusive) {
      // No maturity picked yet -- open near the start date instead of
      // today's month, so the user isn't left paging back several years.
      setView(partsFromIso(minDateExclusive))
    }
  }, [value, minDateExclusive])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const monthStart = isoFromParts(view.year, view.month, 1)
  const monthEnd = isoFromParts(view.year, view.month, new Date(Date.UTC(view.year, view.month, 0)).getUTCDate())
  const nonBusiness = useNonBusinessDays(monthStart, monthEnd)
  const cellsReady = nonBusiness?.status === 'ok'

  const cells = buildMonthGrid(view.year, view.month)

  function isDisabled(iso) {
    if (!cellsReady) return true
    if (minDateExclusive && iso <= minDateExclusive) return true
    return nonBusiness.days.has(iso)
  }

  function selectDay(iso) {
    onChange(iso)
    setOpen(false)
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center rounded-sm border border-input bg-background px-3 py-1 text-sm text-left',
          'focus:outline-none focus:ring-1 focus:ring-ring focus:border-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          value ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {value || placeholder || '연도-월-일'}
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute z-50 mt-1 w-64 rounded-sm border border-border bg-popover p-2 text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <button
              type="button"
              onClick={() => setView((v) => addMonths(v.year, v.month, -1))}
              className="rounded-sm px-2 py-0.5 text-sm hover:bg-accent"
              aria-label="이전 달"
            >
              ‹
            </button>
            <span className="text-xs font-semibold">
              {view.year}년 {view.month}월
            </span>
            <button
              type="button"
              onClick={() => setView((v) => addMonths(v.year, v.month, 1))}
              className="rounded-sm px-2 py-0.5 text-sm hover:bg-accent"
              aria-label="다음 달"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center">
            {WEEKDAY_LABELS.map((w, i) => (
              <span
                key={w}
                className={cn(
                  'text-[10px] font-medium',
                  i === 0 || i === 6 ? 'text-muted-foreground/70' : 'text-muted-foreground',
                )}
              >
                {w}
              </span>
            ))}

            {cells.map((cell, i) => {
              if (!cell) return <span key={i} />
              const disabledCell = isDisabled(cell.iso)
              const selected = cell.iso === value
              return (
                <button
                  key={cell.iso}
                  type="button"
                  disabled={disabledCell}
                  onClick={() => selectDay(cell.iso)}
                  aria-label={cell.iso}
                  aria-disabled={disabledCell}
                  className={cn(
                    'h-7 w-7 justify-self-center rounded-sm text-xs',
                    disabledCell
                      ? 'cursor-not-allowed text-muted-foreground/40'
                      : 'text-foreground hover:bg-accent',
                    selected && !disabledCell && 'bg-primary text-primary-foreground hover:bg-primary',
                  )}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>

          {!cellsReady && (
            <p className="pt-2 text-center text-[10px] text-muted-foreground">영업일 조회 중…</p>
          )}
        </div>
      )}
    </div>
  )
}
