# Start the IRS Pricer API — F-17: NO --reload.
#
# The reload watcher is an observed crash mode on this machine, and it leaves
# orphaned multiprocessing children holding the :8000 socket after the parent
# dies (seen live during Session 4 integration: killed parents 8124/26988 left
# spawn_main children still serving requests). Plain uvicorn, one process.
#
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File start-backend.ps1
Set-Location $PSScriptRoot
python -m uvicorn irs_pricer.api.app:app --host 127.0.0.1 --port 8000
