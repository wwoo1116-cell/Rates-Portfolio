"""IRS static pricing injection (pvbp/krdMap/expectedThetaPnL) — moved
verbatim from simulation_service.py (R3a)."""

from __future__ import annotations

from datetime import date, timedelta

from ...engine import quant_engine as qe
from .kr_calendar import next_kr_business_day
from .models import FrontendPosition


def enrich_irs_pvbp(
    positions: list[FrontendPosition],
    irs_curves: list[dict],
    base_date_str: str = "2026-01-01",
) -> list[FrontendPosition]:
    """
    IRS 포지션의 pvbp / krdMap / expectedThetaPnL을 quant_engine으로 산출하여 채워 반환.

    irsCurves가 비어있으면 flat 3% 커브를 fallback으로 사용.
    채권 포지션은 그대로 통과.
    """
    try:
        _enrich_base_date = date.fromisoformat(str(base_date_str)[:10])
    except Exception:
        _enrich_base_date = date.today()
    par_rates = qe.parse_irs_curves(irs_curves, base_date=_enrich_base_date)

    enriched: list[FrontendPosition] = []
    for p in positions:
        if p.bondType != "swap":
            enriched.append(p)
            continue

        t_mat = max(float(p.remainingDays or 0) / 365.0, 1 / 365)
        # 다음 변동 지급일: nextFixingDate 필드 우선 사용, 없으면 3개월 근사
        if p.nextFixingDate:
            try:
                nfd = date.fromisoformat(str(p.nextFixingDate)[:10])
                ref = date.fromisoformat(str(base_date_str)[:10])
                days_to_next = max((nfd - ref).days, 1)
                t_next = days_to_next / 365.0
            except Exception:
                t_next = 0.25
        else:
            t_next = t_mat * 0.1 if t_mat < 0.25 else 0.25
        t_next = max(min(t_next, t_mat), 1.0 / 365.0)

        # startDate가 있으면 실제 ISDA 스케줄(Forward Generation + EOM + Modified
        # Following + 만기 스냅)을 그대로 재현해 compute_irs_krd_map에 전달한다.
        # 이렇게 하면 compute_irs_npv 내부의 "t_maturity/t_next_payment 두 float만
        # 보고 날짜를 역산"하는 근사 로직을 완전히 건너뛰므로, 시작일 day-of-month가
        # 만기일과 다른 경우(예: 매달 16일 지급인데 만기가 18일)의 마지막 구간
        # 스텁까지 정확해진다. startDate가 없으면(프론트가 못 채운 레거시 포지션)
        # None으로 두어 기존 근사 경로로 폴백.
        _base = date.fromisoformat(str(base_date_str)[:10])
        _settle_date = next_kr_business_day(_base)  # 결제일(T+1 영업일, 한국 공휴일 반영)

        real_pay_dates = None
        real_accruals = None
        real_start_date = None
        if p.startDate:
            try:
                _sdate = date.fromisoformat(str(p.startDate)[:10])
                _mat_date = qe._modfol_bd(_base + timedelta(days=round(t_mat * 365)))
                if _mat_date > _sdate:
                    _trade_tmp = qe.IRS_Trade(
                        _sdate, _mat_date, p.couponRate or 0.0,
                        int(p.direction or 1), p.notional or 0.0, sector=p.sector or "IRS",
                    )
                    real_pay_dates = _trade_tmp.pay_dates
                    real_accruals = _trade_tmp.accruals
                    real_start_date = _sdate
            except Exception:
                real_pay_dates = None
                real_accruals = None
                real_start_date = None

        # 병행 방법론(linear-on-rate 보간 + 결제일 기준 할인)의 current_float_rate_pct:
        # 실제 스케줄을 알 때만 "리셋일이 [평가일, 결제일]에 걸리는 롤링 종목"을
        # 판정해 3M par rate로 리픽싱(resolve_current_float_rate). 실제 스케줄이
        # 없으면(startDate 미전달) 이 판정 자체가 불가능하므로 프론트 값 그대로 사용.
        _settle_float_rate = p.currentFloatRate or 0.0
        if real_pay_dates is not None:
            _settle_float_rate = qe.resolve_current_float_rate(
                pay_dates=real_pay_dates, start_date=real_start_date, val_date=_base,
                settle_date=_settle_date, cutoff_date=_settle_date,
                par_rates=par_rates, file_float_rate_pct=p.currentFloatRate or 0.0,
            )

        pvbp = qe.compute_irs_pvbp(
            par_rates          = par_rates,
            notional           = p.notional or 0.0,
            fixed_rate_pct     = p.couponRate or 0.0,       # % 단위
            direction          = int(p.direction or 1),
            t_maturity         = t_mat,
            t_next_payment     = t_next,
            current_float_rate_pct = _settle_float_rate,  # % 단위
            sector             = p.sector or "IRS",
            sim_date           = _settle_date,
            df_fn              = qe.df_linear_rate,
            pay_dates          = real_pay_dates,
            accruals           = real_accruals,
        )
        krd = qe.compute_irs_krd_map(
            par_rates          = par_rates,
            notional           = p.notional or 0.0,
            fixed_rate_pct     = p.couponRate or 0.0,
            direction          = int(p.direction or 1),
            t_maturity         = t_mat,
            t_next_payment     = t_next,
            current_float_rate_pct = _settle_float_rate,
            sector             = p.sector or "IRS",
            sim_date           = _settle_date,
            pay_dates          = real_pay_dates,
            accruals           = real_accruals,
        )
        theta = qe.compute_irs_theta(
            par_rates          = par_rates,
            notional           = p.notional or 0.0,
            fixed_rate_pct     = p.couponRate or 0.0,
            direction          = int(p.direction or 1),
            t_maturity         = t_mat,
            t_next_payment     = t_next,
            current_float_rate_pct = p.currentFloatRate or 0.0,
            sector             = p.sector or "IRS",
            base_date          = date.fromisoformat(base_date_str[:10]),
            pay_dates          = real_pay_dates,
            accruals           = real_accruals,
        )

        # Pydantic 모델은 immutable이므로 copy(update=...) 사용
        enriched.append(p.model_copy(update={
            "pvbp": pvbp,
            "krdMap": krd,
            "expectedThetaPnL": theta,
        }))

    return enriched


