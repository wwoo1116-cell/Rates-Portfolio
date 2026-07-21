/**
 * RECON-SCEN M1 + M3 — scenario-side reconciliation selectors over ONE
 * finished run (lastRunRequest + lastRun). Pure; no network, no engine call.
 *
 * Core rule (fixed): Assumed path(day) = Σ_tenor( KRD_tenor@baseDate ×
 * cumΔbp_tenor(day) ), KRD held CONSTANT at baseDate — vs the engine's
 * realized valuation path (decompositionDaily bondMtm + swapMtm, the
 * bond+swap component curves). The difference is the 잔차 path. It is a
 * RESIDUAL — everything the constant-KRD linear model does not capture
 * (position aging, remaining-tenor drift, FM revaluation convexity, pillar
 * bucketing) — and must NEVER be renamed to anything containing 테타/carry
 * (guarded by scenario-recon.test.ts).
 *
 * Sign convention: engine P&L per cell is −KRD × Δbp (aggregates.py
 * "MTM = pvbp * (-sbp)"; recon loop "_pnl_r = −pvbp × dbp") — long duration
 * loses on rising rates.
 *
 * M1 sources (why two): the response's pvbpSensitivity rows carry real KRD
 * only where krdMap reached the engine — swaps (enrich_irs_pvbp @ baseDate)
 * and legacy/golden payloads. The LIVE bridge sends bonds with krdMap:{}
 * (position-bridge.ts), so all-zero bond rows are rebuilt here from the
 * request positions themselves (pvbp bucketed at the position's tenor label —
 * the Home PVBP table's established convention). `derivedBondRows` discloses
 * which source produced the bond rows; both regimes are unit-tested.
 */
import type { SimulateRequest, SimulateResponse } from "../../api/simulate-dto";
import {
  createPathEvaluator,
  pillarYears,
  sectorToFamily,
  PATH_PILLARS,
  type CurveFamilyKey,
} from "./path-matrix";

/** The residual's ONLY name. A rename to anything containing 테타/carry/캐리
 * fails the guard test — the residual is not a theta and not a carry. */
export const RESIDUAL_LABEL = "잔차";
/** FB3 — the residual's fixed caption (owner spec, same as the daily 대사). */
export const RESIDUAL_CAPTION = "컨벡시티(+베이시스)";
export const ASSUMED_LABEL = "가정 경로";
/** FB3 ladder series labels — 예상 = 테타 + 가정; 실현 = 테타 + 평가 (the
 * engine lanes; funding stays outside the comparison). The old standalone
 * "엔진 평가 경로" label left this surface with the ladder redesign. */
export const EXPECTED_LABEL = "예상 경로";
export const REALIZED_LABEL = "실현 경로 (테타+평가)";

/** On-screen ladder + linearity caption (M3). States the bridge, the
 * linearity assumption, and what the 잔차 therefore measures. 테타 appears
 * here as a LADDER TERM — the residual itself is never named with it. */
export const LINEARITY_CAPTION =
  "예상 경로 = 테타(엔진 캐리 경로) + 가정(Σ테너 기준일 KRD 고정 × 설계 경로 누적Δbp, " +
  "선형 근사) — 실현 경로(테타+채권·스왑 평가)와 대사합니다. 차이가 잔차 = " +
  "컨벡시티(+베이시스)이며, 정확히 이 선형화(KRD 기준일 고정·에이징 무시)가 놓치는 " +
  "부분을 측정합니다. 펀딩은 비교 대상이 아닙니다.";

/** Non-tenor keys the backend folds into krdMap/tenors dicts. */
const NON_TENOR_KEYS = new Set(["합계", "total"]);

export interface KrdGridRow {
  sector: string;
  /** pillar label → ₩/bp (missing pillar = 0). */
  cells: Record<string, number>;
  total: number;
}

export interface KrdGrid {
  /** Ascending-tenor column labels: PATH_PILLARS ∪ every extra bucket the
   * data carries (full pillar set — a column set may never hide risk). */
  pillarLabels: string[];
  rows: KrdGridRow[];
  totalRow: KrdGridRow;
  /** True when bond rows had to be rebuilt from request positions because the
   * response's bond rows were empty (live-bridge krdMap:{} regime). */
  derivedBondRows: boolean;
}

function cleanTenors(tenors: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(tenors)) {
    if (!NON_TENOR_KEYS.has(k) && pillarYears(k) !== null && v !== 0) out[k] = v;
  }
  return out;
}

