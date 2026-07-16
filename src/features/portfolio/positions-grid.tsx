"use client";

import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ColDef, GridOptions, ModuleRegistry } from "ag-grid-community";
import { Trash2, Upload } from "lucide-react";
import { usePortfolioFiltersStore } from "@/stores/portfolio-filters-store";
import { useManualPositionsStore } from "@/stores/manual-positions-store";
import { useBondPositionsStore } from "@/stores/bond-positions-store";
import { Button } from "@/components/ui/button";
import { toast } from "@/stores/toast-store";
import type { Position } from "@/types/portfolio";
import { directionPnlColor } from "@/lib/direction-color";
import { usePortfolioPositions } from "./use-portfolio-positions";
import { parseBlotterFile } from "./blotter-parser";
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

// Only manual rows are deletable (they're the only ones in global client
// state). Uses the store's imperative getState() rather than the
// useManualPositionsStore() hook, since this renderer only needs to fire an
// action, not subscribe/re-render -- avoids any question of whether hooks
// behave correctly inside an ag-grid-react inline cellRenderer.
function DeleteCellRenderer(params: { data?: Position }) {
  if (!params.data?.isManual) return null;
  const id = params.data.id;
  return (
    <button
      type="button"
      data-row-action
      aria-label="Delete position"
      onClick={(e) => {
        e.stopPropagation();
        useManualPositionsStore.getState().removePosition(id);
      }}
      className="flex h-full w-full items-center justify-center text-fg-muted hover:text-sem-danger transition-colors"
    >
      <Trash2 size={13} strokeWidth={1.5} />
    </button>
  );
}

const DELETE_COLUMN_DEF: ColDef = {
  colId: "delete",
  headerName: "",
  width: 36,
  minWidth: 36,
  sortable: false,
  resizable: false,
  suppressMovable: true,
  cellStyle: { padding: 0, textAlign: "center" },
  cellRenderer: DeleteCellRenderer,
};

export function PositionsGrid() {
  const filters = usePortfolioFiltersStore((state) => state.filters);
  const rowHeight = usePortfolioFiltersStore((state) => state.rowHeight);
  const setSelectedPositionId = usePortfolioFiltersStore((state) => state.setSelectedPositionId);
  const { positions, isLoading, isError } = usePortfolioPositions();

  // Inline blotter import for the empty (No Rows) state -- same client-side
  // pipeline as filter-bar.tsx's "Import Blotter", surfaced here so a user who
  // lands on an empty grid (e.g. after clearing storage) can reload positions
  // without leaving the tab. Positions normally persist across refresh now
  // (manual-/bond-positions-store), so this is a recovery affordance.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  async function handleBlotterFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setIsImporting(true);
    try {
      const bonds = await parseBlotterFile(file);
      if (bonds.length === 0) {
        toast({ title: "No bonds found", description: "Could not read any bond rows from this file.", variant: "error" });
        return;
      }
      useBondPositionsStore.getState().setPositions(bonds);
      toast({ title: `Imported ${bonds.length} bond${bonds.length === 1 ? "" : "s"}`, description: file.name, variant: "success" });
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : "Could not parse the file.", variant: "error" });
    } finally {
      setIsImporting(false);
    }
  }

  const showEmptyImport = positions.length === 0 && !isLoading;

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

  const columnDefs = useMemo<ColDef[]>(() => [
    DELETE_COLUMN_DEF,
    { field: "id", headerName: "Trade ID", width: 100, cellStyle: { color: "var(--fg-secondary)" } },
    { field: "book", headerName: "Book", width: 90 },
    { field: "assetClass", headerName: "Asset", width: 130 },
    { 
      field: "direction", 
      headerName: "Dir", 
      width: 70,
      // Direction rule single-sourced in lib/direction-color (owner ruling,
      // iv3: Pay = Berry everywhere) — pinned against divergence by
      // direction-color.test.ts.
      cellStyle: (params) => ({
        color: directionPnlColor(String(params.value)),
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
      const target = event.event?.target as HTMLElement | null;
      if (target?.closest("[data-row-action]")) return;
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
      <div className="ag-theme-balham-dark" style={{ position: "relative", flex: 1, minHeight: 0, background: "var(--bg-surface)" }}>
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

        {/* No Rows empty state: import a bond blotter Excel without leaving the
            tab. Overlays the grid (ag-grid's own noRowsOverlay can't host an
            interactive file input reliably). */}
        {showEmptyImport && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--bg-surface)",
            }}
          >
            <div className="flex max-w-xs flex-col items-center gap-3 text-center">
              <span className="text-h2 text-fg-primary">No positions loaded</span>
              <span className="text-body text-fg-muted">
                포지션이 없습니다. 채권 블로터 엑셀을 불러와 시작하세요. IRS는 상단의
                Add Position으로 추가할 수 있습니다.
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleBlotterFile}
              />
              <Button
                variant="primary"
                size="md"
                loading={isImporting}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} strokeWidth={1.5} />
                Import Blotter
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
