"""API-boundary guards: rate-unit validation, and the error contract.

Two unrelated failure modes, both of which lie rather than crash:

1. Rates cross the API as DECIMALS (0.0305 = 3.05%). The percent form reads as
   305%, which pushes the par rate outside bootstrap_zero_curve's brentq
   bracket [-0.10, 1.00]; the solver failure is swallowed and the node falls
   back to r = -log(1e-12)/T, pinning discount factors to a 1e-12 floor from
   ~1.5Y out (measured: 10Y DF 0.667 -> 1e-12). Nothing raises -- the long end
   is annihilated and the caller gets a confident, wrong number.
   api/models.py's DecimalRate bound turns that into a 422.
2. An exception with no registered handler escapes past CORSMiddleware, so the
   500 carries no Access-Control-Allow-Origin and the browser reports a CORS
   failure instead of the real error -- api-client.ts then shows "cannot reach
   the server" though the server answered fine.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from irs_pricer.api.app import app
from irs_pricer.services import market_data_service, portfolio_analytics_service

client = TestClient(app)

# Same real scenario as test_ccp_independence.py: 2026-07-01 start, 1Y, 30bn
# KRW, receive-fixed at 3.4450%, valued 2026-07-03. Reused here because it is
# known to bootstrap and price cleanly, so a 422/400 in these tests can only
# come from the guard under test.
_SWAP_QUOTES = [
    {"tenor_years": 1, "tenor_months": 6, "rate": 0.031525},
    {"tenor_years": 1, "tenor_months": 9, "rate": 0.033496},
    {"tenor_years": 1, "tenor_months": 12, "rate": 0.035039},
    {"tenor_years": 2, "tenor_months": 18, "rate": 0.036850},
    {"tenor_years": 2, "tenor_months": 24, "rate": 0.037779},
]
_POSITION = {
    "position_id": "p1",
    "start_date": "2026-07-01",
    "maturity_date": "2027-07-01",
    "notional": 30_000_000_000,
    "fixed_rate": 0.034450,
    "pay_fixed": False,
}
_COMMON = {
    "valuation_date": "2026-07-03",
    "cd_rate": 0.0292,
    "swap_quotes": _SWAP_QUOTES,
}


# --- 1. Rate-unit guardrails ---------------------------------------------


def test_decimal_rates_are_accepted():
    """The bound must not be so tight it rejects real input. Guards the other
    direction from every test below -- without this, `le=0.0` would 'pass'
    them all."""
    resp = client.post("/api/portfolio/price", json={**_COMMON, "positions": [_POSITION]})
    assert resp.status_code == 200


def test_percent_typed_cd_rate_is_rejected():
    """2.92 means 2.92% to a human and 292% to the engine. Before the bound this
    returned 200 with silently-zeroed long-end discount factors."""
    resp = client.post(
        "/api/portfolio/price",
        json={**_COMMON, "cd_rate": 2.92, "positions": [_POSITION]},
    )
    assert resp.status_code == 422
    assert "cd_rate" in resp.text


def test_percent_typed_swap_quote_is_rejected():
    """The quotes are what bootstrap_zero_curve actually solves on, so a percent
    here is the most direct route to the underflow."""
    bad_quotes = [{**q, "rate": q["rate"] * 100} for q in _SWAP_QUOTES]
    resp = client.post(
        "/api/portfolio/price",
        json={**_COMMON, "swap_quotes": bad_quotes, "positions": [_POSITION]},
    )
    assert resp.status_code == 422


def test_percent_typed_fixed_rate_is_rejected():
    resp = client.post(
        "/api/portfolio/price",
        json={**_COMMON, "positions": [{**_POSITION, "fixed_rate": 3.4450}]},
    )
    assert resp.status_code == 422


def test_negative_rates_are_still_allowed():
    """The bound exists to catch a unit error, not to express a view on the
    market -- a negative rate is unusual for KRW but not invalid, and stress
    scenarios must stay expressible."""
    resp = client.post(
        "/api/portfolio/price",
        json={**_COMMON, "cd_rate": -0.001, "positions": [_POSITION]},
    )
    assert resp.status_code == 200


def test_bond_coupon_rate_is_exempt_because_it_is_percent_by_convention():
    """BondCashflowIn.coupon_rate is documented as percent ("e.g. 3.125"),
    unlike every other rate on the API. Applying DecimalRate to it would reject
    every real bond -- this pins the exemption so a future sweep doesn't
    'consistently' break it."""
    resp = client.post(
        "/api/portfolio/bond-cashflows",
        json={
            "bonds": [
                {
                    "asset_id": "b1",
                    "asset_type": "국고채",
                    "issue_date": "2024-06-10",
                    "maturity_date": "2029-06-10",
                    "coupon_rate": 3.125,  # percent -- must NOT be rejected
                    "payment_frequency": 2,
                    "notional": 1_000_000_000,
                }
            ]
        },
    )
    assert resp.status_code != 422, f"coupon_rate=3.125 must not be unit-rejected: {resp.text}"


def test_real_market_data_survives_the_decimal_bound():
    """Canary for the dual-use models.

    MarketDataResponse is both the response model of GET /api/market-data/{date}
    and the request body of POST /live, so DecimalRate also asserts the loaders
    never hand back percent-scaled rates. If they did, it would surface in
    production as a ResponseValidationError 500; catching it here instead is the
    whole point. A failure means the DATA or the LOADER is wrong -- do not widen
    the bound to make this pass.
    """
    try:
        dates = market_data_service.list_available_dates()
    except Exception as exc:  # noqa: BLE001 -- no workbook/DB in this env
        pytest.skip(f"no market data available: {exc}")
    if not dates:
        pytest.skip("no market data available")

    resp = client.get(f"/api/market-data/{dates[-1]}")
    assert resp.status_code == 200, (
        f"real market data failed the DecimalRate bound -- the loader is "
        f"producing percent-scaled rates: {resp.text}"
    )


# --- 2. Error contract ----------------------------------------------------


def _analytics_payload() -> dict:
    return {**_COMMON, "positions": []}


def test_value_error_in_analytics_becomes_a_400(monkeypatch):
    """Matches the ValueError -> 400 contract the other routers already use
    (historical_pnl.py, bond_cashflows.py). An unknown sector/rating is bad
    input, not a server fault."""
    monkeypatch.setattr(market_data_service, "load_fixings", lambda: {})
    monkeypatch.setattr(
        portfolio_analytics_service,
        "build_pvbp_sensitivity",
        lambda *a, **k: (_ for _ in ()).throw(ValueError("unknown sector: 없는섹터")),
    )
    resp = client.post("/api/portfolio/pvbp-sensitivity", json=_analytics_payload())
    assert resp.status_code == 400
    assert "없는섹터" in resp.text


def test_unhandled_exception_still_carries_cors_headers(monkeypatch):
    """The one that actually proves the middleware ordering.

    A KeyError matches no registered handler, so without the catch-all
    middleware it escapes to ServerErrorMiddleware -- which sits OUTSIDE
    CORSMiddleware -- and the 500 goes out bare. The browser then blames CORS
    and the real error never surfaces. Registering the catch-all after CORS
    instead of before would silently reproduce exactly that, and only this
    assertion would notice.
    """
    monkeypatch.setattr(market_data_service, "load_fixings", lambda: {})
    monkeypatch.setattr(
        portfolio_analytics_service,
        "build_pvbp_sensitivity",
        lambda *a, **k: (_ for _ in ()).throw(KeyError("boom")),
    )
    resp = client.post(
        "/api/portfolio/pvbp-sensitivity",
        json=_analytics_payload(),
        headers={"Origin": "http://localhost:3000"},
    )
    assert resp.status_code == 500
    assert "access-control-allow-origin" in resp.headers, (
        "500 escaped without CORS headers -- the browser will misreport this as "
        "a CORS failure. Check the middleware registration order in app.py."
    )


def test_registered_handlers_still_win_over_the_catch_all(monkeypatch):
    """The catch-all must not shadow the specific handlers.

    RuntimeError is the discriminating case: the router's `except ValueError`
    doesn't see it, so it reaches ExceptionMiddleware -- which sits INSIDE the
    catch-all -- and its registered handler should answer with "계산 오류".
    If the catch-all were outside ExceptionMiddleware (or registered as
    @app.exception_handler(Exception), which Starlette hoists into
    ServerErrorMiddleware), this would come back as the generic "서버 오류"
    instead. Asserting on the message, not just the 500, is what makes this
    test able to tell the two apart.
    """
    monkeypatch.setattr(market_data_service, "load_fixings", lambda: {})
    monkeypatch.setattr(
        portfolio_analytics_service,
        "build_pvbp_sensitivity",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("singular matrix")),
    )
    resp = client.post("/api/portfolio/pvbp-sensitivity", json=_analytics_payload())
    assert resp.status_code == 500
    assert "계산 오류" in resp.text, (
        f"the RuntimeError handler was shadowed by the catch-all: {resp.text}"
    )
