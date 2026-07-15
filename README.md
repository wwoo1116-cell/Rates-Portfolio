# KRW IRS NPV Pricer
This project is a production-grade KRW Interest Rate Swap (IRS) pricing and risk management application. It calculates Net Present Value.

## 🏗️ Architecture
The codebase strictly adheres to modular design principles to separate pure quantitative logic from I/O and presentation.

### Backend (irs_pricer/)
engine/: The core quantitative library. It is 100% side-effect-free and mathematically pure. Handles zero curve bootstrapping (curve.py), instrument definitions (instruments.py), and pricing integrations via Python QuantLib (pricing.py).

### loaders/: 
The data access layer. Implements a robust Factory Pattern (factory.py) that seamlessly routes market snapshots from True Data.xlsx, Total Data.xlsx, or CSV fallbacks. Employs a two-tier in-memory and on-disk caching layer (cache.py) to eliminate parsing latency. Every loader takes the data directory as a parameter and never resolves a path itself — callers get it from `config.DATA_DIR` (see Getting Started §0).

### services/: 
The orchestration layer. Manages business logic for pricing (pricing_service.py), Mark-to-Market repricing (mtm_service.py), and market data distribution. Fully decoupled from disk I/O through Dependency Injection.

### api/: 
The FastAPI presentation layer. Exposes REST endpoints serving market data and pricing calculations to the frontend while enforcing strict Pydantic schemas.

### Frontend (web/)
A modern React application (built with Vite and styled with Tailwind CSS) that provides an interactive UI for:

Real-time market data visualization.

Interactive Single Swap Pricing.

Scenario analysis and Curve Comparisons.

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

### 2. Run the React Frontend
Navigate to the web directory:

Bash
cd web
npm install
npm run dev
The application is accessible at http://localhost:5173.

### 3. CLI Execution
To test core pricing capabilities via the terminal:

Bash
python scripts/run_pricer.py

## 🧪 Testing
The mathematical engine and orchestrated services are covered by Pytest. To execute the test suite:

Bash
python -m pytest tests/

## 🛡️ Stability and Safety
Thread Safety: System utilizes a global lock (managed_quantlib_env) to ensure QuantLib's singleton settings remain isolated during concurrent API requests.

Data Integrity: Implements strict Fail-Fast error handling for missing market data to prevent corrupt historical MTM results.
