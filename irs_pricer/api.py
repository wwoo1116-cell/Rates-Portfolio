"""
HTTP API exposing the pricing engine to the web frontend. A thin translation
layer only: validates the request, builds a MarketSnapshot + VanillaSwap, and
returns price_swap/dv01 results. No pricing logic lives here.

Run with: uvicorn irs_pricer.api:app --reload --port 8000
"""

from __future__ import annotations

import logging
import logging.config
from datetime import date
from pathlib import Path
from typing import Literal

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"default": {"format": "%(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "default"}},
    "root": {"level": "INFO", "handlers": ["console"]},
    "loggers": {
        "irs_pricer": {"level": "DEBUG"},
    },
})

import QuantLib as ql
from dateutil.relativedelta import relativedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .csv_loader import NonBusinessDayError, load_fixing_history_csv, load_market_snapshot
from .csv_loader import common_dates as common_dates_csv
from .curve import build_curve
from .excel_loader import common_dates_xl, load_market_snapshot_xl
from .instruments import VanillaSwap
from .market_data import MarketSnapshot, RateQuote
from .mtm_valuation import value_booked_trade
from .pricing import price_swap
from .risk import dv01
from .xlsx_loader import common_dates_xlsx, load_market_snapshot_xlsx

# Keep in sync with irs_pricer.interpolation.VALID_INTERPOLATION_METHODS.
InterpolationMethod = Literal["flat", "linear", "cubic"]

DATA_DIR = Path(__file__).resolve().parent.parent

# Infomax export workbook (multi-sheet, one series per sheet) -- the canonical
# replacement for the CSV files. None if not present (falls through to CSV).
_EXCEL_PATH = DATA_DIR / "Total Data.xlsx"

# Historical CD91D fixings for MTM revaluation (resets already observed in the past).
_CD_FIXINGS_PATH = DATA_DIR / "CD_AAA_91D.csv"

