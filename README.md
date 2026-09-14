# OHB Cleanroom Sensor Dashboard – MVP

Echtzeit-Überwachungssystem für Reinraum-Sensordaten via MQTT, gespeichert in TimescaleDB, visualisiert im React-Frontend.

## Systemarchitektur

```
[Docker] simulator (mqtt_simulator.py)
      │  MQTT publish (Port 1883)
      ▼
[Docker] mosquitto ──────────────────────────► Browser-Frontend
      │  MQTT subscribe                         ws://localhost:9001
      ▼
[Docker] ingest (mqttBridge.js)
      │  INSERT INTO sensor_data
      ▼
[Docker] postgres — PostgreSQL + TimescaleDB (Port 5432)
      │  LISTEN/NOTIFY
      ▼
[Docker] api (server.js — REST API + SSE Alerts, Port 3001)
      ▲
      │  http://localhost:3001/api
[Docker] web (nginx, Frontend-Build, Port 8080)
```

Alle sieben Dienste laufen als Container, siehe `docker-compose.yml`.

## Voraussetzungen

| Tool | Version | Download |
|------|---------|----------|
| Docker Desktop | ≥ 4.x | https://www.docker.com/products/docker-desktop |

> Node.js und Python werden nur für die lokale Entwicklung *ohne* Docker gebraucht
> (Hot-Reload etc.) — siehe [Lokale Entwicklung ohne Docker](#lokale-entwicklung-ohne-docker).

> **Wichtig:** Falls du eine lokale PostgreSQL- oder Mosquitto-Installation hast, deaktiviere diese vor dem Start, da sie Port 5432 bzw. 1883 belegen würden.
> - PostgreSQL deaktivieren: Windows Services → `postgresql-*` → Stopp
> - Mosquitto deaktivieren: Windows Services → `mosquitto` → Stopp

---

## Schnellstart (Docker) — ein Befehl, kompletter Stack

### 1. `.env` anlegen

```powershell
cp .env.example .env
```

Ein starkes `POSTGRES_PASSWORD` eintragen, z. B. erzeugt mit:
```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

### 2. Stack bauen und starten

```powershell
docker compose up -d --build
```

Oder unter Windows per Skript, das zusätzlich auf Bereitschaft wartet:
```powershell
./start.ps1
```

Das startet den kompletten Stack in einem Rutsch:

| Dienst | Beschreibung | Port |
|---|---|---|
| `postgres` | PostgreSQL + TimescaleDB | `5432` |
| `mosquitto` | MQTT-Broker | `1883` (MQTT), `9001` (WebSocket) |
| `seed` | Legt Reinräume an — läuft einmalig, beendet sich danach | – |
| `api` | REST-API + Alert-Server (SSE) | `3001` |
| `ingest` | MQTT-Bridge, schreibt Messdaten in Postgres | – |
| `web` | Frontend (Vite-Build, ausgeliefert von nginx) | `8080` |
| `simulator` | Generiert Testdaten (nicht für Produktion) | – |

Status prüfen:
```powershell
docker compose ps
```
`postgres`, `mosquitto`, `api` und `web` sollten `healthy` bzw. `running` anzeigen.

### 3. Dashboard öffnen

**http://localhost:8080**

Sensoren erscheinen automatisch, sobald der Simulator (oder echte Sensoren) Daten senden —
kein manuelles Eintragen von Topics nötig.

---

## Stoppen

```powershell
# Container stoppen (Daten bleiben erhalten)
docker compose down

# Container stoppen UND alle Daten löschen
docker compose down -v
```

---

## Lokale Entwicklung ohne Docker

Für Hot-Reload am Backend/Frontend lassen sich `postgres` und `mosquitto` weiter über
Docker laufen lassen, während `api`, `ingest` und das Frontend direkt auf dem Host laufen:

```powershell
docker compose up -d postgres mosquitto seed
```

**Backend-Abhängigkeiten installieren:**
```powershell
cd node-backend
npm install
```

**API (Terminal 1):**
```powershell
npm run dev
```

**MQTT-Bridge (Terminal 2):**
```powershell
node src/mqttBridge.js
```

**Frontend (Terminal 3):**
```powershell
cd ohb-dashboard
npm install     # einmalig
npm run dev
```
Frontend öffnet sich unter **http://localhost:5173** (Vite Dev-Server statt nginx).

**MQTT-Simulator (Terminal 4, optional):**
```powershell
cd MQTT_Publish_Test
pip install -r requirements.txt   # einmalig
python mqtt_simulator.py
```

Die Werte in `node-backend/.env` (Vorlage: `node-backend/.env.example`) sind bereits auf
`127.0.0.1` eingestellt und passen zu den auf den Host gemappten Docker-Ports.

## Konfiguration

### `.env` (Wurzelverzeichnis, für `docker compose`)
```env
POSTGRES_PASSWORD=<starkes Passwort>
```

### `node-backend/.env` (nur für lokale Entwicklung ohne Docker, Vorlage: `.env.example`)
```env
POSTGRES_HOST=127.0.0.1     # Wichtig: 127.0.0.1 statt localhost (IPv4)
POSTGRES_PORT=5432
POSTGRES_DB=ohb_sensordata
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<dasselbe Passwort wie oben>

MQTT_BROKER_URL=mqtt://127.0.0.1:1883

PORT=3001
```
In Docker werden diese Werte stattdessen direkt in `docker-compose.yml` gesetzt
(Hostnamen `postgres`/`mosquitto` statt `127.0.0.1`) — die `.env` im Container wird ignoriert.

### `MQTT_Publish_Test/mqtt_simulator.py`
Per Umgebungsvariablen überschreibbar (siehe `docker-compose.yml`, Dienst `simulator`):
```env
MQTT_BROKER_HOST=localhost   # MQTT-Broker Adresse
MQTT_BROKER_PORT=1883
MQTT_INTERVAL=2.0            # Sendeintervall in Sekunden
```

---

## Troubleshooting

| Problem | Ursache | Lösung |
|---------|---------|--------|
| `docker compose up` bricht ab: "bitte in .env setzen" | `POSTGRES_PASSWORD` fehlt | `.env.example` nach `.env` kopieren und Passwort eintragen |
| `Datenbank 'ohb_sensordata' existiert nicht` | Lokale PostgreSQL blockiert Port 5432 | Lokale PostgreSQL stoppen (Windows Services) |
| `ingest`-Container läuft, aber keine Daten in der DB | `simulator` läuft nicht oder sendet an falschen Broker | `docker compose logs simulator` und `docker compose logs ingest` prüfen |
| Frontend zeigt keine Daten | Mosquitto WebSocket nicht erreichbar | `docker compose ps mosquitto` prüfen; Broker-URL im Dashboard auf `ws://localhost:9001` setzen |
| `ECONNREFUSED` / Container startet nicht | Docker Desktop nicht gestartet | Docker Desktop starten, dann `docker compose up -d --build` |
| Port 5432/1883 schon belegt | Lokale PostgreSQL/Mosquitto-Installation läuft parallel | Lokale Installation stoppen (siehe Voraussetzungen oben) |
