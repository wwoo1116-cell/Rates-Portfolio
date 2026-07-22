"""Guard tests for config.DATA_DIR resolution.

No workbook needed — these run everywhere, including a fresh clone with no
Data/ folder, which is exactly the state they describe.
"""

from pathlib import Path

import pytest

from irs_pricer import config


def test_data_dir_defaults_to_sibling_of_repo():
    assert config.DEFAULT_DATA_DIR == config.REPO_ROOT.parent / "Data"


def test_require_data_dir_raises_for_missing_dir(tmp_path):
    missing = tmp_path / "no-such-data-dir"
    with pytest.raises(config.DataDirNotFoundError) as exc:
        config.require_data_dir(missing)

    message = str(exc.value)
    # Both halves matter: a wrong data dir otherwise renders as base_rate=None
    # on every chart point (loaders treat a missing file as legitimate), so the
    # error is the only thing that can tell someone what to look at and what
    # knob to turn.
    assert str(missing) in message
    assert "IRS_PRICER_DATA_DIR" in message


def test_require_data_dir_returns_existing_dir(tmp_path):
    assert config.require_data_dir(tmp_path) == tmp_path


def test_require_data_dir_rejects_a_file(tmp_path):
    """A path that exists but isn't a directory is still misconfiguration —
    is_dir(), not exists(). loaders/factory does its own exists() check on the
    source it's handed, and would route a stray file by filename."""
    a_file = tmp_path / "True Data.xlsx"
    a_file.write_bytes(b"")
    with pytest.raises(config.DataDirNotFoundError):
        config.require_data_dir(a_file)


def test_env_var_overrides_default(monkeypatch, tmp_path):
    monkeypatch.setenv("IRS_PRICER_DATA_DIR", str(tmp_path))
    assert config._resolve_data_dir() == Path(str(tmp_path))


def test_no_env_var_falls_back_to_default(monkeypatch):
    monkeypatch.delenv("IRS_PRICER_DATA_DIR", raising=False)
    assert config._resolve_data_dir() == config.DEFAULT_DATA_DIR
