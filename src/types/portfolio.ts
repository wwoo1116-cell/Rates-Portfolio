import type { AssetClass, Book, Tenor } from "@/lib/constants";

export type Direction = "Pay" | "Rec" | "Buy" | "Sell";

export interface Position {
  id: string;
  assetClass: AssetClass;
  book: Book;
  ticker: string;
  direction: Direction;
  tenor: Tenor;
  effectiveDate: string;
  maturityDate: string;
  notionalKrwEok: number;
  fixedRate: number;
  dv01: number;
  krd1y: number;
  krd3y: number;
  krd5y: number;
  krd10y: number;
  convexity: number;
  /** Real clean NPV from POST /api/portfolio/price (Phase 3). */
  npv?: number;
  /** True only for manual-positions-store.ts rows. Lets the grid's Delete
   * column and DetailsPanel branch without re-deriving it from id prefixes
   * or book-label string matching in multiple places. */
  isManual?: boolean;
  /** True for uploaded blotter bonds (bond-positions-store.ts). DetailsPanel
   * uses it to source cashflows from the bond CF endpoint instead of the
   * manual IRS price query; `assetClass` carries the bond sector. */
  isBond?: boolean;
}

export type GroupByOption = "none" | "assetClass" | "book" | "tenorBucket" | "direction";