app = FastAPI(title="IRS Pricer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory cache of the latest rates pushed by data_updater.py (xlwings poller).
# Keyed by valuation_date; takes priority over the static xlsx/csv files so the
# UI reflects intraday RTD updates without waiting for a file save.
_live_snapshots: dict[date, MarketSnapshot] = {}


def _load_snapshot(valuation_date: date) -> MarketSnapshot:
    if valuation_date in _live_snapshots:
        return _live_snapshots[valuation_date]
    try:
        return load_market_snapshot_xlsx(DATA_DIR, valuation_date)
    except NonBusinessDayError:
        raise
    except ValueError:
        pass
    if _EXCEL_PATH.exists():
        try:
            return load_market_snapshot_xl(_EXCEL_PATH, valuation_date)
        except NonBusinessDayError:
            raise
        except ValueError:
            pass
    # Final CSV fallback -- only reached for dates outside both xlsx files' coverage.
    # CD_AAA_91D.csv is not present, so this raises FileNotFoundError; convert it to
    # ValueError so the route handler returns HTTP 404 instead of HTTP 500.
    try:
        return load_market_snapshot(DATA_DIR, valuation_date)
    except NonBusinessDayError:
        raise
    except Exception:
        raise ValueError(f"{valuation_date}의 시장 데이터를 찾을 수 없습니다.")


def _all_dates() -> list[date]:
    try:
        dates = set(common_dates_xlsx(DATA_DIR))
    except ValueError:
        dates = set()
    if _EXCEL_PATH.exists():
        try:
            dates |= set(common_dates_xl(_EXCEL_PATH))
        except ValueError:
            pass
    try:
        dates |= set(common_dates_csv(DATA_DIR))
    except (ValueError, OSError):
        pass
    dates |= set(_live_snapshots.keys())
    if not dates:
        raise ValueError("사용 가능한 시장 데이터가 없습니다.")
    return sorted(dates)


class RateQuoteIn(BaseModel):
    tenor_years: int = Field(gt=0)
    rate: float


class SwapIn(BaseModel):
    tenor_years: int = Field(gt=0)
    notional: float = Field(gt=0)
    fixed_rate: float
    pay_fixed: bool = True


class PriceRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    swap_quotes: list[RateQuoteIn]
    swap: SwapIn
    interpolation_method: InterpolationMethod = "flat"


class PriceResponse(BaseModel):
    npv: float
    fixed_leg_pv: float
    float_leg_pv: float
    par_rate: float
    dv01: float
    interpolation_method: InterpolationMethod


class MtmSwapIn(BaseModel):
    trade_date: date
    tenor_years: int = Field(gt=0)
    notional: float = Field(gt=0)
    fixed_rate: float
    pay_fixed: bool = True
    float_spread: float = 0.0


class MtmRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    swap_quotes: list[RateQuoteIn]
    swap: MtmSwapIn
    interpolation_method: InterpolationMethod = "flat"


class CashFlowDetailOut(BaseModel):
    accrual_start: date
    accrual_end: date
    payment_date: date
    leg: str
    rate: float | None
    is_known: bool
    cashflow: float | None
    pv: float


class MtmResponse(BaseModel):
    clean_npv: float
    dirty_npv: float
    accrued_interest: float
    pv_fixed_leg: float
    pv_floating_leg: float
    telescoping_used: bool
    telescoping_diverged: bool
    cashflows: list[CashFlowDetailOut]
    interpolation_method: InterpolationMethod


class MarketDataResponse(BaseModel):
    valuation_date: date
    cd_rate: float
    swap_quotes: list[RateQuoteIn]


class CurveRequest(BaseModel):
    valuation_date: date
    cd_rate: float
    swap_quotes: list[RateQuoteIn]
    interpolation_method: InterpolationMethod = "flat"


class CurvePointOut(BaseModel):
    tenor_years: float
    zero_rate: float
    discount_factor: float
    is_knot: bool  # tenor carries a real market quote, vs. purely interpolated


class CurveResponse(BaseModel):
    valuation_date: date
    interpolation_method: InterpolationMethod
    points: list[CurvePointOut]


class DateRangeResponse(BaseModel):
    min_date: date
    max_date: date
    available_dates: list[date]


@app.get("/api/market-data/range", response_model=DateRangeResponse)
def market_data_range() -> DateRangeResponse:
    try:
        dates = _all_dates()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return DateRangeResponse(min_date=dates[0], max_date=dates[-1], available_dates=dates)


@app.get("/api/market-data/{valuation_date}", response_model=MarketDataResponse)
def market_data(valuation_date: date) -> MarketDataResponse:
    try:
        snapshot = _load_snapshot(valuation_date)
    except NonBusinessDayError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    return MarketDataResponse(
        valuation_date=snapshot.valuation_date,
        cd_rate=snapshot.cd_rate,
        swap_quotes=[RateQuoteIn(tenor_years=q.tenor_years, rate=q.rate) for q in snapshot.swap_quotes],
    )


_CURVE_SAMPLE_STEP_YEARS = 0.25
_CURVE_SAMPLE_MAX_YEARS = 10.0


@app.post("/api/curve", response_model=CurveResponse)
def curve_points(request: CurveRequest) -> CurveResponse:
    """Sample the bootstrapped curve's zero rate / discount factor across a
    tenor mesh, for the interpolation-method comparison page (/curve-comparison
    on the frontend). Reuses build_curve() -- no separate calculation engine.
    Tenors carrying a real market quote (the CD91 3M deposit plus each
    swap_quotes tenor) are marked is_knot=True, distinct from the
    purely-interpolated in-between mesh points."""
    snapshot = MarketSnapshot(
        valuation_date=request.valuation_date,
        cd_rate=request.cd_rate,
        swap_quotes=[RateQuote(q.tenor_years, q.rate) for q in request.swap_quotes],
    )
    curve = build_curve(snapshot, interpolation_method=request.interpolation_method)
    knot_years = {0.25} | {float(q.tenor_years) for q in request.swap_quotes}

    points = []
    steps = round(_CURVE_SAMPLE_MAX_YEARS / _CURVE_SAMPLE_STEP_YEARS)
    for i in range(1, steps + 1):
        t = round(i * _CURVE_SAMPLE_STEP_YEARS, 2)
        points.append(
            CurvePointOut(
                tenor_years=t,
                zero_rate=curve.yield_curve.zeroRate(t, ql.Continuous).rate(),
                discount_factor=curve.yield_curve.discount(t),
                is_knot=any(abs(t - k) < 1e-6 for k in knot_years),
            )
        )

    return CurveResponse(
        valuation_date=request.valuation_date,
        interpolation_method=request.interpolation_method,
        points=points,
    )


@app.post("/api/market-data/live", response_model=MarketDataResponse)
def update_live_market_data(request: MarketDataResponse) -> MarketDataResponse:
    """Called by data_updater.py (xlwings poller) to push intraday RTD rates."""
    _live_snapshots[request.valuation_date] = MarketSnapshot(
        valuation_date=request.valuation_date,
        cd_rate=request.cd_rate,
        swap_quotes=[RateQuote(q.tenor_years, q.rate) for q in request.swap_quotes],
    )
    return request


@app.post("/api/price", response_model=PriceResponse)
def price(request: PriceRequest) -> PriceResponse:
    snapshot = MarketSnapshot(
        valuation_date=request.valuation_date,
        cd_rate=request.cd_rate,
        swap_quotes=[RateQuote(q.tenor_years, q.rate) for q in request.swap_quotes],
    )
    curve = build_curve(snapshot, interpolation_method=request.interpolation_method)
    swap = VanillaSwap(
        tenor_years=request.swap.tenor_years,
        notional=request.swap.notional,
        fixed_rate=request.swap.fixed_rate,
        pay_fixed=request.swap.pay_fixed,
    )
    result = price_swap(swap, curve)
    return PriceResponse(**result, dv01=dv01(swap, curve), interpolation_method=request.interpolation_method)


@app.post("/api/mtm", response_model=MtmResponse)
def mtm(request: MtmRequest) -> MtmResponse:
    """Revalue a historically booked swap (trade_date <= valuation_date) and
    return clean/dirty NPV plus the remaining cash-flow breakdown."""
    snapshot = MarketSnapshot(
        valuation_date=request.valuation_date,
        cd_rate=request.cd_rate,
        swap_quotes=[RateQuote(q.tenor_years, q.rate) for q in request.swap_quotes],
    )
    curve = build_curve(snapshot, interpolation_method=request.interpolation_method)
    maturity_date = request.swap.trade_date + relativedelta(years=request.swap.tenor_years)
    swap = VanillaSwap(
        tenor_years=request.swap.tenor_years,
        notional=request.swap.notional,
        fixed_rate=request.swap.fixed_rate,
        pay_fixed=request.swap.pay_fixed,
        float_spread=request.swap.float_spread,
        trade_date=request.swap.trade_date,
        maturity_date=maturity_date,
    )

    try:
        fixings = load_fixing_history_csv(_CD_FIXINGS_PATH) if _CD_FIXINGS_PATH.exists() else {}
    except OSError:
        fixings = {}

    result = value_booked_trade(swap, curve, fixings)
    return MtmResponse(
        clean_npv=result.clean_npv,
        dirty_npv=result.dirty_npv,
        accrued_interest=result.accrued_interest,
        pv_fixed_leg=result.pv_fixed_leg,
        pv_floating_leg=result.pv_floating_leg,
        telescoping_used=result.telescoping_used,
        telescoping_diverged=result.telescoping_diverged,
        cashflows=[CashFlowDetailOut(**vars(c)) for c in result.cashflows],
        interpolation_method=request.interpolation_method,
    )
