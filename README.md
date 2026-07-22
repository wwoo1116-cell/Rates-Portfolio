# Rates Portfolio — KRW FI PMS

원화 금리(KRW IRS · 국고채) 포트폴리오 관리 시스템입니다.
프론트엔드(Next.js)와 백엔드(FastAPI 프라이싱·리스크 엔진)를 **하나의 저장소**에서 관리합니다.

```
Rates Portfolio/
  Data/                 <- 시장데이터 워크북 (저장소 밖, git 미포함)
  krw-fi-pms/           <- 이 저장소 (origin: wwoo1116-cell/Rates-Portfolio)
    src/                   프론트엔드 (Next.js 16 / React 19)
    backend/               백엔드 (FastAPI + numpy 엔진, :8000)
    docs/                  세션·통합 리포트, 배포 리포트
```

> 백엔드는 2026-07-22에 `krw-fi-pms-backend` 저장소를 히스토리 보존한 채 `backend/`로 흡수했습니다(`f80475c`).
> **정본 원격은 `Rates-Portfolio` 하나**입니다 — 예전 백엔드 저장소는 더 이상 배포 경로가 아닙니다.

## 실행 방법

### 1. 데이터 파일

시장데이터 엑셀(`True Data.xlsx`, `Credit Matrix Data.xlsx`, `BOK Base Rate.xlsx`, …)은 **저장소에 포함되지 않습니다.** 위 트리처럼 형제 폴더 `Data/`에 둡니다(경로는 `backend/irs_pricer/config.py`가 해석, `IRS_PRICER_DATA_DIR`로 변경 가능). `Data/`가 없어도 앱은 부팅되며, `/upload` 페이지로 워크북을 올리면 폴더가 생성됩니다.

### 2. 백엔드 (`backend/`)

```bash
cd backend
python -m uvicorn irs_pricer.api.app:app --port 8000     # API 문서: /docs
```

권장은 `backend/start-backend.ps1` — 4 워커, :8000 이중 기동 가드, 커브 캐시 kill switch(`IRS_PRICER_CURVE_CACHE=0`) 포함.
**`--reload` 금지**(F-17) — 이 머신에서 reload 워처가 크래시하며 고아 프로세스가 :8000을 물고 남습니다.

### 3. 프론트엔드 (저장소 루트)

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

> `npm`이 아니라 **pnpm**을 사용합니다(`pnpm-workspace.yaml` 존재). Windows에서는 `start-frontend.ps1`도 가능합니다.
> 프론트의 `/api/*`는 `next.config.ts`의 rewrite로 `BACKEND_ORIGIN`(기본 `http://127.0.0.1:8000`)에 프록시됩니다.

### 품질 게이트

```bash
# 프론트엔드 (루트)
pnpm typecheck && pnpm lint && pnpm build
pnpm test               # vitest (차트 색상 대비/hex 가드 포함)
pnpm check:contrast     # 대비 게이트만 단독 실행

# 백엔드 (backend/)
PYTHONPATH=$PWD python -m pytest tests/
```

## 배포 (Vercel FE + 로컬 BE)

프론트는 Vercel, 백엔드는 **로컬 실행 + Cloudflare 터널 노출** 구조입니다.
운영 URL: **`https://rates-portfolio.vercel.app`** — 상세 기록은 [`docs/DEPLOY_EXEC_REPORT.md`](docs/DEPLOY_EXEC_REPORT.md).

| 환경변수 | 값 | 비고 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `""` (설정하되 **빈 문자열**) | same-origin. ⚠️ 미설정 시 브라우저가 자기 localhost를 때립니다 |
| `BACKEND_ORIGIN` | 터널 오리진 | 서버 전용(`NEXT_PUBLIC_*` 아님). rewrite 목적지는 **빌드 타임에 고정** → 호스트명이 바뀌면 재배포 필요 |
| `NEXT_PUBLIC_SIMULATION_API_BASE_URL` | 미설정 | same-origin 상속 → `/api/simulate` 라우트 핸들러 경유 |
| `NEXT_PUBLIC_UPLOAD_BASE_URL` | 미설정 | same-origin rewrite(4.5 MB 함수 바디 캡 회피) |

- **타임아웃 벽 순서: ~100s (Cloudflare 524) < 120s (Vercel rewrite TTFB) < 300s (`/api/simulate` 라우트 핸들러 `maxDuration`).**
  simulate만 라우트 핸들러로 빠지고 나머지는 평범한 rewrite를 탑니다.
- Cloudflare의 ~100s 벽은 **named 터널로도 해결되지 않습니다**(무료 플랜 엣지 공통). 실제 방어책은 백엔드 simulate의 **StreamingResponse + 30초 whitespace 하트비트**이며 이미 반영되어 있습니다(`570a2ff`) — **:8000 재기동 후에만 적용됩니다.**
- 남은 하드닝 항목(named 터널/도메인, `APP_SHARED_SECRET` 활성화, NSSM 서비스 등록)은 배포 리포트의 하드닝 섹션 참고.

**브랜치 모델**: 작업은 `feat/simulation-migration`, 승격은 `main`으로 `git merge --ff-only`.
**`main` 푸시는 Vercel 프로덕션 자동 배포를 트리거합니다.**

## 기술 스택

**프론트엔드**

