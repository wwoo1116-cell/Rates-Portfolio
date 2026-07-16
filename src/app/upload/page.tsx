"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FileUploadRow } from "@/components/upload/file-upload-row";
import { useUploadStore, type FileSlotKey } from "@/stores/upload-store";
import { useManualPositionsStore } from "@/stores/manual-positions-store";
import { useBondPositionsStore } from "@/stores/bond-positions-store";
import { useAuthStore } from "@/stores/auth-store";
import { uploadApi, ApiError } from "@/lib/api-client";
import type { MarketDataUploadResponse } from "@/lib/api-types";
import { toast } from "@/stores/toast-store";

const KRW_PER_EOK = 100_000_000; // 1억 = 100,000,000 won -- manual-positions-store.ts's notional unit

const SLOTS: { key: FileSlotKey; label: string; description: string }[] = [
  { key: "irsData", label: "IRS Data", description: "IRS swap curve market data (True Data export)." },
  { key: "creditMatrix", label: "Credit Matrix", description: "Credit-spread curve matrix by category and tenor." },
  { key: "bokBaseRate", label: "BoK Base Rate", description: "Bank of Korea policy rate history." },
  { key: "portfolioData", label: "Portfolio Data", description: "Booked IRS position ledger." },
];

const RESULT_KEY: Record<FileSlotKey, "irs_data" | "credit_matrix" | "bok_base_rate" | "portfolio"> = {
  irsData: "irs_data",
  creditMatrix: "credit_matrix",
  bokBaseRate: "bok_base_rate",
  portfolioData: "portfolio",
};

