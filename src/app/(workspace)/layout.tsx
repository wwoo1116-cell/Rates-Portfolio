"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

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
