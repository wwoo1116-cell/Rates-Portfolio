"""index market_data by instrument_type for CD fixing history

Revision ID: a1c4e7f2b930
Revises: 9cccfde8b764
Create Date: 2026-07-15

repository.get_cd_fixing_history() selects the entire CD91D history with
`WHERE instrument_type = 'CD'` and nothing else. Every index on market_data
either doesn't mention instrument_type (idx_market_data_date,
idx_market_data_tenor) or leads with valuation_date (uq_market_data) -- and a
composite index only helps on a leftmost prefix -- so that query full-scanned
the table: ~64k rows today (4,000 dates x ~16 tenors), one more row per
instrument per business day forever.

It's called on every pricing/MTM path via market_data_service.load_fixings().
That's now TTL-cached, which bounds it to once a minute rather than once per
request, but a cache in front of a full scan is a workaround, not a fix -- the
first request after each expiry still pays it, and it gets slower every day the
table grows.

Verified with EXPLAIN on the real schema at production row counts:
    before: SCAN market_data
    after:  SEARCH market_data USING INDEX idx_market_data_type_date (instrument_type=?)

Additive and online-safe: creating an index takes no destructive action, and
the downgrade simply drops it.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1c4e7f2b930'
down_revision: Union[str, Sequence[str], None] = '9cccfde8b764'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        "idx_market_data_type_date",
        "market_data",
        ["instrument_type", "valuation_date"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("idx_market_data_type_date", table_name="market_data")
