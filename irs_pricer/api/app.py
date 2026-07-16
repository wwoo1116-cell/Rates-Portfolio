"""
FastAPI application: logging, middleware, and router registration.

Run with: uvicorn irs_pricer.api:app --reload --port 8000
"""

from __future__ import annotations

import logging
import logging.config
import os

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

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.base import BaseHTTPMiddleware

from ..core import ttl_cache
from ..core.errors import CurveBootstrapError
from ..db.connection_settings import DatabaseNotConfiguredError
from ..engine import curve_cache
from .routers import (
    bond_cashflows,
    calendar,
    credit_curve,
    db_settings,
    historical_pnl,
    market_data,
    mtm,
    npv_trace,
    portfolio,
    pricing,
    rate_history,
    simulate,
    spread_backtest,
    trades,
    upload,
    portfolio_analytics,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Memoises the pure curve bootstrap that every pricing/risk path funnels
    # through -- see engine/curve_cache.py for the measurements. Installed here
    # rather than at import so tests and scripts opt in explicitly and can A/B
    # against the unmemoised engine.
    #
    # s21: IRS_PRICER_CURVE_CACHE=0 skips installation -- the operational
    # escape hatch and the A/B mechanism for the byte-identity evidence. The
    # env is read per startup (not at import), so a TestClient context picks
    # up whatever the test just set. uninstall() rather than a bare skip: a
    # previous in-process startup may have left the wrapper bound.
    if os.environ.get(curve_cache.ENV_FLAG, "1") == "0":
        logging.getLogger("irs_pricer").warning(
            "curve_cache NOT installed (%s=0) -- engine runs unmemoized", curve_cache.ENV_FLAG
        )
        curve_cache.uninstall()
    else:
        curve_cache.install()
    yield


app = FastAPI(title="IRS Pricer API", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict:
    """Liveness plus cache counters.

    Doubles as the cheapest way to confirm the event loop is actually free: if
    this doesn't answer instantly while the dashboard is computing, something
    heavy is back on the loop again.
    """
    return {"status": "ok", "curve_cache": curve_cache.stats(), "ttl_cache": ttl_cache.stats()}

class _UnhandledErrorMiddleware(BaseHTTPMiddleware):
    """Last-resort net for exception types no registered handler covers.

    The handlers below cover the types we know about (CurveBootstrapError,
    SQLAlchemyError, RuntimeError...), but a KeyError/TypeError/IndexError, a
    numpy or scipy error, or any new domain exception still escapes to
    ServerErrorMiddleware and comes back as a bare 500 with no
    Access-Control-Allow-Origin -- the browser then blames CORS and
    api-client.ts reports "cannot reach the server" though the server answered.

    This has to be middleware rather than @app.exception_handler(Exception),
    for the exact reason the SQLAlchemyError handler documents: Starlette
    special-cases a handler keyed `Exception` (or 500) and hoists it into
    ServerErrorMiddleware, which sits *outside* CORSMiddleware. Middleware can
    sit inside it; that handler never can.

    ExceptionMiddleware sits inside this, so HTTPException and every registered
    handler still resolve normally -- only genuinely unhandled exceptions get
    here.
    """

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception as exc:  # noqa: BLE001 -- being the last net is the point
            logging.getLogger("irs_pricer").exception("Unhandled error")
            return JSONResponse(status_code=500, content={"detail": f"서버 오류: {exc}"})


# ORDER IS LOAD-BEARING, and reads backwards: add_middleware() does
# user_middleware.insert(0, ...) and build_middleware_stack() wraps the list in
# reverse, so the LAST middleware added ends up OUTERMOST (verified against the
# installed starlette 1.3.1). CORS must therefore be added last to stay outside
# the catch-all -- otherwise the catch-all's 500 goes out without CORS headers
# and re-creates the very bug it exists to prevent. tests/test_api_robustness.py
# asserts the header is actually present rather than trusting this reasoning.
app.add_middleware(_UnhandledErrorMiddleware)
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
app.include_router(upload.router)
app.include_router(portfolio_analytics.router)
app.include_router(credit_curve.router)
app.include_router(bond_cashflows.router)
app.include_router(simulate.router)
