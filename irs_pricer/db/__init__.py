"""
Database access layer: SQLAlchemy engine/session management (database.py),
ORM models mirroring the market_data / trade_specification / npv_pnl_trace /
tenor_pillar tables (models.py), and repositories that replace loaders/ as the
runtime data source once this layer is wired into services/.
"""
