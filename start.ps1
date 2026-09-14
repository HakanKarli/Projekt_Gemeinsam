# =====================================================================
# OHB Reinraum Dashboard – Start-Skript
# Startet den kompletten Stack ueber Docker Compose:
#   Postgres, Mosquitto, API, MQTT-Bridge, Frontend (nginx), Simulator
# =====================================================================

$ROOT = $PSScriptRoot

function Write-Step { param($msg) Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "    [OK] $msg"   -ForegroundColor Green }
function Write-Fail { param($msg) Write-Host "    [!!] $msg"   -ForegroundColor Red }

# ── 1. .env pruefen ───────────────────────────────────────────────
if (-not (Test-Path "$ROOT\.env")) {
    Write-Fail "Keine .env gefunden. Vorlage kopieren und POSTGRES_PASSWORD setzen:"
    Write-Host "    cp .env.example .env" -ForegroundColor Yellow
    exit 1
}

# ── 2. Docker Compose: kompletten Stack bauen und starten ────────
Write-Step "Baue Images und starte alle Services..."
docker compose -f "$ROOT\docker-compose.yml" up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Fail "docker compose fehlgeschlagen. Ist Docker Desktop gestartet?"
    exit 1
}
Write-OK "Container gestartet."

# ── 3. Warten bis Postgres und API bereit sind ────────────────────
Write-Step "Warte auf Postgres und API..."
$tries = 0
do {
    Start-Sleep -Seconds 2
    $pgStatus  = docker inspect --format "{{.State.Health.Status}}" (docker compose -f "$ROOT\docker-compose.yml" ps -q postgres) 2>$null
    $apiStatus = docker inspect --format "{{.State.Health.Status}}" (docker compose -f "$ROOT\docker-compose.yml" ps -q api)      2>$null
    $tries++
    Write-Host "    ... ($tries) Postgres: $pgStatus | API: $apiStatus"
} while (($pgStatus -ne "healthy" -or $apiStatus -ne "healthy") -and $tries -lt 30)

if ($pgStatus -ne "healthy" -or $apiStatus -ne "healthy") {
    Write-Fail "Nicht alle Services sind nach $tries Versuchen bereit. Pruefe: docker compose logs"
} else {
    Write-OK "Postgres und API sind bereit."
}

# ── Fertig ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=====================================================" -ForegroundColor Yellow
Write-Host "  Alle Services laufen!" -ForegroundColor Yellow
Write-Host "  Dashboard: http://localhost:8080" -ForegroundColor Yellow
Write-Host "  API:       http://localhost:3001/api" -ForegroundColor Yellow
Write-Host "  Postgres:  localhost:5432" -ForegroundColor Yellow
Write-Host "  Mosquitto: localhost:1883 / WS:9001" -ForegroundColor Yellow
Write-Host "  Simulator: sendet laufend Testdaten via MQTT" -ForegroundColor Yellow
Write-Host "=====================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Logs ansehen:  docker compose logs -f          (in diesem Verzeichnis)" -ForegroundColor Gray
Write-Host "Zum Stoppen:   docker compose down" -ForegroundColor Gray
