"""
Standalone MySQL connection diagnostic -- SQLAlchemy only, no FastAPI import,
no uvicorn boot. Run this first whenever the app 502s/hangs and you suspect
the DB connection is the cause; it isolates "can Python reach MySQL at all"
from "is the FastAPI process even running."

Usage:
  python scripts/diagnose_db_connection.py                     # uses the app's
                                                                 # actual resolved
                                                                 # config (Settings
                                                                 # page file, or
                                                                 # IRS_PRICER_DATABASE_URL)
  python scripts/diagnose_db_connection.py --host 127.0.0.1 --port 3306 \
      --user bondman --password '<pw>' --database irs_pricer    # test a candidate
                                                                 # config directly,
                                                                 # without saving it
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

# Windows consoles often default to cp949/cp1252, not UTF-8 -- without this,
# printing the Korean error messages below (get_database_url()'s em-dash,
# etc.) crashes with UnicodeEncodeError instead of showing the diagnosis.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # project root, same as alembic/env.py

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.exc import OperationalError, SQLAlchemyError  # noqa: E402


def build_url_from_args(args) -> str:
    from urllib.parse import quote_plus

    return (
        f"mysql+pymysql://{quote_plus(args.user)}:{quote_plus(args.password)}"
        f"@{args.host}:{args.port}/{args.database}?charset=utf8mb4"
    )


def resolve_url(args) -> str:
    if args.host:
        return build_url_from_args(args)
    from irs_pricer.db.connection_settings import DatabaseNotConfiguredError, get_database_url

    try:
        return get_database_url()
    except DatabaseNotConfiguredError as e:
        print(f"[FAIL] {e}")
        print("       --host 등을 직접 넘겨서 후보 접속정보를 테스트하세요.")
        sys.exit(1)


def redact(url: str) -> str:
    # crude but sufficient: hide whatever sits between ':' and '@' in the userinfo section
    if "@" not in url or "://" not in url:
        return url
    scheme_and_user, rest = url.split("@", 1)
    scheme, userinfo = scheme_and_user.split("://", 1)
    user = userinfo.split(":", 1)[0]
    return f"{scheme}://{user}:***@{rest}"


def main() -> None:
    parser = argparse.ArgumentParser(description="MySQL connection diagnostic (SQLAlchemy only)")
    parser.add_argument("--host")
    parser.add_argument("--port", type=int, default=3306)
    parser.add_argument("--user")
    parser.add_argument("--password", default="")
    parser.add_argument("--database")
    parser.add_argument("--timeout", type=float, default=5.0, help="connect timeout in seconds (default 5)")
    args = parser.parse_args()

    if args.host and not (args.user and args.database):
        parser.error("--host를 쓰려면 --user와 --database도 함께 넘겨야 합니다.")

    url = resolve_url(args)
    print(f"대상: {redact(url)}")

    t0 = time.time()
    try:
        engine = create_engine(url, connect_args={"connect_timeout": args.timeout})
        with engine.connect() as conn:
            version = conn.execute(text("SELECT VERSION()")).scalar()
            db_name = conn.execute(text("SELECT DATABASE()")).scalar()
        elapsed = time.time() - t0
        print(f"[OK] 연결 성공 ({elapsed:.2f}s) -- MySQL {version}, 현재 DB: {db_name}")
    except OperationalError as e:
        elapsed = time.time() - t0
        print(f"[FAIL] OperationalError ({elapsed:.2f}s)")
        print(f"       {e.orig!r}")
        _hint(e.orig)
        sys.exit(1)
    except SQLAlchemyError as e:
        print(f"[FAIL] {type(e).__name__}: {e}")
        sys.exit(1)
    finally:
        try:
            engine.dispose()
        except NameError:
            pass


def _hint(orig: Exception) -> None:
    msg = str(orig)
    if "2003" in msg or "Can't connect" in msg:
        print("       -> 호스트/포트에 아예 도달하지 못함: MySQL 서비스가 떠 있는지, 방화벽/포트 확인.")
    elif "1045" in msg or "Access denied" in msg:
        print("       -> 계정/비밀번호 오류: bondman 계정의 비밀번호와 호스트 권한(예: 'bondman'@'localhost' vs '%') 확인.")
    elif "1049" in msg or "Unknown database" in msg:
        print("       -> irs_pricer DB가 실제로 존재하지 않음: `CREATE DATABASE irs_pricer;` 실행 여부 확인.")
    elif "2013" in msg or "Lost connection" in msg:
        print("       -> 연결 중 끊김: MySQL이 부팅 도중이거나 리소스 부족일 수 있음.")


if __name__ == "__main__":
    main()
