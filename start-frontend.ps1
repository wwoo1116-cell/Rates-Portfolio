# Start the KIS Rates PMS frontend (Next.js dev server on :3000).
#
# Dev mode preserves the current desk workflow (hot reload, .env.local rewrite
# to the local backend). For a production-style serve instead:
#   pnpm build; pnpm start
# (same :3000, same rewrite config, no HMR).
#
# NOTE: this repo is a pnpm project (pnpm-lock.yaml). Do not npm install here —
# npm skips peer deps and breaks tsc (see SESSION3_REPORT.md).
#
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File start-frontend.ps1
Set-Location $PSScriptRoot
pnpm dev
