import QuantLib as ql

def verify_irs_cashflow(start_date, end_date, krx_dcf_expected):
    # 1. 설정
    calendar = ql.SouthKorea() # KRX 달력
    day_counter = ql.Actual365Fixed()
    
    # 2. 내부 로직 시뮬레이션
    adjusted_start = calendar.adjust(start_date, ql.ModifiedFollowing)
    adjusted_end = calendar.adjust(end_date, ql.ModifiedFollowing)
    
    internal_dcf = day_counter.yearFraction(adjusted_start, adjusted_end)
    
    # 3. 검증
    diff = abs(internal_dcf - krx_dcf_expected)
    is_match = diff < 1e-9
    
    print(f"기간: {adjusted_start} ~ {adjusted_end}")
    print(f"내부 DCF: {internal_dcf:.10f} | KRX DCF: {krx_dcf_expected:.10f}")
    print(f"일치 여부: {'성공' if is_match else '오차 발생 (차이: ' + str(diff) + ')'}")
    print("-" * 30)

# Check all periods of our 2026-07-01 to 2027-07-01 schedule
verify_irs_cashflow(ql.Date(1, 7, 2026), ql.Date(1, 10, 2026), 0.2520547945) # 92 / 365
verify_irs_cashflow(ql.Date(1, 10, 2026), ql.Date(4, 1, 2027), 0.2602739726) # 95 / 365
verify_irs_cashflow(ql.Date(4, 1, 2027), ql.Date(1, 4, 2027), 0.2383561644) # 87 / 365
verify_irs_cashflow(ql.Date(1, 4, 2027), ql.Date(1, 7, 2027), 0.2493150685) # 91 / 365

print("==== VERSUS T+1 EFFECTIVE DATE ====")
verify_irs_cashflow(ql.Date(2, 7, 2026), ql.Date(2, 10, 2026), 0.2520547945) # 92 / 365
verify_irs_cashflow(ql.Date(2, 10, 2026), ql.Date(4, 1, 2027), 0.2575342466) # 94 / 365
verify_irs_cashflow(ql.Date(4, 1, 2027), ql.Date(2, 4, 2027), 0.2410958904) # 88 / 365
verify_irs_cashflow(ql.Date(2, 4, 2027), ql.Date(2, 7, 2027), 0.2493150685) # 91 / 365
