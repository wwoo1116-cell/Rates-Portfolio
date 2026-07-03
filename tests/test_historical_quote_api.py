"""Regression tests for /api/portfolio/historical-quote: a deliberately
SEPARATE endpoint from /api/portfolio/fair-rate. fair-rate always prices off
TODAY's curve (a forward breakeven rate); historical-quote must instead set
the QuantLib evaluation date to start_date itself and use ONLY that day's
own market snapshot -- these answer two different questions and must never
be conflated back into one endpoint.
"""
from fastapi.testclient import TestClient

from irs_pricer.api.app import app

client = TestClient(app)


def test_historical_quote_uses_that_days_own_curve_not_today():
    # Real data: 2017-06-01's actual quoted 10Y rate is ~1.895%. Today's
    # curve is nowhere near that -- if this endpoint used today's curve (the
    # fair-rate bug this replaces), it would return something close to
    # today's short-end rate instead.
    resp = client.get(
        "/api/portfolio/historical-quote",
        params={"start_date": "2017-06-01", "maturity_date": "2027-06-01", "notional": 10_000_000_000},
    )
    assert resp.status_code == 200
    rate = resp.json()["historical_rate"]
    assert abs(rate - 0.01895) < 0.0005  # within 5bp of the real 2017-06-01 10Y quote


def test_historical_quote_differs_from_forward_breakeven_fair_rate():
    # Same schedule, same notional -- /fair-rate (today's curve) and
    # /historical-quote (2017's curve) must give very different answers,
    # proving they are genuinely two separate code paths, not the same
    # calculation reused under two names.
    fair_rate_resp = client.post(
        "/api/portfolio/fair-rate",
        json={
            "valuation_date": "2026-07-03",
            "cd_rate": 0.0316,
            "swap_quotes": [
                {"tenor_years": 1, "rate": 0.0369}, {"tenor_years": 2, "rate": 0.03865},
                {"tenor_years": 3, "rate": 0.0391}, {"tenor_years": 4, "rate": 0.0394},
                {"tenor_years": 5, "rate": 0.0396}, {"tenor_years": 6, "rate": 0.03975},
                {"tenor_years": 7, "rate": 0.0399}, {"tenor_years": 8, "rate": 0.04005},
                {"tenor_years": 9, "rate": 0.04005}, {"tenor_years": 10, "rate": 0.0401},
            ],
            "start_date": "2017-06-01",
            "maturity_date": "2027-06-01",
            "notional": 10_000_000_000,
        },
    )
    assert fair_rate_resp.status_code == 200
    forward_breakeven_rate = fair_rate_resp.json()["fair_rate"]

    historical_resp = client.get(
        "/api/portfolio/historical-quote",
        params={"start_date": "2017-06-01", "maturity_date": "2027-06-01", "notional": 10_000_000_000},
    )
    historical_rate = historical_resp.json()["historical_rate"]

    # The forward-breakeven rate reflects <1 remaining year of this near-
    # matured schedule discounted off TODAY's curve, so it sits near today's
    # short-end (~3.5-3.7%) -- nowhere near 2017's own ~1.9% quote.
    assert abs(forward_breakeven_rate - historical_rate) > 0.01  # differ by >100bp


def test_historical_quote_rejects_non_business_day():
    resp = client.get(
        "/api/portfolio/historical-quote",
        params={"start_date": "2017-06-04", "maturity_date": "2027-06-04", "notional": 10_000_000_000},
    )
    # 2017-06-04 is a Sunday
    assert resp.status_code == 400
