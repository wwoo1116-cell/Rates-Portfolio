"""
ORM models for the market_data / trade_specification / npv_pnl_trace / tenor_pillar
tables, per the approved MySQL migration blueprint
(C:\\Users\\infomax\\.claude\\plans\\floating-roaming-biscuit.md).

Tenor is represented uniformly as (tenor_unit, tenor_count) -- QuantLib's own
Period(count, unit) shape -- rather than tenor_months-only (can't express O/N
or CD91D without lossy rounding) or a free-form string label (not sortable in
SQL, and duplicates the _quote_label() formatting bug already present in two
places in engine/curve.py and web/src/lib/tenorQuote.js).

No ON DELETE CASCADE anywhere by design: this is an auditable risk system
(PRODUCT.md -- "a quant can audit any number back to its inputs"), so deleting
a trade with any valuation history must be structurally impossible. The only
sanctioned "delete" path is TradeSpecification.status = CANCELLED.
"""

from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.mysql import BIGINT, DECIMAL, SMALLINT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class TenorUnit(str, enum.Enum):
    D = "D"  # days -- O/N (1), CD91D (91)
    M = "M"  # months -- every IRS pillar, including sub-annual (6, 9, 18)


class InstrumentType(str, enum.Enum):
    IRS = "IRS"
    CD = "CD"
    ON = "ON"
    BOK = "BOK"


class MarketDataSource(str, enum.Enum):
    TRUE_DATA = "TRUE_DATA"
    TOTAL_DATA = "TOTAL_DATA"
    CSV = "CSV"
    LIVE_FEED = "LIVE_FEED"
    CALL_RATE = "CALL_RATE"
    BOK_BASE = "BOK_BASE"


class TraceMarketDataSource(str, enum.Enum):
    """Narrower than MarketDataSource: only sources a curve/trade valuation can be built from."""

    TRUE_DATA = "TRUE_DATA"
    TOTAL_DATA = "TOTAL_DATA"
    CSV = "CSV"
    LIVE_FEED = "LIVE_FEED"


class TradeStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    CANCELLED = "CANCELLED"
    MATURED = "MATURED"


# Rate-scale fields (bid/ask/mid quotes, fixed_rate, float_spread): 3 integer
# digits + 7 fractional digits -- far finer than any real quote tick, and
# deliberately not DECIMAL(13,10) (that precision class is for discount
# factors, which aren't part of this schema -- see A.2 in the blueprint).
_RATE = DECIMAL(10, 7)
# Notional/NPV/PnL-scale fields: KRW notionals and valuation results.
_MONEY = DECIMAL(18, 4)
# tenor_count/tenor_months are always >= 0 (day/month counts); trade_id/id are
# surrogate keys -- both unsigned per the approved blueprint's exact column types.
_SMALLINT_UNSIGNED = SMALLINT(unsigned=True)
_BIGINT_UNSIGNED = BIGINT(unsigned=True)


class TenorPillar(Base):
    """Reference table: the single backend-owned canonical tenor list (blueprint A.1)."""

    __tablename__ = "tenor_pillar"

    tenor_unit: Mapped[TenorUnit] = mapped_column(SAEnum(TenorUnit), primary_key=True)
    tenor_count: Mapped[int] = mapped_column(_SMALLINT_UNSIGNED, primary_key=True)
    label: Mapped[str] = mapped_column(String(8), nullable=False, unique=True)
    sort_order: Mapped[int] = mapped_column(SMALLINT, nullable=False, index=True)
    is_standard_pillar: Mapped[bool] = mapped_column(nullable=False, default=True)

    __table_args__ = (
        CheckConstraint("tenor_count >= 0", name="chk_tenor_count_nonnegative"),
    )


