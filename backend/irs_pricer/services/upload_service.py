"""
Upload orchestration: validate the four mandatory market-data/portfolio
Excel files via their loaders, and only commit (overwrite the live market-
data files) if every one of them parses successfully -- never leaves the
data directory partially updated.

Positions parsed from the portfolio file are NOT booked to a database --
this deployment doesn't use one (see manual-positions-store.ts on the
frontend, which is the actual live, browser-only position store). They're
returned to the caller instead, for the frontend to load into that store.

Route handlers call this; no loader/path logic lives in api/ (same
convention as market_data_service).
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
from pathlib import Path

from ..config import DATA_DIR
from ..loaders import base_rate
from ..loaders import credit_matrix as credit_matrix_loader
from ..loaders import portfolio as portfolio_loader
from ..loaders import true_data

logger = logging.getLogger(__name__)

SLOT_FILENAMES = {
    "irs_data": true_data.XLSX_NAME,
    "credit_matrix": credit_matrix_loader.XLSX_NAME,
    "bok_base_rate": base_rate.XLSX_NAME,
    "portfolio": portfolio_loader.XLSX_NAME,
}

# Windows refuses to rename over a file another process holds open, and holding
# these very files open is Infomax's normal behaviour -- loaders/total_data.py
# carries the mirror-image retry on the read side ("Infomax keeps it open").
# An antivirus scanner reading the temp file we just wrote blocks the rename
# the same way. Both clear on their own within moments, so back off and retry.
_REPLACE_ATTEMPTS = 3
_REPLACE_BACKOFF_S = 0.3


class FileLockedError(Exception):
    """A live data file could not be replaced because something else holds it
    open. `slot` is its SLOT_FILENAMES key, so the caller can report the error
    against the one file it's actually about instead of blaming all four."""

    def __init__(self, slot: str, filename: str):
        self.slot = slot
        self.filename = filename
        # Don't name a culprit. The obvious guess (Excel, Infomax) is often
        # wrong -- the browser holds every file it is uploading open for the
        # length of the request, and _is_unchanged covers that case precisely
        # so that anything reaching this message is a genuine outside holder.
        super().__init__(
            f"{filename}을(를) 다른 프로그램이 사용 중이라 교체할 수 없습니다. "
            f"이 파일을 열어둔 프로그램을 닫고 다시 시도해 주세요."
        )


def _validate_true_data(tmp_dir: Path) -> dict:
    dates = true_data.common_dates_xlsx(tmp_dir)
    return {"status": "ready", "rows": len(dates), "min_date": dates[0], "max_date": dates[-1]}


def _validate_credit_matrix(tmp_dir: Path) -> dict:
    s = credit_matrix_loader.summary(tmp_dir)
    return {"status": "ready", "rows": s["rows"], "min_date": s["min_date"], "max_date": s["max_date"]}


def _validate_base_rate(tmp_dir: Path) -> dict:
    rates = base_rate.all_rates(tmp_dir)
    if not rates:
        raise ValueError(f"{base_rate.XLSX_NAME}에서 날짜 데이터를 찾을 수 없습니다.")
    dates = sorted(rates)
    return {"status": "ready", "rows": len(dates), "min_date": dates[0], "max_date": dates[-1]}


_MARKET_DATA_VALIDATORS = {
    "irs_data": _validate_true_data,
    "credit_matrix": _validate_credit_matrix,
    "bok_base_rate": _validate_base_rate,
}


def _unlink_quietly(path: str | Path) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _is_unchanged(dest: Path, data: bytes) -> bool:
    """True when `data` is already, byte for byte, what sits at `dest`.

    Re-picking the live files is the normal path through this page, not an
    oddity: the dashboard is gated behind an upload, so every session starts
    with the file dialog, and the Data folder is the obvious place to pick four
    files named exactly these four things from.

    Skipping those is worth it on its own -- rewriting 40MB of Credit Matrix
    with its own contents only burns the loaders' (path, mtime) caches and buys
    a full re-parse. But it is also the only way the upload can succeed at all,
    because the browser holds every file it is uploading open until the response
    comes back, and Windows will not rename over a file the in-flight request
    is itself still holding. No amount of retrying wins that: the lock belongs
    to the request doing the retrying. Not replacing it is the whole fix.
    """
    try:
        if dest.stat().st_size != len(data):
            return False
        with dest.open("rb") as f:
            return f.read() == data
    except OSError:
        return False  # unreadable: let the replace path deal with it


def _replace_with_retry(src: str | Path, dest: str | Path) -> None:
    """os.replace(), retried past a transient lock (see _REPLACE_ATTEMPTS)."""
    for attempt in range(_REPLACE_ATTEMPTS):
        try:
            os.replace(src, dest)
            return
        except PermissionError:
            if attempt == _REPLACE_ATTEMPTS - 1:
                raise
            time.sleep(_REPLACE_BACKOFF_S * (attempt + 1))


def _link_backup(dest: Path) -> Path | None:
    """Hard-link `dest` to a sibling .bak so a later rollback can put the
    pre-upload file back. A link, not a copy: it costs a directory entry rather
    than re-writing 40MB of Credit Matrix, and os.replace() onto `dest`
    afterwards only swaps `dest`'s entry, leaving the link on the old content.

    Returns None if the filesystem won't hard-link (never NTFS; a network share
    or FAT volume would, and IRS_PRICER_DATA_DIR can point anywhere) -- callers
    treat that as "no rollback available for this file", which is what the code
    did unconditionally before.
    """
    backup = dest.with_name(dest.name + ".bak")
    _unlink_quietly(backup)  # a leftover from a commit that died mid-flight
    try:
        os.link(dest, backup)
        return backup
    except OSError as exc:
        logger.warning("could not hard-link a backup of %s (%s) -- rollback unavailable", dest.name, exc)
        return None


