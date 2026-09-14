# =====================================================================
# OHB Reinraum Dashboard – Start-Skript
# Startet: Docker (Postgres + Mosquitto), Node-Backend, React-Frontend
# =====================================================================

$ROOT = $PSScriptRoot

function Write-Step { param($msg) Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "    [OK] $msg"   -ForegroundColor Green }
function Write-Fail { param($msg) Write-Host "    [!!] $msg"   -ForegroundColor Red }

# ── 1. Docker Compose ─────────────────────────────────────────────
Write-Step "Starte Docker-Services (Postgres + Mosquitto)..."
docker compose -f "$ROOT\docker-compose.yml" up -d
if ($LASTEXITCODE -ne 0) {
    Write-Fail "docker compose fehlgeschlagen. Ist Docker Desktop gestartet?"
    exit 1
}
Write-OK "Docker-Container gestartet."

# ── 2. Warten bis Postgres bereit ist ────────────────────────────
Write-Step "Warte auf Postgres Health-Check..."
$tries = 0
do {
    Start-Sleep -Seconds 2
    $status = docker inspect --format "{{.State.Health.Status}}" ohb_project-postgres-1 2>$null
    if (-not $status) {
        $status = docker inspect --format "{{.State.Health.Status}}" (
            docker compose -f "$ROOT\docker-compose.yml" ps -q postgres
        ) 2>$null
    }
    $tries++
    Write-Host "    ... ($tries) Status: $status"
} while ($status -ne "healthy" -and $tries -lt 20)

if ($status -ne "healthy") {
    Write-Fail "Postgres ist nach $tries Versuchen nicht bereit. Pruefe: docker compose logs postgres"
} else {
    Write-OK "Postgres ist bereit."
}

# ── 3. Node-Backend ───────────────────────────────────────────────
Write-Step "Starte Node-Backend (Port 3001)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$ROOT\node-backend'; Write-Host 'OHB Backend' -ForegroundColor Cyan; npm run dev" `
    -WindowStyle Normal
Write-OK "Backend-Fenster geoeffnet."

# ── 4. MQTT Bridge ────────────────────────────────────────────────
Write-Step "Starte MQTT Bridge (MQTT → PostgreSQL)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$ROOT\node-backend'; Write-Host 'OHB MQTT Bridge' -ForegroundColor Magenta; node src/mqttBridge.js" `
    -WindowStyle Normal
Write-OK "MQTT-Bridge-Fenster geoeffnet."

# ── 5. MQTT Simulator ────────────────────────────────────────────
Write-Step "Starte MQTT Simulator (Testdaten)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$ROOT\MQTT_Publish_Test'; Write-Host 'OHB MQTT Simulator' -ForegroundColor Yellow; python mqtt_simulator.py" `
    -WindowStyle Normal
Write-OK "MQTT-Simulator-Fenster geoeffnet."

# ── 6. React-Frontend ─────────────────────────────────────────────
Write-Step "Starte React-Frontend (Vite Dev-Server)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$ROOT\ohb-dashboard'; Write-Host 'OHB Frontend' -ForegroundColor Cyan; npm run dev" `
    -WindowStyle Normal
Write-OK "Frontend-Fenster geoeffnet."

# ── Fertig ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=====================================================" -ForegroundColor Yellow
Write-Host "  Alle Services gestartet!" -ForegroundColor Yellow
Write-Host "  Frontend:  http://localhost:5173" -ForegroundColor Yellow
Write-Host "  Backend:   http://localhost:3001" -ForegroundColor Yellow
Write-Host "  Postgres:  localhost:5432" -ForegroundColor Yellow
Write-Host "  Mosquitto: localhost:1883 / WS:9001" -ForegroundColor Yellow
Write-Host "  Simulator: sendet alle 2s Testdaten via MQTT" -ForegroundColor Yellow
Write-Host "=====================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Zum Stoppen: docker compose down  (in diesem Verzeichnis)" -ForegroundColor Gray
