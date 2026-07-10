"use client";

import { OverlayToaster, Position, type ToasterInstance } from "@blueprintjs/core";
import { setAppToaster } from "@/stores/toast-store";

export function GlobalToaster() {
  return (
    <OverlayToaster
      position={Position.TOP_RIGHT}
      maxToasts={3}
      ref={(ref: ToasterInstance | null) => {
        setAppToaster(ref);
      }}
    />
  );
}
