"""pvbpSensitivity + bookDailyPnLs aggregate tables — moved verbatim from
simulation_service.py (R3a).

NOTE (SPLIT_PLAN H2 family): build_book_daily_pnl here is the simulate-glue
table; a DIFFERENT function of the same name lives in
portfolio_analytics_service.py. Keep both; do not unify.
"""

from __future__ import annotations

from ...engine import quant_engine as qe
from .daily_valuation import (
    get_sector_curve_key,
    interpolate_curve_shift,
    parse_tenor_to_years,
)
from .models import FrontendPosition, FrontendShockCurves


def build_frontend_pvbp_sensitivity(positions: list[FrontendPosition]) -> list[dict]:
    sectors = ["국고채", "통안채", "특은채", "시은채", "공사채", "여전채", "회사채", "IRS", "OIS"]
    # qe.KRD_NAMES를 그대로 참조(하드코딩된 별도 목록이면 엔진에 새 테너를 추가해도
    # 여기서 누락되어 "합계"가 실제 평행이동 PVBP와 어긋난다 — 6Y/8Y/9Y 추가 시 실제로 발생했던 문제)
    tenors = qe.KRD_NAMES

    # 원본은 pandas group-by-sum이었다(rates-simulator-main/backend/main.py) —
    # 같은 행들을 같은 순서로 테너별 순차 합산하는 plain-dict 버전. 이 배포에는
    # pandas가 없고, 필요한 것은 섹터×테너 합 하나뿐이다.
    result: list[dict] = []
    col_totals = {t: 0.0 for t in tenors}

    for sector in sectors:
        row_vals = {t: 0.0 for t in tenors}
        for p in positions:
            if p.sector == sector:
                for t in tenors:
                    row_vals[t] += float(p.krdMap.get(t) or 0)
        row_total = sum(row_vals.values())
        row_vals["합계"] = row_total
        for t in tenors:
            col_totals[t] = col_totals.get(t, 0.0) + row_vals.get(t, 0.0)
        result.append({"sector": sector, "tenors": row_vals, "total": row_total})

    grand_total = sum(col_totals.values())
    col_totals["합계"] = grand_total
    result.append({"sector": "합계", "tenors": col_totals, "total": grand_total})
    return result


def build_book_daily_pnl(
    positions: list[FrontendPosition],
    shock_curves: FrontendShockCurves | None,
    funding_rate: float,
) -> list[dict]:
    books = list(dict.fromkeys(p.book for p in positions))
    daily_pnls: list[dict] = []

    for book_name in books:
        bp_list = [p for p in positions if p.book == book_name]
        daily_carry = funding_cost = bond_val = swap_val = swap_theta = 0.0

        for p in bp_list:
            if p.bondType == "swap":
                delta = 0.0
                if p.krdMap and shock_curves and shock_curves.swapCurve:
                    for tenor, pvbp_val in p.krdMap.items():
                        sbp = interpolate_curve_shift(parse_tenor_to_years(tenor), shock_curves.swapCurve)
                        # IRS PVBP는 DV01 관행: receive-fixed=양수, pay-fixed=음수
                        # MTM = pvbp * (-sbp)  (채권과 동일)
                        delta += float(pvbp_val or 0) * (-sbp)
                swap_val += delta
                swap_theta += p.expectedThetaPnL or 0.0
            else:
                eval_amt = p.evaluationAmount or 0.0
                daily_carry += (eval_amt * ((p.mtmYield or 0.0) / 100.0)) / 365.0
                funding_cost -= (eval_amt * funding_rate) / 365.0
                curve_key = get_sector_curve_key(p.sector)
                target: list[dict] = []
                if shock_curves:
                    target = shock_curves.bondCurves.get(curve_key) or shock_curves.bondCurves.get("국채") or []
                sbp = interpolate_curve_shift((p.remainingDays or 0) / 365.0, target)
                bond_val += (p.pvbp or 0.0) * (-sbp)

        total = daily_carry + funding_cost + bond_val + swap_val + swap_theta
        daily_pnls.append({
            "bookName": book_name,
            "dailyCarry": round(daily_carry),
            "fundingCost": round(funding_cost),
            "bondValuation": round(bond_val),
            "swapValuation": round(swap_val),
            "swapThetaPnL": round(swap_theta),
            "totalDailyPnL": round(total),
        })

    if daily_pnls:
        daily_pnls.append({
            "bookName": "Total",
            "dailyCarry": sum(d["dailyCarry"] for d in daily_pnls),
            "fundingCost": sum(d["fundingCost"] for d in daily_pnls),
            "bondValuation": sum(d["bondValuation"] for d in daily_pnls),
            "swapValuation": sum(d["swapValuation"] for d in daily_pnls),
            "swapThetaPnL": sum(d["swapThetaPnL"] for d in daily_pnls),
            "totalDailyPnL": sum(d["totalDailyPnL"] for d in daily_pnls),
        })
    return daily_pnls
