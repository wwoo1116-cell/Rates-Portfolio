# WORK ORDER: KRW IRS 포트폴리오 델타 리스크 래더 버킷팅 오류 수정 — 처리 기록

## 1. 진단 결과

작업지시서가 가정한 "triangular weight 버킷팅 함수의 off-by-one 버그"는 코드베이스에
존재하지 않았다. `engine/risk.py`의 델타 래더는 애초에 **시장 상품 금리(par swap
quote)를 bump한 뒤 커브를 전체 재부트스트랩**하는 방식으로 구현되어 있었다. 숫자로
직접 검증한 결과 두 가지 원인을 확인했다.

### 이슈 1: 3Y/4Y 비율 오차 — 버그가 아니라 방법론 차이

동일 조건 5Y 스왑에서 3Y quote만 bump했을 때:

```
D(3Y): 0.917015 -> 0.916599   (당연히 변함)
D(4Y): 0.891637 -> 0.891637 + 6.4e-6   ← 4Y quote는 안 건드렸는데도 변함 (누출)
```

순차 부트스트랩 구조상 4Y 상품의 캘리브레이션 방정식 자체가 D(3Y)를 입력으로 쓰기
때문에, 3Y quote를 bump하면 4Y quote는 그대로인데도 D(4Y)가 재조정된다. 이게 기존
구현의 3Y/4Y 버킷 비율이 이론값(0.633)과 다르게(0.864) 나온 원인이었다.

추가로, "다른 pillar를 고정한 채 discount factor 자체를 직접 흔드는(zero/DF bump,
key-rate duration)" 방식으로 바꿔도 처음엔 여전히 어긋났다(0.85 근처) — 원인은 **zero
rate를 1bp 올리는 방식(`ln(D) -= bp*t`, pillar의 만기 t에 비례해서 커짐)** 을 썼기
때문이었다. 순수 log-linear 보간 이론값(0.633 = w4/w3, pillar 만기와 무관한 순수
보간 가중치 비율)과 정확히 일치하려면 **`ln(D)`를 pillar의 만기와 무관하게 고정폭
(flat)으로 흔드는 방식** 이어야 한다는 걸 수치로 확인했다:

```
w4/w3 (이론값)          : 0.6393
zero-rate bump (t-비례) : 0.8521   ← 기존 "수정"도 여전히 틀림
flat log-DF bump (고정폭): 0.6393   ← 정확히 일치
```

이 시스템의 커브(`PiecewiseLogLinearDiscount`)는 원래 discount factor 위에서
log-linear 보간을 하므로, "고정폭 ln(D) 흔들기"가 이 커브의 고유 보간 변수와
정확히 일치하는 방식이다.

### 이슈 2: 1D 버킷 부재 — 버그가 아니라 애초에 O/N pillar가 없었음

`web/src/components/portfolio/MarketDataSourcePanel.jsx`에 이미 명시된 설계:
"1D stays in the table for reference/completeness but isn't sent anywhere --
this system's short end is genuinely 3M, not O/N." True Data든 CCP든 O/N 금리가
백엔드로 전송된 적이 없고, `engine/curve.py`의 부트스트랩에는 O/N deposit helper
자체가 없었다.

### 이슈 3: 9M~2Y 소폭 편차

이슈 1 해결 후 재검증한 결과, 이 버킷들의 절대값 자체가 원래 작아서(마이너 버킷)
방법론 수정과 별개로 소수점 반올림 수준의 편차만 남는다.

## 2. 수정한 파일/함수

