import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

export default function SimulatorPage() {
  const [files, setFiles] = useState({
    irs_data: null,
    credit_matrix: null,
    bok_base_rate: null,
    portfolio: null,
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const handleFileChange = (e, key) => {
    setFiles((prev) => ({ ...prev, [key]: e.target.files[0] }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('irs_data', files.irs_data)
      formData.append('credit_matrix', files.credit_matrix)
      formData.append('bok_base_rate', files.bok_base_rate)
      formData.append('portfolio', files.portfolio)

      const res = await fetch('/api/upload/market-data', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <Card>
        <CardHeader>
          <CardTitle>시뮬레이터 데이터 업로드</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium">IRS Data (True Data.xlsx)</label>
              <input type="file" required onChange={(e) => handleFileChange(e, 'irs_data')} />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">Credit Matrix Data.xlsx</label>
              <input type="file" required onChange={(e) => handleFileChange(e, 'credit_matrix')} />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">BOK Base Rate.xlsx</label>
              <input type="file" required onChange={(e) => handleFileChange(e, 'bok_base_rate')} />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">Portfolio Data.xlsx</label>
              <input type="file" required onChange={(e) => handleFileChange(e, 'portfolio')} />
            </div>
            {error && <div className="text-red-500 text-sm">{error}</div>}
            <Button type="submit" disabled={loading}>
              {loading ? '업로드 중...' : '데이터 전송 및 파싱'}
            </Button>
          </form>
          {result && (
            <div className="mt-6 space-y-2">
              <h3 className="font-bold">업로드 결과</h3>
              <p>성공: {result.success ? '✅' : '❌'}</p>
              <p>파싱된 포지션 개수: {result.positions?.length} 개</p>
              {result.positions && result.positions.length > 0 && (
                <div className="bg-muted p-4 rounded text-sm max-h-60 overflow-auto">
                  <pre>{JSON.stringify(result.positions[0], null, 2)}</pre>
                  <p className="mt-2 text-muted-foreground">... ({result.positions.length - 1} more)</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
