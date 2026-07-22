import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Make irs_pricer importable regardless of the working directory alembic is
# invoked from (the project root, one level up from alembic/env.py).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from irs_pricer.db.connection_settings import get_database_url  # noqa: E402
from irs_pricer.db.models import Base  # noqa: E402  (registers all tables on Base.metadata)

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Same resolution the running app uses (IRS_PRICER_DATABASE_URL env var, else
# the connection settings saved via the frontend Settings page) rather than a
# separate hardcoded value in alembic.ini -- one source of truth for "where's
# the database", whether alembic or the app itself is asking.
# '%' -> '%%': configparser's default interpolation treats a bare '%' as the
# start of an interpolation token, which raises on a percent-encoded password
# (e.g. quote_plus('!') -> '%21') unless it's escaped first.
config.set_main_option("sqlalchemy.url", get_database_url().replace("%", "%%"))

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
