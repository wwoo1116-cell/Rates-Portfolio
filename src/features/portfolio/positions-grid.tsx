"use client";

import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ColDef, GridOptions, ModuleRegistry } from "ag-grid-community";
import { usePortfolioFiltersStore } from "@/stores/portfolio-filters-store";
import type { Position } from "@/types/portfolio";
import { usePortfolioPositions } from "./use-portfolio-positions";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-balham.css";

// Required as of ag-grid v33 -- without this, every AgGridReact instance
// silently renders zero rows (AG Grid error #272, "No AG Grid modules are
// registered!") no matter what rowData/columnDefs it receives.
ModuleRegistry.registerModules([AllCommunityModule]);

// We'll use PriceDisplay via a custom cell renderer, or just rely on value formatter for simplicity.
// But the spec says "Render the core integers (Big Figure) at standard size... pips smaller".
// We can use a React cell renderer!
import { PriceDisplay } from "@/components/data/price-display";

export function PositionsGrid() {
  const filters = usePortfolioFiltersStore((state) => state.filters);
  const rowHeight = usePortfolioFiltersStore((state) => state.rowHeight);
  const setSelectedPositionId = usePortfolioFiltersStore((state) => state.setSelectedPositionId);
  const { positions, isError } = usePortfolioPositions();

  const filteredData = useMemo(() => {
    if (filters.length === 0) return positions;
    return positions.filter((pos) =>
      filters.every((filter) => {
        const fieldValue =
          filter.key === "book"       ? pos.book :
          filter.key === "assetClass" ? pos.assetClass :
          filter.key === "tenor"      ? pos.tenor :
          pos.direction;
        return filter.values.includes(fieldValue);
      }),
    );
  }, [filters, positions]);

  const defaultColDef: ColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
    filter: false,
    minWidth: 60,
    cellStyle: { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" },
  }), []);

  const columnDefs: ColDef[] = useMemo(() => [
    { field: "id", headerName: "Trade ID", width: 100, cellStyle: { color: "var(--fg-secondary)" } },
    { field: "book", headerName: "Book", width: 90 },
    { field: "assetClass", headerName: "Asset", width: 130 },
    { 
      field: "direction", 
      headerName: "Dir", 
      width: 70,
      cellStyle: (params) => ({
        color: params.value === "Pay" ? "var(--sem-negative)" : "var(--sem-positive)",
        fontWeight: 600
      })
    },
    { field: "tenor", headerName: "Tenor", width: 80 },
    { 
      field: "fixedRate", 
      headerName: "Rate", 
      width: 100,
      cellRenderer: (params: { value: number | null | undefined }) => {
        if (params.value == null) return null;
        return <PriceDisplay value={params.value} unit="%" />;
      }
    },
    { 
      field: "notionalKrwEok", 
      headerName: "Notional (100M KRW)", 
      width: 150, 
      type: "numericColumn",
      valueFormatter: (params) => params.value ? params.value.toLocaleString() : ""
    },
    { 
      field: "dv01", 
      headerName: "DV01", 
      width: 110, 
      type: "numericColumn",
      valueFormatter: (params) => params.value ? Math.round(params.value).toLocaleString() : ""
    },
    {
      headerName: "MTM",
      width: 110,
      type: "numericColumn",
      // Real IRS rows: clean NPV from POST /api/portfolio/price (Phase 3).
      // Mock rows (KTB/KTBF/CRS): unchanged placeholder formula -- no pricing
      // engine exists for them yet (MIGRATION_PLAN.md §3 gap table).
      valueGetter: (params) => {
        if (!params.data) return null;
        if (params.data.npv != null) return params.data.npv;
        return params.data.notionalKrwEok * (params.data.fixedRate / 100) * 0.5;
      },
      valueFormatter: (params) => params.value ? Math.round(params.value).toLocaleString() : ""
    }
  ], []);

  const gridOptions: GridOptions = useMemo(() => ({
    animateRows: false,
    suppressMovableColumns: false,
    rowSelection: "single",
    rowHeight: rowHeight === "dense" ? 24 : 28,
    headerHeight: 30,
    onRowClicked: (event) => {
      if (event.data) setSelectedPositionId(event.data.id);
    }
  }), [rowHeight, setSelectedPositionId]);

  return (
    <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
      {isError && (
        <div className="px-3 py-1.5 text-micro text-fg-muted border-b border-border-subtle bg-bg-tertiary">
          Could not load positions from the pricing server.
        </div>
      )}
      <div className="ag-theme-balham-dark" style={{ flex: 1, minHeight: 0, background: "var(--bg-surface)" }}>
        <AgGridReact
          // Pin to the classic CSS-file theme (ag-grid.css + ag-theme-balham-dark
          // above). Without this, ag-grid v33's new Theming API kicks in by
          // default (themeQuartz, a light theme) and fights the imported dark
          // CSS for parts of the grid -- AG Grid error #239, and the cause of
          // the grid rendering with white/light patches instead of full dark mode.
          theme="legacy"
          rowData={filteredData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          {...gridOptions}
        />
      </div>
    </div>
  );
}
