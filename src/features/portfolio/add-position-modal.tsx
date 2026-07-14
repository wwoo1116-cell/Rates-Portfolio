"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { addYears, format } from "date-fns";
import { Dialog, Classes, SegmentedControl } from "@blueprintjs/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useManualPositionsStore } from "@/stores/manual-positions-store";

const schema = z
  .object({
    name: z.string().min(1, "Name is required"),
    startDate: z.string().min(1, "Start date is required"),
    maturityDate: z.string().min(1, "Maturity date is required"),
    notionalKrwEok: z.coerce.number().positive("Notional must be positive"),
    fixedRate: z.coerce.number(),
    payFixed: z.boolean(),
  })
  .refine((data) => data.maturityDate > data.startDate, {
    message: "Maturity date must be after start date",
    path: ["maturityDate"],
  });

type FormValues = z.infer<typeof schema>;

const TODAY = new Date();
const DEFAULT_VALUES: FormValues = {
  name: "",
  startDate: format(TODAY, "yyyy-MM-dd"),
  maturityDate: format(addYears(TODAY, 5), "yyyy-MM-dd"),
  notionalKrwEok: 100,
  fixedRate: 3.25,
  payFixed: true,
};

interface AddPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddPositionModal({ isOpen, onClose }: AddPositionModalProps) {
  const addPosition = useManualPositionsStore((state) => state.addPosition);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: DEFAULT_VALUES,
  });

  const onSubmit = (data: FormValues) => {
    addPosition({
      name: data.name,
      // Manual entries have no source-file sector/book -- default to the
      // same values the uploaded-portfolio parser falls back to (see
      // irs_pricer/loaders/portfolio.py's sector/book mapping) so manual
      // positions group sensibly alongside uploaded ones in the PVBP/book
      // tables rather than forming their own ungrouped bucket.
      sector: "IRS",
      book: "RP Fund",
      startDate: data.startDate,
      maturityDate: data.maturityDate,
      notionalKrwEok: data.notionalKrwEok,
      fixedRate: data.fixedRate,
      payFixed: data.payFixed,
    });
    reset(DEFAULT_VALUES);
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Add Position" style={{ width: 380 }}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className={Classes.DIALOG_BODY}>
          <div className="flex flex-col gap-4">
            <Input
              label="Asset / Instrument Name"
              placeholder="e.g., IRS 5Y Receiver"
              error={errors.name?.message}
              {...register("name")}
            />

            <div className="flex flex-col gap-2">
              <label className="text-label text-fg-muted">Direction</label>
              <Controller
                name="payFixed"
                control={control}
                render={({ field }) => (
                  <SegmentedControl
                    options={[
                      { label: "Pay", value: "true" },
                      { label: "Rec", value: "false" },
                    ]}
                    value={String(field.value)}
                    onValueChange={(value) => field.onChange(value === "true")}
                  />
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Start Date"
                type="date"
                error={errors.startDate?.message}
                {...register("startDate")}
              />
              <Input
                label="Maturity Date"
                type="date"
                error={errors.maturityDate?.message}
                {...register("maturityDate")}
              />
            </div>

            <Input
              label="Notional"
              type="number"
              step="any"
              suffix="100M KRW"
              error={errors.notionalKrwEok?.message}
              {...register("notionalKrwEok")}
            />

            <Input
              label="Fixed Rate"
              type="number"
              step="0.0001"
              suffix="%"
              error={errors.fixedRate?.message}
              {...register("fixedRate")}
            />
          </div>
        </div>

        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button type="button" variant="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md">
              Add Position
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
