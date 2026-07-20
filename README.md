# KRW FI / Rates Portfolio — Frontend (UIUX_test)

원화 금리(KRW IRS·국고채) 포트폴리오 관리 시스템의 프론트엔드입니다.
백엔드는 형제 저장소 **`../IRS Pricer_Mock`** (FastAPI, `:8000`)이며, 이 앱은 그 API를 소비하는 Next.js 클라이언트입니다.

## 실행 방법

백엔드를 먼저 띄운 뒤(아래 참고), 프론트를 실행합니다.

```bash
# 1. 백엔드 (../IRS Pricer_Mock 에서 — 권장은 start-backend.ps1, --reload 금지(F-17))
python -m uvicorn irs_pricer.api.app:app --port 8000

# 2. 프론트엔드 (이 폴더에서)
pnpm install
pnpm dev          # http://localhost:3000
```

품질 게이트:

```bash
pnpm typecheck && pnpm lint && pnpm build
pnpm test               # vitest (컬러 대비/hex 가드 포함)
pnpm check:contrast     # 차트 색상 대비 게이트만 단독 실행
```

> `npm`이 아니라 **pnpm** 을 사용합니다 (`pnpm-workspace.yaml` 존재).
> Windows에서는 `start-frontend.ps1`로도 실행할 수 있습니다.

## 기술 스택

- **Next.js 16 / React 19**, TypeScript strict
- **Tailwind v3.4 고정** — v4의 CSS-first `@theme` 방식이 아니라 `tailwind.config.ts` + `tokens.css`(다크/라이트 CSS 변수) 조합을 사용
- 상태: **Zustand** / 폼: React Hook Form + Zod / 테이블: TanStack Table(가상화)
- 차트: **lightweight-charts** 기반 공용 `SeriesChart` + `ChartFrame`(최대화/분리 → `/chart` 라우트), 일부 Recharts·D3

## 화면 구성 (`src/features/`)

| 탭 | 내용 |
|---|---|
| `home` | KPI 카드, KTB/IRS 수익률곡선(전일 대비 시프트), Top Movers |
| `portfolio` | 가상화 포지션 그리드(필터 칩, Group By, 컬럼 이동/리사이즈, 레이아웃 영속화), Daily P&L |
| `rates-history` | 금리 히스토리 차트 (dirty+settled-cash 기준으로 통일된 PnL 시계열 포함) |
| `simulation` | 시나리오 시뮬레이터 — Configure→Running→Results 단계 흐름, 퍼센타일 팬차트(금리 경로 + 시나리오별 수익 곡선 이중축), 펀딩(기준금리+10bp), 스왑 편입/제외, TR 분해 |
| `entry-signals` | ES 백테스트 — Configure→Running→Results, 고정된 lastRun 결과 vs 라이브 모니터링 |
| `optimal` | 최적 포트폴리오(제약조건 폼 + 결과 3패널) |
| `settings` | 데이터/정책 설정 (펀딩 상수 등 백엔드 정책값 표시) |

## 지켜야 할 규칙 (요약)

- **디자인 시스템**: UI 수정 전 `PRODUCT.md` / `DESIGN.md` / `WORK_ORDER.md` 필독. 그라데이션·글래스·글로우 금지, 시맨틱 컬러는 포인트로만, 숫자는 tabular numerics.
- **차트 색상은 반드시 `src/lib/chart-colors.ts` / `--chart-*` 토큰 경유** — 컴포넌트에 hex 하드코딩 금지 (vitest 게이트가 잡아냄). 손익 부호색은 Jade(+)/Berry(−) 쌍으로 통일, Pay=Berry.
- **금리 단위는 소수(decimal)** — `0.0305` = 3.05%. 퍼센트 스케일 입력은 백엔드가 422로 거부.
- 시뮬레이션 기준금리 2.75%는 **수동 상수**(BOK 시계열에서 유도하지 말 것), 펀딩 = 기준금리+10bp 상수.

## 테스트·문서

- 단위/가드 테스트: `vitest` (`scripts/`의 대비·hex 게이트 포함). E2E 확인은 Playwright 스크린샷 패턴 사용.
- 개발 히스토리: `docs/history/` (세션·통합 리포트 전부), 통합 기준선은 **`docs/history/REPORT_integration_v5.md`** (최신), 마이그레이션 계획은 `MIGRATION_PLAN.md`, 리팩터 계획은 `REFACTOR_PLAN.md`.

## 알려진 이슈

- `/api/spread-backtest`는 UI에서 사용되지 않음(백테스트는 클라이언트 사이드 시뮬레이션).

(ES 백테스트 차트가 꼬리 구간만 렌더링되던 마운트 레이스는 s20에서 수정 — 전체 구간 fit + 트레이드 마커, `docs/history/REPORT_s20.md` 참고. s19의 xfail 수용 테스트는 통과로 전환됨.)
