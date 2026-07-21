# FB5-LAND — landing report (both FB5 lanes)

FE-only landing off `feat/simulation-migration`. BE untouched on the dv01 build
(v2 @ `11a4daf`, :8000 healthy throughout). Owner eye-verifies the five feedback
items live after this pass.

## Step 0 — base & lane state (all matched, no STOP)
| | |
|---|---|
| FE mainline pre-merge | `feat/simulation-migration` @ **`0471ed4`** ✓ |
| Lane A | `fb5/rh-trace` @ **`ff352e9`** (wt-fb5-rh) — 12 files (home/rates-history/lib) ✓ |
| Lane B | `fb5/sim-recon-display` @ **`5d8aae9`** (wt-fb5-sim) — 9 files, all `src/features/simulation/` ✓ |
| BE start | `krw-fi-pms-backend` @ **`11a4daf`** (v2), clean, read-only ✓ |
| Dual-dispatch / stray sweep | clean — no unexpected `fb5/*`, no orphan worktrees |

## Step 1 — disjointness proof
`git diff --name-only 0471ed4..<branch>` (code files, reports excluded):
- Lane A: 12 files. Lane B: 9 files. **Intersection: ∅** (`comm -12` empty).
- `.impeccable/hook.cache.json` **absent** from both diffs (both lanes restored
  it to base). Lockfile / `package.json` untouched by both lanes (verified).

## Step 2 — merges (both `--no-ff`, no conflicts)
| Order | Branch | Merge commit |
|---|---|---|
| 1 | `fb5/rh-trace` (A) | **`fa4c802`** |
| 2 | `fb5/sim-recon-display` (B) | **`9342209`** |

## Step 3 — gates (derived vs observed, from merged main checkout)
| Gate | Expected | Observed |
|---|---|---|
| `vitest run` | **444 / 0** = 423 base + 11 (A) + 10 (B) | **444 / 444**, 56 files ✓ (exact — no autocrlf drift to reconcile) |
| `eslint` | 13E / 21W | **13E / 21W** ✓ (all pre-existing, in api-client.ts/api-types.ts) |
| `tsc --noEmit` | clean | **clean** ✓ |
| guards | pass | all green within the 444 (matrix-grid anti-fork reuse, `check:contrast`, label-absence pins, A1/B2 same-source pins, B3 tie-out) |
| tree | clean | clean before build |

## Step 4 — single build + restart window (:3000 only)
- `next build` → exit 0, 13 routes generated.
- Old :3000 PID **17164** (FB4 build) → `taskkill /F` → **confirmed gone**, port freed.
- New :3000 PID **16188** (`next start`, merged head `9342209`) → `✓ Ready`, health **200**.
- :8000 PID **12596** (BE) **never touched** — `/api/market-data/range` → 200 at start and end.

## Step 5 — live smoke (evidence in `fb5-evidence/SMOKE.md`)
Headless env → each item evidenced by served-bundle signature strings +
behavioral vitest pin + route health (all routes 200). Summary:

| Item | Evidence |
|---|---|
| **a. ② trace context** | `Rate Context` / `차트 시리즈` / `trace-benchmark-rates` in bundle; A1 same-source pin (IRS 3Y/10Y + per-series par w/ label+color; quoteless → `—`). |
| **b. F3 label removal** | `coefficient` aria-label **absent** from every chunk; label-absence pins green, weight-emission pins green (coefficients internal & byte-identical). |
| **c. recon display** | `혼합 근거` / `블로터 기준일` / `예상 소액` / `reval DV01` in bundle; blotter still stale → chip shows **2026-03-23**; M3 honest-zero + range %-guard pinned. |
| **d. ③ taxonomy** | `기준 등급` in bundle; `creditSpreads` keys `은행채`/`카드채`/`특은채` intact → **payload byte-identical**; 통안채/특은채 chips absent per lane ruling. |
| **e. ④+⑤** | `기여` subtab + `가정(Assumed)` tie caption in bundle; B2 per-series Δbp readout (`—` on whitespace) + B3 grid book-total = `assumed(day)` (6 dp) pinned. |

## Step 6 — push + deploy state
- **Deploy state**: no `.vercel/` link, no Vercel ref in `.git/config`; remote is
  plain GitHub (`wwoo1116-cell/Rates-Portfolio`); the project's staged deploy path
  is tunnel/nssm-based, not Vercel git-integration. → **This push is backup
  semantics, NOT a production deploy.** Owner dispatch explicitly instructed the push.
- Pushed `--all` then `--tags`; tag **`fb5`** at the landed head. (Ref counts in the
  push-confirmation section below.)
- Both `wt-fb5-*` worktrees removed post-push; branches `fb5/rh-trace` +
  `fb5/sim-recon-display` retained.

## Carried ledger (open, for the owner)
- **credit-Δy variant** — paused by owner; not in this landing.
- **swap-detail (b)** — undecided; no work done.
- **통안채/특은채 chips** — shipped **absent** (matches RV selector). One-line flip to
  disabled-with-reason (`familyRoster` → unfiltered `PREVIEW_FAMILIES` + `스냅샷에
  커브 없음`) available if the owner wants all seven visible — no data work.
- **simulate `remainingDays` staleness** — pre-existing; the sim path still ages off
  the frozen blotter snapshot (same root as the recon blotter as-of).
- **ops: blotter refresh** — the 2026-03-23 export is the reason the recon as-of chip
  shows; a fresh export clears both the chip and the sim staleness.
- **hygiene** — the 13 baseline eslint errors (`no-explicit-any` in
  `api-client.ts`/`api-types.ts`) remain untouched.

## Push confirmation
`git push origin --all` then `--tags` to `github.com/wwoo1116-cell/Rates-Portfolio`:
- `feat/simulation-migration`: **`0471ed4..97d550c`** (fast-forward, backup).
- `[new branch] fb5/rh-trace`, `[new branch] fb5/sim-recon-display` (lane branches retained).
- `[new tag] fb5` → **`430ee53`** (annotated, pointing at the landed head `97d550c`).
- Remote verify: `refs/tags/fb5 = 430ee53`, `refs/heads/feat/simulation-migration = 97d550c` ✓.
- Worktrees: `wt-fb5-rh` + `wt-fb5-sim` removed (git-deregistered + on-disk cleaned,
  main pnpm store intact); branches `fb5/rh-trace` + `fb5/sim-recon-display` retained.

*(This trailing note is committed as a doc addendum on top of `97d550c`; the `fb5`
tag intentionally marks `97d550c` — the merges + landing report + smoke evidence.)*

---
**Landed FE mainline head: `97d550c` (tag `fb5`), doc addendum on top.**
:3000 rebuilt + RUNNING on the merged head (PID 16188, 200); :8000 BE untouched
(PID 12596, 200). **Servers RUNNING — owner verification may begin.**
