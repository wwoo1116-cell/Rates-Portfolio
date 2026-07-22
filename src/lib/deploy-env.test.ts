/**
 * Deploy-readiness env wiring (deploy/vercel-readiness).
 *  1. next.config's /api/* rewrite destination is driven by BACKEND_ORIGIN,
 *     defaulting to 127.0.0.1:8000 for local dev.
 *  2. api-client's API_BASE resolves to same-origin ("") for both an empty var
 *     and an unset var in a non-dev build — a shipped browser bundle must never
 *     target 127.0.0.1 — while an explicit absolute origin is honored verbatim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function rewriteDestination(): Promise<string> {
  vi.resetModules();
  const cfg = (await import("../../next.config")).default;
  const rules = await cfg.rewrites!();
  const arr = Array.isArray(rules) ? rules : (rules.afterFiles ?? []);
  return arr[0].destination;
}

describe("next.config /api rewrite is BACKEND_ORIGIN-driven", () => {
  it("uses BACKEND_ORIGIN when set", async () => {
    vi.stubEnv("BACKEND_ORIGIN", "https://tunnel.example.com");
    expect(await rewriteDestination()).toBe("https://tunnel.example.com/api/:path*");
  });

  it("defaults to 127.0.0.1:8000 when unset", async () => {
    delete process.env.BACKEND_ORIGIN;
    expect(await rewriteDestination()).toBe("http://127.0.0.1:8000/api/:path*");
  });
});

describe("API_BASE resolves same-origin safely", () => {
  async function apiBase(): Promise<string> {
    vi.resetModules();
    return (await import("@/lib/api-client")).API_BASE;
  }

  it("empty string → same-origin '' (in any build)", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await apiBase()).toBe("");
  });

  it("unset + production build → same-origin '' (never 127.0.0.1)", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    vi.stubEnv("NODE_ENV", "production");
    expect(await apiBase()).toBe("");
  });

  it("unset + non-production (dev/test) → 127.0.0.1:8000 fallback", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    vi.stubEnv("NODE_ENV", "development");
    expect(await apiBase()).toBe("http://127.0.0.1:8000");
  });

  it("absolute origin → honored verbatim", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com");
    expect(await apiBase()).toBe("https://api.example.com");
  });
});
