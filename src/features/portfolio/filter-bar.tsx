"use client";

import { useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { HTMLSelect, SegmentedControl } from "@blueprintjs/core";
import { ASSET_CLASSES, BOOKS, IRS_TENORS } from "@/lib/constants";
import {
  usePortfolioFiltersStore,
  type ActiveFilter,
  type FilterKey,
} from "@/stores/portfolio-filters-store";
import { useBondPositionsStore } from "@/stores/bond-positions-store";
import { toast } from "@/stores/toast-store";
import type { GroupByOption } from "@/types/portfolio";
import { AddPositionModal } from "./add-position-modal";
import { parseBlotterFile } from "./blotter-parser";

const FILTER_META: Record<FilterKey, { label: string; options: readonly string[] }> = {
  book: { label: "BOOK", options: BOOKS },
  assetClass: { label: "ASSET", options: ASSET_CLASSES },
  tenor: { label: "TENOR", options: IRS_TENORS },
  direction: { label: "DIRECTION", options: ["Pay", "Rec", "Buy", "Sell"] },
};

const GROUP_BY_OPTIONS: { value: GroupByOption; label: string }[] = [
  { value: "none", label: "None" },
  { value: "assetClass", label: "Asset Class" },
  { value: "book", label: "Book" },
  { value: "tenorBucket", label: "Tenor Bucket" },
  { value: "direction", label: "Direction" },
];

export function FilterBar() {
  const filters = usePortfolioFiltersStore((state) => state.filters);
  const addFilter = usePortfolioFiltersStore((state) => state.addFilter);
  const removeFilter = usePortfolioFiltersStore((state) => state.removeFilter);
  const groupBy = usePortfolioFiltersStore((state) => state.groupBy);
  const setGroupBy = usePortfolioFiltersStore((state) => state.setGroupBy);
  const rowHeight = usePortfolioFiltersStore((state) => state.rowHeight);
  const setRowHeight = usePortfolioFiltersStore((state) => state.setRowHeight);

  const [pendingKey, setPendingKey] = useState<FilterKey | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Every filter key stays selectable so users can keep stacking values onto
  // an already-active chip (e.g. TENOR 3Y, then TENOR 5Y) — see handleAddValue,
  // which merges into the existing filter's `values` array rather than replacing it.
  const availableKeys = Object.keys(FILTER_META) as FilterKey[];

  function handleAddValue(key: FilterKey, value: string) {
    const existing = filters.find((f) => f.key === key);
    const values = existing ? [...new Set([...existing.values, value])] : [value];
    const filter: ActiveFilter = { key, label: FILTER_META[key].label, values };
    addFilter(filter);
    setPendingKey(null);
  }

  return (
    <div className="flex h-12 items-center gap-2 border-b border-border-subtle px-4">
      {filters.map((filter) => (
        <Chip
          key={filter.key}
          label={filter.label}
          value={filter.values}
          onRemove={() => removeFilter(filter.key)}
        />
      ))}

      {pendingKey ? (
        <HTMLSelect
          key={`add-filter-value-${pendingKey}`}
          value=""
          onChange={(e) => {
            if (e.target.value) handleAddValue(pendingKey, e.target.value);
          }}
          onBlur={() => setPendingKey(null)}
          options={[
            { label: FILTER_META[pendingKey].label, value: "", disabled: true },
            ...FILTER_META[pendingKey].options.map(opt => ({ label: opt, value: opt }))
          ]}
          autoFocus
        />
      ) : (
        availableKeys.length > 0 && (
          <HTMLSelect
            key="add-filter-trigger"
            value=""
            onChange={(e) => {
              if (e.target.value) setPendingKey(e.target.value as FilterKey);
            }}
            options={[
              { label: "+ Add Filter", value: "", disabled: true },
              ...availableKeys.map(key => ({ label: FILTER_META[key].label, value: key }))
            ]}
          />
        )
      )}

      <div className="flex-1" />

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleBlotterFile}
      />
      <Button
        variant="secondary"
        size="sm"
        loading={isImporting}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload size={14} strokeWidth={1.5} />
        Import Blotter
      </Button>

      <Button variant="primary" size="sm" onClick={() => setIsAddOpen(true)}>
        <Plus size={14} strokeWidth={1.5} />
        Add Position
      </Button>

      <HTMLSelect
        value={groupBy}
        onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
        options={GROUP_BY_OPTIONS.map(opt => ({ label: opt.label, value: opt.value }))}
      />

      <SegmentedControl
        options={[
          { label: "Dense", value: "dense" },
          { label: "Comfortable", value: "comfortable" },
        ]}
        value={rowHeight}
        onValueChange={(value) => setRowHeight(value as "dense" | "comfortable")}
      />

      <AddPositionModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} />
    </div>
  );
}
