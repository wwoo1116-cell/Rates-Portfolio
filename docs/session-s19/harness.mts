/**
 * s19 diagnosis harness — runs the EXACT frontend modules (buildInstrumentSeries,
 * simulateMeanReversion, rollingZScore, the panels' marker constructions) over
 * the LIVE backend data (127.0.0.1:8000) for the three reproduction configs,
 * then performs the T1 bijection and the windowing math. Diagnosis artifact:
 * never imported by app code, run manually via `npx tsx docs/session-s19/harness.mts`.
 */
import { simulateMeanReversion, type BtResult, type BtTrade } from "../../src/lib/math/backtest";
import { rollingZScore, alignToDates } from "../../src/lib/math/rolling-stats";
import {
  buildInstrumentSeries,
  creditLegsOf,
  type SelectedInstrument,
} from "../../src/lib/rv-instruments";

const BE = "http://127.0.0.1:8000";
const MIN_BAR_SPACING = 0.5; // lightweight-charts default (dist line 12348)

const KTB_SPREAD: SelectedInstrument = {
  kind: "spread",
  id: "S:1*국고채||10Y~-1*국고채||3Y",
  legs: [
    { leg: { sector: "국고채", rating: null, tenor: "10Y" }, weight: 1 },
    { leg: { sector: "국고채", rating: null, tenor: "3Y" }, weight: -1 },
  ],
};
const IRS_SPREAD: SelectedInstrument = {
  kind: "spread",
  id: "S:1*IRS||10Y~-1*IRS||3Y",
  legs: [
    { leg: { sector: "IRS", rating: null, tenor: "10Y" }, weight: 1 },
    { leg: { sector: "IRS", rating: null, tenor: "3Y" }, weight: -1 },
  ],
};
const IRS_3Y: SelectedInstrument = {
  kind: "outright",
  id: "O:IRS||3Y",
  leg: { sector: "IRS", rating: null, tenor: "3Y" },
};

const CONFIGS = [
  { name: "A: 국고 10Y−3Y, lookback 60, entry 3σ (expect 35 trades / 70.4M)", inst: KTB_SPREAD, lookback: 60, entryZ: 3.0, exitZ: 0.5, stopZ: 3.5, costBp: 0.05, notional: 1_000_000 },
  { name: "B: IRS 10Y−3Y, defaults entry 2σ (expect 92 trades / 71.45M)", inst: IRS_SPREAD, lookback: 60, entryZ: 2.0, exitZ: 0.5, stopZ: 3.5, costBp: 0.05, notional: 1_000_000 },
  { name: "C: IRS 3Y outright, defaults entry 2σ (expect 69 trades / −432.4M)", inst: IRS_3Y, lookback: 60, entryZ: 2.0, exitZ: 0.5, stopZ: 3.5, costBp: 0.05, notional: 1_000_000 },
] as const;

interface MarkerTuple { time: string; position: string; shape: string; text: string }

/** Markers exactly as equity-curve-panel.tsx constructs them from trades. */
function equityMarkers(trades: BtTrade[]): MarkerTuple[] {
  const out: MarkerTuple[] = [];
  for (const t of trades) {
    const long = t.direction > 0;
    out.push({ time: t.entryDate, position: long ? "belowBar" : "aboveBar", shape: "circle", text: long ? "L" : "S" });
    out.push({ time: t.exitDate, position: "aboveBar", shape: "square", text: "×" });
  }
  out.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}

/** Markers exactly as zscore-oscillator-panel.tsx derives them (first crossing
 * into the entry zone), INDEPENDENT of the trade list. */
function oscillatorMarkers(dates: string[], values: number[], lookback: number, entryZ: number): MarkerTuple[] {
  const z = rollingZScore(values, lookback);
  const out: MarkerTuple[] = [];
  let wasBreaching = false;
  for (let i = 0; i < z.length; i++) {
    const zi = z[i];
    if (zi == null) continue;
    const breaching = Math.abs(zi) >= entryZ;
    if (breaching && !wasBreaching) {
      const rich = zi > 0;
      out.push({ time: dates[i], position: rich ? "aboveBar" : "belowBar", shape: "circle", text: rich ? "SHORT" : "LONG" });
    }
    wasBreaching = breaching;
  }
  return out;
}

function bijection(
  label: string,
  expected: MarkerTuple[], // derived from trades (the source of truth)
  actual: MarkerTuple[], // what the chart is handed
  barTimes: Set<string>,
) {
  const key = (m: MarkerTuple) => `${m.time}|${m.position}|${m.shape}|${m.text}`;
  const exp = new Map(expected.map((m) => [key(m), m]));
  const act = new Map(actual.map((m) => [key(m), m]));
  const orphans = [...act.keys()].filter((k) => !exp.has(k)); // injective fail
  const missing = [...exp.keys()].filter((k) => !act.has(k)); // surjective fail
  const offBar = actual.filter((m) => !barTimes.has(m.time));
  console.log(`  [T1 ${label}] expected=${expected.length} actual=${actual.length}`);
  console.log(`    injective (no orphan markers): ${orphans.length === 0 ? "PASS" : `FAIL — ${orphans.length} orphans; first: ${orphans[0]}`}`);
  console.log(`    surjective (no missing markers): ${missing.length === 0 ? "PASS" : `FAIL — ${missing.length} missing; first: ${missing[0]}`}`);
  console.log(`    aligned/on-bar (time ∈ bar array): ${offBar.length === 0 ? "PASS" : `FAIL — ${offBar.length} off-bar; first: ${JSON.stringify(offBar[0])}`}`);
  if (orphans.length || missing.length) {
    const firstBreakKey = missing[0] ?? orphans[0];
    console.log(`    first break: expected=${JSON.stringify(exp.get(missing[0]!) ?? null)} actual=${JSON.stringify(act.get(orphans[0]!) ?? null)}`);
  }
}

