/** s19: exhaustive neighborhood sweep — does ANY plausible store state yield
 * the reported (35 trades, net 70,400,000) pair? */
import { simulateMeanReversion } from "../../src/lib/math/backtest";
import { buildInstrumentSeries, creditLegsOf, type SelectedInstrument } from "../../src/lib/rv-instruments";

const BE = "http://127.0.0.1:8000";
const ktb: SelectedInstrument = {
  kind: "spread",
  id: "S:1*국고채||10Y~-1*국고채||3Y",
  legs: [
    { leg: { sector: "국고채", rating: null, tenor: "10Y" }, weight: 1 },
    { leg: { sector: "국고채", rating: null, tenor: "3Y" }, weight: -1 },
  ],
};
const irs: SelectedInstrument = {
  kind: "spread",
  id: "S:1*IRS||10Y~-1*IRS||3Y",
  legs: [
    { leg: { sector: "IRS", rating: null, tenor: "10Y" }, weight: 1 },
    { leg: { sector: "IRS", rating: null, tenor: "3Y" }, weight: -1 },
  ],
};
const irs3y: SelectedInstrument = { kind: "outright", id: "O:IRS||3Y", leg: { sector: "IRS", rating: null, tenor: "3Y" } };
const irs10y: SelectedInstrument = { kind: "outright", id: "O:IRS||10Y", leg: { sector: "IRS", rating: null, tenor: "10Y" } };

const range = await (await fetch(`${BE}/api/market-data/range`)).json();
const history = await (await fetch(`${BE}/api/rate-history?start=${range.min_date}&end=${range.max_date}`)).json();

let hits = 0;
for (const [name, inst] of [["국고10-3", ktb], ["IRS10-3", irs], ["IRS3Y", irs3y], ["IRS10Y", irs10y]] as const) {
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
  const scale = series.kind === "spread" ? 1 : 10_000;
  const values = series.lineData.map((d) => d.value * scale);

  for (const lookback of [20, 40, 60, 90, 120]) {
    for (const entryZ of [1.5, 2, 2.5, 3, 3.5]) {
      for (const exitZ of [0.25, 0.5, 0.75, 1, 1.5]) {
        for (const stopZ of [3, 3.5, 4, 5, 99]) {
          if (stopZ <= entryZ) continue;
          const r = simulateMeanReversion(dates, values, { lookback, entryZ, exitZ, stopZ, costBp: 0.05, notional: 1_000_000 });
          if (r.summary.numTrades === 35 && Math.abs(r.summary.totalPnl - 70_400_000) < 300_000) {
            hits++;
            console.log(`HIT: ${name} lb=${lookback} entry=${entryZ} exit=${exitZ} stop=${stopZ}: 35 trades net=${Math.round(r.summary.totalPnl).toLocaleString()}`);
          }
        }
      }
    }
  }
  console.log(`${name} swept.`);
}
console.log(`sweep3 done — ${hits} exact hits for (35, 70.4M±0.3M)`);
