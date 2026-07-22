"""
Scenario-simulation service facade: the import surface behind POST /api/simulate.

R3a (2026-07-20): the former 1,856-line single-file implementation was split
into the services/simulation/ family (see docs/r3a/SPLIT_PLAN.md and the
family map in simulation/__init__.py). This module now only re-exports that
family's surface so every pre-split import keeps working unchanged:

- api/routers/simulate.py:      `simulation_service.run_simulation`,
                                `FrontendPosition`, `FrontendShockCurves`
- tests (s15/s18):              funding constants as module attrs,
                                `_resolve_swap_float_fields`, and the
                                monkeypatch seam
                                `simulation_service.market_data_service`
                                (the shared module object — patching its
                                load_snapshot/load_fixings reaches
                                simulation/swap_inputs.py, which calls
                                through the module attribute).

Everything historical in the old module docstring (source-port provenance,
deliberate deviations from rates-simulator-main, the frozen camelCase DTO
contract) moved with the code: see simulation/models.py, simulation/chart.py,
and the per-module docstrings.

New code should import from the specific family module; this facade exists
for the frozen external surface.
"""

from __future__ import annotations

from . import market_data_service  # noqa: F401 — tests' monkeypatch seam (H4)
from .simulation.aggregates import (  # noqa: F401
    build_book_daily_pnl,
    build_frontend_pvbp_sensitivity,
)
from .simulation.chart import (  # noqa: F401
    _build_irs_shock_curve,
    build_chart_data,
)
from .simulation.constants import (  # noqa: F401
    FUNDING_RATE_KRW,
    FUNDING_SPREAD_BP,
    POLICY_BASE_RATE_KRW,
)
from .simulation.daily_valuation import (  # noqa: F401
    _is_matured,
    calc_dynamic_funding_rate,
    calculate_daily_carry,
    calculate_daily_funding_cost,
    calculate_daily_mtm,
    get_position_shock_bp,
    get_sector_curve_key,
    interpolate_curve_shift,
    parse_tenor_to_years,
)
from .simulation.distribution import (  # noqa: F401
    _DIST_PERCENTILES,
    _DIST_SIGMA_BP_DAILY,
    _DIST_Z,
    _offset_curve_points,
    _offset_custom_path,
    _offset_shock_curves,
    build_distribution_bands,
)
from .simulation.enrichment import enrich_irs_pvbp  # noqa: F401
from .simulation.kr_calendar import (  # noqa: F401
    _TENOR_MONTHS,
    build_bizday_schedule,
    modified_following_kr,
    next_kr_business_day,
    resolve_curve_maturity_dates,
    tenor_to_maturity_date,
)
from .simulation.models import (  # noqa: F401
    FrontendPosition,
    FrontendShockCurves,
)
from .simulation.orchestrator import (  # noqa: F401
    _run_simulation_profiled,
    run_simulation,
)
from .simulation.profiling import (  # noqa: F401
    SIM_PROFILE_ENV,
    _log_profile,
    _phase,
    _sim_profiler,
)
from .simulation.swap_inputs import (  # noqa: F401
    _MONTHS_TO_TENOR,
    SWAP_EXCLUSION_REASON_NO_QUOTES,
    _resolve_swap_float_fields,
    _resolve_swap_inputs,
)
