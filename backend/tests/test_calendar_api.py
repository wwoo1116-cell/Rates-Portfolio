from datetime import date

from fastapi.testclient import TestClient

from irs_pricer.api.app import app

client = TestClient(app)


def test_business_days_flags_new_years_day_holiday():
    # 2026-01-01 is a Thursday (not a weekend) but a KRX public holiday --
    # only the calendar (not a day-of-week check) can catch this.
    resp = client.get("/api/calendar/business-days", params={"start": "2025-12-30", "end": "2026-01-02"})
    assert resp.status_code == 200
    non_business = set(resp.json()["non_business_days"])
    assert "2026-01-01" in non_business


def test_business_days_flags_weekend():
    # 2026-01-03/04 is a Saturday/Sunday.
    resp = client.get("/api/calendar/business-days", params={"start": "2026-01-02", "end": "2026-01-05"})
    assert resp.status_code == 200
    non_business = set(resp.json()["non_business_days"])
    assert "2026-01-03" in non_business
    assert "2026-01-04" in non_business
    assert "2026-01-02" not in non_business  # ordinary Friday


def test_business_days_rejects_end_before_start():
    resp = client.get("/api/calendar/business-days", params={"start": "2026-01-05", "end": "2026-01-01"})
    assert resp.status_code == 400


def test_business_days_rejects_oversized_range():
    resp = client.get("/api/calendar/business-days", params={"start": "2020-01-01", "end": "2030-01-01"})
    assert resp.status_code == 400


def test_tenor_date_simple_case_no_adjustment_needed():
    resp = client.get("/api/calendar/tenor-date", params={"start_date": "2026-06-01", "months": 12})
    assert resp.status_code == 200
    assert resp.json()["maturity_date"] == "2027-06-01"


def test_tenor_date_applies_modified_following_when_naive_addition_hits_weekend():
    # start_date + 60 months (5Y) lands unadjusted on 2031-06-01, which is a
    # Sunday. Modified Following must roll it forward to the next business day.
    resp = client.get("/api/calendar/tenor-date", params={"start_date": "2026-06-01", "months": 60})
    assert resp.status_code == 200
    maturity = resp.json()["maturity_date"]
    assert maturity == "2031-06-02"
    assert maturity != "2031-06-01"  # would be wrong: the naive, unadjusted date


def test_tenor_date_rejects_non_business_day_start():
    # 2026-01-01 is a holiday; the picker should never produce this as a
    # start date, but the endpoint must still reject it defensively.
    resp = client.get("/api/calendar/tenor-date", params={"start_date": "2026-01-01", "months": 12})
    assert resp.status_code == 400


def test_tenor_date_rejects_non_positive_months():
    resp = client.get("/api/calendar/tenor-date", params={"start_date": "2026-06-01", "months": 0})
    assert resp.status_code == 422  # FastAPI query validation (months must be > 0)


def test_spot_date_is_one_business_day_after_valuation_date():
    # 2026-06-01 is a Monday -> spot date is the next business day, Tuesday 2026-06-02.
    resp = client.get("/api/calendar/spot-date", params={"valuation_date": "2026-06-01"})
    assert resp.status_code == 200
    assert resp.json()["spot_date"] == "2026-06-02"


def test_spot_date_skips_weekend():
    # 2026-01-02 is a Friday -> spot date must skip the weekend to Monday 2026-01-05.
    resp = client.get("/api/calendar/spot-date", params={"valuation_date": "2026-01-02"})
    assert resp.status_code == 200
    assert resp.json()["spot_date"] == "2026-01-05"


def test_spot_date_rejects_non_business_day_valuation_date():
    resp = client.get("/api/calendar/spot-date", params={"valuation_date": "2026-01-01"})
    assert resp.status_code == 400
