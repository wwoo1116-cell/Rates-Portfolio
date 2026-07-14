"use client";

/**
 * Client-side parser for an uploaded bond blotter Excel (SheetJS/xlsx). Reads
 * the sheet, locates the header row (tolerating title rows above it), and
 * hydrates BondPosition rows -- with particular care taken over issue/maturity
 * date parsing (Excel dates arrive as JS Date, Excel serial numbers, or strings
 * in several Korean formats) and sector classification (국고채/은행채/…).
 *
 * Coupon comes from the 표면이율 column (the KTB name pattern "국고03125-2606"
 * is only a fallback). payment_frequency is injected by sector convention
 * (국고채·통안채 = 2 semi-annual; credit = 4 quarterly). No cash-flow / NPV math
 * is done here.
 */

import * as XLSX from "xlsx";
import { BOND_SECTORS } from "@/lib/constants";
import type { BondPosition } from "@/stores/bond-positions-store";

// First-present-wins candidate headers per field (mirrors the loader's
// _first_present over _FIXED_RATE_COLUMNS in irs_pricer/loaders/portfolio.py).
const HEADER_CANDIDATES = {
  name: ["종목명", "종목명(약어)", "종목약어", "채권명", "종목", "약어", "bond name", "name", "alias", "isin"],
  sector: ["상품소분류명", "종목분류", "채권분류", "섹터", "분류", "sector", "종류"],
  coupon: ["표면이율", "표면금리", "쿠폰금리", "쿠폰", "coupon", "coupon rate"],
  issueDate: ["발행일", "발행일자", "발행", "issue date", "issue_date", "issuedate"],
  maturityDate: ["만기일", "만기일자", "만기", "상환일", "상환일자", "maturity date", "maturity_date", "maturitydate"],
  notional: ["결제장부수량(만)", "장부수량(만)", "액면금액", "액면", "장부금액", "보유액면", "보유수량", "수량", "notional", "face"],
  rating: ["신용등급", "등급", "rating", "credit rating"],
  book: ["북", "book", "계정", "펀드", "펀드명"],
  evaluation: ["평가금액", "평가액", "평가금액(원)", "market value"],
  mtmYield: ["민평수익율", "민평수익률", "평가수익율", "평가수익률", "시장수익률", "유통수익률"],
} as const;

type Field = keyof typeof HEADER_CANDIDATES;

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/** Resolve the column index for a field by matching any candidate header
 * (exact-normalized first, then substring). */
function resolveIndex(headerRow: unknown[], field: Field): number {
  const cands = HEADER_CANDIDATES[field].map(norm);
  const cells = headerRow.map(norm);
  for (let i = 0; i < cells.length; i++) if (cands.includes(cells[i])) return i;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] && cands.some((c) => cells[i].includes(c) || c.includes(cells[i]))) return i;
  }
  return -1;
}

/** Pick the header row: the first row that matches at least two known fields
 * (guards against a title/metadata row sitting above the real header). */
function findHeaderRow(rows: unknown[][]): number {
  const fields = Object.keys(HEADER_CANDIDATES) as Field[];
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const hits = fields.filter((f) => resolveIndex(rows[r], f) !== -1).length;
    if (hits >= 2) return r;
  }
  return 0;
}

const pad2 = (n: number | string) => String(n).padStart(2, "0");

/** Robust date parse -> "YYYY-MM-DD" (or "" if unparseable). Handles JS Date
 * (cellDates), Excel serials, YYYYMMDD, and 2026-06-10 / 2026.06.10 / 2026/6/10
 * / "2026년 6월 10일". */
