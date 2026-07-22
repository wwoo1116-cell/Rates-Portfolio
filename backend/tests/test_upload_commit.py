"""Guard tests for upload_service's commit step — the part that overwrites the
live data files once all four uploads have parsed.

No workbook needed: _commit only moves bytes around, so these run anywhere.
The lock these describe is not hypothetical — Infomax holds its own exports
open, which is why the read side (loaders/total_data.py) already retries.
"""

import os
from pathlib import Path

import pytest

from irs_pricer.services import upload_service
from irs_pricer.services.upload_service import SLOT_FILENAMES, FileLockedError

FILES = {
    "irs_data": b"irs-new",
    "credit_matrix": b"credit-new",
    "bok_base_rate": b"bok-new",
    "portfolio": b"portfolio-new",
}
OLD = {key: f"{key}-old".encode() for key in FILES}


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    """A data dir standing in for the live one. Patched onto upload_service,
    not config: the module binds DATA_DIR at import."""
    monkeypatch.setattr(upload_service, "DATA_DIR", tmp_path)
    monkeypatch.setattr(upload_service.time, "sleep", lambda _s: None)  # don't pay the backoff
    return tmp_path


@pytest.fixture
def populated_data_dir(data_dir):
    for key, content in OLD.items():
        (data_dir / SLOT_FILENAMES[key]).write_bytes(content)
    return data_dir


def _fail_replace_onto(filename: str, times: int, monkeypatch):
    """Make os.replace() raise PermissionError for the first `times` attempts to
    land on `filename`, exactly as Windows does for a file held open elsewhere.
    Every other replace (including a rollback's) goes through untouched."""
    real_replace = os.replace
    remaining = {"n": times}

    def fake_replace(src, dst, **kwargs):
        if Path(dst).name == filename and remaining["n"] > 0:
            remaining["n"] -= 1
            raise PermissionError(5, "액세스가 거부되었습니다")
        return real_replace(src, dst, **kwargs)

    monkeypatch.setattr(os, "replace", fake_replace)


def _leftovers(data_dir: Path) -> list[str]:
    expected = set(SLOT_FILENAMES.values())
    return sorted(p.name for p in data_dir.iterdir() if p.name not in expected)


def test_commit_writes_every_file(populated_data_dir):
    upload_service._commit(FILES)

    for key, content in FILES.items():
        assert (populated_data_dir / SLOT_FILENAMES[key]).read_bytes() == content


def test_a_file_uploaded_onto_itself_is_never_touched(populated_data_dir):
    """The case that actually broke this page. Re-picking the live files is the
    normal way in, and the browser holds every file it uploads open for the
    length of the request -- so the request's own commit cannot rename over
    them. Leaving them alone is the fix; mtime must not even move, or the
    loaders re-parse 40MB for nothing."""
    unchanged = {key: OLD[key] for key in FILES}
    before = {key: (populated_data_dir / SLOT_FILENAMES[key]).stat().st_mtime_ns for key in FILES}

    upload_service._commit(unchanged)

    for key, content in OLD.items():
        dest = populated_data_dir / SLOT_FILENAMES[key]
        assert dest.read_bytes() == content
        assert dest.stat().st_mtime_ns == before[key], f"{key} was rewritten"
    assert _leftovers(populated_data_dir) == []


def test_an_unchanged_file_survives_a_lock_that_would_have_failed_the_upload(populated_data_dir, monkeypatch):
    """Nothing may even attempt a replace on a file that already matches --
    that attempt is exactly what the held-open browser file used to fail on."""
    _fail_replace_onto(SLOT_FILENAMES["irs_data"], times=99, monkeypatch=monkeypatch)

    # irs_data is byte-identical; the rest are genuinely new.
    upload_service._commit({**FILES, "irs_data": OLD["irs_data"]})

    assert (populated_data_dir / SLOT_FILENAMES["irs_data"]).read_bytes() == OLD["irs_data"]
    for key in ("credit_matrix", "bok_base_rate", "portfolio"):
        assert (populated_data_dir / SLOT_FILENAMES[key]).read_bytes() == FILES[key]


def test_a_same_size_but_different_file_is_still_written(populated_data_dir):
    """The skip is a byte comparison, not a size check -- an edited workbook
    that happens to match in size must not be mistaken for the same file."""
    same_size = {"irs_data": bytes(len(OLD["irs_data"]))}
    assert len(same_size["irs_data"]) == len(OLD["irs_data"])

    upload_service._commit(same_size)

    assert (populated_data_dir / SLOT_FILENAMES["irs_data"]).read_bytes() == same_size["irs_data"]


def test_commit_creates_files_in_an_empty_data_dir(data_dir):
    """Uploading is how a fresh checkout gets its data files at all."""
    upload_service._commit(FILES)

    for key, content in FILES.items():
        assert (data_dir / SLOT_FILENAMES[key]).read_bytes() == content


