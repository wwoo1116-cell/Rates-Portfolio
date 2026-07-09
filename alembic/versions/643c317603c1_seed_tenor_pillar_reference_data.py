"""seed tenor pillar reference data

Revision ID: 643c317603c1
Revises: 2018b1a1160f
Create Date: 2026-07-09 11:28:44.085841

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '643c317603c1'
down_revision: Union[str, Sequence[str], None] = '2018b1a1160f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Lightweight sa.table() rather than importing irs_pricer.db.models: data
# migrations should stay valid even if the ORM model changes shape later.
tenor_pillar = sa.table(
    "tenor_pillar",
    sa.column("tenor_unit", sa.String),
    sa.column("tenor_count", sa.Integer),
    sa.column("label", sa.String),
    sa.column("sort_order", sa.Integer),
    sa.column("is_standard_pillar", sa.Boolean),
)

# (tenor_unit, tenor_count, label, sort_order, is_standard_pillar).
# sort_order is a rough days-equivalent (D-unit counts as-is, M-unit * 30) so
# the whole reference table -- BOK/ON/CD/IRS mixed together -- sorts by real
# duration rather than needing separate per-instrument-type ordering.
# is_standard_pillar=True marks exactly the tenors in
# loaders/infomax_schema.py:IRS_TENORS (the True Data.xlsx bootstrapping
# mesh); 3M/1D/CD91D/BOK are real quotes but not part of that mesh (3M is
# CCP-grid-only today; 1D/CD91D/BOK are single-tenor deposit/policy rates,
# not IRS swap pillars).
_SEED_ROWS = [
    ("D", 0, "BOK", 0, False),      # BOK base rate sentinel -- no real tenor
    ("D", 1, "1D", 1, False),       # O/N (Call Rate)
    ("M", 3, "3M", 90, False),      # CCP-grid-only, not in True Data.xlsx mesh
    ("D", 91, "CD91D", 91, False),  # CD 91D deposit rate
    ("M", 6, "6M", 180, True),
    ("M", 9, "9M", 270, True),
    ("M", 12, "1Y", 360, True),
    ("M", 18, "1.5Y", 540, True),
    ("M", 24, "2Y", 720, True),
    ("M", 36, "3Y", 1080, True),
    ("M", 48, "4Y", 1440, True),
    ("M", 60, "5Y", 1800, True),
    ("M", 72, "6Y", 2160, True),
    ("M", 84, "7Y", 2520, True),
    ("M", 96, "8Y", 2880, True),
    ("M", 108, "9Y", 3240, True),
    ("M", 120, "10Y", 3600, True),
    ("M", 132, "11Y", 3960, True),
    ("M", 144, "12Y", 4320, True),
    ("M", 180, "15Y", 5400, True),
    ("M", 240, "20Y", 7200, True),
    ("M", 300, "25Y", 9000, True),
    ("M", 360, "30Y", 10800, True),
]


def upgrade() -> None:
    """Upgrade schema."""
    op.bulk_insert(
        tenor_pillar,
        [
            {
                "tenor_unit": unit,
                "tenor_count": count,
                "label": label,
                "sort_order": sort_order,
                "is_standard_pillar": is_standard,
            }
            for unit, count, label, sort_order, is_standard in _SEED_ROWS
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(tenor_pillar.delete())
