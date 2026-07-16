/** s19: invert exit/stop (the persisted params the capture didn't state) for
 * (lookback 60, entry 3σ) — does any cell hit 35 trades / net 70.4M? */
import { simulateMeanReversion } from "../../src/lib/math/backtest";
import { buildInstrumentSeries, creditLegsOf, type SelectedInstrument } from "../../src/lib/rv-instruments";

const BE = "http://127.0.0.1:8000";
const ktbSpread: SelectedInstrument = {
  kind: "spread",
  id: "S:1*국고채||10Y~-1*국고채||3Y",
  legs: [
    { leg: { sector: "국고채", rating: null, tenor: "10Y" }, weight: 1 },
    { leg: { sector: "국고채", rating: null, tenor: "3Y" }, weight: -1 },
  ],
};
const irsSpread: SelectedInstrument = {
  kind: "spread",
  id: "S:1*IRS||10Y~-1*IRS||3Y",
  legs: [
    { leg: { sector: "IRS", rating: null, tenor: "10Y" }, weight: 1 },
    { leg: { sector: "IRS", rating: null, tenor: "3Y" }, weight: -1 },
  ],
};

const range = await (await fetch(`${BE}/api/market-data/range`)).json();
const history = await (await fetch(`${BE}/api/rate-history?start=${range.min_date}&end=${range.max_date}`)).json();

for (const [name, inst] of [["국고 10Y−3Y", ktbSpread], ["IRS 10Y−3Y", irsSpread]] as const) {
  const legs = creditLegsOf([inst]);
  let creditResults: unknown[] = [];
  if (legs.length) {
    const resp = await (
      await fetch(`${BE}/api/credit-curve/series`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legs, start_date: range.min_date, end_date: range.max_date }),
      })
    ).json();
    creditResults = resp.results ?? [];
  }
  const [series] = buildInstrumentSeries([inst], history.points, creditResults as never);
  const dates = series.lineData.map((d) => d.time);
  const values = series.lineData.map((d) => d.value);

  for (const exitZ of [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0]) {
    for (const stopZ of [3.5, 4, 4.5, 5, 6, 8, 99]) {
      const r = simulateMeanReversion(dates, values, { lookback: 60, entryZ: 3, exitZ, stopZ, costBp: 0.05, notional: 1_000_000 });
      const hit = r.summary.numTrades === 35 || Math.abs(r.summary.totalPnl - 70_400_000) < 600_000;
      if (hit || (r.summary.numTrades >= 33 && r.summary.numTrades <= 37)) {
        const last = r.trades[r.trades.length - 1];
        console.log(
          `${name} exit=${exitZ} stop=${stopZ}: trades=${r.summary.numTrades} net=${Math.round(r.summary.totalPnl).toLocaleString()}` +
            ` last=${last?.entryDate}->${last?.exitDate} ${last && last.direction > 0 ? "LONG" : "SHORT"} pnl=${last ? Math.round(last.pnl).toLocaleString() : "-"}${hit ? "  <<< HIT" : ""}`,
        );
      }
    }
  }
}
console.log("sweep2 done");
