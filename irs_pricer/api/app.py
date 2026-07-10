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
from sqlalchemy.exc import SQLAlchemyError

from ..core.errors import CurveBootstrapError
from ..db.connection_settings import DatabaseNotConfiguredError
from .routers import (
    calendar,
    db_settings,
    historical_pnl,
    market_data,
    mtm,
    npv_trace,
    portfolio,
    pricing,
    rate_history,
    spread_backtest,
    trades,
)

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


@app.exception_handler(DatabaseNotConfiguredError)
async def database_not_configured_handler(
    request: Request, exc: DatabaseNotConfiguredError
) -> JSONResponse:
    """DB-backed endpoints hit before anyone has visited the Settings page
    come back as a clean 503 with a Korean message pointing at /settings,
    rather than a raw connection/import error."""
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_error_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    """Any DB-layer error not already caught locally as an IntegrityError
    (missing table, connection drop, bad SQL) -- without this, it propagates
    as an unhandled exception past CORSMiddleware to Starlette's outer
    ServerErrorMiddleware, which returns a bare 500 with no
    Access-Control-Allow-Origin header. The browser then reports a
    misleading "CORS policy" failure instead of the real error, and
    api-client.ts's fetch catch block shows "cannot reach the server" even
    though the server responded fine.

    NOTE: registering this for `SQLAlchemyError` specifically -- NOT the bare
    `Exception` -- matters here. Starlette's build_middleware_stack()
    special-cases a handler registered for `Exception` (or status code 500):
    it's pulled out and used as ServerErrorMiddleware's handler, which sits
    *outside* CORSMiddleware, so that response would never get CORS headers
    either. A handler for a specific subclass like `SQLAlchemyError` instead
    goes through the normal ExceptionMiddleware, which is inside CORSMiddleware.

    Logged here explicitly since registering any exception_handler for this
    exception type suppresses Starlette's own default traceback-to-console
    behavior for it."""
    logging.getLogger("irs_pricer").exception("Unhandled database error")
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.exception_handler(RuntimeError)
async def runtime_error_handler(request: Request, exc: RuntimeError) -> JSONResponse:
    """Catch unhandled RuntimeErrors (typically propagated from QuantLib) before
    they escape as bare 500s without CORS headers.

    QuantLib raises std::exception wrappers as Python RuntimeErrors for a wide
    range of calculation failures that aren't caught and re-raised as
    CurveBootstrapError (e.g. schedule errors, maturity-before-valuation-date,
    singular matrices). Without this handler they propagate past CORSMiddleware
    and the browser sees a CORS policy failure instead of the real error,
    causing api.js's fetch catch block to show 'cannot connect to backend'
    even though the server responded (same phenomenon as SQLAlchemyError above).

    NOTE: Same caveat as SQLAlchemyError -- this MUST be a specific subclass,
    never bare `Exception`, or Starlette pulls it out of ExceptionMiddleware and
    puts it in ServerErrorMiddleware *outside* CORSMiddleware."""
    logging.getLogger("irs_pricer").exception("Unhandled QuantLib/runtime error")
    return JSONResponse(status_code=500, content={"detail": f"계산 오류: {exc}"})

app.include_router(market_data.router)
app.include_router(pricing.router)
app.include_router(mtm.router)
app.include_router(portfolio.router)
app.include_router(historical_pnl.router)
app.include_router(calendar.router)
app.include_router(rate_history.router)
app.include_router(spread_backtest.router)
app.include_router(npv_trace.router)
app.include_router(db_settings.router)
app.include_router(trades.router)
