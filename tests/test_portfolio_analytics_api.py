"""
API-level guards for the Home analytics endpoints.

The regression these protect against is subtle and has no visible symptom in a
unit test: declaring a CPU-bound handler `async def` is perfectly valid Python
and returns perfectly correct numbers -- it just runs the work directly on the
event loop, so the whole API stalls for the duration. That is precisely how the
dashboard came to sit on "Pricing…"/"Computing…": these three were the only
`async def` handlers in the app and the only ones doing heavy sync work.
"""

from __future__ import annotations

import inspect

from fastapi.routing import APIRoute

from irs_pricer.api.app import app

_ANALYTICS_PATHS = {
    "/api/portfolio/pvbp-sensitivity",
    "/api/portfolio/book-daily-pnl",
    "/api/portfolio/book-summary",
    # Bond-only, but it revalues the whole book five times over -- same reason
    # it must not run on the event loop.
    "/api/portfolio/allocation-history",
}


def _walk(routes) -> list[APIRoute]:
    """Flatten app.routes.

    FastAPI (0.138) doesn't splice an included router's routes into app.routes;
    it appends a `_IncludedRouter` wrapper that keeps them under
    `.original_router`. Walking only the top level finds nothing but the
    app-level handlers, so recurse.
    """
    found: list[APIRoute] = []
    for route in routes:
        if isinstance(route, APIRoute):
            found.append(route)
        inner = getattr(route, "original_router", None)
        if inner is not None:
            found.extend(_walk(inner.routes))
    return found


def _routes_by_path() -> dict[str, APIRoute]:
    return {r.path: r for r in _walk(app.routes)}


def test_analytics_endpoints_are_sync_so_fastapi_threadpools_them():
    """`def` (not `async def`) is load-bearing here, not a style choice.

    FastAPI runs a sync handler in a threadpool and an async one inline on the
    event loop. These handlers do seconds of numpy work and await nothing, so
    they must stay sync. If you need `async def` here, the heavy call has to
    move to run_in_threadpool/asyncio.to_thread first.
    """
    routes = _routes_by_path()
    for path in _ANALYTICS_PATHS:
        assert path in routes, f"route disappeared: {path}"
        endpoint = routes[path].endpoint
        assert not inspect.iscoroutinefunction(endpoint), (
            f"{path} is `async def` and does blocking CPU work -- this blocks the "
            f"event loop for every other request. Use `def`, or offload the "
            f"computation with run_in_threadpool."
        )


def test_no_handler_in_the_app_is_async_without_awaiting():
    """Generalises the above: an `async def` handler whose body never awaits is
    almost always this same mistake. upload is the one legitimate case (it
    awaits UploadFile.read())."""
    offenders = []
    for route in _routes_by_path().values():
        endpoint = route.endpoint
        if not inspect.iscoroutinefunction(endpoint):
            continue
        try:
            source = inspect.getsource(endpoint)
        except OSError:
            continue
        if "await" not in source:
            offenders.append(route.path)
    assert not offenders, (
        f"async handlers that never await (they block the event loop): {offenders}"
    )


def test_legacy_payload_fields_are_ignored_not_rejected():
    """prior_* and daily_pnl_by_book are gone from the models now. A client
    still sending them mid-rollout must get a 200, not a 422 -- Pydantic ignores
    unknown fields by default, and this pins that so nobody "tightens" it to
    extra="forbid" and breaks a deploy-order dependency."""
    from irs_pricer.api.routers.portfolio_analytics import (
        BookDailyPnlRequest,
        PortfolioAnalyticsRequest,
    )

    daily = BookDailyPnlRequest(
        valuation_date="2026-06-29", cd_rate=0.033, swap_quotes=[], positions=[],
        prior_valuation_date="2026-06-26", prior_cd_rate=0.0329, prior_swap_quotes=[],
    )
    assert daily.valuation_date.isoformat() == "2026-06-29"
    assert not hasattr(daily, "prior_valuation_date")

    summary = PortfolioAnalyticsRequest(
        valuation_date="2026-06-29", cd_rate=0.033, swap_quotes=[], positions=[],
        daily_pnl_by_book=[{"book": "A", "total": 1.0}],
    )
    assert not hasattr(summary, "daily_pnl_by_book")

