# Betriebshandbuch

> Einrichten, Starten, Stoppen und die häufigsten Störungen — für das System, wie es
> tatsächlich in `docker-compose.yml` definiert ist. Kein Backup-Tooling, keine
> Überwachung, keine Hochverfügbarkeit: Diese Bausteine sind im Repository als Code
> vorbereitet, aber nicht an den laufenden Stack angeschlossen — siehe
> [Technische-Schulden.md](Technische-Schulden.md#3-backup--und-überwachungswerkzeuge-sind-vorbereitet-aber-nicht-angeschlossen).
>
> **Stand:** 23.09.2026.
>
> Verwandt: [Architektur.md](Architektur.md) · [Technische-Schulden.md](Technische-Schulden.md) ·
> [CI-Pipeline.md](CI-Pipeline.md)

---

## 1. Einmalige Einrichtung

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # Passwort erzeugen
# Wert in .env bei POSTGRES_PASSWORD eintragen
```

`.env` wird nur von `docker compose` gelesen (Top-Level-Variable
`POSTGRES_PASSWORD`, siehe `docker-compose.yml`). Für lokale Entwicklung **ohne**
Docker existiert zusätzlich `node-backend/.env` (Vorlage:
`node-backend/.env.example`) — diese Datei wird im Container ignoriert.

## 2. Starten

```powershell
docker compose up -d --build
docker compose ps
```

Oder per Skript, das zusätzlich auf Bereitschaft von `postgres` und `api` wartet:

```powershell
.\start.ps1
```

| Adresse | Inhalt |
|---|---|
| `http://localhost:8080` | Dashboard |
| `http://localhost:3001/api` | REST-API, direkt (nicht über nginx) |
| `localhost:5432` | PostgreSQL, direkt vom Host erreichbar |
| `localhost:1883` | MQTT für Feldgeräte / Simulator |
| `ws://localhost:9001` | MQTT über WebSocket, vom Browser direkt genutzt |

**Startreihenfolge:** `postgres` muss `healthy` sein, bevor `seed`, `api` und
`ingest` starten; `mosquitto` muss `healthy` sein, bevor `ingest` und `simulator`
starten. `web` startet, sobald `api` gestartet (nicht zwingend `healthy`) ist.
`seed` läuft einmalig durch (`restart: "no"`) und legt die Reinräume „Reinraum 221“
und „Infoboard“ an, falls sie noch nicht existieren.

> **Achtung bei lokaler Mosquitto-Installation:** Läuft auf dem Host bereits ein
> Mosquitto-Dienst, belegt dieser Port 1883 (und ggf. 9001) und fängt die
> Nachrichten der Feldgeräte bzw. des Simulators ab — der Container-Broker bekommt
> sie nie zu sehen, obwohl `docker compose ps` alles als `healthy` meldet. Prüfen
> mit `netstat -ano | findstr :1883`; bei mehr als einem Eintrag den nativen
> Windows-Dienst stoppen, bevor an der Docker-Konfiguration gesucht wird.

## 3. Welche Dienste laufen

| Dienst | Aufgabe | Nach außen | Neustart bei Absturz |
|---|---|---|---|
| `postgres` | TimescaleDB | `127.0.0.1:5432` | ✅ |
| `mosquitto` | MQTT-Broker, `allow_anonymous true`, ohne Persistenz-Konfiguration | `:1883`, `:9001` | ✅ |
| `seed` | legt Reinräume an, beendet sich danach | — | ❌ (`restart: "no"`) |
| `api` | REST-API + SSE-Alarme (`server.js`) | `:3001` | ✅ |
| `ingest` | MQTT → PostgreSQL (`mqttBridge.js`) | nur intern | ✅ |
| `web` | nginx: Frontend-Build ausliefern | `:8080` | ✅ |
| `simulator` | Testdaten, **nicht für Produktion** | nur intern | ✅ |

### Was passiert, wenn ein Dienst ausfällt

| Fällt aus | Folge |
|---|---|
| `ingest` | Dashboard zeigt weiter Live-Werte (kommen direkt per WebSocket vom Broker). Keine Persistenz, **und keine automatische Nachlieferung** nach dem Neustart — der laufende Ingest hat kein Retry/Ack-Verfahren |
| `api` | Live-Werte laufen weiter, Historie, Alarmliste und PDF-Report fallen aus |
| `postgres` | `ingest` protokolliert Fehler pro fehlgeschlagenem Insert und läuft weiter, ohne die verlorenen Nachrichten nachzuliefern; `api`-Anfragen mit Datenbankzugriff schlagen fehl |
| `mosquitto` | keine Live-Werte, keine neuen Messdaten |
| `web` | Dashboard im Browser nicht erreichbar — der einzige echte Einzelpunkt für die Oberfläche |

## 4. Alarme und erste Schritte

| Beobachtung | Erste Schritte |
|---|---|
| Dashboard zeigt keine Live-Werte | `docker compose ps mosquitto`, danach den Mosquitto-Port-Konflikt aus Abschnitt 2 prüfen |
| Werte kommen live an, aber `Verlauf`/Historie bleibt leer | `docker compose logs ingest --tail=50` — häufig eine kurzzeitige Datenbankstörung, die ohne Nachlieferung verloren geht (siehe [Technische-Schulden.md](Technische-Schulden.md#2-verlustrisiko-im-tatsächlich-laufenden-ingest)) |
| Push-Benachrichtigung zeigt „undefined“ im Titel | bekannter Fehler in `alertListener.js`, siehe [Technische-Schulden.md](Technische-Schulden.md#6-bekannter-funktionaler-fehler-push-titel-zeigt-undefined) — die Angaben im Dashboard (SSE) sind davon nicht betroffen |
| `api`-Container startet wiederholt neu | `docker compose logs api --tail=50` — bei Express 4 beendet ein unbehandelter Fehler in einer Route den Prozess, siehe [Technische-Schulden.md](Technische-Schulden.md#5-fehlerbehandlung-im-tatsächlich-laufenden-backend) |

## 5. Wartung

### Schema ändern

Das tatsächlich verwendete Schema ist [`db-init/001_schema.sql`](../db-init/001_schema.sql)
— es läuft **nur** beim allerersten Start eines leeren `pgdata`-Volumes. Für
bestehende Installationen gehören Änderungen in `ensureSchema()`
(`node-backend/src/db.js`), die bei jedem Start von `api` und `ingest` erneut
ausgeführt wird. Der Ordner `node-backend/migrations/` gehört zum unbenutzten
Backend-Pfad und wirkt sich auf die laufende Datenbank nicht aus, siehe
[Technische-Schulden.md](Technische-Schulden.md#1-der-wichtigste-befund-zwei-parallele-implementierungen).

### Neuen Sensor in Betrieb nehmen

1. Gerät auf `sensors/<uuid>` senden lassen → erscheint automatisch in
   **Konfiguration → Sensoren**.
2. Dort umbenennen (optional) und **einem Reinraum zuordnen**.
3. **Konfiguration → Schwellenwerte** → Sensor + Messgröße wählen → Min/Max setzen.
4. Panel erscheint in der Übersicht; ab jetzt greift die Alarmierung.

> Ohne Raumzuordnung bleibt ein Sensor im Dashboard unsichtbar (`DashboardGrid`
> filtert auf zugeordnete Sensoren) — das verhindert, dass fremde MQTT-Teilnehmer
> das Dashboard fluten.

### Speicherplatz

```sql
SELECT pg_size_pretty(pg_database_size('ohb_sensordata'));
```

Es gibt keine Kompressions- oder Aufbewahrungsregel auf `sensor_data` — die
Tabelle wächst unbegrenzt, siehe [Technische-Schulden.md](Technische-Schulden.md#7-datenmodell).

### Datenbank zurücksetzen

```powershell
docker compose down -v   # löscht das pgdata-Volume unwiderruflich
docker compose up -d --build
```

Danach läuft `db-init/` erneut, `seed` legt die Reinräume erneut an, alle
Sensoren müssen sich neu registrieren.

## 6. Offene Punkte

Vollständige, priorisierte Liste in [Technische-Schulden.md](Technische-Schulden.md).
Für den Betrieb am wichtigsten:

- **Kein Backup.** `ops/backup.ps1` setzt ein Postgres-Image mit `pgbackrest`
  voraus, das im laufenden Stack nicht verwendet wird — das Skript würde
  fehlschlagen. Ein Ausfall der Datenbank oder des `pgdata`-Volumes bedeutet
  Datenverlust ohne Wiederherstellungsmöglichkeit.
- **Keine Überwachung.** Kein Dienst meldet einen Ausfall automatisch; Kontrolle
  aktuell nur über `docker compose ps`/`docker compose logs`.
- **MQTT ohne Zugangsdaten** (`allow_anonymous true` auf beiden Listenern).
- **Keine Anmeldung am Dashboard.** Jeder im Netz kann Grenzwerte ändern, ohne dass
  festgehalten wird, wer.