/** M1 — the KRD grid @ baseDate for the run. */
export function buildKrdGrid(req: SimulateRequest, resp: SimulateResponse): KrdGrid {
  // Defensive: legacy/partial payloads (and older cached runs) may lack
  // positions entirely — the grid then builds from whatever the response has.
  const positions = req.positions ?? [];
  const respRows = (resp.pvbpSensitivity ?? [])
    .filter((r) => r.sector !== "합계")
    .map((r) => ({ sector: r.sector, cells: cleanTenors(r.tenors ?? {}) }));

  const bondRespNonZero = respRows.some(
    (r) => sectorToFamily(r.sector) !== "swap" && Object.keys(r.cells).length > 0,
  );
  const hasBondPositions = positions.some((p) => p.bondType !== "swap");
  const derivedBondRows = !bondRespNonZero && hasBondPositions;

  let rows: { sector: string; cells: Record<string, number> }[];
  if (!derivedBondRows) {
    rows = respRows.filter((r) => Object.keys(r.cells).length > 0);
  } else {
    // Live-bridge regime: bond KRD rebuilt from the request positions
    // (pvbp @ tenor bucket, summed per sector) + the response's swap rows.
    const bySector = new Map<string, Record<string, number>>();
    for (const p of positions) {
      if (p.bondType === "swap" || !p.pvbp || !p.tenor || pillarYears(p.tenor) === null) continue;
      const cells = bySector.get(p.sector) ?? {};
      cells[p.tenor] = (cells[p.tenor] ?? 0) + p.pvbp;
      bySector.set(p.sector, cells);
    }
    rows = [
      ...[...bySector.entries()].map(([sector, cells]) => ({ sector, cells })),
      ...respRows.filter(
        (r) => sectorToFamily(r.sector) === "swap" && Object.keys(r.cells).length > 0,
      ),
    ];
  }

  // Column set: full pillar list plus any extra buckets present, tenor-ascending.
  const extra = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.cells)) {
      if (!PATH_PILLARS.some((p) => p.label === k)) extra.add(k);
    }
  }
  const pillarLabels = [
    ...PATH_PILLARS.map((p) => p.label),
    ...[...extra].sort((a, b) => (pillarYears(a) ?? 0) - (pillarYears(b) ?? 0)),
  ];

  const gridRows: KrdGridRow[] = rows.map((r) => ({
    sector: r.sector,
    cells: r.cells,
    total: Object.values(r.cells).reduce((s, v) => s + v, 0),
  }));
  const totalCells: Record<string, number> = {};
  for (const r of gridRows) {
    for (const [k, v] of Object.entries(r.cells)) totalCells[k] = (totalCells[k] ?? 0) + v;
  }
  return {
    pillarLabels,
    rows: gridRows,
    totalRow: {
      sector: "합계",
      cells: totalCells,
      total: gridRows.reduce((s, r) => s + r.total, 0),
    },
    derivedBondRows,
  };
}

export interface ReconPoint {
  day: number;
  /** ISO date when the response carries it (recon rows), else derived
   * calendar date baseDate + day. */
  date: string;
  /** FB3 ladder — 테타(day): the engine's cumulative carry lanes
   * (decompositionDaily bondCarry + swapCarry; swap lane 0 when excluded). */
  theta: number;
  assumed: number;
  /** 테타 + 가정 — the ladder's 예상 path. */
  expected: number;
  /** The engine's valuation lanes (bondMtm + swapMtm) — kept under its
   * original name; the 잔차 is defined against THIS, so its values are
   * byte-identical to the pre-ladder surface (pinned). */
  engine: number;
  /** 테타 + engine — the ladder's 실현 path (== decompositionDaily total −
   * fundingCost, ±₩1 pinned). */
  realized: number;
  residual: number;
}

export interface ScenarioRecon {
  points: ReconPoint[];
  /** True when the run excluded swaps — the engine lane is then bond-only and
   * the swap KRD rows are absent, so the comparison stays like-for-like. */
  swapsExcluded: boolean;
  grid: KrdGrid;
}

function isoDayAfter(baseDate: string, day: number): string {
  const ms = Date.parse(baseDate);
  if (Number.isNaN(ms)) return `D+${day}`;
  return new Date(ms + day * 86400000).toISOString().slice(0, 10);
}

/** M3 — assumed vs engine valuation vs 잔차, on the run's business-day axis
 * (decompositionDaily). Day 0 included (all lanes 0). */
