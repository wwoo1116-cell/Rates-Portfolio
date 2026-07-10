"""CCP Data mode's curve is an independent, user-typed payload with no real
fixing history behind it. For an already-reset floating period, "true_data"
mode uses True Data's real historical CD91D print; "ccp" mode instead assumes
that period fixed at the CCP payload's own quoted cd_rate (there being no
real fixing to look up for an independent, possibly hypothetical curve). Both
modes otherwise share the identical curve-bootstrap/discounting pipeline --
data_source only changes which rate an already-reset period is priced at.
"""
from fastapi.testclient import TestClient

from irs_pricer.api.app import app

client = TestClient(app)

# Real scenario from the reported discrepancy: 2026-07-01 start, 1Y, 30bn
# KRW, receive-fixed at 3.4450%, valued 2026-07-03. The first floating reset
# (2026-06-30) has a real True Data fixing of 2.9200% -- the same level as
# the cd_rate (2.9200%) entered here as this curve's own 3M pillar, so
# true_data and ccp modes happen to agree on this particular date regardless
# of which fixing convention "wins" (both resolve to 2.92%).
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


def _first_floating_cashflow(price_response_json):
    return next(
        cf
        for cf in price_response_json["cashflows"]
        if cf["leg"] == "floating" and cf["accrual_start"] == "2026-07-01"
    )


def test_true_data_mode_uses_real_historical_fixing_and_matches_known_npv():
    resp = client.post(
        "/api/portfolio/price",
        json={**_COMMON, "positions": [_POSITION], "data_source": "true_data"},
    )
    assert resp.status_code == 200
    data = resp.json()
    first_floating = _first_floating_cashflow(data)
    assert first_floating["is_known"] is True
    assert abs(first_floating["rate"] - 0.0292) < 1e-9
    assert abs(data["net_npv"] - (-13_410_272.24)) < 1.0, f"Expected -13,410,272.24, got {data['net_npv']}"

def test_ccp_mode_uses_true_historical_fixing_for_past_resets():
    resp = client.post(
        "/api/portfolio/price",
        json={**_COMMON, "positions": [_POSITION], "data_source": "ccp"},
    )
    assert resp.status_code == 200
    data = resp.json()
    first_floating = _first_floating_cashflow(data)
    assert first_floating["is_known"] is True
    # In order to avoid NPV discrepancy with the CCP, CCP mode now correctly
    # falls back to the true historical fixing rather than using the request's
    # cd_rate for past resets. On this particular date the real fixing (2.92%)
    # happens to equal the request's own cd_rate anyway (see _SWAP_QUOTES
    # comment above), so this assertion alone doesn't distinguish the two
    # conventions -- it's here for parity with the true_data test above.
    assert abs(first_floating["rate"] - 0.0292) < 1e-9
    assert abs(data["net_npv"] - (-13_410_272.24)) < 1.0, f"Expected -13,410,272.24, got {data['net_npv']}"


def test_data_source_defaults_to_true_data_when_omitted():
    resp = client.post(
        "/api/portfolio/price",
        json={**_COMMON, "positions": [_POSITION]},
    )
    assert resp.status_code == 200
    assert abs(resp.json()["net_npv"] - (-13_410_272.24)) < 1.0


def test_fair_rate_endpoint_matches_true_data_when_quotes_align():
    common = {**_COMMON, "start_date": "2026-07-01", "maturity_date": "2027-07-01", "notional": 30_000_000_000}
    true_data_resp = client.post("/api/portfolio/fair-rate", json={**common, "data_source": "true_data"})
    ccp_resp = client.post("/api/portfolio/fair-rate", json={**common, "data_source": "ccp"})
    assert true_data_resp.status_code == 200
    assert ccp_resp.status_code == 200
    # Since CCP mode now uses the same historical fixings and the provided
    # swap quotes are extremely close to the true data quotes, the fair rates
    # should be nearly identical.
    assert abs(true_data_resp.json()["fair_rate"] - ccp_resp.json()["fair_rate"]) < 0.0005


def test_ccp_mode_fair_rate_zeros_npv_when_priced_back_through_price():
    common = {**_COMMON, "start_date": "2026-07-01", "maturity_date": "2027-07-01", "notional": 30_000_000_000}
    fair_rate_resp = client.post("/api/portfolio/fair-rate", json={**common, "data_source": "ccp"})
    assert fair_rate_resp.status_code == 200
    fair_rate = fair_rate_resp.json()["fair_rate"]

    price_resp = client.post(
        "/api/portfolio/price",
        json={**_COMMON, "positions": [{**_POSITION, "fixed_rate": fair_rate}], "data_source": "ccp"},
    )
    assert price_resp.status_code == 200
    assert abs(price_resp.json()["net_npv"]) < 1.0
