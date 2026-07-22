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
    # Same shape of work as allocation-history (whole book at up to 4 dates).
    "/api/portfolio/period-pnl",
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


def test_period_pnl_endpoint_contract(monkeypatch):
    """/period-pnl through the full FastAPI stack: request parsing (the
    allocation-history payload), the declared response_model (F-09: never an
    undeclared dict), and null-not-zero surviving JSON serialisation.

    Market data and curves are stubbed at the same seams the service tests use;
    value_bond runs for real.
    """
    from datetime import date, timedelta

    from fastapi.testclient import TestClient

    from irs_pricer.api.app import app
    from irs_pricer.api.models import PeriodPnlResponse
    from irs_pricer.services import allocation_history_service as ahs

    start, end = date(2026, 7, 1), date(2026, 7, 15)
    available = [
        d for d in (start + timedelta(days=i) for i in range((end - start).days + 1))
        if d.weekday() < 5
    ]
    monkeypatch.setattr(ahs.market_data_service, "list_available_dates", lambda: available)
    monkeypatch.setattr(
        ahs.credit_curve_service, "market_yield_for",
        lambda sector, rating, remaining_years, val_date=None: 0.03 + 0.001 * remaining_years,
    )

    client = TestClient(app)
    resp = client.post("/api/portfolio/period-pnl", json={
        "positions": [{
            "position_id": "B1", "book": "RP Fund", "sector": "시은채",
            "issue_date": "2024-01-10", "maturity_date": "2029-01-10",
            "coupon_rate": 3.0, "payment_frequency": 4, "notional": 1e9,
            "rating": "AA",
        }],
        "book": "RP Fund",
    })
    assert resp.status_code == 200
    body = resp.json()

    # The declared response_model is authoritative: the payload must round-trip
    # through it (no undeclared extras, no missing fields).
    PeriodPnlResponse.model_validate(body)

    assert body["as_of"] == "2026-07-15"
    assert [r["book"] for r in body["rows"]] == ["RP Fund", "Total"]
    total = body["rows"][-1]
    # WTD resolved to the previous Friday and carries a real number...
    assert total["wtd"]["baseline_date"] == "2026-07-10"
    assert isinstance(total["wtd"]["pnl"], float)
    # ...while YTD predates all stubbed data: JSON null, not 0.
    assert total["ytd"]["baseline_date"] is None
    assert total["ytd"]["pnl"] is None

