import { useCallback, useState } from 'react'
import { fetchHistoricalSnapshot } from '@/lib/historicalSnapshot'
import { fetchNpvTrace } from '@/lib/npvTrace'
import { approxTenorYears, findQuoteRate } from '@/lib/tenorQuote'

// A real backtest trade is a bet on a TWO-leg spread (short tenor vs long
// tenor); the panel deliberately shows only a single-leg proxy -- the
// long-tenor swap that carries the trade's directional view -- since
// visualizing the real two-leg replication is out of scope here.
// direction === 1 ("long the spread", entered when z <= -entry_z) is
// treated as paying fixed on that long-tenor leg.
//
// A draft (what-if) "trade" isn't a backtest signal at all -- there's no
// direction or backtest notional to inherit, so it gets its own realistic
// face-notional default instead of the backtest's per-bp sensitivity
// number. Both paths are just starting points; the form stays fully editable.
const DRAFT_DEFAULT_NOTIONAL = 50_000_000_000 // 50B KRW

function defaultSpecFromTrade(trade, backtestParams, entrySnapshot) {
  const tenorLabel = backtestParams.long
  const marketData = entrySnapshot?.marketData
  const fairRate =
    tenorLabel === 'cd_rate' ? marketData?.cd_rate : findQuoteRate(marketData?.swap_quotes, tenorLabel)

  return {
    trade_date: trade.entry_date,
    tenor_years: approxTenorYears(tenorLabel),
    notional: trade.is_draft ? DRAFT_DEFAULT_NOTIONAL : backtestParams.notional,
    pay_fixed: trade.is_draft ? true : trade.direction === 1,
    fixed_rate: fairRate != null ? Number(fairRate.toFixed(6)) : 0.035,
    float_spread: 0,
  }
}

export function useTradeDetail(backtestParams) {
  const [selectedTrade, setSelectedTrade] = useState(null)
  // Date currently shown in the "market snapshot" section of the panel --
  // independent of the NPV trace's date range, so a trader can flip between
  // entry-date and exit-date curves without re-running the trace.
  const [selectedDate, setSelectedDate] = useState(null)
  const [irsSpec, setIrsSpec] = useState(null)

  const [snapshot, setSnapshot] = useState(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState('')

  const [npvTrace, setNpvTrace] = useState(null)
  const [npvTraceLoading, setNpvTraceLoading] = useState(false)
  const [npvTraceError, setNpvTraceError] = useState('')

  const loadSnapshot = useCallback((date) => {
    setSelectedDate(date)
    setSnapshotLoading(true)
    setSnapshotError('')
    return fetchHistoricalSnapshot(date)
      .then((data) => {
        setSnapshot(data)
        return data
      })
      .catch((err) => {
        setSnapshotError(err.message)
        return null
      })
      .finally(() => setSnapshotLoading(false))
  }, [])

  const runNpvTrace = useCallback((spec, startDate, endDate) => {
    setNpvTraceLoading(true)
    setNpvTraceError('')
    fetchNpvTrace(spec, startDate, endDate)
      .then(setNpvTrace)
      .catch((err) => setNpvTraceError(err.message))
      .finally(() => setNpvTraceLoading(false))
  }, [])

  // Opening a trade: seed selectedDate/irsSpec from the row/click, fetch the
  // entry-date snapshot, then compute the default spec.
  //
  // A real backtest trade auto-runs the trace immediately (entry_date ->
  // exit_date is well-defined and free -- no reason to make the trader ask
  // for it). A draft (what-if) trade has no exit_date -- it would trace all
  // the way to latestAvailableDate, which can be a long, non-free backend
  // call -- so it only populates the form and waits for an explicit "Run
  // Trace" click (see repriceSpec).
  const openTrade = useCallback(
    (trade) => {
      setSelectedTrade(trade)
      setIrsSpec(null)
      setNpvTrace(null)
      setNpvTraceError('')
      loadSnapshot(trade.entry_date).then((entrySnapshot) => {
        const spec = defaultSpecFromTrade(trade, backtestParams, entrySnapshot)
        setIrsSpec(spec)
        if (!trade.is_draft) {
          runNpvTrace(spec, trade.entry_date, trade.exit_date)
        }
      })
    },
    [backtestParams, loadSnapshot, runNpvTrace],
  )

  const closeTrade = useCallback(() => {
    setSelectedTrade(null)
    setSelectedDate(null)
    setIrsSpec(null)
    setSnapshot(null)
    setNpvTrace(null)
  }, [])

  const updateSpec = useCallback((patch) => {
    setIrsSpec((prev) => ({ ...prev, ...patch }))
  }, [])

  // Re-run the trace off the (possibly hand-edited) spec form, not the
  // original auto-populated defaults -- starts from irsSpec.trade_date
  // (not selectedTrade.entry_date) so editing the Trade Date field actually
  // takes effect on rerun. A real backtest trade traces to its own
  // exit_date; a draft what-if trade has none, so it traces to the latest
  // available market date instead (surfaced as an error if that isn't
  // known yet, e.g. the page's date-range fetch hasn't resolved).
  const repriceSpec = useCallback(() => {
    if (!irsSpec || !selectedTrade) return
    const endDate = selectedTrade.is_draft ? backtestParams.latestAvailableDate : selectedTrade.exit_date
    if (!endDate) {
      setNpvTraceError('최신 시장 데이터 날짜를 아직 확인할 수 없습니다. 잠시 후 다시 시도하세요.')
      return
    }
    runNpvTrace(irsSpec, irsSpec.trade_date, endDate)
  }, [irsSpec, selectedTrade, backtestParams, runNpvTrace])

  const inspectDate = useCallback((date) => loadSnapshot(date), [loadSnapshot])

  return {
    selectedTrade,
    selectedDate,
    irsSpec,
    snapshot,
    snapshotLoading,
    snapshotError,
    npvTrace,
    npvTraceLoading,
    npvTraceError,
    openTrade,
    closeTrade,
    updateSpec,
    repriceSpec,
    inspectDate,
  }
}
