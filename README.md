# KRW IRS NPV Pricer — Backend (IRS Pricer_Mock)

원화 이자율스왑(KRW IRS)·국고채 프라이싱 및 리스크 관리 백엔드입니다.
커브 부트스트래핑부터 NPV / KRD / PVBP / MtM / 일별 PnL까지 계산하며, FastAPI로 프론트엔드(`../UIUX_test`)에 제공합니다.

## 🏗️ 아키텍처

순수 수치 로직과 I/O·표현 계층을 엄격히 분리한 모듈 구조입니다.

### `irs_pricer/engine/` — 수치 엔진 (side-effect 없음)

핵심은 **`quant_engine.py`** — numpy/scipy/holidays만 사용하는 hand-rolled full-revaluation 엔진입니다 (QuantLib은 2026-07-14 완전 제거). 커브 부트스트래핑, 스케줄 생성, NPV, KRD, PVBP를 담당합니다.

> ⚠️ **`quant_engine.py`는 `rates-simulator-main/backend/quant_engine.py`와 byte-identical하게 유지해야 합니다** (원본 sha256 시작 `2d600a3a`, 83,895 bytes). **절대 직접 수정 금지.**
> 최적화는 바깥에서 감쌉니다 — `curve_cache.py`가 선례: 앱 기동 시 모듈 속성을 재바인딩해 `bootstrap_zero_curve`를 메모이즈하고, 파일 자체는 건드리지 않습니다.
> 수정 가능한 글루 레이어: `curve.py`, `instruments.py`, `pricing.py`, `mtm_valuation.py`, `risk.py`, `bond_valuation.py`, `fixings.py`(변동금리 픽싱, Seoul 영업일 기준).

### `irs_pricer/loaders/` — 데이터 접근 계층

Factory 패턴(`factory.py`)으로 `True Data.xlsx` / `Total Data.xlsx` / CSV 폴백을 자동 라우팅. 2단(메모리+디스크) 캐시(`cache.py`)로 파싱 지연 제거. 모든 로더는 데이터 경로를 파라미터로 받으며 직접 경로를 해석하지 않습니다 — 경로는 `config.DATA_DIR`에서 옵니다 (아래 §0).

### `irs_pricer/services/` — 오케스트레이션

프라이싱(`pricing_service.py`), MtM 재평가(`mtm_service.py`), 시장데이터 배포의 비즈니스 로직. DI로 디스크 I/O와 완전 분리.

### `irs_pricer/api/` — FastAPI 표현 계층

시장데이터·프라이싱·시뮬레이션 REST 엔드포인트. Pydantic 스키마 강제.

### 프론트엔드

프로덕션 UI는 형제 저장소 **`../UIUX_test`** (Next.js 16 / React 19) — 설치·실행은 그쪽 README 참고.
이 저장소의 `web/`은 구형 Vite + React 레퍼런스 클라이언트로, 동작은 하지만(:5173) UI 작업 장소가 아닙니다.

### CLI (`scripts/`)

`run_pricer.py` — services 계층을 직접 호출해 배치 계산/스왑 프라이싱을 드라이런하는 표준 CLI 진입점.

## 🚀 시작하기

### 0. 데이터 파일

시장데이터 엑셀은 **저장소에 포함되어 있지 않습니다.** 옆의 공유 `Data/` 폴더에 둡니다:

```
Rates Portfolio/
  Data/                 <- True Data.xlsx, Credit Matrix Data.xlsx, BOK Base Rate.xlsx, ...
  IRS Pricer_Mock/      <- 이 저장소 (백엔드)
  UIUX_test/            <- 프론트엔드 저장소
```

업로드 페이지가 로더가 읽는 파일을 그대로 덮어쓰는 구조라, 저장소 안에 두면 업로드마다 워킹트리가 더러워지고 41MB 블랍이 히스토리에 쌓이기 때문입니다. 경로는 `irs_pricer/config.py`가 해석하며, `IRS_PRICER_DATA_DIR` 환경변수로 바꿀 수 있습니다 (업로드가 원자적 `os.replace`에 의존하므로 같은 파일시스템이어야 함).

갓 clone한 상태에는 `Data/`가 없어도 앱은 부팅됩니다 — 데이터 엔드포인트가 경로와 환경변수를 명시한 에러를 반환하고, 앱 업로드 페이지로 워크북 4개를 올리면 폴더가 자동 생성됩니다.

### 1. 백엔드 실행

```bash
python -m uvicorn irs_pricer.api.app:app --reload --port 8000
```

API 문서: http://127.0.0.1:8000/docs (Windows에서는 `start-backend.ps1`도 사용 가능)

### 2. 프론트엔드 실행

```bash
cd ../UIUX_test
pnpm install
pnpm dev        # http://localhost:3000
```

### 3. CLI 실행

```bash
python scripts/run_pricer.py
```

## 🧪 테스트

엔진과 서비스 계층은 Pytest로 커버됩니다. 프로젝트 루트에서 (패키지가 작업 디렉터리 기준으로 해석되므로 editable install이 아니면 `PYTHONPATH` 지정):

```bash
PYTHONPATH=$PWD python -m pytest tests/
```

- `tests/test_engine_regression.py` — 프라이싱/리스크 글루 변경의 회귀 게이트
- `tests/test_true_data_loader.py` — 실제 워크북을 읽으며 `Data/` 부재 시 self-skip

## 🛡️ 안정성·안전장치

- **이벤트 루프 보호**: CPU-bound 핸들러는 일반 `def`(FastAPI가 스레드풀에서 실행) — 수 초짜리 numpy 계산이 다른 요청을 막지 않습니다. `tests/test_portfolio_analytics_api.py`가 강제.
- **캐싱**: `engine/curve_cache.py`가 커브 부트스트랩을 메모이즈(앱 기동 시 설치 — 벤치마크 시 `TestClient(app)`를 컨텍스트 매니저로 쓰지 않으면 lifespan이 안 돌아 ~50배 느려짐). `core/ttl_cache.py`는 파생값(포트폴리오 델타, 픽싱, 크레딧 시프트)을 엔드포인트 간 공유 — 무효화 계약이 모듈에 문서화되어 있으며 캐시 소비자를 추가할 때 반드시 지켜야 합니다.
- **데이터 무결성**: 시장데이터 누락 시 Fail-Fast로 오염된 히스토리컬 MtM을 방지. **API 경계의 금리는 소수(decimal) 단위** (`0.0305` = 3.05%) — 퍼센트 스케일 입력은 커브 장기 구간을 조용히 망가뜨리는 대신 422로 거부됩니다.
- **평가 기준 통일**: 히스토리컬 PnL/트레이스 시계열은 dirty MtM + settled cash 기준으로 통일 (`settled_cash_between`, curve-free) — basis guard 테스트가 강제.
