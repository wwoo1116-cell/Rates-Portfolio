import QuantLib as ql

calendar = ql.SouthKorea()
day_counter = ql.Actual365Fixed()

def compare_dcf(start_krx, end_krx, krx_dcf, start_engine, end_engine):
    adj_s_krx = calendar.adjust(start_krx, ql.ModifiedFollowing)
    adj_e_krx = calendar.adjust(end_krx, ql.ModifiedFollowing)
    calc_krx = day_counter.yearFraction(adj_s_krx, adj_e_krx)
    
    adj_s_eng = calendar.adjust(start_engine, ql.ModifiedFollowing)
    adj_e_eng = calendar.adjust(end_engine, ql.ModifiedFollowing)
    calc_eng = day_counter.yearFraction(adj_s_eng, adj_e_eng)
    
    print(f"KRX Reference : {adj_s_krx} ~ {adj_e_krx} (DCF: {krx_dcf:.10f} | Calc: {calc_krx:.10f})")
    print(f"Engine Output : {adj_s_eng} ~ {adj_e_eng} (DCF: {calc_eng:.10f})")
    print(f"Difference    : {abs(calc_krx - calc_eng):.10f}")
    print("-" * 50)

print("ANALYSIS OF PERIOD 2 (October ~ January)\n")
compare_dcf(ql.Date(2, 10, 2026), ql.Date(4, 1, 2027), 0.25753425, ql.Date(1, 10, 2026), ql.Date(4, 1, 2027))
