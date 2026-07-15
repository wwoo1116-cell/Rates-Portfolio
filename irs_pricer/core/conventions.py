"""
Conventions shared by curve construction and pricing.
(QuantLib dependency removed)
"""

from __future__ import annotations

from datetime import date

# Placeholder constants for any external callers during migration
SPOT_DAYS = 1

def to_ql_date(d: date) -> date:
    # Dummy pass-through to keep api/services from failing on imports immediately
    return d

def from_ql_date(d: date) -> date:
    # Dummy pass-through
    return d
