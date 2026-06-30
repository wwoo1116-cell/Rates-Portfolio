import { Link } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TradeTimelineDemo } from '@/components/methodology/TradeTimelineDemo'
import { NpvDefinitionDemo } from '@/components/methodology/NpvDefinitionDemo'
import { LegComparisonDemo } from '@/components/methodology/LegComparisonDemo'
import { BootstrapStepperDemo } from '@/components/methodology/BootstrapStepperDemo'
import { FlatForwardDemo } from '@/components/methodology/FlatForwardDemo'
import { SingleDualCurveDemo } from '@/components/methodology/SingleDualCurveDemo'
import { TelescopingDemo } from '@/components/methodology/TelescopingDemo'

const SECTIONS = [
  { id: 'npv-definition', num: 1, title: 'NPV의 정의' },
  { id: 'fixed-vs-floating', num: 2, title: '고정 레그 vs 변동 레그' },
  { id: 'single-vs-dual-curve', num: 3, title: '싱글 커브 vs 듀얼 커브' },
  { id: 'bootstrapping', num: 4, title: '선도금리 추정과 부트스트래핑' },
  { id: 'flat-forward', num: 5, title: 'Flat-Forward 가정' },
  { id: 'revaluation', num: 6, title: '기존 거래 재평가 vs 신규 거래 가격산정' },
  { id: 'telescoping', num: 7, title: '텔레스코핑 단축 계산 (심화)' },
]

function MethodologyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary text-primary-foreground px-6 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary-foreground/70">
            IRS Pricer
          </span>
          <span className="text-primary-foreground/30 text-xs">|</span>
          <span className="text-xs text-primary-foreground/70">NPV 산출 방식</span>
        </div>
        <Link
          to="/pricer"
          className="text-xs text-primary-foreground/80 hover:text-primary-foreground underline underline-offset-2"
        >
          ← 계산기로 돌아가기
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">산출 방식</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            이 페이지는 원화 금리스왑(IRS) NPV가 산출되는 이론적 근거를 단계별로 설명합니다 —
            기본적인 현금흐름 할인(DCF) 개념부터 커브 부트스트래핑, 그리고 과거에 체결된 거래가
            특정 시점에 어떻게 재평가되는지까지 다룹니다. 아래 각 섹션은 직접 조작해볼 수 있는
            인터랙티브 예시입니다. 순서대로 읽거나, 위 색인을 눌러 원하는 섹션으로 바로 이동할 수
            있습니다.
          </p>
        </div>

        <nav className="flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="px-2.5 py-1 rounded-sm text-[11px] font-medium border border-border text-foreground hover:border-primary hover:text-primary transition-colors"
            >
              {s.num}. {s.title}
            </a>
          ))}
        </nav>

        <section id="npv-definition" className="scroll-mt-20">
          <Card>
            <CardHeader>
              <CardTitle>1. NPV의 정의</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <NpvDefinitionDemo />
            </CardContent>
          </Card>
        </section>

        <section id="fixed-vs-floating" className="scroll-mt-20">
          <Card>
            <CardHeader>
              <CardTitle>2. 고정 레그 vs 변동 레그</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <LegComparisonDemo />
            </CardContent>
          </Card>
        </section>

        <section id="single-vs-dual-curve" className="scroll-mt-20">
          <Card>
            <CardHeader>
              <CardTitle>3. 싱글 커브 vs 듀얼 커브</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <SingleDualCurveDemo />
            </CardContent>
          </Card>
        </section>

        <section id="bootstrapping" className="scroll-mt-20">
          <Card>
            <CardHeader>
              <CardTitle>4. 선도금리 추정과 부트스트래핑</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <BootstrapStepperDemo />
            </CardContent>
          </Card>
        </section>

        <section id="flat-forward" className="scroll-mt-20">
          <Card>
            <CardHeader>
              <CardTitle>5. Flat-Forward 가정</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <FlatForwardDemo />
              <p className="text-xs text-muted-foreground border-t border-border pt-3">
                이 계산기는 기본적으로 flat-forward 보간을 사용하지만, linear·cubic 보간을 선택했을
                때 커브 모양과 NPV가 실제로 어떻게 달라지는지{' '}
                <Link to="/curve-comparison" className="text-primary hover:underline underline-offset-2">
                  보간법 비교 페이지
                </Link>
                에서 직접 확인할 수 있습니다.
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="revaluation" className="scroll-mt-20">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>6. 기존 거래 재평가 vs 신규 거래 가격산정</CardTitle>
                <Badge>핵심</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <TradeTimelineDemo />
            </CardContent>
          </Card>
        </section>

        <section id="telescoping" className="scroll-mt-20">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>7. 텔레스코핑 단축 계산</CardTitle>
                <Badge variant="outline">심화</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <TelescopingDemo />
            </CardContent>
          </Card>
        </section>

        <p className="text-[11px] text-muted-foreground border-t border-border pt-4">
          유의사항: 이 페이지의 인터랙티브 예시는 개념 전달을 위해 브라우저에서 단순화된 계산만
          수행합니다. FastAPI 백엔드나 QuantLib과 연동되어 있지 않으며, 실제 계산기(Pricer)의
          산출값과 정확히 일치하지 않습니다 — 정확한 수치가 아닌 개념 이해가 이 페이지의 목적입니다.
        </p>
      </main>
    </div>
  )
}

export default MethodologyPage
