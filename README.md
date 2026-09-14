# OHB Cleanroom Sensor Dashboard – MVP

Echtzeit-Überwachungssystem für Reinraum-Sensordaten via MQTT, gespeichert in TimescaleDB, visualisiert im React-Frontend.

## Systemarchitektur

```
mqtt_simulator.py
      │  MQTT publish (Port 1883)
      ▼
[Docker] Mosquitto Broker ──────────────────► Browser-Frontend
      │  MQTT subscribe                        ws://localhost:9001
      ▼
[Node] mqttBridge.js
      │  INSERT INTO sensor_data
      ▼
[Docker] PostgreSQL + TimescaleDB (Port 5432)
      │  LISTEN/NOTIFY
      ▼
[Node] server.js (REST API + SSE Alerts, Port 3001)
```

## Voraussetzungen

| Tool | Version | Download |
|------|---------|----------|
| Docker Desktop | ≥ 4.x | https://www.docker.com/products/docker-desktop |
| Node.js | ≥ 22.x | https://nodejs.org |
| Python | 3.10+ | https://www.python.org |

> **Wichtig:** Falls du eine lokale PostgreSQL- oder Mosquitto-Installation hast, deaktiviere diese vor dem Start, da sie Port 5432 bzw. 1883 belegen würden.
> - PostgreSQL deaktivieren: Windows Services → `postgresql-*` → Stopp
> - Mosquitto deaktivieren: Windows Services → `mosquitto` → Stopp

---

## Setup – Schritt für Schritt

### 1. Docker-Services starten

```powershell
cd OHB_JahresProjekt_MVP
docker compose up -d
```

Startet im Hintergrund:
- **PostgreSQL + TimescaleDB** auf Port `5432`
- **Mosquitto MQTT Broker** auf Port `1883` (MQTT) und `9001` (WebSocket)

Status prüfen:
```powershell
docker compose ps
```
Beide Services sollten `healthy` anzeigen.

---

### 2. Node-Backend – Abhängigkeiten installieren

```powershell
cd node-backend
npm install
```

---

### 3. Datenbank-Seed einspielen

Einmalig ausführen, um Sensoren und Reinraum in die DB einzutragen:

```powershell
cd node-backend\src
node .\seed.js
```

Mac:
```powershell
cd node-backend/src
node ./seed.js
```

Erwartete Ausgabe:
```
[SEED] Verbunden mit PostgreSQL
[SEED] cleanrooms OK
[SEED] sensors OK
[SEED]   Assignment: reinraum1/lps22/#
[SEED]   Assignment: reinraum1/sgp30/#
[SEED]   Assignment: reinraum1/fs3000/#
[SEED]   Assignment: reinraum1/hm3301/#
[SEED] Fertig!
```

---

### 4. Services starten

Öffne **3 separate Terminals** und führe in jedem einen der folgenden Befehle aus:

**Terminal 1 – REST-API & Alert-Server:**
```powershell
cd node-backend\src
node .\server.js
```
Mac:
```powershell
cd node-backend\src
node ./server.js
```

Erwartete Ausgabe:
```
[SERVER] Laeuft auf http://0.0.0.0:3001
[ALERT]  Lausche auf PostgreSQL-Channel "threshold_alert"
```

**Terminal 2 – MQTT-zu-Datenbank-Bridge:**
```powershell
cd node-backend\src
node .\mqttBridge.js
```
Mac:
```powershell
cd node-backend\src
node ./mqttBridge.js
```

Erwartete Ausgabe:
```
[BRIDGE] Verbunden mit mqtt://127.0.0.1:1883
[BRIDGE] Subscribed: reinraum1/lps22/#
[BRIDGE] Subscribed: reinraum1/sgp30/#
[BRIDGE] Subscribed: reinraum1/fs3000/#
[BRIDGE] Subscribed: reinraum1/hm3301/#
```

**Terminal 3 – MQTT-Simulator (Testdaten):**
```powershell
cd MQTT_Publish_Test
pip install paho-mqtt   # einmalig
python mqtt_simulator.py
```
Erwartete Ausgabe:
```
✅ Verbunden mit localhost:1883
  → reinraum1/lps22/temperature   25.4 °C
  → reinraum1/lps22/pressure      1013.2 hPa
  ...
```

---

### 5. Frontend starten

```powershell
cd ohb-dashboard
npm install     # einmalig
npm run dev
```

Frontend öffnet sich unter: **http://localhost:5173**

---

### 6. Dashboard benutzen

1. Im Frontend ein Topic in ein Panel eingeben, z.B.:
   - `reinraum1/lps22/temperature`
   - `reinraum1/sgp30/eco2`
   - `reinraum1/fs3000/wind_speed`
   - `reinraum1/hm3301/pm2_5`
2. Auf **Subscribe** klicken
3. Live-Daten erscheinen im Chart

---

## Stoppen

```powershell
# Docker-Services stoppen (Daten bleiben erhalten)
docker compose down

# Docker-Services stoppen UND alle Daten löschen
docker compose down -v
```

---

## Konfiguration

### `node-backend/.env`
```env
POSTGRES_HOST=127.0.0.1     # Wichtig: 127.0.0.1 statt localhost (IPv4)
POSTGRES_PORT=5432
POSTGRES_DB=ohb_sensordata
POSTGRES_USER=postgres
POSTGRES_PASSWORD=Baum1234

MQTT_BROKER_URL=mqtt://127.0.0.1:1883

PORT=3001
```

### `MQTT_Publish_Test/mqtt_simulator.py`
```python
BROKER_HOST = "localhost"   # MQTT-Broker Adresse
BROKER_PORT = 1883
INTERVAL    = 2.0           # Sendeinervall in Sekunden
```

---

## Troubleshooting

| Problem | Ursache | Lösung |
|---------|---------|--------|
| `Datenbank 'ohb_sensordata' existiert nicht` | Lokale PostgreSQL blockiert Port 5432 | Lokale PostgreSQL stoppen (Windows Services) |
| MQTT-Bridge subscribed keine Topics | `sensor_assignments` Tabelle leer | `node seed.js` ausführen (Schritt 3) |
| Frontend zeigt keine Daten | Mosquitto WebSocket nicht erreichbar | Lokalen Mosquitto stoppen; `ws://localhost:9001` als Broker-URL verwenden |
| `ECONNREFUSED` beim Nodestart | Docker nicht gestartet | `docker compose up -d` ausführen |
