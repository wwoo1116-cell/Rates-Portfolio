"""s15/s18 funding constants.

R3B-PLUS T2a (owner ruling, 2026-07-20): the definitions (with their full
s15/s18 provenance docstring) moved to ..funding_basis — the SIM2-7 module
already sitting outside both families, and the natural single shared source
now that portfolio_analytics_service also needs them for a historical as-of
date (see funding_basis.py's own docstring: "the flat POLICY_BASE_RATE_KRW +
FUNDING_SPREAD_BP constant is only valid for FUTURE dates"). Re-exported here
so every existing simulation-family import (`from .constants import
POLICY_BASE_RATE_KRW`, etc. — orchestrator.py, simulation_service.py's facade
re-export) stays byte-identical; this file is now a pure passthrough, not a
second definition.
"""

from ..funding_basis import FUNDING_RATE_KRW, FUNDING_SPREAD_BP, POLICY_BASE_RATE_KRW

__all__ = ["FUNDING_RATE_KRW", "FUNDING_SPREAD_BP", "POLICY_BASE_RATE_KRW"]
