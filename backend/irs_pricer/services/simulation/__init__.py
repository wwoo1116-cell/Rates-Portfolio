"""
simulation/ — the module family behind POST /api/simulate (R3a split).

The former single-file service (services/simulation_service.py, 1,856 lines)
split into coherent modules; `services/simulation_service.py` remains the
facade every external consumer imports (router, portfolio_analytics_service,
tests). Nothing outside the family imports these modules directly — go
through the facade, whose surface is the frozen one.

Family map (see docs/r3a/SPLIT_PLAN.md for the full census):
- models.py          wire DTOs (frozen FE contract field names)
- constants.py       s15/s18 funding constants (manual policy-rate constant)
- kr_calendar.py     KR business-day / tenor-maturity date logic
- daily_valuation.py per-day bond MtM/carry/funding glue + shock lookup
- profiling.py       s18 T5 measure-only profiler
- chart.py           build_chart_data — the per-scenario engine run
- distribution.py    s11 T3 percentile fan (quantile-scenario identity)
- aggregates.py      pvbpSensitivity + bookDailyPnLs tables
- enrichment.py      IRS static pricing injection (pvbp/krdMap/theta)
- swap_inputs.py     s15 T2 swap market-data resolution + exclusions
- orchestrator.py    run_simulation — the endpoint body
"""
