from fastapi.testclient import TestClient
from irs_pricer.api.app import app
from irs_pricer.engine.mtm_valuation import CashFlowDetail

client = TestClient(app)
_COMMON = {
    "valuation_date": "2026-07-03",
    "cd_rate": 0.0292,
}
_POSITION = {
    "position_id": "P1",
    "trade_date": "2026-07-01",
    "maturity_date": "2027-07-01",
    "tenor_years": 1,
    "notional": 30_000_000_000,
    "fixed_rate": 0.03445,
    "pay_fixed": False,
}
resp = client.post("/api/portfolio/price", json={**_COMMON, "positions": [_POSITION], "data_source": "true_data"})
data = resp.json()
print("NPV:", data["net_npv"])
floating = [c for c in data["cashflows"] if c["leg"] == "floating"]
print("First Floating Rate:", floating[0]["rate"])
