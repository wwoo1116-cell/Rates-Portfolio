"""
Two-tier (in-memory + on-disk) cache for parsed Excel/XLSX row data, shared
by true_data.py and total_data.py.

The on-disk layer exists specifically to survive `uvicorn --reload` worker
restarts during development: the in-memory layer is a module-global dict
that gets wiped every time the worker process restarts (e.g. on any .py
edit), but re-parsing a multi-thousand-row workbook from scratch costs
several seconds. Both layers are keyed by (absolute file path, file mtime),
so a stale cache from a previous version of the source file is never served
-- editing the underlying data file invalidates both layers automatically.
"""

from __future__ import annotations

import logging
import os
import pickle
import tempfile
from pathlib import Path
from typing import Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

_memory_cache: dict[tuple[Path, str], tuple[float, object]] = {}


def _disk_cache_path(source_path: Path, cache_key_suffix: str = "") -> Path:
    suffix = f".{cache_key_suffix}" if cache_key_suffix else ""
    return source_path.parent / ".cache" / f"{source_path.name}{suffix}.rows.pkl"


def get_cached(source_path: Path, parse_fn: Callable[[Path], T], cache_key_suffix: str = "") -> T:
    """Return parse_fn(source_path)'s result, reusing a cached copy when possible.

    Lookup order: in-memory cache -> on-disk pickle cache -> parse_fn(source_path).
    parse_fn's return value must be picklable (e.g. a list of row tuples, or a
    dict of per-sheet date->value series).

    `cache_key_suffix` distinguishes multiple differently-shaped cached views of
    the same source file (e.g. a raw row list vs. a date-indexed dict) so they
    don't collide under the same in-memory/disk cache key. Defaults to "" for
    the original single-view-per-file behavior.
    """
    mtime = source_path.stat().st_mtime
    cache_key = (source_path, cache_key_suffix)

    cached = _memory_cache.get(cache_key)
    if cached is not None and cached[0] == mtime:
        logger.debug("memory cache hit: %s", source_path.name)
        return cached[1]

    disk_path = _disk_cache_path(source_path, cache_key_suffix)
    if disk_path.exists():
        try:
            with disk_path.open("rb") as f:
                disk_mtime, value = pickle.load(f)
            if disk_mtime == mtime:
                logger.debug("disk cache hit: %s", source_path.name)
                _memory_cache[cache_key] = (mtime, value)
                return value
            logger.debug("disk cache stale (mtime mismatch): %s", source_path.name)
        except Exception as exc:
            logger.warning("disk cache unreadable (%s), will reparse: %s", exc, source_path.name)

    logger.info("parsing %s (no valid cache)…", source_path.name)
    value = parse_fn(source_path)
    logger.info("parsed %s successfully", source_path.name)
    _memory_cache[cache_key] = (mtime, value)
    _write_disk_cache(disk_path, mtime, value)
    return value


def _write_disk_cache(disk_path: Path, mtime: float, value: object) -> None:
    """Write value to disk cache atomically. All failures are logged and swallowed --
    a disk write failure is non-fatal because the in-memory cache is still valid."""
    fd: int | None = None
    tmp_name: str | None = None
    try:
        disk_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=disk_path.parent, suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            fd = None  # fdopen took ownership; do not double-close on error
            pickle.dump((mtime, value), f)
        # Atomic replace: concurrent readers never see a partial file.
        # On Windows this can raise PermissionError if another process has the
        # destination open; we catch it below and fall back to in-memory only.
        os.replace(tmp_name, disk_path)
        tmp_name = None  # replace succeeded; nothing left to clean up
        logger.debug("disk cache written: %s", disk_path.name)
    except Exception as exc:
        logger.warning("disk cache write failed (%s): %s — using in-memory cache only", type(exc).__name__, exc)
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        if tmp_name is not None:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
