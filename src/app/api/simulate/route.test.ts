/**
 * Contract for the /api/simulate proxy route handler (deploy/vercel-readiness).
 * The handler forwards the POST body to `${BACKEND_ORIGIN}/api/simulate`,
 * streams the upstream status + body back, defaults the origin to localhost when
 * BACKEND_ORIGIN is unset, and declares maxDuration 300 for the ~106–118s wall.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function importRoute() {
  vi.resetModules();
  return import("./route");
}

describe("/api/simulate route handler", () => {
  it("forwards the POST body to BACKEND_ORIGIN and streams status + body back", async () => {
    vi.stubEnv("BACKEND_ORIGIN", "https://tunnel.example.com");
    const captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.url = String(url);
      captured.init = init;
      return new Response(JSON.stringify({ status: "ok", n: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { POST } = await importRoute();
    const payload = JSON.stringify({ baseShockBp: 30, simDays: 90 });
    const res = await POST(
      new Request("http://localhost/api/simulate", {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(captured.url).toBe("https://tunnel.example.com/api/simulate");
    expect(captured.init?.method).toBe("POST");
    expect(captured.init?.body).toBe(payload); // byte-identical forward
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", n: 1 });
  });

  it("defaults to 127.0.0.1:8000 when BACKEND_ORIGIN is unset", async () => {
    delete process.env.BACKEND_ORIGIN;
    const captured: { url?: string } = {};
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      captured.url = String(url);
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const { POST } = await importRoute();
    await POST(new Request("http://localhost/api/simulate", { method: "POST", body: "{}" }));
    expect(captured.url).toBe("http://127.0.0.1:8000/api/simulate");
  });

  it("preserves a non-200 upstream status (e.g. backend 422)", async () => {
    vi.stubEnv("BACKEND_ORIGIN", "https://tunnel.example.com");
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "bad" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const { POST } = await importRoute();
    const res = await POST(new Request("http://localhost/api/simulate", { method: "POST", body: "{}" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ detail: "bad" });
  });

  it("declares maxDuration 300 and the nodejs runtime", async () => {
    const mod = await importRoute();
    expect(mod.maxDuration).toBe(300);
    expect(mod.runtime).toBe("nodejs");
  });
});