- **Next.js 16 / React 19**, TypeScript strict
- **Tailwind v3.4 고정** — v4의 CSS-first `@theme`가 아니라 `tailwind.config.ts` + `tokens.css`(다크/라이트 CSS 변수) 조합
- 상태: **Zustand** / 폼: React Hook Form + Zod / 그리드: **AG Grid**(포지션·시그널), `@tanstack/react-virtual`
- 차트: **lightweight-charts** 기반 공용 `SeriesChart` + `ChartFrame`(최대화/분리 → `/chart` 라우트) — 차트는 이 한 경로로 통일되어 있습니다(Recharts·D3는 `package.json`에 남아 있으나 현재 import되지 않는 잔여 의존성)
- 패널 레이아웃: dockview(시뮬레이션 탭·차트 레지스트리)

**백엔드**

- **FastAPI** + numpy/scipy/holidays 기반 hand-rolled full-revaluation 엔진 (QuantLib 제거됨)
- `engine/` 수치 로직(side-effect 없음) · `loaders/` 엑셀·CSV 데이터 접근 + 2단 캐시 · `services/` 오케스트레이션 · `api/` REST 표현 계층
- 커브 부트스트랩 메모이제이션(`engine/curve_cache.py`), 파생값 TTL 캐시(`core/ttl_cache.py`)

## 화면 구성 (`src/features/`)

| 탭 | 내용 |
|---|---|
| `home` | KPI 카드, KTB/IRS 수익률곡선(전일 대비 시프트), Top Movers, **일별 대사(recon) 패널** — PnL 트레이스, PVBP 민감도, 스왑 현금흐름 대사, Δbp 시계열 |
| `portfolio` | 가상화 포지션 그리드(필터 칩, Group By, 컬럼 이동/리사이즈, 레이아웃 영속화), Daily P&L |
| `rates-history` | 금리 히스토리 차트(dirty+settled-cash 기준 PnL 시계열, 크로스헤어 rate readout, IRS 3Y/10Y 벤치마크) |
| `simulation` | 시나리오 시뮬레이터 — Configure→Running→Results, 커브형/시계열형/매트릭스 입력, 시작일·마감일 지정, 펀딩(기준금리+10bp), 스왑 편입/제외, TR 분해, 시나리오 대사 기여 그리드 |
| `entry-signals` | ES 백테스트 — Configure→Running→Results, 고정된 lastRun 결과 vs 라이브 모니터링 |
| `optimal` | 최적 포트폴리오(제약조건 폼 + 결과 3패널) |
| `settings` | 데이터/정책 설정(펀딩 상수 등 백엔드 정책값 표시) |

`/upload`(워크북 업로드), `/chart/[chartId]`(차트 분리 창), `/dev/components`(컴포넌트 갤러리)는 워크스페이스 밖 라우트입니다.

## 지켜야 할 규칙 (요약)

- **`backend/irs_pricer/engine/quant_engine.py`는 원본과 byte-identical 유지 — 직접 수정 금지.** 최적화는 바깥에서 감쌉니다(`curve_cache.py`가 선례: 앱 기동 시 모듈 속성 재바인딩).
- **디자인 시스템**: UI 수정 전 `PRODUCT.md` / `DESIGN.md` / `WORK_ORDER.md` 필독. 그라데이션·글래스·글로우 금지, 시맨틱 컬러는 포인트로만, 숫자는 tabular numerics.
- **차트 색상은 반드시 `src/lib/chart-colors.ts` / `--chart-*` 토큰 경유** — 컴포넌트 hex 하드코딩 금지(vitest 게이트가 잡음). 손익 부호색은 Jade(+)/Berry(−) 쌍, Pay=Berry.
- **금리 단위는 소수(decimal)** — `0.0305` = 3.05%. 퍼센트 스케일 입력은 백엔드가 422로 거부.
- 시뮬레이션 기준금리 2.75%는 **수동 상수**(BOK 시계열에서 유도 금지), 펀딩 = 기준금리+10bp 상수.
- **평가 기준 통일**: 히스토리컬 PnL/트레이스 시계열은 dirty MtM + settled cash(`settled_cash_between`, curve-free) — basis guard 테스트가 강제.
- CPU-bound API 핸들러는 일반 `def`로 작성(FastAPI 스레드풀). 예외는 하트비트를 흘리는 `simulate`뿐이며, 실제 계산은 `run_in_executor`로 빠집니다.

## 문서

- 배포: `docs/DEPLOY_EXEC_REPORT.md`
- 개발 히스토리: `docs/history/` (세션·통합 리포트 전부) — 통합 기준선은 `docs/history/REPORT_integration_v5.md`, 이후 대사/시뮬레이션 작업은 `RECON2_MERGE_REPORT.md`, `FB4_LAND_REPORT.md`, `FB5_LAND_REPORT.md`, `FB5R_REPORT.md`
- 백엔드 리스크 계산 이력: `backend/DV01_DIAG_REPORT.md` → `DV01_FIX_REPORT.md` → `DV01_LAND_REPORT.md`(PVBP/DV01 잔차 정정), `backend/REPORT_s21.md`(커브 캐시 하드닝)
- 계획 문서: `MIGRATION_PLAN.md`(시뮬레이션 이관), `REFACTOR_PLAN.md`, `DEMO_DEBT.md`(데모용으로 잠시 감춘 것들의 복구 지도)

## 알려진 이슈

- 포지션 블로터는 **2026-03-23 스냅샷 고정** — 잔존일수가 실시간으로 늙지 않습니다(운영 항목).
- ES 백테스트는 **클라이언트 사이드 시뮬레이션**입니다 — 백엔드 `spread_backtest_service`는 R2에서 삭제됐고, `src/lib/math/backtest.ts`가 그 포팅본입니다.
- Cloudflare **quick** 터널은 재기동마다 호스트명이 바뀌며, rewrite 목적지가 빌드 타임 고정이라 `BACKEND_ORIGIN` 갱신 + 재배포가 필요합니다.
