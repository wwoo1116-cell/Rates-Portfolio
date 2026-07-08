"""
FastAPI application: logging, middleware, and router registration.

Run with: uvicorn irs_pricer.api:app --reload --port 8000
"""

from __future__ import annotations

import logging
import logging.config

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

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ..core.errors import CurveBootstrapError
from .routers import calendar, historical_pnl, market_data, mtm, portfolio, pricing, rate_history, spread_backtest

app = FastAPI(title="IRS Pricer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(CurveBootstrapError)
async def curve_bootstrap_error_handler(request: Request, exc: CurveBootstrapError) -> JSONResponse:
    """Every endpoint routes through build_curve() at some point -- handling
    this centrally means a bad market rate (CCP curve typo, corrupt snapshot)
    comes back as one clean 400 everywhere, instead of a raw QuantLib
    RuntimeError as an opaque 500 with no actionable message for the caller."""
    return JSONResponse(status_code=400, content={"detail": str(exc)})

app.include_router(market_data.router)
app.include_router(pricing.router)
app.include_router(mtm.router)
app.include_router(portfolio.router)
app.include_router(historical_pnl.router)
app.include_router(calendar.router)
app.include_router(rate_history.router)
app.include_router(spread_backtest.router)
