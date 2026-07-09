"""
Persisted MySQL connection settings, entered through the frontend Settings
page rather than an environment variable.

This is a single-user desk tool with no deploy pipeline and no auth system at
all today (see PRODUCT.md) -- "type host/user/password into a web form" is
the realistic operating model here, not a .env file someone has to remember
to create. The settings file therefore lives outside git (see .gitignore)
next to the project root, the same trust boundary the rest of the app
already operates in.

IRS_PRICER_DATABASE_URL, if set, always overrides the saved file -- this
keeps a real secrets-manager-backed deployment possible later without
touching this module.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import quote_plus

_SETTINGS_PATH = Path(__file__).resolve().parent.parent.parent / ".db_connection.json"


class DatabaseNotConfiguredError(RuntimeError):
    """No connection settings saved yet and IRS_PRICER_DATABASE_URL isn't set either."""

    def __init__(self) -> None:
        super().__init__(
            "데이터베이스 연결 정보가 아직 설정되지 않았습니다 — 설정 화면에서 MySQL 접속 정보를 입력하세요."
        )


@dataclass
class DbConnectionSettings:
    host: str
    port: int
    user: str
    password: str
    database: str

    def to_url(self) -> str:
        # quote_plus escapes characters like '!' or '@' that would otherwise
        # break the userinfo section of the connection URL.
        user = quote_plus(self.user)
        password = quote_plus(self.password)
        return f"mysql+pymysql://{user}:{password}@{self.host}:{self.port}/{self.database}?charset=utf8mb4"


def load() -> DbConnectionSettings | None:
    if not _SETTINGS_PATH.exists():
        return None
    data = json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
    return DbConnectionSettings(**data)


def save(settings: DbConnectionSettings) -> None:
    _SETTINGS_PATH.write_text(json.dumps(asdict(settings), indent=2), encoding="utf-8")


def get_database_url() -> str:
    """Resolve the active connection URL: env var override, else the saved
    settings file. Raises DatabaseNotConfiguredError if neither is present."""
    env_url = os.environ.get("IRS_PRICER_DATABASE_URL")
    if env_url:
        return env_url
    settings = load()
    if settings is None:
        raise DatabaseNotConfiguredError()
    return settings.to_url()