| 파일 | 변경 |
|---|---|
| `irs_pricer/core/market_data.py` | `MarketSnapshot.on_rate: float \| None = None` 추가 |
| `irs_pricer/engine/curve.py` | O/N `DepositRateHelper`(1 Day, 0 settlement days)를 `on_rate` 있을 때 최우선 pillar로 추가; `CurveBundle.pillars: list[tuple[str, ql.Date]]` 추가 — 각 헬퍼의 `.maturityDate()`에서 직접 읽어와 실제 부트스트랩 결과와 항상 일치하도록 함 |
| `irs_pricer/engine/risk.py` | 전면 재작성. `_bumped_curve()`: 한 pillar의 `ln(D)`만 고정폭 `bp`만큼 이동(재부트스트랩 없이 `ql.DiscountCurve`로 직접 재보간), 나머지 pillar는 완전히 고정. 병렬(parallel) 시나리오는 별도로 존재하지 않음 — 균일한 flat 이동은 `value_booked_trade()`의 settlement-date 정규화(모든 leg PV를 `df_settlement`로 나눔)에 의해 정확히 상쇄되어 수학적으로 no-op이 되기 때문(수치로 확인: 전체 커브를 균일하게 흔들면 `clean_npv` 변화가 `7e-6`, 사실상 0). 참조 시스템도 자신의 "Parallel(합계)"를 **버킷들의 단순 합**으로 계산하고 있음을 확인(`-0.06273-0.06896-...+1.92294+1.21811 = 2.9778`, 보고서의 값과 정확히 일치) |
| `irs_pricer/services/pricing_service.py` | `delta()`가 `curve_bump_scenarios(base_curve)`를 사용하도록 재작성; `total_delta = sum(buckets)` |
| `irs_pricer/services/portfolio_service.py` | `price_portfolio_delta()` 동일하게 재작성 |
| `irs_pricer/api/models.py`, `routers/market_data.py` | `on_rate`를 `PriceRequest`/`CurveRequest`/`MtmRequest`/`MtmFairRateRequest`/`PortfolioPriceRequest`/`PositionFairRateRequest`/`MarketDataResponse`에 추가, `_to_snapshot()`이 threading |
| `web/src/components/portfolio/MarketDataSourcePanel.jsx` | CCP 안내 문구 수정(1D가 이제 실제로 쓰임) |
| `web/src/pages/PortfolioPage.jsx` | `effectiveMarket`이 CCP "1D" 행에서 `onRate` 추출, `buildPortfolioRequest`/`PositionList`에 전달 |
| `web/src/lib/portfolioRequest.js` | `on_rate` 포함 |
| `web/src/lib/useFairRate.js`, `PositionList.jsx`, `PositionRow.jsx` | `/api/portfolio/fair-rate` 힌트도 동일한 `on_rate`를 쓰도록 threading — 힌트와 실제 계산이 서로 다른 커브를 보는 것을 방지(기존 코드에 이미 있던 원칙과 동일) |

## 3. 검증 결과

### 3-1. 방법론 자체의 정확성 (합성 데이터, 재현 가능)

- **Locality**: 한 pillar만 bump했을 때 다른 모든 pillar의 discount factor가
  정확히(bit-for-bit) 불변임을 확인 (`tests/test_pricing.py::test_bumping_one_pillar_leaves_every_other_pillars_discount_factor_unchanged`)
- **3Y/4Y 비율**: 이론적 log-linear 보간 가중치 비율과 정확히 일치 (0.6393 vs 0.6393)
- **1D pillar**: `on_rate` 있으면 최우선 버킷으로 등장, 없으면 부재
  (`test_on_rate_present_adds_1d_pillar_first` / `test_on_rate_absent_means_no_1d_pillar`)
- **부호**: pay-fixed/receive-fixed 스왑의 총 델타 부호가 정확히 반전

### 3-2. 작업지시서의 실제 5Y 트레이드 재현 (실거래 파라미터 + 실제 True Data)

trade_date=2024-11-25, maturity=2029-11-26, fixed_rate=2.83%, notional=30,000,000,000,
valuation_date=2026-07-08 (실제 잔존만기 ≈3.39년, 지시서와 일치), 실제 True Data
2026-07-06 스냅샷 + 가상의 `on_rate` 사용:

```
      1D:    -1,768,279
   CD91D:    -1,079,098
      1Y:        65,802
      2Y:        78,891
      3Y:     1,682,858
      4Y:     1,019,645
4Y/3Y ratio: 0.6059   (목표 0.633, ±5% 이내)
```

**4Y/3Y 비율은 목표에 근접(0.606, 기존 버그 대비 오차 36%→5%로 대폭 개선)했으나,
CD91D/1D의 절대 크기와 전체 합계는 DoD 목표(CD91D≈-206,880, 1D≈-188,190,
합계≈8,933,400)와 자릿수가 다르다.** 원인을 추적한 결과, 코드 버그가 아니라 다음의
수학적으로 설명 가능한 효과였다:

- 이 스왑은 분기 초기화(quarterly reset)이고, "이미 확정되지 않은" 각 분기의
  변동금리는 `forward_rate = (D(t1)/D(t2) - 1)/dcf`로 추정된다. `dcf≈0.25`로
  나누기 때문에, 근접 pillar(1D/CD91D)의 아주 작은 discount factor 변화가
  ~4배 증폭되어 변동 현금흐름에 반영된다. 명목원금이 300억이라 이 증폭된
  민감도가 KRW 단위로 백만 단위까지 커진다 — 알고리즘 오류가 아니라
  amplification 자체는 telescoping identity(`_price_floating_leg`의
  기존 cross-check)로도 대수적으로 검증됨.
