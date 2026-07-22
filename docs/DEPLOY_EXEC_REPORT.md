# DEPLOY_EXEC_REPORT — FE-on-Vercel + BE-local, live (2026-07-22)

Owner-attended deploy execution. FE deploys to Vercel from GitHub; the FastAPI BE
stays local, exposed through a Cloudflare **quick** tunnel. This records what was
built, measured, and verified live.

## Heads

| Repo | Head | Notes |
|---|---|---|
| FE `krw-fi-pms` | **5003729** | `origin/main == origin/feat/simulation-migration == 5003729` |
| — deploy-readiness commit | `c9d6968` | env-driven origin, same-origin client, `/api/simulate` route proxy |
| — merge into mainline | `7b0e4ad` | `--no-ff` |
| — repo cleanup (Part 1) | `6fa6cc4` → merge `5003729` | reports/evidence → `docs/`, root 24→8 md |
| BE `krw-fi-pms-backend` | `11a4daf` (v2, tag `dv01`) | unchanged this session; running, 4 workers |

**Production URL: `https://rates-portfolio.vercel.app`** (the owner set this primary
domain; the auto-generated `project-future-nine.vercel.app` now 307-redirects to it).

## Environment variables (Vercel, values redacted)

| Key | Value | Why |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `""` (set, **empty**) | Same-origin. ⚠️ Omitting it makes the browser target its own localhost — must be present as empty. |
| `BACKEND_ORIGIN` | `https://<quick-tunnel-host>.trycloudflare.com` | Server-side only (NOT `NEXT_PUBLIC_*`); the tunnel origin. |
| `NEXT_PUBLIC_SIMULATION_API_BASE_URL` | *(unset)* | Inherits same-origin → simulate hits the 300s route handler. |
| `NEXT_PUBLIC_UPLOAD_BASE_URL` | *(unset)* | Same-origin through the rewrite (CDN router, no 4.5 MB cap). |
| `APP_SHARED_SECRET` | *(not set)* | Auth posture **OFF** this session (owner call) → no BE change, no secret header. |

## The 4.5 MB measurement and why the route handler is still required

Measured against the live 649-position book (273 bonds + 376 live swaps), simDays 180,
UI-shaped ramp/matrix shock:

- **Request body: 0.292 MB. Full-book response body: 0.075 MB** (79,111 B) — ~60× under
  Vercel's 4.5 MB function-body cap. The response is aggregated by day/book/sector, not
  per-instrument, so it barely grows with book size. → the route-handler lane is viable.
- **Why not the plain rewrite:** Vercel external rewrites cap at **120s TTFB**; FastAPI
  sends the whole simulate JSON at completion, so TTFB ≈ full runtime. Historical
  full-book cold runs are ~106–118s (1–13% margin) — one regression 504s. The route
  handler runs as a function with `export const maxDuration = 300`, ≥2.5× the worst
  measured cold run. `/api/simulate` deploys as **ƒ (Dynamic)**; everything else stays on
  the plain rewrite.

## Quick-tunnel mode + rotating-hostname caveat

A trycloudflare **quick** tunnel needs no login but **rotates its hostname on every
cloudflared restart**. Because the `next.config` rewrite destination is **baked at build
time**, a hostname change requires updating `BACKEND_ORIGIN` in Vercel **and a redeploy**
— not just an env edit. (The route handler reads `BACKEND_ORIGIN` at runtime, but the
plain-rewrite lanes do not.) Acceptable for testing; the production fix is a named tunnel
on a domain (stable `api.<domain>`).

**Cloudflare quick-tunnel wall:** a quick tunnel also imposes its own ~100s
request wall — **below** both the 120s rewrite and 300s function budgets (wall order:
~100 < 120 < 300). A cold full-book run (~106–118s) can therefore 524 at the *tunnel*
layer even though Vercel would allow it. Remedy on record: make simulate an async
`StreamingResponse` with periodic heartbeats so the tunnel sees bytes flowing (BE-side
fix; requires a :8000 restart to go live). Not exercised this session — runs were warm.

## Step-5 live verification (against `rates-portfolio.vercel.app`)

| # | Item | Result | Timing |
|---|---|---|---|
| 1 | Deployment serves current build | ✅ route handler present, env wired (dashboard Ready-status is owner-eyeball) | — |
| 2 | URL serves app, no SSO wall | ✅ 200, app shell, API returns data (no Protection wall) | — |
| 3 | Data path deployed→tunnel→BE | ✅ `funding-rate` real numbers `{policy_base_rate:0.0275,…}` | ~0.5s |
| 4 | Full-book simulate via route handler | ✅ 200, 79,111 B intact, no 504 | **4.8s (WARM cache)** |
| 5 | Side-by-side vs local `:3000` | ✅ byte-identical (`finalTotal -8978122036`) | :3000 2.2s |
| 6 | Deployed bundle clean | ✅ 0× `127.0.0.1` / `:8000` in served chunks | — |

Note on #4: the BE cache was warm from this session, so 4.8s is not the cold ~110s case.
A genuine cold test needs a :8000 restart (and would risk the tunnel wall above).

## Branch model now in force

- Work on **`feat/simulation-migration`**; promote to **`main`** via `git merge --ff-only`
  (verified pure-ancestor). **`main` is the Vercel production branch → any push to `main`
  auto-deploys.** Keep the two fast-forward-aligned.
- No force flags on our own repos.

## Part-1 repo cleanup (this session)

- Root markdown 24 → 8; 16 session reports moved to `docs/history/`, evidence dirs to
  `docs/fb5`, `docs/fb5r`, `docs/history/` (`git mv`, history preserved). Doc-only.
- All 22 stale worktrees removed from both repos; **every branch ref preserved**
  (incl. unmerged `r3a/sim-service-split`).

## Production-hardening follow-ups (not done today)

1. **Named tunnel + owner domain** → stable `api.<domain>`, ends the rotation/redeploy churn.
2. **Shared secret ON** → BE middleware `x-app-secret` when `APP_SHARED_SECRET` set; route
   handler + rewrite layer inject it. Closes the open tunnel to scanners.
3. **Async streaming simulate** → survive the Cloudflare quick-tunnel ~100s wall on cold runs.
4. **NSSM services installed LAST** (BE + cloudflared) → boot-start + auto-restart; from then
   on all sessions use `Restart-Service`, never manual `start-backend.ps1`.
5. **Blotter refresh** ops item (frozen 2026-03-23 snapshot).

## Servers at report time

BE `:8000` up (11a4daf, 4 workers); quick tunnel up; local `:3000` up (side-by-side).
Production `https://rates-portfolio.vercel.app` live, data path green.
