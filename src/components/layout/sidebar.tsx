"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NAV_ITEMS } from "@/lib/constants";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useWorkspacePanelsStore } from "@/stores/workspace-panels-store";
import { togglePanel } from "@/lib/workspace-panels";

export function Sidebar() {
  const pathname  = usePathname();
  const router    = useRouter();
  const collapsed = useSidebarStore((state) => state.collapsed);
  const toggle    = useSidebarStore((state) => state.toggle);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- subscribed only to re-render on layout changes
  const tick = useWorkspacePanelsStore((s) => s.tick);
  const workspaceId = useWorkspacePanelsStore((s) => s.workspaceId);
  const workspaceApi = useWorkspacePanelsStore((s) => s.api);
  const workspacePanels = useWorkspacePanelsStore((s) => s.panels);
  const onReset = useWorkspacePanelsStore((s) => s.onReset);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isCmd = event.metaKey || event.ctrlKey;
      if (isCmd && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggle();
      }
      if (isCmd && ["1", "2", "3", "4", "5", "6"].includes(event.key)) {
        event.preventDefault();
        const idx = parseInt(event.key, 10) - 1;
        if (NAV_ITEMS[idx]) {
          router.push(NAV_ITEMS[idx].href);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle, router]);

  return (
    <aside
      style={{
        height: "100%",
        width: collapsed ? 48 : 220,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-header)",
        borderRight: "1px solid var(--border-dim)",
        zIndex: 100,
        // No CSS transition — institutional: no motion
      }}
    >
      {/* Organization mark — first element of the nav column, above Home
          (S10 owner decision; supersedes the top-bar placement). Expanded
          shows the full reversed lockup at 26px wordmark height. The 48px
          collapsed rail can't fit the wordmark, so it shows only the orange
          swoosh, centered — a CSS crop of the SAME public/brand asset (no
          re-derived file): in the 339×80 source the swoosh occupies
          x 301–338 / y 0–41, cleanly separated from the wordmark (x ≤ 297). */}
      <div
        style={{
          display: "flex",
          justifyContent: collapsed ? "center" : "flex-start",
          padding: collapsed ? "14px 0 10px" : "14px 12px 10px",
          flexShrink: 0,
        }}
      >
        {collapsed ? (
          <div style={{ width: 18, height: 20, overflow: "hidden" }}>
            <Image
              src="/brand/mirae-logo-reversed.png"
              alt="Mirae Asset"
              width={161}
              height={38}
              priority
              /* Tailwind preflight's img { max-width: 100% } would shrink the
                 image to the 18px crop window — the crop needs true size. */
              style={{ maxWidth: "none", marginLeft: -143 }}
            />
          </div>
        ) : (
          <Image
            src="/brand/mirae-logo-reversed.png"
            alt="Mirae Asset"
            width={110}
            height={26}
            priority
            style={{ flexShrink: 0 }}
          />
        )}
      </div>

      <nav
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 1,
          padding: "4px 4px",
          overflowY: "auto",
        }}
      >
        {NAV_ITEMS.map((item, index) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          const itemWorkspaceId = item.href.replace(/^\//, "");
          const showAccordion =
            !collapsed && active && workspaceId === itemWorkspaceId && workspaceApi && workspacePanels.length > 0;

          return (
            <div key={item.href}>
              <Link
                href={item.href}
                title={collapsed ? item.label : undefined}
                style={{
                  opacity: 0, // for animation
                  animation: `entrance-premium var(--transition-normal) forwards`,
                  animationDelay: `${index * 75}ms`,
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  height: 34,
                  padding: "0 10px",
                  color: active ? "var(--fg-primary)" : "var(--fg-muted)",
                  background: "transparent",
                  textDecoration: "none",
                  fontSize: "var(--text-sm)",
                  fontFamily: "var(--font-ui)",
                  fontWeight: active ? 700 : 400,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  borderLeft: active ? "2px solid var(--fg-primary)" : "2px solid transparent",
                  transition: "background-color var(--transition-fast), color var(--transition-fast), border-left-color var(--transition-fast)",
                }}
              >
                <Icon size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                {!collapsed && (
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.label}
                  </span>
                )}
              </Link>

              {showAccordion && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    padding: "2px 8px 6px 30px",
                  }}
                >
                  {workspacePanels.map((def) => {
                    const isOpen = Boolean(workspaceApi!.getPanel(def.id));
                    return (
                      <button
                        key={def.id}
                        type="button"
                        onClick={() => togglePanel(workspaceApi!, def)}
                        aria-pressed={isOpen}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          height: 24,
                          padding: "0 6px",
                          border: "none",
                          background: "transparent",
                          color: isOpen ? "var(--fg-primary)" : "var(--fg-muted)",
                          fontFamily: "var(--font-ui)",
                          fontSize: 11,
                          fontWeight: isOpen ? 700 : 400,
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            flexShrink: 0,
                            background: isOpen ? "var(--fg-primary)" : "var(--fg-dim)",
                          }}
                        />
                        {def.title}
                      </button>
                    );
                  })}
                  {onReset && (
                    <button
                      type="button"
                      onClick={onReset}
                      style={{
                        marginTop: 2,
                        height: 22,
                        padding: "0 6px",
                        border: "none",
                        background: "transparent",
                        color: "var(--fg-dim)",
                        fontFamily: "var(--font-ui)",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--fg-primary)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--fg-dim)"; }}
                    >
                      Reset Layout
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div
        style={{
          padding: "6px 4px",
          borderTop: "1px solid var(--border-dim)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flexShrink: 0,
        }}
      >
        {/* User avatar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 32,
            padding: "0 10px",
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              background: "var(--accent-soft)",
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            PK
          </span>
          {!collapsed && (
            <span style={{ fontSize: 12, color: "var(--fg-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
              Park
            </span>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-end",
            height: 26,
            padding: "0 10px",
            background: "transparent",
            border: "none",
            color: "var(--fg-dim)",
            cursor: "pointer",
            transition: "transform var(--transition-fast), color var(--transition-fast)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--fg-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--fg-dim)"; }}
          onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.90)"; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={1.5} />
          ) : (
            <ChevronLeft size={14} strokeWidth={1.5} />
          )}
        </button>
      </div>
    </aside>
  );
}
