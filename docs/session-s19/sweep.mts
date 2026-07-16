/** s19: which (instrument, lookback, entryZ) produces the 35-trade / 70.4M
 * capture? Sweeps the plausible config space over live data. */
import { simulateMeanReversion } from "../../src/lib/math/backtest";
import { buildInstrumentSeries, creditLegsOf, type SelectedInstrument } from "../../src/lib/rv-instruments";

const BE = "http://127.0.0.1:8000";

function ktb(w10: number, w3: number): SelectedInstrument {
  return {
    kind: "spread",
    id: `S:${w10}*국고채||10Y~${w3}*국고채||3Y`,
    legs: [
      { leg: { sector: "국고채", rating: null, tenor: "10Y" }, weight: w10 },
      { leg: { sector: "국고채", rating: null, tenor: "3Y" }, weight: w3 },
    ],
  };
}
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

const INSTRUMENTS: [string, SelectedInstrument][] = [
  ["국고 10Y−3Y", ktb(1, -1)],
  ["국고 3Y−10Y (reversed)", ktb(-1, 1)],
  ["IRS 10Y−3Y", irsSpread],
];

for (const [name, inst] of INSTRUMENTS) {
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

  for (const lookback of [20, 60, 120]) {
    for (const entryZ of [2, 2.5, 3, 3.5]) {
      const r = simulateMeanReversion(dates, values, {
        lookback,
        entryZ,
        exitZ: 0.5,
        stopZ: 3.5,
        costBp: 0.05,
        notional: 1_000_000,
      });
      const last = r.trades[r.trades.length - 1];
      const flag = r.summary.numTrades === 35 || Math.abs(r.summary.totalPnl - 70_400_000) < 1_000_000 ? "  <<< CANDIDATE" : "";
      console.log(
        `${name} lb=${lookback} entry=${entryZ}σ: trades=${r.summary.numTrades} net=${Math.round(r.summary.totalPnl).toLocaleString()}` +
          (last ? ` lastTrade=${last.entryDate}->${last.exitDate} ${last.direction > 0 ? "LONG" : "SHORT"} pnl=${Math.round(last.pnl).toLocaleString()}` : "") +
          flag,
      );
    }
  }
  console.log("");
}