def enrich_bond_dv01(
    positions: list[FrontendPosition],
    base_date_str: str = "2026-01-01",
) -> list[FrontendPosition]:
    """DV01-FIX Phase B — bond pvbp re-derived server-side on the SAME
    derivation point Home/recon uses (services/bond_risk; owner ruling: no
    parallel math). The wire's pvbp is the frozen blotter snapshot figure
    (2026-03-23 in the current export — DV01_DIAG_REPORT.md); every simulate
    consumer (calculate_daily_mtm aging, aggregates bondValuation, zone
    PVBP, 시나리오 대사 lanes) scales with it.

    Per bond: fixed-coupon reval at base_date, bump base = the position's own
    민평수익율 (the wire carries no rating for a curve lookup), maturity-
    anchored synthetic schedule (no 발행일자 on the wire — pinned ≤2% vs the
    true-issue anchor). FRN '(변)' rows and rows the engine cannot revalue
    keep the wire figure — identical carve-out semantics to Phase A. Swap
    positions pass through untouched (their pvbp is enrich_irs_pvbp's).

    remainingDays is deliberately NOT rewritten here (aging anchor follow-up,
    enumerated in DV01_FIX_REPORT.md) — this phase replaces the SENSITIVITY,
    not the calendar columns.
    """
    from .. import bond_risk

    try:
        base_date = date.fromisoformat(str(base_date_str)[:10])
    except Exception:
        base_date = date.today()

    enriched: list[FrontendPosition] = []
    for p in positions:
        if p.bondType == "swap":
            enriched.append(p)
            continue
        maturity = None
        if p.maturityDate:
            try:
                maturity = date.fromisoformat(str(p.maturityDate)[:10])
            except Exception:
                maturity = None
        res = bond_risk.bond_dv01(
            name=p.name or p.id,
            sector=p.sector,
            rating=None,
            valuation_date=base_date,
            sheet_pvbp=p.pvbp or 0.0,
            stale_bucket=None,
            maturity_date=maturity,
            coupon_rate=p.couponRate,
            payment_frequency=p.frequency,
            notional=p.notional,
            issue_date=None,
            market_yield=(p.mtmYield / 100.0) if p.mtmYield else None,
        )
        if res.source == "reval":
            enriched.append(p.model_copy(update={"pvbp": res.dv01}))
        else:
            enriched.append(p)
    return enriched
