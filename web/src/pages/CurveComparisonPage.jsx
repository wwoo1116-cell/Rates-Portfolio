import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { apiGet, apiPost } from '@/lib/api'
import { CurveChart } from '@/components/curve-comparison/CurveChart'
import { NpvComparisonPanel } from '@/components/curve-comparison/NpvComparisonPanel'

const METHODS = [
  { method: 'flat', label: 'Flat', color: '#3b82f6' },
  { method: 'linear', label: 'Linear', color: '#10b981' },
  { method: 'cubic', label: 'Cubic', color: '#f59e0b' },
]

const METHOD_EXPLANATIONS = {
  flat: '0–3M 구간 이후 각 부트스트랩 구간 사이의 선도금리를 일정하게(flat) 유지하는 방식입니다. 가장 단순하고 계산이 빠르지만, 구간 경계(knot)에서 선도금리 곡선이 꺾이는 모습(kink)이 뚜렷하게 나타날 수 있습니다.',
  linear: 'zero rate를 구간 사이에서 직선으로 보간합니다. flat 방식보다는 매끄럽지만, zero rate가 직선이어도 그로부터 유도되는 선도금리 곡선 자체는 여전히 구간 경계에서 꺾일 수 있습니다.',
  cubic: 'zero rate를 매끄러운 곡선(cubic)으로 통과시켜 보간합니다. 선도금리 곡선의 매끄러움 측면에서는 가장 우수하지만, 스왑 테너처럼 점이 듬성듬성한 경우 일반적인 natural cubic spline은 구간 사이에서 오버슈트·진동할 수 있습니다 — 이 계산기는 그 문제를 줄이기 위해 단조성을 보존하는 Kruger 방식을 사용합니다.',
}

function fmtPct(r) {
  return r == null ? '—' : `${(r * 100).toFixed(4)}%`
}

