"""add book and ticker to trade_specification

Revision ID: 9cccfde8b764
Revises: 643c317603c1
Create Date: 2026-07-10 10:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '9cccfde8b764'
down_revision: Union[str, Sequence[str], None] = '643c317603c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Nullable, no default: existing rows (and any trade booked before the
# UIUX_test migration wires these through, per MIGRATION_PLAN.md §0.4) are
# legitimately unlabeled rather than defaulting to a misleading placeholder
# book/ticker. Real desk columns, not display-only -- UIUX_test's Position
# type already carries book/ticker client-side; this is the migration that
# gives them a persisted home instead of deriving them client-side only.
def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("trade_specification", sa.Column("book", sa.String(length=32), nullable=True))
    op.add_column("trade_specification", sa.Column("ticker", sa.String(length=32), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("trade_specification", "ticker")
    op.drop_column("trade_specification", "book")
