import type { LucideIcon } from "lucide-react";
import { FlaskConical, History, Home, Table2, Target } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Portfolio Management", href: "/portfolio", icon: Table2 },
  { label: "Backtest", href: "/backtest", icon: History },
  { label: "Simulation", href: "/simulation", icon: FlaskConical },
  { label: "Optimal Portfolio", href: "/optimal", icon: Target },
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
export type AssetClass = (typeof ASSET_CLASSES)[number];

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
