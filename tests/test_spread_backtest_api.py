"""Regression tests for GET /api/spread-backtest's request validation.

z-threshold ordering is checked before the backtest ever runs (entry_z <=
exit_z, or stop_z <= entry_z, is a logical contradiction -- a position would
immediately exit or immediately stop out the instant it's entered), so these
tests don't need real market data to reach the 400s.
"""
from fastapi.testclient import TestClient

from irs_pricer.api.app import app

client = TestClient(app)

_BASE_PARAMS = {"start": "2023-01-01", "end": "2023-06-01", "short": "1Y", "long": "3Y"}


def test_entry_z_not_greater_than_exit_z_is_rejected():
    resp = client.get("/api/spread-backtest", params={**_BASE_PARAMS, "entry_z": 1.0, "exit_z": 2.0, "stop_z": 3.0})
    assert resp.status_code == 400
    assert "entry_z" in resp.json()["detail"]


def test_stop_z_not_greater_than_entry_z_is_rejected():
    resp = client.get("/api/spread-backtest", params={**_BASE_PARAMS, "entry_z": 3.0, "exit_z": 0.5, "stop_z": 2.0})
    assert resp.status_code == 400
    assert "stop_z" in resp.json()["detail"]


def test_valid_threshold_ordering_is_accepted():
    resp = client.get("/api/spread-backtest", params={**_BASE_PARAMS, "entry_z": 2.0, "exit_z": 0.5, "stop_z": 3.5})
    assert resp.status_code == 200
    body = resp.json()
    assert body["short"] == "1Y"
    assert body["long"] == "3Y"
    assert "points" in body and "trades" in body and "summary" in body
