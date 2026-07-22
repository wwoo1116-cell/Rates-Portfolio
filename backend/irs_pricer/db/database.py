"""
MySQL engine/session management.

The engine is built lazily from `connection_settings.get_database_url()` --
not at import time -- because this app can legitimately start with no
database configured yet (a fresh install before anyone has visited the
Settings page). `reconfigure()` disposes the old pool and rebuilds against
whatever was just saved, so a running backend picks up new connection
settings immediately without a restart. `pool_pre_ping` guards against
MySQL's `wait_timeout` silently dropping idle connections (the classic
"MySQL server has gone away" error under a long-lived worker process).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from . import connection_settings


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _build_engine() -> Engine:
    url = connection_settings.get_database_url()  # raises DatabaseNotConfiguredError if unset
    return create_engine(url, pool_pre_ping=True, pool_recycle=3600)


def _ensure_engine() -> tuple[Engine, sessionmaker[Session]]:
    global _engine, _SessionLocal
    if _engine is None or _SessionLocal is None:
        _engine = _build_engine()
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
    return _engine, _SessionLocal


def reconfigure() -> None:
    """Call right after connection_settings.save() so already-open connections
    to the old target are dropped and the next request uses the new one."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = _build_engine()
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: yields a session, always closed after the request.
    Raises DatabaseNotConfiguredError (-> HTTP 503, see api/app.py) if no
    connection has been configured yet."""
    _, session_factory = _ensure_engine()
    db = session_factory()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context-manager session for callers outside FastAPI's dependency
    injection -- market_data_service's DB-first/Excel-fallback logic, the ETL
    backfill script. Always closed; write paths commit explicitly (repository
    functions already do), so this never auto-commits on exit."""
    _, session_factory = _ensure_engine()
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
