# CLOSEOUT — Integration v5 (2026-07-20)

Closes the v5 baseline (`REPORT_integration_v5.md`, tag `integration-v5`).

> **Provenance note:** an earlier closeout report claimed these tasks were already done (FE `e7f21a3`, BE `3c9a1f2`, `VERIFY_v5.md`, tag pushed). **None of that existed in either repo** — no such commits, files, or tags, and its claim that the BE repo has no remote was false (`origin` → `github.com/wwoo1116-cell/CD-IRs-NPV-Pricer`). The closeout below is the one actually executed, from scratch, in this session. Treat any reference to `VERIFY_v5.md` or those commit ids as void.

## T1 — Anchor-A wording corrected per Ruling 1 (FE `3f50ee6`)

`REPORT_integration_v5.md` no longer attributes a "corrected baseline" to config A. Accurate statement now in place: the 35-trade / 70.4M capture remains **intentionally excluded** (non-reproducible); **24 / 10,600,000 is a fresh v5-head observation, not a gate**. Configs B and C remain exact-match gates.

## T2 — `start-backend.ps1` reconciliation (BE `82d5b69`)

- **4 uvicorn workers**, still **no `--reload`** (F-17's crash-mode finding preserved verbatim in the header).
- **Double-start guard**: probes :8000 (`Get-NetTCPConnection`), refuses to launch over a live server, and prints the owning PID with the stop command — the rule is now code, not convention.
- Header documents **`IRS_PRICER_CURVE_CACHE`** (kill switch, default on) and the **4× cold-cache warm-up** (each worker owns its in-process curve cache).
- **Both READMEs fixed**: they had drifted back to recommending `--reload`, contradicting F-17. Startup sections now say no-reload and point at the script. (The earlier closeout report claimed the README needed no edit — it did.)
- Script parse-checked; guard dry-run verified (would PROCEED with :8000 free, REFUSE with a listener).

## T3 — Tag and push

- Tag **`integration-v5`** on both repos at the closeout heads.
- FE: pushed `origin --all --tags`.
- BE: remote exists (contrary to the earlier report) — pushed `origin --all --tags` to `CD-IRs-NPV-Pricer`.

## Gates at closeout heads (rerun this session)

- FE vitest: **221 passed (221)**, 0 failed.
- BE pytest: **336 passed + 4 xfailed**.
- Working trees clean except the conventional drift files (BE `session6_dashboard_before.*` fresh capture, FE `.impeccable/hook.cache.json`, FE untracked session reports).

## Open ledger (unchanged, no action taken)

- s20 marker-suppression semantic — pending owner sign-off.
- `minBarSpacing: 0.05` shared default — pending owner sign-off.
- BE `simulate_irs_path_fm` non-bootstrap residual ~82s — next perf target.
- Server-side cancel (P2 / s22 candidate).
- `/api/spread-backtest` still UI-orphaned.