def _rollback(backups: list[tuple[Path, Path]], orphans: list[Path]) -> None:
    """Undo a partial commit: restore every backed-up file, and delete the ones
    that had no pre-upload version to restore. Best-effort -- if a restore
    itself fails there is nothing further to try, so say so loudly, because that
    is the one path that can leave the data directory inconsistent."""
    for dest, backup in backups:
        try:
            os.replace(backup, dest)
        except OSError:
            logger.exception("could not restore %s -- its previous contents are at %s", dest.name, backup)
    for dest in orphans:
        _unlink_quietly(dest)


def _commit(file_bytes: dict[str, bytes]) -> None:
    """Bring every live data file up to date, or leave all of them as they were.

    A file whose bytes already match the upload is left completely alone -- see
    _is_unchanged, which is what makes re-picking the live files (the normal way
    through this page) work at all.

    The rest land by the same write-temp-then-os.replace() dance as before (as
    in loaders/cache.py): the live path always holds a complete file and is
    never momentarily absent, which matters because the loaders treat a missing
    workbook as legitimate and would quietly serve base_rate=None to a request
    that raced the commit rather than fail.

    Those replaces are undone as a group if any of them fails: pricing the
    portfolio against half-updated market data would silently produce wrong
    P&L, and a file being held open is a routine thing to walk into here.
    """
    # Uploading is how a fresh checkout gets a data directory in the first
    # place -- nothing else creates it, and mkstemp() below won't. Note
    # os.replace() is only atomic within one filesystem, so IRS_PRICER_DATA_DIR
    # pointing at another drive or a network share breaks that guarantee.
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    staged: list[tuple[str, str, Path]] = []  # (slot, temp path, live path)
    backups: list[tuple[Path, Path]] = []  # (live path, its .bak hard link)
    orphans: list[Path] = []  # live paths with no pre-upload version behind them
    committed = False
    try:
        for key, data in file_bytes.items():
            dest = DATA_DIR / SLOT_FILENAMES[key]
            if _is_unchanged(dest, data):
                logger.info("%s already holds these exact bytes -- not rewriting it", dest.name)
                continue
            fd, tmp_name = tempfile.mkstemp(dir=DATA_DIR, suffix=".tmp")
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            staged.append((key, tmp_name, dest))

        for key, tmp_name, dest in staged:
            existed = dest.exists()
            backup = _link_backup(dest) if existed else None
            try:
                _replace_with_retry(tmp_name, dest)
            except PermissionError as exc:
                if backup is not None:
                    _unlink_quietly(backup)  # dest untouched; nothing to roll back for it
                raise FileLockedError(key, dest.name) from exc
            if backup is not None:
                backups.append((dest, backup))
            elif not existed:
                # Nothing here before this upload, so undoing means deleting it.
                # A file that did exist but couldn't be linked stays out of both
                # lists: it can't be restored, and it must not be deleted either.
                orphans.append(dest)

        committed = True
    finally:
        if not committed:
            _rollback(backups, orphans)
        else:
            for _dest, backup in backups:
                _unlink_quietly(backup)
        for _key, tmp_name, _dest in staged:
            _unlink_quietly(tmp_name)  # a no-op for any that got renamed into place


def process_upload(file_bytes: dict[str, bytes]) -> tuple[bool, dict[str, dict], list[dict]]:
    """file_bytes: {"irs_data": ..., "credit_matrix": ..., "bok_base_rate": ..., "portfolio": ...}
    (raw uploaded bytes, keyed the same as SLOT_FILENAMES).

    Returns (success, {slot: {status, message?, rows?, min_date?, max_date?}}, positions).
    `positions` is the parsed PortfolioPositionIn-shaped list, non-empty only
    on success -- the caller (frontend) owns loading these into its own
    client-side position store, there's no server-side persistence here.
    Commits nothing to disk unless every slot validates."""
    with tempfile.TemporaryDirectory(prefix="irs_upload_") as tmp:
        tmp_dir = Path(tmp)
        for key, data in file_bytes.items():
            (tmp_dir / SLOT_FILENAMES[key]).write_bytes(data)

        results: dict[str, dict] = {}
        for key, validator in _MARKET_DATA_VALIDATORS.items():
            try:
                results[key] = validator(tmp_dir)
            except Exception as exc:
                logger.warning("upload validation failed for %s: %s", key, exc)
                results[key] = {"status": "error", "message": str(exc)}

        parsed_positions: list[dict] = []
        try:
            parsed_positions = portfolio_loader.parse(tmp_dir)
            p_summary = portfolio_loader.summary(tmp_dir)
            results["portfolio"] = {
                "status": "ready",
                "rows": p_summary["positions"],
                "min_date": p_summary["min_maturity"],
                "max_date": p_summary["max_maturity"],
            }
        except Exception as exc:
            logger.warning("upload validation failed for portfolio: %s", exc)
            results["portfolio"] = {"status": "error", "message": str(exc)}

    if not all(r["status"] == "ready" for r in results.values()):
        return False, results, []

    try:
        _commit(file_bytes)
    except FileLockedError as exc:
        # The file parsed fine; it just couldn't be written. Reported as that
        # slot's error rather than raised, so it renders on the row the user
        # has to act on -- an escaping exception becomes the catch-all 500 in
        # api/app.py, which the upload page can only smear across all four rows.
        logger.warning("upload commit failed: %s", exc)
        results[exc.slot] = {"status": "error", "message": str(exc)}
        return False, results, []

    return True, results, parsed_positions