def test_commit_leaves_no_temp_or_backup_files_behind(populated_data_dir):
    upload_service._commit(FILES)

    assert _leftovers(populated_data_dir) == []


def test_commit_rides_out_a_transient_lock(populated_data_dir, monkeypatch):
    """The common case: something has the file open for a moment. Retrying is
    the whole point -- this must not surface to the user at all."""
    _fail_replace_onto(SLOT_FILENAMES["bok_base_rate"], times=upload_service._REPLACE_ATTEMPTS - 1, monkeypatch=monkeypatch)

    upload_service._commit(FILES)

    assert (populated_data_dir / SLOT_FILENAMES["bok_base_rate"]).read_bytes() == FILES["bok_base_rate"]
    assert _leftovers(populated_data_dir) == []


def test_a_held_lock_raises_against_the_file_it_is_about(populated_data_dir, monkeypatch):
    _fail_replace_onto(SLOT_FILENAMES["credit_matrix"], times=99, monkeypatch=monkeypatch)

    with pytest.raises(FileLockedError) as exc:
        upload_service._commit(FILES)

    # The slot is what lets process_upload report this on the right row rather
    # than smearing one message across all four.
    assert exc.value.slot == "credit_matrix"
    assert SLOT_FILENAMES["credit_matrix"] in str(exc.value)


def test_a_locked_file_rolls_back_the_ones_already_written(populated_data_dir, monkeypatch):
    """The reason any of this exists: the four files are priced against each
    other, so a half-applied upload is worse than a refused one."""
    _fail_replace_onto(SLOT_FILENAMES["bok_base_rate"], times=99, monkeypatch=monkeypatch)

    with pytest.raises(FileLockedError):
        upload_service._commit(FILES)

    for key, content in OLD.items():
        assert (populated_data_dir / SLOT_FILENAMES[key]).read_bytes() == content, f"{key} was not rolled back"
    assert _leftovers(populated_data_dir) == []


def test_rollback_deletes_files_that_had_no_previous_version(data_dir, monkeypatch):
    """Rolling back an upload into an empty data dir means removing what it
    wrote -- there is no older copy to put back."""
    _fail_replace_onto(SLOT_FILENAMES["bok_base_rate"], times=99, monkeypatch=monkeypatch)

    with pytest.raises(FileLockedError):
        upload_service._commit(FILES)

    assert sorted(p.name for p in data_dir.iterdir()) == []


def test_an_unbackupable_file_is_never_deleted_by_rollback(populated_data_dir, monkeypatch):
    """If the filesystem won't hard-link, that file loses rollback -- but it
    must not be mistaken for one this upload created and deleted outright."""
    monkeypatch.setattr(os, "link", lambda *a, **k: (_ for _ in ()).throw(OSError("no hard links here")))
    _fail_replace_onto(SLOT_FILENAMES["portfolio"], times=99, monkeypatch=monkeypatch)

    with pytest.raises(FileLockedError):
        upload_service._commit(FILES)

    for key in ("irs_data", "credit_matrix", "bok_base_rate"):
        assert (populated_data_dir / SLOT_FILENAMES[key]).exists(), f"{key} was deleted"


def test_process_upload_reports_a_lock_on_its_own_slot(data_dir, monkeypatch):
    """A lock is a commit failure, not a parse failure: it comes back as that
    one slot's error with the others still ready, and never as an exception --
    an escaping one becomes api/app.py's catch-all 500, which the upload page
    can only render across all four rows at once."""
    ready = {"status": "ready", "rows": 1, "min_date": None, "max_date": None}
    monkeypatch.setattr(
        upload_service, "_MARKET_DATA_VALIDATORS", {key: (lambda _d: dict(ready)) for key in upload_service._MARKET_DATA_VALIDATORS}
    )
    monkeypatch.setattr(upload_service.portfolio_loader, "parse", lambda _d: [{"position_id": "P1"}])
    monkeypatch.setattr(
        upload_service.portfolio_loader, "summary", lambda _d: {"positions": 1, "min_maturity": None, "max_maturity": None}
    )

    def locked(_file_bytes):
        raise FileLockedError("credit_matrix", SLOT_FILENAMES["credit_matrix"])

    monkeypatch.setattr(upload_service, "_commit", locked)

    success, results, positions = upload_service.process_upload(FILES)

    assert success is False
    assert results["credit_matrix"]["status"] == "error"
    assert SLOT_FILENAMES["credit_matrix"] in results["credit_matrix"]["message"]
    assert [results[k]["status"] for k in ("irs_data", "bok_base_rate", "portfolio")] == ["ready"] * 3
    assert positions == []
