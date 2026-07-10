import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { GlobalToaster } from "@/components/layout/global-toaster";
import { QueryProvider } from "@/components/providers/query-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Future",
  description: "Future",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      /* bp5-dark: forces Blueprint dark theme globally, no toggle */
      className={`bp5-dark ${inter.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        <QueryProvider>
          <main className="flex-1 min-h-0 flex flex-col">{children}</main>
          <GlobalToaster />
        </QueryProvider>
      </body>
    </html>
  );
}
