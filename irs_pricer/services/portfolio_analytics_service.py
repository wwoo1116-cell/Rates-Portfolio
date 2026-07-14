import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Literal

from ..core.market_data import MarketSnapshot
from ..engine.instruments import VanillaSwap
from . import portfolio_service
from . import historical_pnl_service
from ..loaders import base_rate
from ..loaders import true_data
from ..loaders import credit_matrix

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent.parent

_TENOR_COLUMNS = ["1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y", "30Y"]


@dataclass
class PositionData:
    """Lightweight mirror of ParsedPositionOut for use within the service layer,
    avoiding a circular import from api.models."""
    instrument_type: str  # "bond" | "irs"
    position_id: str
    sector: str
    book: str
    start_date: date | None = None
    maturity_date: date | None = None
    notional: float | None = None
    fixed_rate: float | None = None
    pay_fixed: bool | None = None
    float_spread: float | None = None
    evaluation_amount: float | None = None
    remaining_days: int | None = None
    tenor_bucket: str | None = None
    entry_yield: float | None = None
    mtm_yield: float | None = None
    duration: float | None = None
    pvbp: float | None = None


def _to_swap(p: PositionData) -> tuple[str, VanillaSwap]:
    nominal_tenor_years = max(1, round((p.maturity_date - p.start_date).days / 365))
    return (p.position_id, VanillaSwap(
        tenor_years=nominal_tenor_years,
        notional=p.notional,
        fixed_rate=p.fixed_rate,
        pay_fixed=p.pay_fixed,
        float_spread=p.float_spread or 0.0,
        trade_date=p.start_date,
        maturity_date=p.maturity_date,
    ))

def build_pvbp_sensitivity(
    positions: list[PositionData],
    snapshot: MarketSnapshot,
    fixings: dict[date, float]
) -> list[dict]:
    sectors = {p.sector for p in positions}
    rows = {sec: {c: 0.0 for c in _TENOR_COLUMNS} for sec in sectors}
    
    irs_positions = [p for p in positions if p.instrument_type == "irs"]
    bond_positions = [p for p in positions if p.instrument_type == "bond"]
    
    for b in bond_positions:
        if b.pvbp is not None and b.tenor_bucket in rows[b.sector]:
            rows[b.sector][b.tenor_bucket] += b.pvbp

    if irs_positions:
        swaps = [_to_swap(p) for p in irs_positions]
        delta_result = portfolio_service.price_portfolio_delta(snapshot, swaps, fixings)
        
        pid_to_sector = {p.position_id: p.sector for p in irs_positions}
        for pd in delta_result.position_deltas:
            sec = pid_to_sector[pd.position_id]
            for bkt in pd.buckets:
                col = "3M" if bkt.pillar == "CD91D" else bkt.pillar
                if col in rows[sec]:
                    rows[sec][col] += bkt.delta
                    
    result = []
    for sec, values in rows.items():
        row = {"sector": sec}
        row.update(values)
        row["total"] = sum(values.values())
        result.append(row)
        
    result.sort(key=lambda x: x["sector"])
    
    total_row = {"sector": "합계", "total": sum(r["total"] for r in result)}
    for c in _TENOR_COLUMNS:
        total_row[c] = sum(r[c] for r in result)
    result.append(total_row)
    
    return result

def build_book_daily_pnl(
    positions: list[PositionData],
    snapshot: MarketSnapshot,
    prior_snapshot: MarketSnapshot,
    fixings: dict[date, float]
) -> list[dict]:
    funding_rate = 0.0
    try:
        funding_rate = base_rate.load_base_rate(_DATA_DIR, snapshot.valuation_date)
    except Exception:
        pass
        
    credit_shifts = credit_matrix.daily_shift(_DATA_DIR)
    irs_shifts = true_data.daily_shift(_DATA_DIR)
    
    books = {p.book for p in positions}
    book_pnl = {b: {"book": b, "dailyCarry": 0.0, "fundingCost": 0.0, "bondValuation": 0.0, 
                    "swapValuation": 0.0, "swapThetaPnL": 0.0, "total": 0.0} for b in books}
                    
    for p in positions:
        if p.instrument_type == "bond":
            carry = (p.evaluation_amount or 0.0) * ((p.mtm_yield or 0.0) / 100.0) / 365.0
            funding = -(p.evaluation_amount or 0.0) * funding_rate / 365.0
            
            shift_bp = 0.0
            if p.sector in credit_shifts and p.tenor_bucket in credit_shifts[p.sector]:
                shift_bp = credit_shifts[p.sector][p.tenor_bucket]
            valuation = (p.pvbp or 0.0) * (-shift_bp)
            
            book_pnl[p.book]["dailyCarry"] += carry
            book_pnl[p.book]["fundingCost"] += funding
            book_pnl[p.book]["bondValuation"] += valuation
            book_pnl[p.book]["total"] += carry + funding + valuation

    irs_positions = [p for p in positions if p.instrument_type == "irs"]
    if irs_positions:
        swaps = [_to_swap(p) for p in irs_positions]
        delta_result = portfolio_service.price_portfolio_delta(snapshot, swaps, fixings)
        
        swap_vals = {b: 0.0 for b in books}
        for pd in delta_result.position_deltas:
            p_book = next(p.book for p in irs_positions if p.position_id == pd.position_id)
            for bkt in pd.buckets:
                col = "3M" if bkt.pillar == "CD91D" else bkt.pillar
                shift_bp = irs_shifts.get(col, 0.0)
                swap_vals[p_book] += bkt.delta * shift_bp
                
        for b, v in swap_vals.items():
            book_pnl[b]["swapValuation"] += v
            book_pnl[b]["total"] += v
            
        by_book = defaultdict(list)
        for p in irs_positions:
            by_book[p.book].append(_to_swap(p))
            
        for book_name, book_swaps in by_book.items():
            try:
                hist_res = historical_pnl_service.compute_historical_pnl(
                    book_swaps,
                    prior_snapshot.valuation_date,
                    snapshot.valuation_date,
                    prior_snapshot.valuation_date
                )
                today_pt = next((pt for pt in hist_res.points if pt.valuation_date == snapshot.valuation_date), None)
                total_swap_pnl = today_pt.cumulative_pnl if today_pt else 0.0
                
                theta = total_swap_pnl - swap_vals[book_name]
                book_pnl[book_name]["swapThetaPnL"] += theta
                book_pnl[book_name]["total"] += theta
            except Exception as e:
                logger.error("Error computing swap theta for %s: %s", book_name, e)

    result = list(book_pnl.values())
    result.sort(key=lambda x: x["book"])
    
    total_row = {"book": "Total", "dailyCarry": sum(r["dailyCarry"] for r in result),
                 "fundingCost": sum(r["fundingCost"] for r in result),
                 "bondValuation": sum(r["bondValuation"] for r in result),
                 "swapValuation": sum(r["swapValuation"] for r in result),
                 "swapThetaPnL": sum(r["swapThetaPnL"] for r in result),
                 "total": sum(r["total"] for r in result)}
    result.append(total_row)
    
    return result

