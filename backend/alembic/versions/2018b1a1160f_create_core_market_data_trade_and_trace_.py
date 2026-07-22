"""create core market data trade and trace tables

Revision ID: 2018b1a1160f
Revises:
Create Date: 2026-07-09 11:04:39.459347

"""
from typing import Sequence, Union

from alembic import op

from irs_pricer.db.models import Base

# revision identifiers, used by Alembic.
revision: str = '2018b1a1160f'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# This is revision zero: the schema doesn't exist anywhere yet, so there's
# nothing to diff against. Delegating straight to Base.metadata.create_all/
# drop_all (rather than hand-transcribing every column into op.create_table)
# means this migration can never drift from irs_pricer/db/models.py -- the
# single source of truth for the schema. Table creation order (tenor_pillar
# before market_data, trade_specification before npv_pnl_trace) is handled
# automatically via FK-dependency sort in Base.metadata.sorted_tables.
def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=False)


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=False)
