// Toast shim — Radix Toast removed. Blueprint Toaster used in new code.
// This file is a no-op shim for any remaining import references.

export function Toaster() {
  return null;
}

export function useToast() {
  return {
    toast: (_opts: { title?: string; description?: string }) => {},
    dismiss: (_id?: string) => {},
  };
}