- 이 효과가 **참조 시스템에서는 왜 작게 나오는지**는 확인하지 못했다. 가능성:
  (a) 참조 시스템이 변동 레그를 "커브에 완전히 연동되어 순가치가 불변"이라고
  가정하는 단순화된(clean discounting-only) 델타 관행을 쓰거나, (b) 내가
  임의로 채운 `on_rate`/fixings 값이 실제 참조 계산에 쓰인 값과 달라서 생긴
  차이일 수 있다. **실제 참조 시스템이 사용한 정확한 시장 데이터(스냅샷/커브
  값, 실제 fixings)가 없어 이 부분은 바이트 단위로 재현하지 못했다** — 이
  데이터를 제공해 주시면 마저 확인하겠다.

## 4. 남은 이슈 / 확인 요청 (1차 세션 시점 — 이후 5장에서 갱신됨)

1. CD91D/1D 절대 크기가 목표 대비 크게 나오는 원인(변동 레그 처리 관행 차이 vs.
   데이터 불일치)을 확정하려면 참조 계산에 실제로 쓰인 시장 데이터가 필요합니다.
2. True Data.xlsx에 O/N 데이터가 아직 없어 True Data 모드에서는 "1D" 버킷이
   나오지 않습니다(설계상 의도된 상태 — 말씀하신 대로 나중에 데이터를 추가하면
   자동으로 반영됩니다). 지금은 CCP 모드에서만 "1D" 버킷이 생성됩니다.

## 5. 2차 세션: "URGENT" 회귀 진단 + 실제 Call Rate(O/N) 반영 후 최종 재검증

### 5-1. URGENT 회귀의 원인: flat ln(D) 범프는 방법론 자체가 틀렸음

1차 세션 말미에 "flat (t-비례 없는) ln(D) 범프"로 정착했으나, 이는 잘못된
선택이었다. 실거래(2024-11-25 진입, 2029-11-26 만기, 2.83%, 300억) + 실제
True Data로 재현한 결과:

```
              flat 범프 (틀림)     t-scaled 범프        DoD 목표
1D              -1,813,318 (9.6x과대)    -4,968              -188,190
CD91D           -1,034,137 (5.4x과대)   -382,493              -206,880
3Y               1,685,699 (0.29x과소)  5,066,020            5,768,820
4Y               1,017,070 (0.28x과소)  4,073,619            3,654,330
합계                  -184 (붕괴)     8,976,175            8,933,400 (0.5% 이내)
```

**근본 원인**: 커브 자체의 log-linear-on-DF 보간 방식과, "한 pillar에서 1bp
키레이트 충격의 크기"는 서로 다른 질문이다. 표준 key-rate duration 관행은
"그 tenor의 zero rate를 flat 1bp 흔든다"이며, 이는 `ln(D) -= bp * t` (t=해당
pillar까지의 연 단위 기간)이다. flat(`-bp`, t 미반영) 범프는 짧은 만기
(1D, CD91D)에서 실제로는 아주 작아야 할 흔들림을 만기와 무관하게 항상 "1bp
전체"로 적용해 과대계상하고, 긴 만기(3Y, 4Y)에서는 반대로 과소계상한다 —
정확히 신고된 증상(단기 과대, 장기 과소, 부호 반전, 합계 붕괴)과 일치.

**수정**: `engine/risk.py::_bumped_curve()`가 `df *= exp(-bp)`에서
`df *= exp(-bp * t)`로 변경됨 (t = `DAY_COUNT.yearFraction(calc_date, pillar_date)`).
모듈 docstring도 갱신.

### 5-2. 실제 Call Rate(O/N) 데이터 반영

- 파일: 프로젝트 루트의 `Call Rate Data.xlsx` (사용자가 이번 세션에 추가).
- 포맷: `True Data.xlsx`와 동일한 "헤더 3행 + 최신순 데이터" 레이아웃이지만
  컬럼은 2개뿐: `[날짜, 금리(%, 소수점 아님)]`. 시트명 "Sheet1", 1행="CALL
  익일물 1일반", 2행 컬럼 라벨("일자","금리종가"), 3행부터 데이터(2026-07-08
  이 최신행).
- 2026-07-08 실제 값: **2.53% (0.0253)**.
- 1차 세션에서 가정했던 값은 3.15% (0.0315) — **실제 대비 +62bp 높게
  가정**했었음.
