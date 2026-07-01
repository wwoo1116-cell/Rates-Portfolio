"""
Thread-safe context management for QuantLib's global state.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
import QuantLib as ql

_QL_LOCK = threading.Lock()

@contextmanager
def managed_quantlib_env(calc_date: ql.Date):
    """
    Context manager to ensure thread-safe execution of QuantLib operations 
    that rely on global state (evaluationDate and IndexManager histories).
    """
    with _QL_LOCK:
        # Clear any existing fixings from previous or concurrent executions
        ql.IndexManager.instance().clearHistories()
        
        # Save original evaluation date
        orig_date = ql.Settings.instance().evaluationDate
        
        # Set new evaluation date
        ql.Settings.instance().evaluationDate = calc_date
        
        try:
            yield
        finally:
            # Restore original state
            ql.Settings.instance().evaluationDate = orig_date
            ql.IndexManager.instance().clearHistories()
