"use client";

import React from "react";
import { Intent, type ToasterInstance } from "@blueprintjs/core";

// Create a singleton toaster instance reference
let AppToaster: ToasterInstance | null = null;

export function setAppToaster(ref: ToasterInstance | null) {
  AppToaster = ref;
}

export interface ToastItem {
  id?: string;
  title: string;
  description?: string;
  variant?: "default" | "success" | "error";
}

export function toast(item: ToastItem) {
  if (!AppToaster) return;

  let intent: Intent = Intent.NONE;
  // S12: Intent.SUCCESS renders Blueprint's own vendor GREEN (compiled CSS,
  // out of our token layer's reach) — success is a confirmation, not a
  // signed value, so it maps to PRIMARY (accent). Errors keep DANGER red
  // (error semantic, --sem-danger side — never directional Berry).
  if (item.variant === "success") intent = Intent.PRIMARY;
  if (item.variant === "error") intent = Intent.DANGER;

  AppToaster.show({
    message: React.createElement(
      "div",
      null,
      React.createElement("div", { style: { fontWeight: 600 } }, item.title),
      item.description
        ? React.createElement(
            "div",
            { style: { fontSize: "0.9em", opacity: 0.8 } },
            item.description
          )
        : null
    ),
    intent,
    timeout: 3000,
  });
}