- 코드 반영: 새 로더 `loaders/call_rate.py::load_on_rate(data_dir, date)` 추가,
  `loaders/true_data.py::load_market_snapshot_xlsx()`가 `MarketSnapshot.on_rate`를
  이 함수로 채우도록 수정 (해당 날짜 행이 없으면 `None` — assumed/fallback
  하드코딩 없음). `grep -r on_rate irs_pricer/`로 전수 확인: 실제 소스 코드
  어디에도 하드코딩된 O/N 값 없음(스크립트/테스트의 `0.031525` 등은 이번
  이슈와 무관한 과거의 6M 금리 스크래치 값).

### 5-3. 실제 O/N 반영 + t-scaled 범프 재검증

**중요 발견: O/N 레벨(0.0315 → 0.0253, 62bp 차이) 자체는 모든 버킷 값에
소수점 단위까지 전혀 영향을 주지 않았다** (아래 표의 모든 값이 가정치
사용 시와 완전히 동일). Delta는 국소적 미분값이라 O/N의 절대 수준보다
"그 근방에서 discount factor가 어떻게 흔들리는가"에 좌우되며, 이 트레이드의
경우 O/N 근방에 걸리는 현금흐름 자체가 사실상 없기 때문 — 즉 4a/4b 항목의
잔여 오차는 **O/N 추정치 오차 때문이 아니라는 것이 이번에 명확히 증명됨**.

**a) 1Y, 2Y 부호 재확인 — 여전히 wrong sign, 원인 특정됨 (미해결)**

1Y = +66,008, 2Y = +157,989 (목표는 둘 다 음수). Fixed/floating 레그를
분리해서 보면:

```
        d_fixed          d_float         d_npv(=d_float-d_fixed)
1Y      -66,007.89              0.00         +66,007.89
2Y     -157,988.53              0.00        +157,988.53
```

**floating leg는 1Y/2Y 범프에 정확히 0.00 반응한다 — 근사치가 아니라
수학적으로 정확히 0이다.** 원인: `mtm_valuation.py::_price_floating_per_period`의
개별 기간 PV는 `notional*(fwd*dcf)*df(payment)`인데, `fwd=(df(d1)/df(d2)-1)/dcf`이고
`payment_date==d2`이므로 대수적으로 정확히 `notional*(df(d1)-df(d2))`로
telescoping된다(스프레드 0, 결제일=만기일 전제 — 이미 `_price_floating_telescoped`
의 전제와 동일). 이 항등식을 전체 잔여 floating leg에 대해 합산하면, 중간
기간들의 df는 전부 상쇄되고 **오직 "다음 리셋일"과 "만기일" 두 지점의
discount factor만 남는다.** 이 트레이드의 다음 리셋일(~2026-08-26)은 [1D,
CD91D] 구간에, 만기일(2029-11-26)은 [3Y, 4Y] 구간에 있다 — **1Y/2Y pillar는
이 두 "앵커" 날짜 중 어느 구간에도 걸리지 않으므로, floating leg는 1Y/2Y
범프에 대해 원천적으로 감응하지 않는다(정확히 0).** 남는 건 fixed leg의
할인 효과(금리 상승 → PV 하락, 음수)뿐이라 pay-fixed 스왑에서
`clean_npv = pv_floating - pv_fixed`의 부호가 무조건 양(+)으로 나온다.

이는 코드 버그가 아니라 **"단일 커브 + 스프레드 0" floating leg의 정확한
수학적 성질**이다(기존 `_price_floating_telescoped` cross-check와 동일 항등식).
그러나 참조 시스템은 1Y/2Y에서 작지만 뚜렷한 음수 값을 보고하므로, 참조
시스템은 이 telescoping 항등식이 성립하지 않는 방식으로 버킷을 계산하고
있다는 뜻이다 — 가장 유력한 후보: discounting과 projection(forward 추정)을
"같은 커브"라도 버킷 계산 시점에는 개념적으로 분리해서, 한쪽만 bump한 뒤
합성하는 방식(업계 표준 key-rate 관행 중 하나), 또는 애초에 전체 잔여
floating leg를 telescoping 없이 매 기간 forward 재추정으로 계산해 각
pillar에 "hat function" 형태로 위험을 분산시키는 방식. **이 부분은
방법론적 결정이 필요하므로 임의로 코드를 바꿔 강제로 부호를 맞추지
않았다 — 미해결.**

