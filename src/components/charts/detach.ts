"use client";

/**
 * Detached-chart plumbing (S10): ChartFrame's "open in new window" control
 * opens /chart/[chartId] in a separate browser window; charts that aren't
 * self-fetching hand their props over as a JSON snapshot in localStorage
 * (shared same-origin with the new window — sessionStorage is NOT reliably
 * copied into windows opened via window.open), keyed by a nonce carried in
 * the URL. Snapshots survive a reload of the detached window and are
 * garbage-collected by age on the next write.
 *
 * Kept separate from ChartFrame so the /chart route can read snapshots
 * without importing the wrapper, and ChartFrame never has to import the
 * chart registry (which imports feature panels that import ChartFrame).
 */

const SNAPSHOT_PREFIX = "chart-detach:";
/** Long enough to reload/inspect a detached window across a workday; short
 * enough that snapshots don't accumulate in localStorage forever. */
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

interface SnapshotEnvelope {
  ts: number;
  chartId: string;
  state: unknown;
}

function gcSnapshots(): void {
  const now = Date.now();
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(SNAPSHOT_PREFIX)) continue;
    try {
      const env = JSON.parse(localStorage.getItem(key) ?? "") as SnapshotEnvelope;
      if (!env || now - env.ts > SNAPSHOT_TTL_MS) stale.push(key);
    } catch {
      stale.push(key);
    }
  }
  for (const key of stale) localStorage.removeItem(key);
}

/** Open chartId's standalone route in a new window, optionally passing a
 * serializable state snapshot for the chart-registry renderer. */
export function openDetachedChart(chartId: string, state?: unknown): void {
  let query = "";
  if (state !== undefined) {
    gcSnapshots();
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(
      SNAPSHOT_PREFIX + nonce,
      JSON.stringify({ ts: Date.now(), chartId, state } satisfies SnapshotEnvelope),
    );
    query = `?s=${nonce}`;
  }
  window.open(
    `/chart/${encodeURIComponent(chartId)}${query}`,
    "_blank",
    "width=1200,height=800,noopener",
  );
}

/** Read (without consuming — reloads keep working) the snapshot a detached
 * window was opened with. Returns undefined for a missing/expired/mismatched
 * snapshot; the registry renderer decides how to degrade. */
export function readDetachedSnapshot(chartId: string, nonce: string): unknown {
  try {
    const raw = localStorage.getItem(SNAPSHOT_PREFIX + nonce);
    if (!raw) return undefined;
    const env = JSON.parse(raw) as SnapshotEnvelope;
    return env.chartId === chartId ? env.state : undefined;
  } catch {
    return undefined;
  }
}
