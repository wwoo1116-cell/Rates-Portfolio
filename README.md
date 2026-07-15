# KRW IRS NPV Pricer
This project is a production-grade KRW Interest Rate Swap (IRS) pricing and risk management application. It calculates Net Present Value.

## 🏗️ Architecture
The codebase strictly adheres to modular design principles to separate pure quantitative logic from I/O and presentation.

### Backend (irs_pricer/)
engine/: The core quantitative library. It is 100% side-effect-free and mathematically pure. The heart is `quant_engine.py`, a hand-rolled full-revaluation engine (numpy/scipy/holidays only — QuantLib was fully removed on 2026-07-14) that owns curve bootstrapping, schedule generation, NPV, KRD and PVBP.

**`quant_engine.py` must stay byte-identical to `rates-simulator-main/backend/quant_engine.py`** (the authoritative source; sha256 begins `2d600a3a`, 83,895 bytes). Never edit it. Optimizations wrap it from the outside — `curve_cache.py` is the precedent: it memoizes `bootstrap_zero_curve` by rebinding the module attribute at app startup, leaving the file untouched. The wrappers around it (`curve.py`, `instruments.py`, `pricing.py`, `mtm_valuation.py`, `risk.py`, `bond_valuation.py`) are the editable glue.

### loaders/: 
The data access layer. Implements a robust Factory Pattern (factory.py) that seamlessly routes market snapshots from True Data.xlsx, Total Data.xlsx, or CSV fallbacks. Employs a two-tier in-memory and on-disk caching layer (cache.py) to eliminate parsing latency. Every loader takes the data directory as a parameter and never resolves a path itself — callers get it from `config.DATA_DIR` (see Getting Started §0).

### services/: 
The orchestration layer. Manages business logic for pricing (pricing_service.py), Mark-to-Market repricing (mtm_service.py), and market data distribution. Fully decoupled from disk I/O through Dependency Injection.

### api/: 
The FastAPI presentation layer. Exposes REST endpoints serving market data and pricing calculations to the frontend while enforcing strict Pydantic schemas.

### Frontend
The production frontend is the **sibling repo `../UIUX_test`** (Next.js 16 / React 19, its own git repository) — see its README for setup.

`web/` in this repo is the older Vite + React reference client. It still runs and documents the API-consumption patterns, but it is not where UI work happens.

### Command-Line Interface (scripts/)
run_pricer.py: The canonical CLI entry point for executing batch calculations or dry-running swap pricing directly against the services layer.

## 🚀 Getting Started
### 0. Data files
The market-data workbooks are **not in this repo**. They live in a shared `Data/`
folder next to it:

```
Rates Portfolio/
  Data/                 <- True Data.xlsx, Credit Matrix Data.xlsx, BOK Base Rate.xlsx, ...
  IRS Pricer_Mock/      <- this repo
  UIUX_test/            <- the frontend repo
```

They're data, not code: the upload page overwrites the same files the loaders
read, so keeping them here meant every upload dirtied the working tree and wrote
a fresh 41MB blob into history. `irs_pricer/config.py` resolves the folder;
set `IRS_PRICER_DATA_DIR` to point somewhere else (it must be on the same
filesystem — uploads rely on an atomic `os.replace`).

A fresh clone has no `Data/`. That's fine — the app still boots; data endpoints
return a clear error naming the path and the env var, and uploading the four
workbooks through the app's upload page creates the folder for you.

### 1. Run the FastAPI Backend
Launch the backend from the project root:

Bash
python -m uvicorn irs_pricer.api.app:app --reload --port 8000
API documentation is available at http://127.0.0.1:8000/docs.

### 2. Run the Frontend
The production UI lives in the sibling repo:

Bash
cd ../UIUX_test
pnpm install
pnpm dev
The application is accessible at http://localhost:3000.

(The legacy reference client in `web/` still runs via `cd web && npm run dev` on :5173.)

### 3. CLI Execution
To test core pricing capabilities via the terminal:

Bash
python scripts/run_pricer.py

## 🧪 Testing
The mathematical engine and orchestrated services are covered by Pytest. From the project root (the package is resolved from the working directory, so set `PYTHONPATH` unless you've done an editable install):

Bash
PYTHONPATH=$PWD python -m pytest tests/

`tests/test_engine_regression.py` is the regression gate for pricing/risk glue changes; `tests/test_true_data_loader.py` reads the real workbook and self-skips when `Data/` is absent.

## 🛡️ Stability and Safety
Event-loop protection: CPU-bound handlers are plain `def` (FastAPI runs them in a threadpool), so seconds of numpy can never stall unrelated requests — `tests/test_portfolio_analytics_api.py` enforces this.

Caching: `engine/curve_cache.py` memoizes curve bootstraps (installed at app startup — note for benchmarking: `TestClient(app)` must be used as a context manager or the lifespan never runs and pricing is ~50x slower). `core/ttl_cache.py` shares derived values (portfolio delta, fixings, credit shifts) across endpoints; its invalidation contract is documented in the module and must be preserved when adding cache consumers.

Data Integrity: Implements strict Fail-Fast error handling for missing market data to prevent corrupt historical MTM results. Rates at the API boundary are decimals (0.0305 = 3.05%); percent-scaled input is rejected with a 422 rather than silently destroying the long end of the curve.
