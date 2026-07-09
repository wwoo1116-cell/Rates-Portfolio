"""
MySQL connection settings: entered through the frontend Settings page
(POST /api/db-settings) rather than an environment variable, then applied to
the running backend immediately via database.reconfigure() -- no restart
needed. See irs_pricer/db/connection_settings.py for the persistence model
and why a plaintext local file is the right trust boundary for this app.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import create_engine, text

from ...db import database
from ...db.connection_settings import DbConnectionSettings, load, save
from ..models import DbConnectionIn, DbConnectionStatusOut, DbConnectionTestResult

router = APIRouter(prefix="/api/db-settings")


def _to_settings(request: DbConnectionIn) -> DbConnectionSettings:
    return DbConnectionSettings(
        host=request.host,
        port=request.port,
        user=request.user,
        password=request.password,
        database=request.database,
    )


def _try_connect(settings: DbConnectionSettings) -> str | None:
    """Attempt a real connection with a throwaway engine (never touches the
    live app engine). Returns None on success, else the driver's own error
    message -- surfaced as-is so the user can tell "wrong password" apart
    from "host unreachable" apart from "unknown database"."""
    engine = create_engine(settings.to_url(), pool_pre_ping=False)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return None
    except Exception as e:  # noqa: BLE001 -- surfacing the driver's own message to the user is the point
        return str(e)
    finally:
        engine.dispose()


@router.get("", response_model=DbConnectionStatusOut)
def get_status() -> DbConnectionStatusOut:
    settings = load()
    if settings is None:
        return DbConnectionStatusOut(configured=False)
    return DbConnectionStatusOut(
        configured=True,
        host=settings.host,
        port=settings.port,
        user=settings.user,
        database=settings.database,
    )


@router.post("/test", response_model=DbConnectionTestResult)
def test_connection(request: DbConnectionIn) -> DbConnectionTestResult:
    """Dry run -- never persists, never touches the live app engine."""
    error = _try_connect(_to_settings(request))
    if error:
        return DbConnectionTestResult(ok=False, message=error)
    return DbConnectionTestResult(ok=True, message="연결에 성공했습니다.")


@router.post("", response_model=DbConnectionStatusOut)
def save_connection(request: DbConnectionIn) -> DbConnectionStatusOut:
    settings = _to_settings(request)
    error = _try_connect(settings)
    if error:
        raise HTTPException(status_code=400, detail=error)
    save(settings)
    database.reconfigure()
    return DbConnectionStatusOut(
        configured=True,
        host=settings.host,
        port=settings.port,
        user=settings.user,
        database=settings.database,
    )