export default function UploadPage() {
  const router = useRouter();
  const store = useUploadStore();
  const clearPositions = useManualPositionsStore((s) => s.clearPositions);
  const addPosition = useManualPositionsStore((s) => s.addPosition);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authHasHydrated = useAuthStore((s) => s.hasHydrated);
  const [files, setFiles] = useState<Partial<Record<FileSlotKey, File>>>({});
  const [submitting, setSubmitting] = useState(false);
  // For failures that belong to the request rather than to any one file.
  const [formError, setFormError] = useState<string | null>(null);

  const allSelected = SLOTS.every((s) => files[s.key] != null);

  useEffect(() => {
    if (authHasHydrated && !isAuthenticated) {
      router.replace("/");
    }
  }, [authHasHydrated, isAuthenticated, router]);

  // Wait for the persisted auth flag to rehydrate before deciding to
  // redirect -- otherwise a fresh page load (direct nav, refresh, new tab)
  // always sees the default isAuthenticated=false for one tick and bounces
  // an already-logged-in user back to "/" regardless of real auth state.
  if (!authHasHydrated || !isAuthenticated) return null;

  function handleFileSelected(key: FileSlotKey, file: File) {
    setFiles((prev) => ({ ...prev, [key]: file }));
    store.setSlot(key, { status: "selected", fileName: file.name, errorMessage: undefined });
    setFormError(null);
  }

  function applyResults(response: MarketDataUploadResponse) {
    SLOTS.forEach((s) => {
      const result = response[RESULT_KEY[s.key]];
      store.setSlot(s.key, {
        status: result.status,
        fileName: files[s.key]?.name,
        errorMessage: result.message ?? undefined,
        rows: result.rows ?? undefined,
        minDate: result.min_date ?? undefined,
        maxDate: result.max_date ?? undefined,
      });
    });
  }

  async function handleProcess() {
    if (!allSelected || submitting) return;
    setSubmitting(true);
    setFormError(null);
    SLOTS.forEach((s) => store.setSlot(s.key, { status: "uploading" }));

    try {
      const response = await uploadApi.marketData({
        irsData: files.irsData!,
        creditMatrix: files.creditMatrix!,
        bokBaseRate: files.bokBaseRate!,
        portfolioData: files.portfolioData!,
      });
      applyResults(response);

      if (response.success) {
        // No backend DB in this deployment -- positions live entirely
        // client-side (same store add-position-modal.tsx writes to).
        // The upload replaces the prior set rather than appending, so
        // re-processing doesn't accumulate duplicates.
        clearPositions();
        useBondPositionsStore.getState().clearPositions();
        
        const irsPositions = response.positions.filter(p => p.instrument_type === "irs");
        const bondPositions = response.positions.filter(p => p.instrument_type === "bond");

        irsPositions.forEach((p) => {
          addPosition({
            name: p.position_id,
            sector: p.sector,
            book: p.book,
            startDate: p.start_date || "",
            maturityDate: p.maturity_date || "",
            notionalKrwEok: (p.notional || 0) / KRW_PER_EOK,
            fixedRate: (p.fixed_rate || 0) * 100,
            payFixed: !!p.pay_fixed,
          });
        });

        useBondPositionsStore.getState().setPositions(bondPositions.map(p => ({
          id: p.position_id,
          name: p.position_id,
          sector: p.sector,
          book: p.book,
          notionalKrwEok: (p.notional || 0) / KRW_PER_EOK,
          evaluationAmountKrwEok: (p.evaluation_amount || 0) / KRW_PER_EOK,
          remainingDays: p.remaining_days || 0,
          tenorBucket: p.tenor_bucket || "",
          entryYield: p.entry_yield || 0,
          mtmYield: p.mtm_yield || 0,
          duration: p.duration || 0,
          pvbp: p.pvbp || 0,
          // Static bond params, from the server parser's 발행일자/만기일자/
          // 표면이율/신용등급 extraction (blotter-parser.ts owns these on the
          // client import path). payment_frequency alone stays a client-side
          // sector convention -- the backend deliberately leaves it null.
          issueDate: p.issue_date || "",
          maturityDate: p.maturity_date || "",
          couponRate: p.coupon_rate ?? 0,
          paymentFrequency: p.sector === "국고채" || p.sector === "통안채" ? 2 : 4,
          rating: p.rating ?? null,
        })));

        toast({
          title: "Data processed",
          description: `Market data and ${response.positions.length} position(s) loaded successfully.`,
          variant: "success",
        });
        store.setProcessed(true);
        router.push("/home");
      } else {
        toast({
          title: "Upload failed",
          description: "One or more files could not be processed. Review the errors below.",
          variant: "error",
        });
      }
    } catch (err) {
      // A request that never came back says nothing about any individual file.
      // Marking all four ERROR (which this used to do) reads as "your files are
      // bad" and prints one cause four times, under rows it isn't even about.
      // Report it once, and hand the slots back the way the user left them.
      const message = err instanceof ApiError ? err.message : "Unexpected error while uploading.";
      toast({ title: "Upload failed", description: message, variant: "error" });
      setFormError(message);
      SLOTS.forEach((s) => store.setSlot(s.key, { status: "selected", errorMessage: undefined }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="relative flex flex-col items-center justify-center w-full h-screen"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      <div className="flex flex-col items-center w-full max-w-lg px-4">
        <div className="mb-8 text-center">
          <h1 className="font-extrabold tracking-tight text-3xl" style={{ color: "var(--fg-primary)" }}>
            Project Future
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--fg-muted)" }}>
            Load market data to continue
          </p>
        </div>

        <div
          className="w-full p-8"
          style={{
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "0px",
          }}
        >
          <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--fg-primary)" }}>
            Upload Market Data
          </h2>
          <p className="text-xs mb-4" style={{ color: "var(--fg-muted)" }}>
            All four files are required before the dashboard can load.
          </p>

          <div className="flex flex-col">
            {SLOTS.map((s) => (
              <FileUploadRow
                key={s.key}
                label={s.label}
                description={s.description}
                slot={store[s.key]}
                disabled={submitting}
                onFileSelected={(file) => handleFileSelected(s.key, file)}
              />
            ))}
          </div>

          {formError && (
            <p className="text-xs mt-4" style={{ color: "var(--sem-danger)" }}>
              {formError}
            </p>
          )}

          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full mt-6"
            disabled={!allSelected}
            loading={submitting}
            onClick={handleProcess}
          >
            Process and Enter Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
