import type { LucideIcon } from "lucide-react";
// DEMO-DEBT (demo sprint 2026-07-20): Crosshair icon import parked with the
// hidden Entry Signals nav item below — restore both together.
import { FlaskConical, History, Home, Settings, Table2, Target } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Portfolio Management", href: "/portfolio", icon: Table2 },
  { label: "Rates History", href: "/rates-history", icon: History },
  // DEMO-DEBT (demo sprint 2026-07-20): Entry Signals HIDDEN, not deleted —
  // unused for the demo. Slice source/tests/store untouched; the route 404s
  // via notFound() in app/(workspace)/entry-signals/page.tsx. Restore =
  // uncomment this line (+ Crosshair import above) and revert that page.
  // NOTE hiding shifts the Cmd+1~6 nav shortcuts one slot from #4 on.
  // { label: "Entry Signals", href: "/entry-signals", icon: Crosshair },
  { label: "Simulation", href: "/simulation", icon: FlaskConical },
  { label: "Optimal Portfolio", href: "/optimal", icon: Target },
  // 7번째 항목이라 Cmd+1~6 단축키 범위 밖 -- sidebar.tsx 키핸들러 수정 불필요.
  { label: "Settings", href: "/settings", icon: Settings },
];

export const MOCK_WORKSPACES = ["Workspace 1", "Workspace 2", "Workspace 3"] as const;

/**
 * KTB cash curve (Benchmark, on-the-run benchmarks only). Distinct from IRS_TENORS —
 * see WORK_ORDER.md §10(2). Used by the KTB curve chart, not general tenor selectors.
 */
export const KTB_TENORS = ["3Y", "5Y", "10Y", "20Y", "30Y"] as const;

/** Fuller tenor set for IRS/CRS curve and general tenor selectors (filters, Simulation, Backtest). */
export const IRS_TENORS = [
  "3M",
  "6M",
  "1Y",
  "2Y",
  "3Y",
  "5Y",
  "7Y",
  "10Y",
  "20Y",
  "30Y",
] as const;

export type Tenor = (typeof IRS_TENORS)[number];

export const BOOKS = ["CMA RP", "NAVER CMA", "RP Trading"] as const;
export type Book = (typeof BOOKS)[number];

export const ASSET_CLASSES = ["IRS", "KTB", "CRS", "KTBF"] as const;

/** Korean bond sectors used to CLASSIFY uploaded blotter bonds in the grid
 * (matches loaders/portfolio.py:_BOND_SECTOR_MAP + credit_taxonomy sectors).
 * A bond position's `assetClass` is set to one of these so the Positions grid
 * shows 국고채/통안채/은행채… rather than a generic "Bond". */
export const BOND_SECTORS = [
  "국고채", "통안채", "특은채", "시은채", "공사채", "여전채", "회사채", "기타",
] as const;
export type BondSector = (typeof BOND_SECTORS)[number];

export type AssetClass = (typeof ASSET_CLASSES)[number] | BondSector;

const TENOR_BUCKET_MAP: Record<Tenor, string> = {
  "3M": "0-1Y",
  "6M": "0-1Y",
  "1Y": "0-1Y",
  "2Y": "1-3Y",
  "3Y": "1-3Y",
  "5Y": "3-5Y",
  "7Y": "5-10Y",
  "10Y": "5-10Y",
  "20Y": "10Y+",
  "30Y": "10Y+",
};

export const TENOR_BUCKETS = ["0-1Y", "1-3Y", "3-5Y", "5-10Y", "10Y+"] as const;
export type TenorBucket = (typeof TENOR_BUCKETS)[number];

export function getTenorBucket(tenor: string): string {
  return TENOR_BUCKET_MAP[tenor as Tenor] ?? tenor;
}
