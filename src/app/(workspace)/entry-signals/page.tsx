import { notFound } from "next/navigation";

// DEMO-DEBT (demo sprint 2026-07-20): Entry Signals is HIDDEN for the demo —
// the route 404s so it can't be reached by URL while the nav item is parked
// in src/lib/constants.ts. The whole features/entry-signals slice, its store
// and tests are untouched. Restore = revert this file to:
//   import { EntrySignalsWorkspace } from "@/features/entry-signals/entry-signals-workspace";
//   export default function EntrySignalsPage() { return <EntrySignalsWorkspace />; }
export default function EntrySignalsPage() {
  notFound();
}