export function buildScenarioRecon(req: SimulateRequest, resp: SimulateResponse): ScenarioRecon {
  const grid = buildKrdGrid(req, resp);
  const ev = createPathEvaluator(req);
  const swapsExcluded = (resp.exclusions ?? []).some((x) => x.assetClass === "swap");

  // Flatten the grid once into (family, tenorYears, krd) cells; swap rows are
  // dropped when the engine excluded swaps (their valuation lane is null).
  const cells: { family: CurveFamilyKey; t: number; krd: number }[] = [];
  for (const row of grid.rows) {
    const family = sectorToFamily(row.sector);
    if (swapsExcluded && family === "swap") continue;
    for (const [label, krd] of Object.entries(row.cells)) {
      const t = pillarYears(label);
      if (t !== null && krd !== 0) cells.push({ family, t, krd });
    }
  }

  const dateByDay = new Map<number, string>();
  for (const r of resp.irsDailyReconciliation ?? []) dateByDay.set(r.day, r.date);

  const points: ReconPoint[] = (resp.decompositionDaily ?? []).map((row) => {
    const assumed = cells.reduce((s, c) => s - c.krd * ev.cumBpAt(c.family, c.t, row.day), 0);
    const engine = row.bondMtm + (row.swapMtm ?? 0);
    // FB3 ladder terms. theta = the engine's own cumulative carry lanes
    // (bondCarry excludes funding by construction — decompositionDaily's
    // fundingCost is a separate component); realized = theta + valuation
    // == row.total − row.fundingCost (±₩1, pinned in tests). The 잔차 stays
    // engine − assumed, byte-identical to the pre-ladder definition.
    const theta = row.bondCarry + (row.swapCarry ?? 0);
    return {
      day: row.day,
      date: dateByDay.get(row.day) ?? isoDayAfter(req.baseDate, row.day),
      theta,
      assumed,
      expected: theta + assumed,
      engine,
      realized: theta + engine,
      residual: engine - assumed,
    };
  });

  return { points, swapsExcluded, grid };
}

export interface ContributionGrid {
  /** Same ascending-tenor column set as the KRD grid (full pillar set). */
  pillarLabels: string[];
  /** Per-sector contribution row: cell = −KRD@baseDate × cumΔbp(day). */
  rows: KrdGridRow[];
  /** Column totals + the book-level total (== ScenarioRecon assumed(day)). */
  totalRow: KrdGridRow;
  /** Σ over every cell — ties to the 시나리오 대사 summary's Assumed for the
   * day (the linearity-caption tolerance applies: same terms, sum order aside). */
  bookTotal: number;
}

/** M3 — the scenario contribution grid for one day: 기여 = KRD@baseDate ×
 * (designed path cumΔbp), the per-(sector × tenor) decomposition of the day's
 * Assumed. Built from the SAME KRD grid and evaluator buildScenarioRecon uses,
 * with the SAME engine P&L sign (−KRD × Δbp) and the SAME swap-exclusion rule,
 * so Σ over the grid IS assumed(day) by construction (no forked math). Cells a
 * sector doesn't carry stay absent (→ null → em-dash); a carried cell whose
 * cumΔbp is 0 (e.g. 1D/3M without 금통위) is a genuine 0.0, per FB3 T2. */
export function buildContributionGrid(
  req: SimulateRequest,
  resp: SimulateResponse,
  day: number,
): ContributionGrid {
  const grid = buildKrdGrid(req, resp);
  const ev = createPathEvaluator(req);
  const swapsExcluded = (resp.exclusions ?? []).some((x) => x.assetClass === "swap");

  const rows: KrdGridRow[] = [];
  for (const row of grid.rows) {
    const family = sectorToFamily(row.sector);
    if (swapsExcluded && family === "swap") continue;
    const cells: Record<string, number> = {};
    let total = 0;
    for (const [label, krd] of Object.entries(row.cells)) {
      const t = pillarYears(label);
      if (t === null) continue;
      const contrib = -krd * ev.cumBpAt(family, t, day);
      cells[label] = contrib;
      total += contrib;
    }
    rows.push({ sector: row.sector, cells, total });
  }

  const totalCells: Record<string, number> = {};
  let bookTotal = 0;
  for (const r of rows) {
    for (const [label, v] of Object.entries(r.cells)) totalCells[label] = (totalCells[label] ?? 0) + v;
    bookTotal += r.total;
  }

  return {
    pillarLabels: grid.pillarLabels,
    rows,
    totalRow: { sector: "합계", cells: totalCells, total: bookTotal },
    bookTotal,
  };
}
