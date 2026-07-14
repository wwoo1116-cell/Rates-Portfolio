"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { useUploadStore } from "@/stores/upload-store";

import { useAuthStore } from "@/stores/auth-store";

export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const hasHydrated = useUploadStore((s) => s.hasHydrated);
  const isProcessed = useUploadStore((s) => s.isProcessed);
  const authHasHydrated = useAuthStore((s) => s.hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const ready = hasHydrated && authHasHydrated;

  useEffect(() => {
    if (!ready) return;
    if (!isAuthenticated) {
      router.replace("/");
    } else if (!isProcessed) {
      router.replace("/upload");
    }
  }, [ready, isProcessed, isAuthenticated, router]);

  // Wait for BOTH persisted flags (auth + upload gate) to rehydrate before
  // rendering or redirecting anything -- each store's own isAuthenticated/
  // isProcessed starts at its default (false) for one tick before
  // localStorage is read, so checking either without its own hasHydrated
  // bounces an already-logged-in, already-processed user back to "/" (or
  // "/upload") on every fresh page load/reload, not just first-time visits.
  if (!ready || !isProcessed || !isAuthenticated) {
    return <div className="h-full" style={{ backgroundColor: "var(--bg-base)" }} />;
  }

  return (
    <div className="h-full flex flex-row">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <TopBar />
        <main className="flex-1 min-h-0 flex flex-col">{children}</main>
      </div>
    </div>
  );
}
