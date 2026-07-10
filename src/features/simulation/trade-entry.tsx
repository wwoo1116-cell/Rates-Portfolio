"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HTMLSelect, SegmentedControl } from "@blueprintjs/core";
import { PriceDisplay } from "@/components/data/price-display";
import { useSimulationStore } from "@/stores/simulation-store";
import { ASSET_CLASSES, IRS_TENORS, type AssetClass, type Tenor } from "@/lib/constants";
import { useState } from "react";

const schema = z.object({
  assetClass: z.enum(["IRS", "KTB", "CRS", "KTBF"]),
  direction: z.enum(["Pay", "Rec", "Buy", "Sell"]),
  notionalKrwEok: z.coerce.number().positive("Notional must be positive"),
  tenor: z.string().min(1, "Tenor is required"),
  customTenor: z.string().optional(),
  rate: z.coerce.number().positive("Rate must be positive"),
});

type FormValues = z.infer<typeof schema>;

export function TradeEntry() {
  const { sandboxTrades, addTrade, removeTrade } = useSimulationStore();
  const [showCustomTenor, setShowCustomTenor] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: {
      assetClass: "IRS",
      direction: "Pay",
      notionalKrwEok: 100,
      tenor: "3Y",
      customTenor: "",
      rate: 3.245,
    },
  });

  const assetClass = watch("assetClass");
  const rateValue = watch("rate");

  const onSubmit = (data: FormValues) => {
    const finalTenor =
      data.tenor === "custom" && data.customTenor
        ? (data.customTenor as Tenor)
        : (data.tenor as Tenor);

    addTrade({
      assetClass: data.assetClass,
      direction: data.direction,
      notionalKrwEok: data.notionalKrwEok,
      tenor: finalTenor,
      rate: data.rate,
    });

    // Reset keeping structure
    reset({
      assetClass: data.assetClass,
      direction: data.direction,
      notionalKrwEok: 100,
      tenor: "3Y",
      customTenor: "",
      rate: 3.245,
    });
    setShowCustomTenor(false);
  };

  const getDirectionOptions = (asset: AssetClass) => {
    if (asset === "IRS" || asset === "CRS") {
      return [
        { label: "Pay", value: "Pay" },
        { label: "Rec", value: "Rec" },
      ];
    }
    return [
      { label: "Buy", value: "Buy" },
      { label: "Sell", value: "Sell" },
    ];
  };

  return (
    <div className="flex h-full flex-col justify-between p-4 gap-4 overflow-y-auto">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        {/* Asset Class */}
        <div className="flex flex-col gap-2">
          <label className="text-label text-fg-muted">Asset Class</label>
          <Controller
            name="assetClass"
            control={control}
            render={({ field }) => (
              <HTMLSelect
                value={field.value}
                onChange={(e) => {
                  const val = e.target.value;
                  field.onChange(val);
                  // Sync direction options when asset class changes
                  if (val === "IRS" || val === "CRS") {
                    setValue("direction", "Pay");
                  } else {
                    setValue("direction", "Buy");
                  }
                }}
                options={ASSET_CLASSES}
                fill
              />
            )}
          />
        </div>

        {/* Direction */}
        <div className="flex flex-col gap-2">
          <label className="text-label text-fg-muted">Direction</label>
          <Controller
            name="direction"
            control={control}
            render={({ field }) => (
              <SegmentedControl
                options={getDirectionOptions(assetClass)}
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
        </div>

        {/* Notional */}
        <Input
          label="Notional"
          type="number"
          step="any"
          suffix="100M KRW"
          error={errors.notionalKrwEok?.message}
          {...register("notionalKrwEok")}
        />

        {/* Tenor */}
        <div className="flex flex-col gap-2">
          <label className="text-label text-fg-muted">Tenor</label>
          <Controller
            name="tenor"
            control={control}
            render={({ field }) => (
              <HTMLSelect
                value={field.value}
                onChange={(e) => {
                  const val = e.target.value;
                  field.onChange(val);
                  setShowCustomTenor(val === "custom");
                }}
                options={[
                  ...IRS_TENORS.map((t) => ({ label: t, value: t })),
                  { label: "+ Custom", value: "custom" },
                ]}
                fill
              />
            )}
          />
          {showCustomTenor && (
            <Input
              placeholder="e.g., 4Y, 15Y"
              error={errors.customTenor?.message}
              {...register("customTenor")}
              className="mt-1"
            />
          )}
        </div>

        {/* Rate */}
        <div className="flex flex-col gap-1">
          <Input
            label="Rate"
            type="number"
            step="0.0001"
            error={errors.rate?.message}
            {...register("rate")}
          />
          <div className="flex justify-between items-center px-1">
            <span className="text-micro text-fg-muted">Live Preview:</span>
            {rateValue && !isNaN(Number(rateValue)) ? (
              <PriceDisplay value={Number(rateValue)} unit="%" />
            ) : (
              <span className="text-micro text-fg-dim">—</span>
            )}
          </div>
        </div>

        {/* Add button */}
        <Button type="submit" variant="secondary" className="w-full">
          Add to Sandbox
        </Button>
      </form>

      {/* Sandbox Trades List */}
      <div className="flex flex-1 flex-col gap-2 border-t border-border-subtle pt-4 min-h-0">
        <span className="text-label text-fg-muted uppercase">Sandbox Trades</span>
        <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
          {sandboxTrades.length === 0 ? (
            <div className="flex h-full items-center justify-center text-micro text-fg-dim text-center">
              No sandbox trades added. Add one above.
            </div>
          ) : (
            sandboxTrades.map((trade) => (
              <div
                key={trade.id}
                className="flex items-center gap-2 rounded bg-bg-secondary px-2.5 py-1.5 text-micro text-fg-secondary"
              >
                <button
                  type="button"
                  onClick={() => removeTrade(trade.id)}
                  className="text-fg-muted hover:text-sem-negative transition-colors"
                  aria-label="Remove trade"
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
                <span className="font-mono text-fg-dim">{trade.id}</span>
                <span className="flex-1 truncate">
                  <span className="font-semibold text-fg-primary">{trade.assetClass}</span>{" "}
                  {trade.direction} {trade.tenor} KRW {trade.notionalKrwEok}100M @ {trade.rate.toFixed(3)}%
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
