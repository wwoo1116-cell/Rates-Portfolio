import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { apiGet, apiPost } from '@/lib/api'

const IMPORTED_FLAG_KEY = 'irs-portfolio:legacyImportedToDb'

// Safe, additive backup only (blueprint C.4) -- this never changes what
// PortfolioPage actually edits/prices against (still localStorage, still
// instant-on-keystroke); it just copies the current browser-only positions
// into trade_specification once DB is reachable, for audit/durability.
// Hidden entirely until the DB is configured, and permanently once imported.
export function LegacyImportBanner({ positions }) {
  const [dbConfigured, setDbConfigured] = useState(false)
  const [imported, setImported] = useState(() => {
    try {
      return localStorage.getItem(IMPORTED_FLAG_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [hiddenThisSession, setHiddenThisSession] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiGet('/api/db-settings')
      .then((status) => {
        if (!cancelled) setDbConfigured(Boolean(status.configured))
      })
      .catch(() => {
        // DB status unreachable -- stay hidden rather than showing a banner
        // for a backup action that would just fail.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (imported || hiddenThisSession || !dbConfigured || positions.length === 0) return null

  async function handleImport() {
    setBusy(true)
    setError('')
    try {
      await apiPost('/api/trades/import-legacy', {
        positions: positions.map((p) => ({
          position_id: p.id,
          start_date: p.startDate,
          maturity_date: p.maturityDate,
          notional: Number(p.notional),
          fixed_rate: Number(p.fixedRatePct) / 100,
          pay_fixed: p.direction === 'pay',
        })),
      })
      localStorage.setItem(IMPORTED_FLAG_KEY, 'true')
      setImported(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 px-4 py-3 text-xs">
      <div>
        <p className="text-foreground">
          브라우저에 저장된 포지션 {positions.length}개를 데이터베이스에 백업할 수 있습니다.
        </p>
        <p className="mt-0.5 text-muted-foreground">
          현재 편집/계산 흐름에는 영향을 주지 않는 1회성 백업입니다.
        </p>
        {error && <p className="mt-1 text-negative">{error}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={() => setHiddenThisSession(true)} disabled={busy}>
          나중에
        </Button>
        <Button size="sm" onClick={handleImport} disabled={busy}>
          {busy ? '백업 중…' : '지금 백업'}
        </Button>
      </div>
    </div>
  )
}