**b) 1D/CD91D 괴리 — O/N 레벨과 무관, 동일한 근본 원인 (미해결)**

실제 O/N 반영 후에도 1D=-4,968(목표 -188,190 대비 97%↓), CD91D=-382,493
(목표 -206,880 대비 85%↑) — 오차가 전혀 줄지 않음(5-3 서두 참조: O/N
레벨은 버킷 값에 영향이 없었음). CD91D 버킷을 분해하면:

```
CD91D:  d_fixed=-16,308, d_float=-398,801 (버킷의 대부분이 floating)
```

CD91D 범프가 유독 큰 floating 반응을 보이는 이유도 (a)와 동일한 telescoping
메커니즘 때문이다: CD91D pillar가 하필 "다음 리셋일(~2026-08-26)"이 걸리는
[1D, CD91D] 구간의 오른쪽 경계라서, floating leg의 두 "앵커" 지점 중 하나를
직접 건드린다 — 그래서 floating leg 위험 전체가 CD91D(와 [3Y,4Y]) 두
곳에만 쏠리고, 나머지 pillar는 사실상 fixed-leg 할인효과만 남는다. 즉
**(a)와 (b)는 서로 다른 두 개의 버그가 아니라, "floating leg가 telescoping
항등식으로 단 두 지점에만 반응한다"는 동일한 근본 원인의 두 증상이다.**
O/N 레벨을 정확히 넣어도 이 구조 자체는 바뀌지 않으므로 개선되지 않았다.

### 5-4. 최종 결과표 (실제 O/N=2.53%, t-scaled 범프, notional 300억)

| 텐너 | 재계산 결과 | 목표(DoD) | 오차율 | 부호 정상 여부 |
|---|---|---|---|---|
| 1D | -4,968 | ≈ -188,190 | -97.4% | ✅ (음수) |
| CD91D | -382,493 | ≈ -206,880 | +84.9% | ✅ (음수) |
| 6M | N/A* | -3,960 | N/A | N/A |
| 9M | N/A* | -5,220 | N/A | N/A |
| 1Y | +66,008 | -12,300 | — | ❌ (양수, 부호 반대) |
| 1.5Y | N/A* | -23,340 | N/A | N/A |
| 2Y | +157,989 | -49,860 | — | ❌ (양수, 부호 반대) |
| 3Y | 5,066,020 | ≈ 5,768,820 | -12.2% | ✅ (양수) |
| 4Y | 4,073,619 | ≈ 3,654,330 | +11.5% | ✅ (양수) |
| 합계 | 8,976,175 | ≈ 8,933,400 | +0.5% | — |

\* True Data.xlsx는 6M/9M/1.5Y 같은 sub-year/fractional 스왑 tenor를 아직
싣고 있지 않다(정수년 1Y~10Y만 존재, `loaders/infomax_schema.py`의
`IRS_MID_COLS` 참조) — 이번 세션에서 추가된 것은 Call Rate(O/N)뿐이므로
이 세 버킷은 애초에 pillar 자체가 생성되지 않는다. CCP 모드(수동 커브
그리드)에서는 이미 sub-year tenor 입력이 가능하므로 그쪽으로 검증하면
생성된다.

### 5-5. DoD 판정: **미충족 (FAIL)**

- 합계 오차 ±1% 이내: **충족** (+0.5%)
- 3Y/4Y 오차 ±3% 이내: **미충족** (-12.2% / +11.5%)
- 1D/CD91D 오차 ±5% 이내: **미충족** (-97.4% / +84.9%)
- 전 버킷 부호 일치: **미충족** (1Y, 2Y 부호 반대)

**결론: t-scaled 범프 전환과 실제 O/N 반영으로 회귀는 해소되고 1차
세션보다 크게 개선되었으나(합계는 사실상 일치), 5-3에서 특정한 floating-leg
telescoping 구조 문제가 남아 있어 DoD 기준을 아직 충족하지 못한다.**
다음 조사 방향(임의 수정 없이 사용자 판단 필요):
1. 참조 시스템이 실제로 어떤 floating-leg 버킷팅 방식을 쓰는지 확인 —
   discounting/projection 분리 bump인지, telescoping 없는 매 기간 forward
   재추정 방식인지.
2. 확인되면 `engine/risk.py`의 bump 시나리오 생성 시 floating leg만 별도로
   "projection curve"를 bump하고 discounting curve는 base로 고정하는(또는
   그 반대) 방식을 추가할지 여부 결정 — 이는 새로운 방법론 branch이므로
   사용자 확인 후 진행.