def build_book_summary(
    positions: list[PositionData],
    daily_pnl_by_book: list[dict],
    snapshot: MarketSnapshot,
    fixings: dict[date, float]
) -> list[dict]:
    books = {p.book for p in positions if p.instrument_type == "bond"}
    result = []
    
    credit_shifts = credit_matrix.daily_shift(_DATA_DIR)
    
    irs_positions = [p for p in positions if p.instrument_type == "irs"]
    irs_pvbp_by_book = {b: 0.0 for b in books}
    if irs_positions:
        swaps = [_to_swap(p) for p in irs_positions]
        try:
            delta_result = portfolio_service.price_portfolio_delta(snapshot, swaps, fixings)
            for pd in delta_result.position_deltas:
                p_book = next(p.book for p in irs_positions if p.position_id == pd.position_id)
                if p_book in irs_pvbp_by_book:
                    irs_pvbp_by_book[p_book] += pd.total_delta
        except Exception as e:
            logger.error("Error computing IRS PVBP for summary: %s", e)

    for book in books:
        bonds = [p for p in positions if p.instrument_type == "bond" and p.book == book]
        total_notional = sum(p.notional or 0.0 for p in bonds)
        total_eval_amt = sum(p.evaluation_amount or 0.0 for p in bonds)
        
        weighted_ytm = 0.0
        if total_eval_amt > 0:
            weighted_ytm = sum((p.mtm_yield or 0.0) * (p.evaluation_amount or 0.0) for p in bonds) / total_eval_amt
            
        bond_pvbp = sum(p.pvbp or 0.0 for p in bonds)
        # pay_fixed=False is "receive fixed" which is long. pay_fixed=True is "pay fixed" which is short.
        # But price_portfolio_delta already returns signed delta. A receive-fixed swap has positive PV01.
        # So we just add IRS PVBP (which is total_delta) to bond_pvbp.
        net_pvbp = bond_pvbp + irs_pvbp_by_book[book]
        hedged_duration = (net_pvbp * 10000) / total_eval_amt if total_eval_amt > 0 else 0.0
        
        sector_totals = defaultdict(float)
        for p in bonds:
            sector_totals[p.sector] += (p.evaluation_amount or 0.0)
            
        sector_allocation = {}
        if total_eval_amt > 0:
            sector_allocation = {k: (v / total_eval_amt) * 100 for k, v in sector_totals.items()}
            
        matur_buckets = {'단기(1년 미만)': 0.0, '중기(1~3년)': 0.0, '장기(3년 이상)': 0.0}
        for p in bonds:
            yr = (p.remaining_days or 0) / 365.0
            if yr < 1:
                matur_buckets['단기(1년 미만)'] += (p.evaluation_amount or 0.0)
            elif yr < 3:
                matur_buckets['중기(1~3년)'] += (p.evaluation_amount or 0.0)
            else:
                matur_buckets['장기(3년 이상)'] += (p.evaluation_amount or 0.0)
                
        maturity_allocation = {}
        if total_eval_amt > 0:
            maturity_allocation = {k: (v / total_eval_amt) * 100 for k, v in matur_buckets.items()}
            
        # Top3 / Bottom3 by bondValuation
        bond_valuations = []
        for p in bonds:
            shift_bp = 0.0
            if p.sector in credit_shifts and p.tenor_bucket in credit_shifts[p.sector]:
                shift_bp = credit_shifts[p.sector][p.tenor_bucket]
            val = (p.pvbp or 0.0) * (-shift_bp)
            bond_valuations.append({"position_id": p.position_id, "valuation": val})
            
        bond_valuations.sort(key=lambda x: x["valuation"], reverse=True)
        top3 = bond_valuations[:3]
        bottom3 = list(reversed(bond_valuations[-3:])) if len(bond_valuations) >= 3 else list(reversed(bond_valuations))
        
        result.append({
            "book": book,
            "totalNotional": total_notional,
            "totalEvaluationAmount": total_eval_amt,
            "weightedAvgYTM": weighted_ytm,
            "hedgedDuration": hedged_duration,
            "sectorAllocation": sector_allocation,
            "maturityAllocation": maturity_allocation,
            "top3": top3,
            "bottom3": bottom3,
        })
        
    result.sort(key=lambda x: x["book"])
    return result
