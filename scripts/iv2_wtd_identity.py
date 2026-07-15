"""Integration-pass v2: rerun S2's WTD reconciliation identity on merged code.

Identity: WTD figure (build_period_pnl, Total row) must equal the telescoping
sum of daily revaluation changes over the same included-bond set, business day
by business day from the WTD baseline to as_of. Bond-only, so S6's IRS fix must
leave every figure byte-unchanged vs SESSION2_REPORT.md.
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from irs_pricer.services import market_data_service as mds
mds._db_market_data_unavailable = True

from irs_pricer.config import DATA_DIR
from irs_pricer.engine import curve_cache
from irs_pricer.loaders import portfolio as portfolio_loader
from irs_pricer.services import allocation_history_service as ahs
from irs_pricer.services import portfolio_analytics_service as pas

curve_cache.install()

rows = portfolio_loader.parse(DATA_DIR)
fields = {f for f in ahs.BondSnapshotInput.__dataclass_fields__}
# payment_frequency is injected FE-side by sector convention (blotter-parser.ts):
# 2 for 국고채/통안채, 4 for credit sectors. Mirror it here.
bonds = [
    ahs.BondSnapshotInput(
        **{k: v for k, v in r.items() if k in fields and k != "payment_frequency"},
        payment_frequency=2 if r.get("sector") in ("국고채", "통안채") else 4,
    )
    for r in rows if r.get("instrument_type") == "bond"
]
print(f"bonds: {len(bonds)}")

out = pas.build_period_pnl(bonds)
total = next(r for r in out["rows"] if r["book"] == "Total")
print(f"as_of={out['as_of']}")
for f in ("wtd", "mtd", "ytd"):
    fig = total[f]
    print(f"{f}: pnl={fig['pnl']:,.2f} baseline={fig['baseline_date']} "
          f"included={fig['included_positions']} not_held={fig['excluded_not_held']} "
          f"unpriceable={fig['excluded_unpriceable']} complete={fig['complete']}")

# telescoping over business days baseline..as_of on the WTD included set
avail = mds.list_available_dates()
as_of = date.fromisoformat(out["as_of"])
base = date.fromisoformat(total["wtd"]["baseline_date"])
days = [d for d in avail if base <= d <= as_of]
print(f"chain: {[d.isoformat() for d in days]}")

# included set: bonds OK on BOTH legs (same rule as _period_figure)
states = {d: [pas._npv_state(b, d) for b in bonds] for d in days}
inc = [i for i in range(len(bonds))
       if states[days[0]][i][0] == pas._NPV_OK and states[days[-1]][i][0] == pas._NPV_OK]
print(f"included on both legs: {len(inc)}")

tele = 0.0
for d0, d1 in zip(days, days[1:]):
    step = sum(states[d1][i][1] - states[d0][i][1] for i in inc)
    v0 = sum(states[d0][i][1] for i in inc)
    v1 = sum(states[d1][i][1] for i in inc)
    print(f"  {d0} -> {d1}: V0={v0:,.2f} V1={v1:,.2f} dV={step:,.2f}")
    tele += step
print(f"telescoping sum = {tele:,.4f}")
print(f"API WTD pnl     = {total['wtd']['pnl']:,.4f}")
print(f"|diff| = {abs(tele - total['wtd']['pnl']):.6f} KRW")
