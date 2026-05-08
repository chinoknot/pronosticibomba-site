# stop_bot.ps1
# Ferma il bot in background.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PidFile   = Join-Path $ScriptDir "bot.pid"

if (-not (Test-Path $PidFile)) {
    Write-Host "  Bot non in esecuzione (nessun bot.pid trovato)." -ForegroundColor Yellow
    exit 0
}

$botPid = [int](Get-Content $PidFile -Raw).Trim()
$proc   = Get-Process -Id $botPid -ErrorAction SilentlyContinue

if ($proc) {
    Stop-Process -Id $botPid -Force
    Remove-Item $PidFile -Force
    Write-Host ""
    Write-Host "  ✅ Bot fermato (PID $botPid)." -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "  Il processo $botPid non esiste più." -ForegroundColor Yellow
    Remove-Item $PidFile -Force
}
