"""
Two-tier (in-memory + on-disk) cache for parsed Excel/XLSX row data, shared
by xlsx_loader.py and excel_loader.py.

The on-disk layer exists specifically to survive `uvicorn --reload` worker
restarts during development: the in-memory layer is a module-global dict
that gets wiped every time the worker process restarts (e.g. on any .py
edit), but re-parsing a multi-thousand-row workbook from scratch costs
several seconds. Both layers are keyed by (absolute file path, file mtime),
so a stale cache from a previous version of the source file is never served
-- editing the underlying data file invalidates both layers automatically.
"""

from __future__ import annotations

import os
import pickle
import tempfile
from pathlib import Path
from typing import Callable, TypeVar

T = TypeVar("T")

_memory_cache: dict[Path, tuple[float, object]] = {}


def _disk_cache_path(source_path: Path) -> Path:
    return source_path.parent / ".cache" / f"{source_path.name}.rows.pkl"


def get_cached(source_path: Path, parse_fn: Callable[[Path], T]) -> T:
    """Return parse_fn(source_path)'s result, reusing a cached copy when possible.

    Lookup order: in-memory cache -> on-disk pickle cache -> parse_fn(source_path).
    parse_fn's return value must be picklable (e.g. a list of row tuples, or a
    dict of per-sheet date->value series).
    """
    mtime = source_path.stat().st_mtime

    cached = _memory_cache.get(source_path)
    if cached is not None and cached[0] == mtime:
        return cached[1]

    disk_path = _disk_cache_path(source_path)
    if disk_path.exists():
        try:
            with disk_path.open("rb") as f:
                disk_mtime, value = pickle.load(f)
            if disk_mtime == mtime:
                _memory_cache[source_path] = (mtime, value)
                return value
        except (pickle.PickleError, EOFError, OSError, ValueError):
            pass  # corrupt/unreadable disk cache -- fall through and reparse

    value = parse_fn(source_path)
    _memory_cache[source_path] = (mtime, value)
    _write_disk_cache(disk_path, mtime, value)
    return value


def _write_disk_cache(disk_path: Path, mtime: float, value: object) -> None:
    disk_path.parent.mkdir(parents=True, exist_ok=True)
    # Write to a temp file then atomically rename, so a concurrent reader
    # (FastAPI's sync routes run in a thread pool -- a cache-miss race
    # between two requests is possible) never sees a partially-written file.
    fd, tmp_name = tempfile.mkstemp(dir=disk_path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            pickle.dump((mtime, value), f)
        os.replace(tmp_name, disk_path)
    except OSError:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