function holdingStats(trades: BtTrade[], dates: string[]) {
  const idx = new Map(dates.map((d, i) => [d, i]));
  const holds = trades.map((t) => (idx.get(t.exitDate)! - idx.get(t.entryDate)!));
  holds.sort((a, b) => a - b);
  const med = holds.length ? holds[Math.floor(holds.length / 2)] : null;
  return { min: holds[0], median: med, max: holds[holds.length - 1] };
}

function windowMath(name: string, result: BtResult, paneWidthPx: number) {
  const n = result.points.length;
  const maxVisible = Math.floor(paneWidthPx / MIN_BAR_SPACING);
  if (n <= maxVisible) {
    console.log(`  [window ${paneWidthPx}px] all ${n} bars fit (max ${maxVisible}) — no clamp`);
    return;
  }
  const firstVisibleIdx = n - maxVisible;
  const first = result.points[firstVisibleIdx];
  const cumAtEdge = result.points[firstVisibleIdx - 1]?.cumulativePnl ?? 0;
  const tradesInWindow = result.trades.filter((t) => t.exitDate >= first.date);
  const entriesInWindow = result.trades.filter((t) => t.entryDate >= first.date);
  console.log(
    `  [window ${paneWidthPx}px] minBarSpacing clamp: ${maxVisible}/${n} bars visible; left edge = ${first.date}` +
      `\n    cumulative accrued BEFORE left edge: ${Math.round(cumAtEdge).toLocaleString()}` +
      `\n    trades with exit in window: ${tradesInWindow.length} · entries in window: ${entriesInWindow.length}`,
  );
}

async function getJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

const range = await getJson(`${BE}/api/market-data/range`);
const { min_date, max_date } = range;
console.log(`market data range: ${min_date} .. ${max_date}\n`);
const history = await getJson(`${BE}/api/rate-history?start=${min_date}&end=${max_date}`);

for (const cfg of CONFIGS) {
  console.log(`\n=== ${cfg.name} ===`);
  const creditLegs = creditLegsOf([cfg.inst]);
  let creditResults: unknown[] = [];
  if (creditLegs.length > 0) {
    const resp = await getJson(`${BE}/api/credit-curve/series`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ legs: creditLegs, start_date: min_date, end_date: max_date }),
    });
    creditResults = resp.results ?? [];
  }
  const [series] = buildInstrumentSeries([cfg.inst], history.points, creditResults as never);
  const dates = series.lineData.map((d) => d.time);
  const scale = series.kind === "spread" ? 1 : 10_000;
  const values = series.lineData.map((d) => d.value * scale);
  console.log(`  series: ${dates.length} bars, ${dates[0]} .. ${dates[dates.length - 1]}`);

  const result = simulateMeanReversion(dates, values, cfg);
  const s = result.summary;
  const hold = holdingStats(result.trades, dates);
  console.log(
    `  KPIs: trades=${s.numTrades} net=${Math.round(s.totalPnl).toLocaleString()} ` +
      `win=${s.winRate == null ? "—" : (s.winRate * 100).toFixed(0) + "%"} sharpe=${s.sharpe?.toFixed(2)} mdd=${Math.round(s.maxDrawdown).toLocaleString()}`,
  );
  console.log(`  holding days: min=${hold.min} median=${hold.median} max=${hold.max}`);
  console.log(`  points[0]: ${result.points[0].date} cumulative=${result.points[0].cumulativePnl} (data starts at ${result.points[0].cumulativePnl === 0 ? "ZERO" : "NON-ZERO!"})`);

  // How "steppy" is the true curve? Days with P&L movement while in a position
  // (daily revaluation) vs flat days.
  const moveDays = result.points.filter((p) => Math.abs(p.dailyPnl) > 1e-9).length;
  const inPosDays = result.points.filter((p) => p.position !== 0).length;
  console.log(`  daily revaluation: ${moveDays} days with dailyPnl≠0, ${inPosDays} in-position days, of ${result.points.length} total (flat-position days are flat by design)`);

  // T1 — equity chart: markers ARE derived from trades; verify bijection + on-bar.
  const eqBars = new Set(result.points.map((p) => p.date));
  bijection("equity markers vs trades", equityMarkers(result.trades), equityMarkers(result.trades), eqBars);

  // T1 — oscillator: markers derived INDEPENDENTLY (first z-crossing). Compare
  // against trade ENTRY events (the thing a user believes they mark).
  const oscBars = new Set(alignToDates(dates, rollingZScore(values, cfg.lookback)).map((p) => p.time));
  const tradeEntryMarkers: MarkerTuple[] = result.trades.map((t) => ({
    time: t.entryDate,
    position: t.direction > 0 ? "belowBar" : "aboveBar",
    shape: "circle",
    text: t.direction > 0 ? "LONG" : "SHORT",
  }));
  bijection("oscillator markers vs trade entries", tradeEntryMarkers, oscillatorMarkers(dates, values, cfg.lookback, cfg.entryZ), oscBars);

  // Windowing math at representative pane widths (s17 grid cell ≈ 640px,
  // pre-s17 dockview equity ≈ 900px, maximized ≈ 1500px).
  for (const w of [640, 900, 1280, 1500]) windowMath(cfg.name, result, w);
}
console.log("\ndone");
