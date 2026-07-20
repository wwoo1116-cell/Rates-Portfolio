# Start the IRS Pricer API — F-17: NO --reload. 4 workers.
#
# The reload watcher is an observed crash mode on this machine, and it leaves
# orphaned multiprocessing children holding the :8000 socket after the parent
# dies (seen live during Session 4 integration: killed parents 8124/26988 left
# spawn_main children still serving requests). Plain uvicorn, no reloader.
#
# Workers: 4 (spawn). Each worker owns its own in-process curve cache
# (irs_pricer/engine/curve_cache.py, installed at app lifespan), so a cold
# start pays the bootstrap warm-up up to 4x — once per worker — before all
# workers reach steady state. Kill switch: set IRS_PRICER_CURVE_CACHE=0 to
# skip the cache install (default on; read once per startup).
#
# Double-start guard: refuses to launch if :8000 is already listening.
# Kill the existing owner first — starting a second server over a half-dead
# one is exactly the orphaned-children failure mode described above.
#
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File start-backend.ps1
Set-Location $PSScriptRoot

$existing = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    $owners = ($existing | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
    Write-Host ":8000 is already listening (PID $owners). Refusing to double-start." -ForegroundColor Red
    Write-Host "Stop the existing server first:  Stop-Process -Id $owners" -ForegroundColor Yellow
    exit 1
}

python -m uvicorn irs_pricer.api.app:app --host 127.0.0.1 --port 8000 --workers 4
