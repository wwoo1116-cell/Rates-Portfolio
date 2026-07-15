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
  icons: {
    // 16px is a hand-simplified variant (bulb + one arrow); 32px keeps the
    // full-detail mark. Browsers pick by declared size. See public/brand/.
    icon: [
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
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
