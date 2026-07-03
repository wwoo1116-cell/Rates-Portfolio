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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import calendar, historical_pnl, market_data, mtm, portfolio, pricing

app = FastAPI(title="IRS Pricer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market_data.router)
app.include_router(pricing.router)
app.include_router(mtm.router)
app.include_router(portfolio.router)
app.include_router(historical_pnl.router)
app.include_router(calendar.router)