class MarketData(Base):
    """Daily/per-tenor rate quote history (blueprint A.2). Replaces True/Total Data.xlsx + CSV + Call Rate + BOK Base Rate."""

    __tablename__ = "market_data"

    id: Mapped[int] = mapped_column(_BIGINT_UNSIGNED, primary_key=True, autoincrement=True)
    valuation_date: Mapped[date] = mapped_column(Date, nullable=False)
    instrument_type: Mapped[InstrumentType] = mapped_column(SAEnum(InstrumentType), nullable=False)
    tenor_unit: Mapped[TenorUnit] = mapped_column(SAEnum(TenorUnit), nullable=False)
    tenor_count: Mapped[int] = mapped_column(_SMALLINT_UNSIGNED, nullable=False)

    bid_rate: Mapped[Decimal | None] = mapped_column(_RATE, nullable=True)
    ask_rate: Mapped[Decimal | None] = mapped_column(_RATE, nullable=True)
    mid_rate: Mapped[Decimal] = mapped_column(_RATE, nullable=False)

    source: Mapped[MarketDataSource] = mapped_column(SAEnum(MarketDataSource), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "valuation_date", "instrument_type", "tenor_unit", "tenor_count", name="uq_market_data"
        ),
        Index("idx_market_data_date", "valuation_date"),
        Index("idx_market_data_tenor", "tenor_unit", "tenor_count"),
        ForeignKeyConstraint(
            ["tenor_unit", "tenor_count"],
            ["tenor_pillar.tenor_unit", "tenor_pillar.tenor_count"],
            name="fk_market_data_tenor_pillar",
            onupdate="CASCADE",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "bid_rate IS NULL OR ask_rate IS NULL OR (bid_rate <= mid_rate AND mid_rate <= ask_rate)",
            name="chk_bidask_bracket_mid",
        ),
    )


class TradeSpecification(Base):
    """Booked IRS trade (blueprint A.3). Replaces the browser-localStorage-only position store."""

    __tablename__ = "trade_specification"

    trade_id: Mapped[int] = mapped_column(_BIGINT_UNSIGNED, primary_key=True, autoincrement=True)
    external_position_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)

    trade_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    maturity_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Provenance only -- NULL when the trade was booked via explicit maturity_date
    # rather than trade_date+tenor. maturity_date (above) is always the
    # authoritative value every pricing/MTM call actually uses.
    tenor_months: Mapped[int | None] = mapped_column(_SMALLINT_UNSIGNED, nullable=True)

    notional: Mapped[Decimal] = mapped_column(_MONEY, nullable=False)
    fixed_rate: Mapped[Decimal] = mapped_column(_RATE, nullable=False)
    pay_fixed: Mapped[bool] = mapped_column(nullable=False)
    float_spread: Mapped[Decimal] = mapped_column(_RATE, nullable=False, default=Decimal("0"))
    # Hardcoded constant everywhere in the engine today (CD 91D) -- stored as a
    # real column anyway since it's nearly free, so a second index is a data
    # change rather than a schema migration if one is ever added.
    float_index: Mapped[str] = mapped_column(String(16), nullable=False, default="CD91D")

    status: Mapped[TradeStatus] = mapped_column(
        SAEnum(TradeStatus), nullable=False, default=TradeStatus.ACTIVE
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    traces: Mapped[list["NpvPnlTrace"]] = relationship(back_populates="trade")

    __table_args__ = (
        Index("idx_trade_status_maturity", "status", "maturity_date"),
        Index("idx_trade_trade_date", "trade_date"),
        CheckConstraint("pay_fixed IN (0,1)", name="chk_pay_fixed_domain"),
        CheckConstraint("notional > 0", name="chk_notional_positive"),
        CheckConstraint("fixed_rate > 0", name="chk_fixed_rate_positive"),
        CheckConstraint("maturity_date > start_date", name="chk_maturity_after_start"),
    )


class NpvPnlTrace(Base):
    """Daily revaluation result, keyed by (trade_id, valuation_date) (blueprint A.4).

    entry_npv, payer_npv/receiver_npv/active_position_ids, and skipped_dates are
    deliberately NOT columns here -- they're derived at query time (see D.1 in
    the blueprint) to avoid update anomalies / duplicated aggregation logic.
    """

    __tablename__ = "npv_pnl_trace"

    trade_id: Mapped[int] = mapped_column(_BIGINT_UNSIGNED, primary_key=True)
    valuation_date: Mapped[date] = mapped_column(Date, primary_key=True)

    clean_npv: Mapped[Decimal] = mapped_column(_MONEY, nullable=False)
    dirty_npv: Mapped[Decimal] = mapped_column(_MONEY, nullable=False)
    daily_pnl: Mapped[Decimal | None] = mapped_column(_MONEY, nullable=True)
    cumulative_pnl: Mapped[Decimal] = mapped_column(_MONEY, nullable=False)

    market_data_source: Mapped[TraceMarketDataSource | None] = mapped_column(
        SAEnum(TraceMarketDataSource), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    trade: Mapped["TradeSpecification"] = relationship(back_populates="traces")

    __table_args__ = (
        Index("idx_trace_date_trade", "valuation_date", "trade_id"),
        ForeignKeyConstraint(
            ["trade_id"],
            ["trade_specification.trade_id"],
            name="fk_trace_trade",
            onupdate="RESTRICT",
            ondelete="RESTRICT",
        ),
    )
