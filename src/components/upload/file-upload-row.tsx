"use client";

import { useRef } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot, type StatusDotVariant } from "@/components/data/status-dot";
import type { FileSlotState } from "@/stores/upload-store";

const STATUS_DOT: Record<FileSlotState["status"], StatusDotVariant> = {
  empty: "neutral",
  selected: "neutral",
  uploading: "neutral",
  ready: "live",
  error: "offline",
};

// S12: READY is a success/status state, not a signed value — Jade is locked
// to signed semantics, so it drops to accent; ERROR carries the danger tone.
const STATUS_BADGE: Record<FileSlotState["status"], { label: string; tone: BadgeTone } | null> = {
  empty: null,
  selected: { label: "SELECTED", tone: "accent" },
  uploading: { label: "PROCESSING", tone: "accent" },
  ready: { label: "READY", tone: "accent" },
  error: { label: "ERROR", tone: "danger" },
};

export interface FileUploadRowProps {
  label: string;
  description: string;
  slot: FileSlotState;
  disabled?: boolean;
  onFileSelected: (file: File) => void;
}

export function FileUploadRow({ label, description, slot, disabled, onFileSelected }: FileUploadRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const badge = STATUS_BADGE[slot.status];

  return (
    <div className="flex flex-col gap-1 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusDot variant={STATUS_DOT[slot.status]} />
          <span className="text-sm font-medium" style={{ color: "var(--fg-primary)" }}>
            {label}
          </span>
          {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || slot.status === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {slot.fileName ? "Replace File" : "Choose File"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileSelected(file);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
        {description}
      </p>
      {slot.fileName && slot.status !== "error" && (
        <p className="text-xs" style={{ color: "var(--fg-secondary)" }}>
          {slot.fileName}
          {slot.rows != null && ` — ${slot.rows.toLocaleString()} rows`}
          {slot.minDate && slot.maxDate && ` (${slot.minDate} → ${slot.maxDate})`}
        </p>
      )}
      {slot.status === "error" && (
        <p className="text-xs" style={{ color: "var(--sem-danger)" }}>
          {slot.fileName ? `${slot.fileName}: ` : ""}
          {slot.errorMessage ?? "Could not process this file."}
        </p>
      )}
    </div>
  );
}
