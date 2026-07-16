/**
 * Slice-local HTTP client for the Simulation backend (POST /api/simulate).
 *
 * Reuses the app's error shape (`ApiError`) and default base from @/lib/api-client
 * — the only app import this file is allowed to make under the slice boundary rule.
 *
 * ⚠ Backend-origin flag (for Phase 3 wiring): the source's /api/simulate is served by
 * rates-simulator-main/backend (FastAPI + QuantLib), which is a DIFFERENT service from
 * the target's IRS Pricer backend that @/lib/api-client's API_BASE points at — even
 * though both default to :8000 in dev. Until that's reconciled, the simulation base URL
 * is independently overridable via NEXT_PUBLIC_SIMULATION_API_BASE_URL and only falls
 * back to the shared API_BASE. Confirm the single-backend vs two-backend decision before S6.
 */
import { API_BASE, ApiError } from "@/lib/api-client";

import type { SimulateRequest, SimulateResponse } from "./simulate-dto";

export const SIMULATION_API_BASE =
  process.env.NEXT_PUBLIC_SIMULATION_API_BASE_URL ?? API_BASE;

const NETWORK_ERROR_MESSAGE =
  "Cannot reach the simulation server -- confirm it is running.";

async function handleResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      typeof body?.detail === "string" ? body.detail : `Request failed (HTTP ${res.status}).`;
    throw new ApiError(detail, res.status);
  }
  return body as T;
}

export const simulationApi = {
  /** Run one scenario. Single request/response — no streaming. `signal` (s15)
   * lets the Running interstitial's cancel button abort the in-flight request;
   * an abort is re-thrown as the original AbortError (NOT wrapped in ApiError)
   * so the caller can tell a user cancel from a network failure. */
  simulate: async (req: SimulateRequest, signal?: AbortSignal): Promise<SimulateResponse> => {
    let res: Response;
    try {
      res = await fetch(`${SIMULATION_API_BASE}/api/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
    }
    return handleResponse<SimulateResponse>(res);
  },
};
