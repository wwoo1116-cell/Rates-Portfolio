"""
Where this deployment's Excel data files live.

The workbooks sit OUTSIDE this repo -- in a `Data/` folder next to it, shared
with the frontend repo -- because they are data, not code, and they were
never really either while they lived at the repo root: upload_service commits
uploaded workbooks over the very files the loaders read, so every upload
dirtied the git working tree, and xlsx is already-compressed so git stores a
fresh full copy of a 41MB workbook on every change. Moving them out separates
the data's lifecycle from the code's.

IRS_PRICER_DATA_DIR, if set, overrides the default -- same escape hatch as
IRS_PRICER_DATABASE_URL in db/connection_settings.py, for a deployment whose
data doesn't sit next to a git checkout.

This module never touches the disk at import: resolving DATA_DIR is pure
computation. That matters because a fresh clone has no sibling Data/ yet, and
the way you populate one is the app's own upload page -- so the app has to be
able to boot without it. Call require_data_dir() at the point of use instead.
"""

from __future__ import annotations

import os
from pathlib import Path

# irs_pricer/config.py -> irs_pricer/ -> repo root
REPO_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_DATA_DIR = REPO_ROOT.parent / "Data"

_ENV_VAR = "IRS_PRICER_DATA_DIR"


class DataDirNotFoundError(RuntimeError):
    """The resolved data directory doesn't exist.

    Raised only from require_data_dir(). The message names both the path we
    looked in and the env var, because the alternative failure modes are
    genuinely hard to diagnose: base_rate/call_rate return None for a missing
    file *by design* (absence is a legitimate state), so a wrong directory
    otherwise renders as a silently blank chart rather than an error.
    """

    def __init__(self, path: Path) -> None:
        super().__init__(
            f"데이터 폴더를 찾을 수 없습니다: {path}\n"
            f"엑셀 데이터 파일이 있는 폴더를 {_ENV_VAR} 환경변수로 지정하거나, "
            f"업로드 화면에서 파일을 올리세요 (폴더가 자동으로 생성됩니다)."
        )


def _resolve_data_dir() -> Path:
    env_dir = os.environ.get(_ENV_VAR)
    if env_dir:
        return Path(env_dir).expanduser()
    return DEFAULT_DATA_DIR


DATA_DIR = _resolve_data_dir()


def require_data_dir(path: Path | None = None) -> Path:
    """The data directory, or DataDirNotFoundError if it isn't there.

    Call this before reaching for a data file in a code path where a missing
    directory means misconfiguration rather than "the user hasn't uploaded
    that optional workbook yet".
    """
    target = DATA_DIR if path is None else path
    if not target.is_dir():
        raise DataDirNotFoundError(target)
    return target
