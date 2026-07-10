"use client";

import {
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { AgGridReact } from "ag-grid-react";
import type {
  ColDef,
  GridApi,
  GridReadyEvent,
  RowClickedEvent,
  ColumnState,
  GridOptions,
} from "ag-grid-community";

export type { ColDef, ColumnState };

export interface DataGridProps<TData> {
  rowData: TData[];
  columnDefs: ColDef<TData>[];
  /** Key used for localStorage column-state persistence. */
  gridKey: string;
  rowHeight?: number;
  headerHeight?: number;
  groupDefaultExpanded?: number;
  onRowClicked?: (data: TData) => void;
  activeRowId?: string | null;
  getRowId?: (params: { data: TData }) => string;
  isLoading?: boolean;
  emptyState?: ReactNode;
  suppressMovableColumns?: boolean;
  animateRows?: boolean;
}

const DEFAULT_COL_DEF: ColDef = {
  sortable: true,
  resizable: true,
  filter: false,
  suppressMovable: false,
  minWidth: 50,
  cellStyle: {
    fontFamily: "var(--font-mono)",
    fontVariantNumeric: "tabular-nums",
    fontSize: "var(--text-sm)",
    color: "var(--fg-secondary)",
    display: "flex",
    alignItems: "center",
  },
  headerClass: "ag-inst-header",
};

export function DataGrid<TData extends object>({
  rowData,
  columnDefs,
  gridKey,
  rowHeight = 28,
  headerHeight = 30,
  groupDefaultExpanded = 1,
  onRowClicked,
  activeRowId,
  getRowId,
  isLoading = false,
  emptyState,
  suppressMovableColumns = false,
  animateRows = false,
}: DataGridProps<TData>) {
  const gridRef = useRef<AgGridReact<TData>>(null);
  const apiRef = useRef<GridApi<TData> | null>(null);

  // Persist column state on every column change
  const saveColumnState = useCallback(() => {
    if (!apiRef.current) return;
    const state = apiRef.current.getColumnState();
    try {
      localStorage.setItem(`ag-col:${gridKey}`, JSON.stringify(state));
    } catch {
      // quota exceeded — ignore
    }
  }, [gridKey]);

  // Restore column state on grid ready
  const onGridReady = useCallback(
    (event: GridReadyEvent<TData>) => {
      apiRef.current = event.api;
      try {
        const saved = localStorage.getItem(`ag-col:${gridKey}`);
        if (saved) {
          const state: ColumnState[] = JSON.parse(saved);
          event.api.applyColumnState({ state, applyOrder: true });
        }
      } catch {
        // corrupt storage — ignore
      }
    },
    [gridKey],
  );

  const handleRowClicked = useCallback(
    (event: RowClickedEvent<TData>) => {
      if (event.data) onRowClicked?.(event.data);
    },
    [onRowClicked],
  );

  // Highlight active row
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !activeRowId) return;
    api.forEachNode((node) => {
      if (node.id === activeRowId) {
        node.setSelected(true, true);
      }
    });
  }, [activeRowId]);

  const gridOptions: GridOptions<TData> = {
    animateRows,
    suppressMovableColumns,
    rowSelection: { mode: "singleRow", checkboxes: false },
    groupDefaultExpanded,
    suppressCellFocus: false,
    enableCellTextSelection: true,
    defaultColDef: DEFAULT_COL_DEF,
    columnDefs,
    rowData: isLoading ? undefined : rowData,
    rowHeight,
    headerHeight,
    getRowId,
    onGridReady,
    onRowClicked: onRowClicked ? handleRowClicked : undefined,
    onSortChanged: saveColumnState,
    onColumnResized: saveColumnState,
    onColumnMoved: saveColumnState,
    onColumnVisible: saveColumnState,
    overlayNoRowsTemplate: emptyState
      ? `<span style="color:var(--fg-muted);font-size:var(--text-sm)"></span>`
      : `<span style="color:var(--fg-muted);font-size:var(--text-sm)">No data</span>`,
    overlayLoadingTemplate: `<span style="color:var(--fg-muted);font-size:var(--text-sm)">Loading…</span>`,
  };

  if (isLoading) {
    gridOptions.loading = true;
  }

  return (
    <div
      className="ag-theme-balham-dark"
      style={{ height: "100%", width: "100%" }}
    >
      <AgGridReact<TData>
        ref={gridRef}
        {...gridOptions}
      />
    </div>
  );
}
