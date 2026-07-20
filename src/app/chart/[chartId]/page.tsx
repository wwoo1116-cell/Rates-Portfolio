"use client";

/**
 * Standalone detached-chart window (S10): /chart/[chartId]?s=<nonce>.
 * Opened by ChartFrame's detach control (window.open); renders the same chart
 * component the main window shows, from the chart-registry — self-fetching
 * panels refetch through the shared query cache / persisted stores, snapshot
 * charts read their state from localStorage via the nonce (detach.ts).
 *
 * Lives OUTSIDE the (workspace) route group on purpose: no sidebar/top bar,
 * just the chart on the dark token theme (tokens.css is global via the root
 * layout, which also provides the QueryProvider). The auth gate mirrors the
 * workspace layout's client-side check so a detached URL can't outlive a
 * logout.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DETACHED_CHARTS } from "@/components/charts/chart-registry";
import { readDetachedSnapshot } from "@/components/charts/detach";
import { useAuthStore } from "@/stores/auth-store";

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <span className="text-body text-fg-muted" style={{ maxWidth: 420 }}>
        {children}
      </span>
    </div>
  );
}

export default function DetachedChartPage() {
  const params = useParams<{ chartId: string }>();
  const chartId = decodeURIComponent(params?.chartId ?? "");
  const entry = DETACHED_CHARTS[chartId];

  const authHasHydrated = useAuthStore((s) => s.hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Snapshot lookup is localStorage + window.location — client-only, read
  // once in a lazy initializer (not useSearchParams, which would demand a
  // Suspense boundary at prerender for no benefit). The server-render branch
  // returns empty state; that can't cause a hydration mismatch because the
  // first paint is already gated behind authHasHydrated, which is false on
  // the server AND on the client's initial render alike.
  const [snapshot] = useState<{ state: unknown }>(() => {
    if (typeof window === "undefined") return { state: undefined };
    const nonce = new URLSearchParams(window.location.search).get("s");
    return { state: nonce ? readDetachedSnapshot(chartId, nonce) : undefined };
  });

  useEffect(() => {
    if (entry) document.title = `${entry.title} — detached`;
  }, [entry]);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 34,
          padding: "0 12px",
          flexShrink: 0,
          background: "var(--bg-header)",
          borderBottom: "1px solid var(--border-dim)",
        }}
      >
        <span className="text-body-strong text-fg-primary">{entry?.title ?? "Chart"}</span>
        <span className="text-micro text-fg-dim" style={{ letterSpacing: "0.04em" }}>
          DETACHED VIEW
        </span>
      </header>

      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
        {!authHasHydrated ? null : !isAuthenticated ? (
          <CenteredNote>Sign in from the main window to view this chart.</CenteredNote>
        ) : !entry ? (
          <CenteredNote>
            Unknown chart id &ldquo;{chartId}&rdquo; — this window was opened for a chart this
            build doesn&apos;t register.
          </CenteredNote>
        ) : (
          <div style={{ flex: 1, minHeight: 0 }}>{entry.render(snapshot.state)}</div>
        )}
      </div>
    </div>
  );
}
