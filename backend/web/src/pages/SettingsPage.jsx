import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/ThemeToggle'
import { apiGet, apiPost } from '@/lib/api'

const EMPTY_FORM = { host: '', port: 3306, user: '', password: '', database: '' }

function SettingsPage() {
  const [status, setStatus] = useState({ configured: false })
  const [statusLoading, setStatusLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [testResult, setTestResult] = useState(null) // { ok, message } | null
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    async function loadStatus() {
      try {
        const body = await apiGet('/api/db-settings')
        setStatus(body)
        if (body.configured) {
          setForm({
            host: body.host ?? '',
            port: body.port ?? 3306,
            user: body.user ?? '',
            password: '',
            database: body.database ?? '',
          })
        }
      } catch {
        // Status fetch failing (e.g. backend not reachable at all) shouldn't
        // block the form -- the user can still fill it in and try.
      } finally {
        setStatusLoading(false)
      }
    }
    loadStatus()
  }, [])

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
    setTestResult(null)
    setSaveError('')
  }

  const payload = { ...form, port: Number(form.port) || 3306 }
  const canSubmit = form.host && form.user && form.password && form.database

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const body = await apiPost('/api/db-settings/test', payload)
      setTestResult(body)
    } catch (err) {
      setTestResult({ ok: false, message: err.message })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    try {
      const body = await apiPost('/api/db-settings', payload)
      setStatus(body)
      setTestResult({ ok: true, message: '연결에 성공했습니다.' })
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
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
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-xl mx-auto px-6 py-10">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>데이터베이스 연결 설정</CardTitle>
              <CardDescription>
                시장 데이터·거래·평가 이력을 저장할 MySQL 서버 접속 정보를 입력하세요.
              </CardDescription>
            </div>
            {!statusLoading && (
              <Badge variant={status.configured ? 'positive' : 'outline'} className="shrink-0">
                {status.configured ? '연결됨' : '연결 안 됨'}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {status.configured && (
              <p className="text-xs text-muted-foreground -mt-1">
                현재 <span className="font-medium text-foreground">{status.user}@{status.host}:{status.port}/{status.database}</span>
                에 연결되어 있습니다. 값을 바꾸면 저장 시 즉시 재연결됩니다.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="db-host">호스트</Label>
                <Input
                  id="db-host"
                  placeholder="예: miraebond2.kro.kr"
                  value={form.host}
                  onChange={(e) => updateField('host', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="db-port">포트</Label>
                <Input
                  id="db-port"
                  type="number"
                  value={form.port}
                  onChange={(e) => updateField('port', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="db-database">데이터베이스명</Label>
                <Input
                  id="db-database"
                  placeholder="예: infomax"
                  value={form.database}
                  onChange={(e) => updateField('database', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="db-user">사용자</Label>
                <Input
                  id="db-user"
                  value={form.user}
                  onChange={(e) => updateField('user', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="db-password">비밀번호</Label>
                <Input
                  id="db-password"
                  type="password"
                  placeholder={status.configured ? '변경하려면 다시 입력' : ''}
                  value={form.password}
                  onChange={(e) => updateField('password', e.target.value)}
                />
              </div>
            </div>

            {testResult && (
              <p className={testResult.ok ? 'text-xs text-positive' : 'text-xs text-negative'}>
                {testResult.ok ? '✓ ' : '✗ '}
                {testResult.message}
              </p>
            )}
            {saveError && <p className="text-xs text-negative">{saveError}</p>}

            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!canSubmit || testing || saving}
                onClick={handleTest}
              >
                {testing ? '연결 확인 중…' : '연결 테스트'}
              </Button>
              <Button size="sm" disabled={!canSubmit || testing || saving} onClick={handleSave}>
                {saving ? '저장 중…' : '저장하고 연결'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

export default SettingsPage
