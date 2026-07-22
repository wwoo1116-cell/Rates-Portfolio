import type { NextConfig } from "next";

// Server-side backend origin for the /api/* rewrite. Local dev/`next start`
// default to the standalone uvicorn on 127.0.0.1:8000; on Vercel this is set to
// the Cloudflare tunnel origin (BACKEND_ORIGIN). NOT NEXT_PUBLIC_* — the browser
// never sees it; only Next's router (rewrite) and the /api/simulate route handler
// read it. The experimental proxy* knobs are self-hosted `next start` tuning
// (Vercel ignores them) — kept so the local :3000 mirror carries large bodies.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "100mb",
    proxyTimeout: 600000,
  },
  rewrites: async () => [
    {
      source: "/api/:path*",
      destination: `${BACKEND_ORIGIN}/api/:path*`,
    },
  ],
};

export default nextConfig;