export function parseBlotterDate(v: unknown): string {
  if (v == null || v === "") return "";

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }

  if (typeof v === "number" && Number.isFinite(v)) {
    // 8-digit YYYYMMDD (e.g. 20260610) is a literal date, not a serial.
    if (v >= 19000101 && v <= 99991231 && Number.isInteger(v)) {
      return fromYyyyMmDd(String(v));
    }
    // Excel serial day count (days since 1899-12-30).
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return Number.isNaN(d.getTime())
      ? ""
      : `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  const s = String(v).trim();
  const ymd = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); // 2026-06-10, 2026.6.10, 2026년 6월 10일
  if (ymd) return `${ymd[1]}-${pad2(ymd[2])}-${pad2(ymd[3])}`;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 8) return fromYyyyMmDd(digits);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fromYyyyMmDd(digits: string): string {
  const y = digits.slice(0, 4);
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

// 상품소분류명 / raw label -> classification sector. Ports _BOND_SECTOR_MAP
// (irs_pricer/loaders/portfolio.py) and adds the directive's raw labels.
const SECTOR_MAP: Record<string, string> = {
  국고채: "국고채", 통안채: "통안채",
  특수은행채: "특은채", 일반은행채: "시은채", 은행채: "시은채",
  공사공단채: "공사채", 비금융특수채: "공사채", 지방공사특수채: "공사채", 특수채: "공사채",
  금융회사채: "여전채", 일반사채: "회사채", 회사채: "회사채",
};

export function normalizeSector(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "기타";
  if (SECTOR_MAP[s]) return SECTOR_MAP[s];
  if ((BOND_SECTORS as readonly string[]).includes(s)) return s;
  for (const [k, v] of Object.entries(SECTOR_MAP)) if (s.includes(k)) return v;
  if (s.includes("국고")) return "국고채";
  if (s.includes("통안")) return "통안채";
  return "기타";
}

/** 국고채·통안채 = 2 (semi-annual); every credit sector = 4 (quarterly). */
export function sectorToPaymentFrequency(sector: string): number {
  return sector === "국고채" || sector === "통안채" ? 2 : 4;
}

/** Coupon from the KTB alias pattern "국고03125-2606" (03125 -> 3.125%);
 * fallback only -- the 표면이율 column is the primary source. */
export function parseCouponFromName(name: string): number | null {
  const m = /국고\s*(\d{5})-\d{4}/.exec(String(name ?? ""));
  if (!m) return null;
  const c = Number(m[1]) / 1000;
  return c > 0 && c < 20 ? c : null;
}

const KRW_PER_EOK = 100_000_000;

/** Parse the workbook into BondPositions. Rows without a resolvable maturity
 * date are dropped (they can't be scheduled/aged). */
export function parseBlotterWorkbook(wb: XLSX.WorkBook): BondPosition[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null });
  if (rows.length === 0) return [];

  const headerIdx = findHeaderRow(rows);
  const header = rows[headerIdx];
  const idx = Object.fromEntries(
    (Object.keys(HEADER_CANDIDATES) as Field[]).map((f) => [f, resolveIndex(header, f)]),
  ) as Record<Field, number>;

  const cell = (row: unknown[], f: Field): unknown => (idx[f] >= 0 ? row[idx[f]] : null);
  const today = new Date();
  const out: BondPosition[] = [];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c == null || c === "")) continue;

    const name = String(cell(row, "name") ?? "").trim();
    const issueDate = parseBlotterDate(cell(row, "issueDate"));
    const maturityDate = parseBlotterDate(cell(row, "maturityDate"));
    if (!maturityDate) continue; // unschedulable without a maturity

    const sector = normalizeSector(cell(row, "sector"));
    const couponCol = toNumber(cell(row, "coupon"));
    const couponRate = Number.isFinite(couponCol) ? couponCol : parseCouponFromName(name) ?? 0;

    // Notional -> 억 (store convention). "…(만)" columns are in 만원.
    const notionalHeader = idx.notional >= 0 ? String(header[idx.notional] ?? "") : "";
    const rawNotional = toNumber(cell(row, "notional"));
    let notionalKrwEok = 0;
    if (Number.isFinite(rawNotional)) {
      if (notionalHeader.includes("만")) notionalKrwEok = (rawNotional * 10_000) / KRW_PER_EOK;
      else if (notionalHeader.includes("억")) notionalKrwEok = rawNotional;
      else notionalKrwEok = rawNotional / KRW_PER_EOK; // assume raw KRW
    }

    const ratingRaw = String(cell(row, "rating") ?? "").trim();
    const rating = ratingRaw || null;
    const evalEok = Number.isFinite(toNumber(cell(row, "evaluation")))
      ? toNumber(cell(row, "evaluation")) / KRW_PER_EOK
      : 0;
    const mtmYield = Number.isFinite(toNumber(cell(row, "mtmYield"))) ? toNumber(cell(row, "mtmYield")) : 0;

    const remainingDays = Math.max(
      0,
      Math.round((new Date(maturityDate).getTime() - today.getTime()) / 86400000),
    );
    const remainingYears = remainingDays / 365;

    out.push({
      id: name || `bond-${r}`,
      name: name || `Bond ${r}`,
      sector,
      book: String(cell(row, "book") ?? "Imported").trim() || "Imported",
      notionalKrwEok,
      evaluationAmountKrwEok: evalEok,
      remainingDays,
      tenorBucket: yearsToTenorBucket(remainingYears),
      entryYield: couponRate, // grid Rate column shows the coupon
      mtmYield,
      duration: 0,
      pvbp: 0,
      issueDate,
      maturityDate,
      couponRate,
      paymentFrequency: sectorToPaymentFrequency(sector),
      rating,
    });
  }

  return out;
}

function yearsToTenorBucket(y: number): string {
  if (y < 1) return "0-1Y";
  if (y < 3) return "1-3Y";
  if (y < 5) return "3-5Y";
  if (y < 10) return "5-10Y";
  return "10Y+";
}

/** Read a File (from an <input type=file>) and parse it into BondPositions. */
export async function parseBlotterFile(file: File): Promise<BondPosition[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  return parseBlotterWorkbook(wb);
}