function CurvePage() {
  const [dateRange, setDateRange] = useState({ min: '', max: '' })
  const [valuationDate, setValuationDate] = useState('')
  const [cdRate, setCdRate] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [marketError, setMarketError] = useState('')
  const [selectedMethod, setSelectedMethod] = useState('all') // 'all' | 'flat' | 'linear' | 'cubic'
  const [curveData, setCurveData] = useState({}) // { flat: points[]|'loading'|'error', linear, cubic }

  useEffect(() => {
    async function loadRange() {
      try {
        const body = await apiGet('/api/market-data/range')
        setDateRange({ min: body.min_date, max: body.max_date })
        setValuationDate(body.max_date)
      } catch (err) {
        setMarketError(err.message)
      }
    }
    loadRange()
  }, [])

  const loadMarketData = useCallback(async (targetDate) => {
    if (!targetDate) return
    setMarketError('')
    try {
      const body = await apiGet(`/api/market-data/${targetDate}`)
      setCdRate(body.cd_rate)
      setQuotes(
        body.swap_quotes
          .slice()
          .sort((a, b) => a.tenor_years - b.tenor_years)
          .map((q) => ({ tenor: `${q.tenor_years}Y`, rate: q.rate })),
      )
    } catch (err) {
      setMarketError(err.message)
      setCdRate(null)
      setQuotes([])
    }
  }, [])

  useEffect(() => {
    loadMarketData(valuationDate)
  }, [valuationDate, loadMarketData])

  useEffect(() => {
    if (!valuationDate || !quotes.length) return
    let cancelled = false
    const swapQuotes = quotes.map((q) => ({ tenor_years: parseInt(q.tenor, 10), rate: q.rate }))
    setCurveData({ flat: 'loading', linear: 'loading', cubic: 'loading' })

    METHODS.forEach(({ method }) => {
      apiPost('/api/curve', {
        valuation_date: valuationDate,
        cd_rate: Number(cdRate),
        swap_quotes: swapQuotes,
        interpolation_method: method,
      })
        .then((body) => {
          if (cancelled) return
          setCurveData((c) => ({ ...c, [method]: body.points }))
        })
        .catch((err) => {
          if (cancelled) return
          setCurveData((c) => ({ ...c, [method]: { error: err.message } }))
        })
    })

    return () => {
      cancelled = true
    }
  }, [valuationDate, cdRate, quotes])

  const visibleMethods = selectedMethod === 'all' ? METHODS : METHODS.filter((m) => m.method === selectedMethod)
  const series = visibleMethods
    .filter((m) => Array.isArray(curveData[m.method]))
    .map((m) => ({ ...m, points: curveData[m.method] }))
  const curveLoading = Object.values(curveData).some((v) => v === 'loading')
  const curveErrored = Object.values(curveData).find((v) => v && v.error)

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary text-primary-foreground px-6 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary-foreground/70">
            IRS Pricer
          </span>
          <span className="text-primary-foreground/30 text-xs">|</span>
          <span className="text-xs text-primary-foreground/70">CD 커브 보간법 비교</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/pricer"
            className="text-xs text-primary-foreground/80 hover:text-primary-foreground underline underline-offset-2"
          >
            ← 계산기로 돌아가기
          </Link>
          {marketError && <span className="text-xs text-red-300">{marketError}</span>}
          <input
            type="date"
            value={valuationDate}
            min={dateRange.min}
            max={dateRange.max}
            onChange={(e) => setValuationDate(e.target.value)}
            className="bg-primary/80 border border-primary-foreground/20 text-primary-foreground text-xs rounded-sm px-2 py-1.5 focus:outline-none focus:border-primary-foreground/50 [color-scheme:dark]"
          />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">CD 커브 보간법 비교</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            동일한 CD91/IRS par quote로부터 부트스트랩한 커브라도, 점(knot) 사이를 채우는 보간법에
            따라 곡선 모양과 NPV가 달라질 수 있습니다. Flat / Linear / Cubic 세 가지 방식을
            선택한 평가일 기준으로 비교합니다.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>커브 모양 비교</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {[{ method: 'all', label: '전체 비교' }, ...METHODS].map((m) => (
                <button
                  key={m.method}
                  type="button"
                  onClick={() => setSelectedMethod(m.method)}
                  className={cn(
                    'px-3 py-1 rounded-sm text-xs font-medium border transition-colors',
                    selectedMethod === m.method
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:border-primary hover:text-primary',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {curveLoading && <p className="text-xs text-muted-foreground">커브 조회 중…</p>}
            {curveErrored && <p className="text-xs text-destructive">{curveErrored.error}</p>}
            {!curveLoading && !curveErrored && series.length > 0 && <CurveChart series={series} />}

            <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
              {visibleMethods.map((m) => (
                <span key={m.method} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                  {m.label}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full border-2" style={{ borderColor: 'var(--muted-foreground)' }} />
                실제 quote 지점 (knot)
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              세로축은 zero rate(연속복리 기준), 가로축은 테너입니다. 점으로 표시된 위치는 CD91
              또는 IRS 시장 quote가 실제로 존재하는 테너이고, 점과 점 사이는 선택한 보간법으로
              "채워 넣은" 값입니다.
            </p>
          </CardContent>
        </Card>

        <div className="grid sm:grid-cols-3 gap-3">
          {METHODS.map((m) => (
            <div key={m.method} className="rounded-sm border border-border px-3 py-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                <span className="text-xs font-semibold text-foreground">{m.label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{METHOD_EXPLANATIONS[m.method]}</p>
            </div>
          ))}
        </div>

        <NpvComparisonPanel valuationDate={valuationDate} quotes={quotes} cdRate={cdRate} />

        <div className="rounded-sm border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          참고: CD 91D 점은{' '}
          <span className="font-mono text-foreground">{cdRate != null ? fmtPct(cdRate) : '—'}</span>
          (0.25Y)로, 모든 보간법의 공통 출발점입니다.
        </div>

        <p className="text-[11px] text-muted-foreground border-t border-border pt-4">
          Cubic 보간은 단조성을 보존하는 Kruger 방식을 사용합니다 — 스왑 테너처럼 점이 듬성듬성한
          경우, 일반적인(단조성을 보존하지 않는) natural cubic spline은 점 사이에서 오버슈트하거나
          진동할 수 있기 때문입니다.
        </p>
      </main>
    </div>
  )
}

export default CurvePage
