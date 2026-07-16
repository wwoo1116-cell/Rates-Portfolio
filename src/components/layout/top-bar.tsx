"use client";

import { useEffect, useState } from "react";
import { Bell, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/data/status-dot";
import { MOCK_WORKSPACES } from "@/lib/constants";

type ConnectionStatus = "live" | "stale" | "offline";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  live: "LIVE",
  stale: "STALE",
  offline: "OFFLINE",
};

function useKstClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const tick = () => setTime(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export function TopBar() {
  const time = useKstClock();
  const [workspace, setWorkspace] = useState<string>(MOCK_WORKSPACES[0]);
  const status: ConnectionStatus = "live";

  const handleWorkspaceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "__reset__") {
      for (const key in localStorage) {
        if (key.startsWith("dockview-layout:")) localStorage.removeItem(key);
      }
      window.location.reload();
      return;
    }
    setWorkspace(val);
  };

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 36,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 16px",
        background: "var(--bg-header)",
        flexShrink: 0,
      }}
    >
      {/* Organization mark moved to the sidebar (above the Home nav item,
          S10 owner decision) — the workspace selector now leads the bar. */}
      {/* Workspace selector — Blueprint HTMLSelect via native select */}
      <select
        value={workspace}
        onChange={handleWorkspaceChange}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--fg-primary)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          cursor: "pointer",
          outline: "none",
          padding: 0,
        }}
      >
        {MOCK_WORKSPACES.map((name) => (
          <option key={name} value={name} style={{ background: "var(--bg-overlay)" }}>
            {name}
          </option>
        ))}
        <option value="__reset__" style={{ background: "var(--bg-overlay)", color: "var(--sem-danger)" }}>
          Reset Layout
        </option>
      </select>

      {/* Connection status */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <StatusDot variant={status} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.07em",
            color: "var(--fg-muted)",
            fontFamily: "var(--font-ui)",
          }}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      {/* KST clock */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontSize: "var(--text-sm)",
          color: "var(--fg-secondary)",
        }}
      >
        {time} KST
      </span>

      <div style={{ flex: 1 }} />

      {/* Notifications */}
      <Button variant="icon" size="sm" aria-label="Notifications">
        <Bell size={16} strokeWidth={1.5} />
      </Button>

      {/* User */}
      <Button variant="icon" size="sm" aria-label="User menu">
        <User size={16} strokeWidth={1.5} />
      </Button>
    </header>
  );
}
