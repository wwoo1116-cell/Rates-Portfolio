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
}

export type GroupByOption = "none" | "assetClass" | "book" | "tenorBucket" | "direction";
