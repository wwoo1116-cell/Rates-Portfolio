"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@blueprintjs/core";
import { toast } from "@/stores/toast-store";
import { ASSET_CLASSES } from "@/lib/constants";

const schema = z.object({
  objective: z.enum(["carry", "dv01", "sharpe"]),
  maxIrsNotional: z.coerce.number().min(0, "Must be non-negative"),
  maxKtbNotional: z.coerce.number().min(0, "Must be non-negative"),
  maxCrsNotional: z.coerce.number().min(0, "Must be non-negative"),
  maxKtbfNotional: z.coerce.number().min(0, "Must be non-negative"),
  maxTotalNotional: z.coerce.number().min(0, "Must be non-negative"),
  minDuration: z.coerce.number().min(0, "Must be non-negative"),
  maxDuration: z.coerce.number().min(0, "Must be non-negative"),
  maxDv01: z.coerce.number().min(0, "Must be non-negative"),
  maxVar: z.coerce.number().min(0, "Must be non-negative"),
  universe: z.array(z.string()).min(1, "Select at least one asset class"),
});

type FormValues = z.infer<typeof schema>;

export function ConstraintsForm() {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: {
      objective: "carry",
      maxIrsNotional: 5000,
      maxKtbNotional: 3000,
      maxCrsNotional: 2000,
      maxKtbfNotional: 1000,
      maxTotalNotional: 10000,
      minDuration: 1.5,
      maxDuration: 8.5,
      maxDv01: 500,
      maxVar: 150,
      universe: ["IRS", "KTB", "CRS", "KTBF"],
    },
  });

  const onSubmit = () => {
    toast({
      title: "Model pending connection",
      description: "Optimization engine will be connected in Phase 2",
      variant: "default",
    });
  };

  return (
    <div className="flex h-full flex-col justify-between p-4 overflow-y-auto">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        {/* Objective */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label className="text-label text-fg-muted uppercase">Objective</label>
            <span className="rounded bg-bg-tertiary px-1 py-0.5 text-micro font-bold text-sem-risk uppercase tracking-wider scale-90">
              MODEL PENDING
            </span>
          </div>
          <Controller
            name="objective"
            control={control}
            render={({ field }) => (
              <div className="flex flex-col gap-1.5 bg-bg-secondary/40 p-2.5 rounded border border-border-subtle">
                <label className="flex items-center gap-2 text-body text-fg-primary cursor-pointer select-none">
                  <input
                    type="radio"
                    value="carry"
                    checked={field.value === "carry"}
                    onChange={() => field.onChange("carry")}
                    className="accent-sem-info"
                  />
                  Maximize Carry
                </label>
                <label className="flex items-center gap-2 text-body text-fg-primary cursor-pointer select-none">
                  <input
                    type="radio"
                    value="dv01"
                    checked={field.value === "dv01"}
                    onChange={() => field.onChange("dv01")}
                    className="accent-sem-info"
                  />
                  Minimize DV01
                </label>
                <label className="flex items-center gap-2 text-body text-fg-primary cursor-pointer select-none">
                  <input
                    type="radio"
                    value="sharpe"
                    checked={field.value === "sharpe"}
                    onChange={() => field.onChange("sharpe")}
                    className="accent-sem-info"
                  />
                  Maximize Sharpe Ratio
                </label>
              </div>
            )}
          />
        </div>

        {/* Notional Constraints */}
        <div className="flex flex-col gap-3">
          <label className="text-label text-fg-muted uppercase">Notional Constraints (100M KRW)</label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Max IRS"
              type="number"
              error={errors.maxIrsNotional?.message}
              {...register("maxIrsNotional")}
            />
            <Input
              label="Max KTB"
              type="number"
              error={errors.maxKtbNotional?.message}
              {...register("maxKtbNotional")}
            />
            <Input
              label="Max CRS"
              type="number"
              error={errors.maxCrsNotional?.message}
              {...register("maxCrsNotional")}
            />
            <Input
              label="Max KTBF"
              type="number"
              error={errors.maxKtbfNotional?.message}
              {...register("maxKtbfNotional")}
            />
          </div>
          <Input
            label="Max Total Notional"
            type="number"
            error={errors.maxTotalNotional?.message}
            {...register("maxTotalNotional")}
          />
        </div>

        {/* Duration Constraints */}
        <div className="flex flex-col gap-3">
          <label className="text-label text-fg-muted uppercase">Duration Constraints (Years)</label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Min Duration"
              type="number"
              step="0.1"
              error={errors.minDuration?.message}
              {...register("minDuration")}
            />
            <Input
              label="Max Duration"
              type="number"
              step="0.1"
              error={errors.maxDuration?.message}
              {...register("maxDuration")}
            />
          </div>
        </div>

        {/* Risk Budget */}
        <div className="flex flex-col gap-3">
          <label className="text-label text-fg-muted uppercase">Risk Budget</label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Max DV01"
              type="number"
              error={errors.maxDv01?.message}
              {...register("maxDv01")}
            />
            <Input
              label="Max VaR"
              type="number"
              error={errors.maxVar?.message}
              {...register("maxVar")}
            />
          </div>
        </div>

        {/* Universe */}
        <div className="flex flex-col gap-2">
          <label className="text-label text-fg-muted uppercase">Asset Universe</label>
          <Controller
            name="universe"
            control={control}
            render={({ field }) => (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 bg-bg-secondary/40 p-2.5 rounded border border-border-subtle">
                {ASSET_CLASSES.map((cls) => {
                  const isChecked = field.value.includes(cls);
                  return (
                    <label key={cls} className="flex items-center gap-1.5 text-body text-fg-primary cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          if (isChecked) {
                            field.onChange(field.value.filter((x: string) => x !== cls));
                          } else {
                            field.onChange([...field.value, cls]);
                          }
                        }}
                        className="accent-sem-info"
                      />
                      {cls}
                    </label>
                  );
                })}
              </div>
            )}
          />
          {errors.universe && (
            <span className="text-micro text-sem-danger">{errors.universe.message}</span>
          )}
        </div>

        {/* Submit with Tooltip */}
        <Tooltip
          content="Optimization model not yet connected"
          placement="top"
        >
          <div className="w-full">
            <Button type="submit" variant="primary" className="w-full">
              Run Optimization
            </Button>
          </div>
        </Tooltip>
      </form>
    </div>
  );
}
