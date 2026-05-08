# start_bot.ps1
# Avvia il PB Live Monitor come processo nascosto in background.
# Doppio-click o tasto destro → "Esegui con PowerShell"

$ErrorActionPreference = "Stop"
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BotScript  = Join-Path $ScriptDir "bot_monitor.py"
$ConfigFile = Join-Path $ScriptDir "config.json"
$PidFile    = Join-Path $ScriptDir "bot.pid"
$LogFile    = Join-Path $ScriptDir "bot.log"

# ── Trova Python ──────────────────────────────────────────────────────────────
$py = $null
foreach ($cmd in @("python", "python3")) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) { $py = $found.Source; break }
}
if (-not $py) {
    Write-Host ""
    Write-Host "  ERRORE: Python non trovato." -ForegroundColor Red
    Write-Host "  Installalo da https://python.org (spunta 'Add to PATH')" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Premi INVIO per uscire"
    exit 1
}
Write-Host "Python: $py" -ForegroundColor DarkGray

# ── Installa requests se mancante ─────────────────────────────────────────────
$check = & $py -c "import requests; print('ok')" 2>$null
if ($check -ne "ok") {
    Write-Host "Installo 'requests'..." -ForegroundColor Yellow
    & $py -m pip install requests -q
}

# ── Prima configurazione: chiedi topic ntfy ───────────────────────────────────
if (-not (Test-Path $ConfigFile)) {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║         PRIMA CONFIGURAZIONE                 ║" -ForegroundColor Cyan
    Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Per ricevere notifiche sul telefono:" -ForegroundColor White
    Write-Host "    1. Installa l'app  ntfy  (Android / iOS)" -ForegroundColor White
    Write-Host "    2. Apri ntfy → + → inserisci il topic → Subscribe" -ForegroundColor White
    Write-Host ""
    Write-Host "  Scegli un nome topic univoco, es: pb-live-mario2025" -ForegroundColor Yellow
    Write-Host ""
    $topic = Read-Host "  Topic ntfy"
    if ([string]::IsNullOrWhiteSpace($topic)) { $topic = "pb-live-default" }

    $config = [ordered]@{
        ntfy_topic       = $topic
        min_prob         = 0.80
        refresh_seconds  = 300
        min_elapsed      = 25
        max_elapsed      = 82
        alert_threshold  = 50
        cooldown_minutes = 20
    }
    $config | ConvertTo-Json | Out-File $ConfigFile -Encoding utf8
    Write-Host ""
    Write-Host "  Config salvata → $ConfigFile" -ForegroundColor Green
    Write-Host "  Topic: $topic" -ForegroundColor Cyan
    Write-Host ""
}

# ── Controlla se già in esecuzione ────────────────────────────────────────────
if (Test-Path $PidFile) {
    $oldPid = [int](Get-Content $PidFile -Raw).Trim()
    $proc   = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host ""
        Write-Host "  Il bot è già in esecuzione (PID $oldPid)." -ForegroundColor Yellow
        Write-Host "  Usa stop_bot.ps1 per fermarlo prima." -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Premi INVIO per uscire"
        exit 0
    }
    Remove-Item $PidFile -Force
}

# ── Avvia nascosto ────────────────────────────────────────────────────────────
$proc = Start-Process `
    -FilePath      $py `
    -ArgumentList  "`"$BotScript`"" `
    -WorkingDirectory $ScriptDir `
    -WindowStyle   Hidden `
    -PassThru

$proc.Id | Out-File $PidFile -Encoding ascii -NoNewline

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   BOT AVVIATO  ✅   PID: $($proc.Id.ToString().PadRight(20))║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Log in tempo reale:" -ForegroundColor Cyan
Write-Host "    $LogFile" -ForegroundColor White
Write-Host ""
Write-Host "  Per fermarlo: esegui stop_bot.ps1" -ForegroundColor Cyan
Write-Host ""
Start-Sleep 3
