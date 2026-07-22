/**
 * /api/simulate proxy route handler (deploy/vercel-readiness).
 *
 * WHY a route handler instead of the plain next.config rewrite: an external
 * rewrite on Vercel caps at 120s time-to-first-byte, and FastAPI sends the whole
 * simulate JSON in one body at completion, so TTFB ≈ the full runtime. Measured
 * full-book runs are ~106–118s (cold), a 1–13% margin under 120s — any regression
 * 504s. A route handler runs as a serverless function whose `maxDuration` we set
 * to 300s (Hobby default & max under Fluid compute), ≥2.5× the worst measured run.
 *
 * Body sizes (measured this session against the live book): request ≈0.29 MB,
 * response ≈0.10 MB — both far under Vercel's 4.5 MB function body cap, so reading
 * the request into the function and streaming the response back is safe. (Only
 * simulate takes this lane; everything else stays on the plain /api/* rewrite,
 * and the ~100 MB upload deliberately avoids any function — see api-client.ts.)
 *
 * Auth: owner posture is Secret OFF for this session, so no header is injected.
 * If a shared secret is later adopted, attach it to the upstream fetch here.
 *
 * As a filesystem route this takes precedence over next.config's afterFiles
 * rewrite for exactly `/api/simulate`; all other `/api/*` paths still rewrite.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";

export async function POST(req: Request): Promise<Response> {
  // Small JSON body (~0.3 MB) — read it whole and forward verbatim. Preserving
  // the raw text keeps the payload byte-identical to what the client sent.
  const body = await req.text();

  const upstream = await fetch(`${BACKEND_ORIGIN}/api/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    // Propagate client cancel (the Running interstitial's abort button) through
    // to the backend so a cancelled run doesn't keep computing upstream.
    signal: req.signal,
  });

  // Stream the upstream response straight back, preserving status and JSON type.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}
