# Betriebshandbuch

> Was zu tun ist: beim Einrichten, beim Alarm, beim Ausfall.
>
> Verwandt: [Verlustfreiheit.md](Verlustfreiheit.md) · [Feldebene.md](Feldebene.md) ·
> [Zielarchitektur.md](Zielarchitektur.md) · [Engineering-Standards.md](Engineering-Standards.md) ·
> [Technologieentscheidungen.md](Technologieentscheidungen.md)

---

## 1. Stack starten

```powershell
# Einmalig: Zugangsdaten anlegen
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # Passwort erzeugen
# Wert in .env bei POSTGRES_PASSWORD eintragen

docker compose up -d --build
docker compose ps          # alle Dienste müssen "healthy" zeigen
```

| Adresse | Inhalt |
|---|---|
| `http://localhost` | Dashboard |
| `http://localhost/api/docs` | Schnittstellenbeschreibung (Swagger UI) |
| `http://localhost/api/health/deep` | Systemzustand als JSON |
| `http://localhost:3003` | Überwachung (Uptime Kuma) |
| `localhost:1883` | MQTT für die Feldgeräte |

**Startreihenfolge** ist erzwungen: `postgres` → `migrate` (läuft einmal durch) → `ingest`/`api` → `web`.
Der `migrate`-Dienst muss mit Code 0 enden, sonst starten die Anwendungen nicht.

> **Achtung bei lokaler Mosquitto-Installation:** Läuft auf dem Host bereits ein
> Mosquitto-Dienst, belegt dieser Port 1883 und fängt die Nachrichten der Feldgeräte
> ab — der Container-Broker bekommt sie nie zu sehen. Prüfen mit
> `netstat -ano | findstr :1883`; bei zwei Einträgen den Windows-Dienst stoppen.

---

## 1a. Welche Dienste laufen

Sechs Container im Dauerbetrieb, einer läuft nur einmal durch.

| Dienst | Aufgabe | Nach außen | Neustart | Zustandsprüfung |
|---|---|---|---|---|
| **web** | nginx: Frontend ausliefern, `/api` und `/mqtt` weiterreichen | `:80` | ✅ | ✅ (im Dockerfile) |
| **api** | REST, Server-Sent Events, PDF-Report, Alarm-Listener und -Abgleich | nur intern | ✅ | ✅ |
| **ingest** | MQTT → PostgreSQL, Bestätigung nach dem Commit | nur intern | ✅ | ✅ |
| **postgres** | TimescaleDB + pgBackRest (WAL-Archivierung) | `127.0.0.1:5432` | ✅ | ✅ |
| **mosquitto** | MQTT-Broker mit Persistenz, puffert bei Ausfällen | `:1883` | ✅ | ✅ |
| **uptime-kuma** | Überwachung und Benachrichtigung | `:3003` | ✅ | ✅ (aus dem Abbild) |
| **migrate** | Wendet Migrationen an, beendet sich mit Code 0 | — | `no` | — |

`api` und `ingest` veröffentlichen bewusst **keine** Ports — sie sind nur im
Docker-Netz erreichbar, der Browser kommt ausschließlich über nginx an sie heran.
PostgreSQL ist auf `127.0.0.1` gebunden und damit nicht aus dem Netz erreichbar.

`api` und `ingest` starten erst, wenn `migrate` erfolgreich beendet ist
(`service_completed_successfully`). Schlägt eine Migration fehl, läuft die Anwendung
gar nicht erst auf einem Schema, das nicht zu ihr passt.

### Was passiert, wenn einer ausfällt

| Fällt aus | Folge |
|---|---|
| **ingest** | Dashboard zeigt weiter Live-Werte (die kommen direkt per WebSocket vom Broker). **Keine** Persistenz — aber auch kein Verlust: Der Broker hält die unbestätigten Nachrichten |
| **api** | Live-Werte laufen weiter, Historie, Alarmliste und PDF fallen aus. Der Ingest schreibt unbeeindruckt weiter |
| **postgres** | Ingest wiederholt, beendet sich, startet neu; Broker puffert. Live-Sicht unbeeinträchtigt |
| **mosquitto** | Keine Live-Werte, keine neuen Messdaten. Historie und Auswertung bleiben bedienbar |
| **web** | Nichts mehr im Browser erreichbar — **der einzige echte Einzelpunkt für die Oberfläche** |
| **uptime-kuma** | Nur die Überwachung fehlt, das System läuft normal weiter |

Die Entkopplung von Live- und Persistenzpfad aus der ursprünglichen Architektur ist
erhalten: Der Broker ist der einzige gemeinsame Punkt zwischen beiden.

### Keine Dienste — Werkzeuge von Hand

- `MQTT_Publish_Test/mqtt_simulator.py` — Testdaten. Bewusst **kein** Container: gehört
  zur Feldebene, nicht zum System. Im Betrieb sitzen dort die Raspberry Pis
- `node-backend/tools/mqtt-sniffer.js` — mitlesen, was auf dem Broker passiert
- `npm run seed` · `npm run openapi:export` · `pgbackrest ... backup`

---

## 2. Einmalige Einrichtung

### 2.1 Sicherung scharfschalten

Bei einer **neuen** Installation legt der Container die pgBackRest-Stanza selbst an
(`docker/postgres/initdb/10-pgbackrest-stanza.sh`). Für eine **bestehende** Datenbank
einmalig nachholen:

```powershell
docker compose exec -u postgres postgres pgbackrest --stanza=ohb stanza-create
docker compose exec -u postgres postgres pgbackrest --stanza=ohb check
```

Der `check` muss mit *„completed successfully"* enden. Scheitert er, wird **kein**
WAL-Segment archiviert — die Segmente stapeln sich, bis die Platte voll ist und die
Datenbank stehen bleibt.

> **Häufigste Ursache:** Die Dateien im Sicherungsverzeichnis gehören `root` statt
> `postgres`. Prüfen mit
> `docker compose exec postgres ls -la /var/lib/pgbackrest/archive/ohb/`.

### 2.2 Erste Sicherung

> ⚠️ **Ohne Basissicherung ist das WAL-Archiv wertlos.** Aus WAL-Segmenten allein lässt
> sich nichts wiederherstellen — sie sind Ergänzungen zu einer Basis. Solange
> `pgbackrest info` `status: error (no valid backups)` meldet, existiert keine
> Wiederherstellungsmöglichkeit, obwohl das Archiv wächst.

```powershell
.\opsackup.ps1 -Typ full
docker compose exec -u postgres postgres pgbackrest --stanza=ohb info
```

Erwartetes Ergebnis: `status: ok` und ein Eintrag unter `full backup`.

### 2.3 Zeitplan einrichten

Als Administrator, einmalig:

```powershell
.\ops\install-backup-tasks.ps1 -KumaPushUrl "http://localhost:3003/api/push/ABC123"
```

Das legt zwei Aufgaben an:

| Aufgabe | Wann | Typ |
|---|---|---|
| `OHB-Backup-Voll` | sonntags 02:00 | vollständig |
| `OHB-Backup-Differenziell` | Mo–Sa 02:00 | differenziell |

Beide rufen [`ops/backup.ps1`](../ops/backup.ps1) auf, protokollieren nach
`ops/logs/backup-JJJJ-MM.log` und senden bei Erfolg einen Heartbeat an Uptime Kuma.
Bleibt der Push aus, meldet Kuma nach 26 Stunden — so fällt eine ausgefallene Sicherung
auf, **bevor** sie gebraucht wird.

Sofort testen:

```powershell
Start-ScheduledTask -TaskName OHB-Backup-Differenziell -TaskPath \OHBGet-Content .\ops\logsackup-*.log -Tail 5
```

### 2.4 Überwachung einrichten

Uptime Kuma hat keine Konfiguration als Datei; die Monitore werden einmalig im Browser
unter `http://localhost:3003` angelegt.

| Name | Typ | Ziel | Intervall | Schlägt an bei |
|---|---|---|---|---|
| API | HTTP(s) | `http://api:3001/healthz` | 60 s | API-Prozess tot |
| Systemzustand | HTTP(s) | `http://api:3001/api/health/deep` | 60 s | 503 — Ingest-Lag, Archiv-Stau |
| Datenbank | PostgreSQL | Verbindungszeichenfolge, `SELECT 1` | 60 s | Datenbank nicht erreichbar |
| Broker | MQTT | `mosquitto:1883`, Topic `$SYS/broker/uptime` | 60 s | Broker tot |
| Dashboard | HTTP(s) | `http://web:80/` | 120 s | Auslieferung gestört |
| Ingest-Heartbeat | Push | erzeugte URL in `.env` als `KUMA_PUSH_URL`, dann `docker compose up -d ingest` | 90 s | Ingest hängt oder ist tot |
| Backup | Push | erzeugte URL im Zeitplan aufrufen | 26 h | Sicherung ausgefallen |

Bei allen Monitoren: **Wiederholungen 2** (erst beim zweiten Fehlschlag melden) und als
Benachrichtigung `ntfy` mit dem Topic aus `NTFY_TOPIC` hinterlegen.

> **Grenze:** Stirbt der Host, stirbt Kuma mit. Minimalabsicherung ohne weitere
> Infrastruktur: einen täglichen „alles in Ordnung"-Push einrichten. Bleibt er aus,
> ist etwas grundsätzlich kaputt.

---

## 3. Alarme und Reaktionen

| Meldung | Bedeutung | Erste Schritte |
|---|---|---|
| **`ingest_lag`** in `/api/health/deep` | Ein zugeordneter Sensor liefert seit über 5 min nichts | `docker compose logs ingest`; Feldgerät und Netzwerk prüfen; bei mehreren Sensoren gleichzeitig zuerst den Broker prüfen |
| **`wal_archive_failing`** | `archive_command` scheitert | `docker compose exec -u postgres postgres pgbackrest --stanza=ohb check` — meist fehlende Stanza oder falsche Besitzrechte (§2.1) |
| **`wal_archive_backlog`** | Über 200 unarchivierte Segmente | Wie oben. **Dringend** — bei anhaltendem Stau läuft die Platte voll und die Datenbank stoppt |
| **API-Monitor rot** | Prozess oder Datenbank weg | `docker compose ps`, `docker compose logs api --tail=50` |
| **Ingest-Heartbeat fehlt** | Ingest tot oder in einer Neustartschleife | `docker inspect ohb_project-ingest-1 --format '{{.RestartCount}}'` — steigt der Zähler, hilft ein Neustart nicht; Logs lesen |
| **Broker-Monitor rot** | Mosquitto weg | `docker compose logs mosquitto`; Feldgeräte puffern nur, wenn ihre Firmware das unterstützt |
| **Schwellenwert-Alarm (ntfy)** | Messwert außerhalb der Grenzen | Fachliche Prüfung im Reinraum; Quittieren im Dashboard unter „Alarme" |

### Was der Neustart heilt — und was nicht

Ingest und API beenden sich bei erkanntem Defekt selbst; Docker startet sie neu. Das
behebt hängende Verbindungen und Zustandsfehler. Es behebt **nicht**: volle Platten,
tote Sensoren, Netzwerkausfälle, Programmierfehler. **Steigt der Neustartzähler
wiederholt, ist die Ursache nichts, was ein Neustart löst.**

---

## 4. Wiederherstellung

### 4.1 Übung — einmal je Quartal, rund 20 Minuten

Ein ungeprüftes Backup ist kein Backup, sondern eine Vermutung.

> **Durchgeführt am 28.07.2026 · Ergebnis: bestanden**
>
> | Prüfpunkt | Ergebnis |
> |---|---|
> | Wiederherstellung in Wegwerf-Verzeichnis | 2,4 s |
> | Zeilen in `sensor_data` | 45 232 — entspricht dem Stand bei Sicherungsende |
> | Jüngste Messung | 02:16:52 = Zeitpunkt des Sicherungsendes, also lückenlos |
> | Hypertable | 3 Chunks, intakt |
> | Stammdaten | 5 Reinräume, 6 Sensoren, 6 Zuordnungen, 1 Schwellenwert |
> | Trigger `trg_check_threshold` | vorhanden (auf Eltern- und Chunk-Ebene) |
> | Unique-Index `idx_sensor_data_uniq` | vorhanden |
> | Migrationsstand | alle 5 Migrationen verzeichnet |
> | Livedatenbank während der Übung | unbeeinflusst weitergelaufen |
>
> Nächste Übung fällig: **Oktober 2026**

```powershell
# 1. Stand der Livedatenbank notieren
docker compose exec -T postgres psql -U postgres -d ohb_sensordata -c `
  "SELECT count(*), max(time) FROM sensor_data;"

# 2. In ein Wegwerf-Verzeichnis wiederherstellen
docker compose exec -T -u postgres postgres sh -c `
  "pgbackrest --stanza=ohb --pg1-path=/tmp/restore-test --type=default restore"

# 3. Testinstanz auf einem ZWEITEN Port starten.
#    archive_mode=off ist ZWINGEND: Sonst schriebe die Testinstanz in dasselbe
#    Sicherungsarchiv und brächte die echte Sicherungskette durcheinander.
docker compose exec -T -u postgres postgres sh -c `
  "pg_ctl -D /tmp/restore-test -o '-p 5433 -c archive_mode=off -c listen_addresses=127.0.0.1' start"

# 4. Inhalt prüfen
docker compose exec -T -u postgres postgres psql -h 127.0.0.1 -p 5433 -U postgres `
  -d ohb_sensordata -c "SELECT count(*), max(time) FROM sensor_data;"

# 5. Aufräumen
docker compose exec -T -u postgres postgres sh -c `
  "pg_ctl -D /tmp/restore-test -m immediate stop; rm -rf /tmp/restore-test"
```

> **Erwartetes Ergebnis:** Die Zeilenzahl liegt etwas UNTER der Livedatenbank und die
> jüngste Messung entspricht dem Zeitpunkt des Sicherungsendes. Das ist korrekt — die
> Sicherung bildet einen Stichtag ab, während die Livedatenbank weiterläuft. Eine
> gleiche Zeilenzahl wäre verdächtig.
>
> **Fallstrick:** `pg_ctl -w` kann bei einer wiederhergestellten Instanz hängen, weil
> die Bereitschaftserkennung während der Wiederherstellung nicht greift. Ohne `-w`
> starten und den Zustand mit `pg_ctl status` prüfen.

Ergebnis mit Datum, Prüfer und Zeilenzahl festhalten — das ist der Nachweis, den ein
Audit sehen möchte.

### 4.2 Ernstfall: Datenbank verloren

```powershell
docker compose stop api ingest
docker compose exec -u postgres postgres pgbackrest --stanza=ohb restore
docker compose restart postgres
docker compose start api ingest
docker compose exec -T postgres psql -U postgres -d ohb_sensordata -c "SELECT count(*) FROM sensor_data;"
```

### 4.3 Versehentliche Löschung rückgängig machen

```powershell
docker compose exec -u postgres postgres pgbackrest --stanza=ohb `
  --type=time --target="2026-07-27 14:29:00+02" --target-action=promote restore
```

---

## 5. Wartung

### Schema ändern

```powershell
cd node-backend
npm run migrate:up            # anwenden
npm run migrate:down          # letzte zurücknehmen
```

Neue Migration anlegen: Datei `migrations/00NN_beschreibung.sql` mit den Abschnitten
`-- Up Migration` und `-- Down Migration`. **Niemals** von Hand `ALTER TABLE` auf der
laufenden Datenbank — der Schemastand muss aus den Migrationen reproduzierbar bleiben.

### Neuen Sensor in Betrieb nehmen

1. Gerät auf `sensors/<uuid>` senden lassen → erscheint selbstständig im Register
2. **Konfiguration → Sensoren** → benennen → **Reinraum zuordnen**
3. **Konfiguration → Schwellenwerte** → Grenzen setzen
4. Panel erscheint in der Übersicht; ab jetzt greift die Alarmierung

> Ohne Raumzuordnung bleibt ein Sensor unsichtbar. Das ist Absicht und verhindert,
> dass fremde MQTT-Teilnehmer das Dashboard fluten.

### Verworfene Nachrichten prüfen

```sql
SELECT received_at, topic, reason, left(payload, 120) FROM ingest_rejects
ORDER BY received_at DESC LIMIT 20;
```

Einträge hier bedeuten: Ein Gerät sendet ein Format, das nicht dem Vertrag entspricht.
Die Nachricht wurde bestätigt (sonst entstünde eine Endlosschleife) und abgelegt.

### Speicherplatz

```sql
SELECT pg_size_pretty(pg_database_size('ohb_sensordata'));
```

Wächst die Datenbank stärker als erwartet, sind Kompression und eine
Aufbewahrungsregel der nächste Schritt — siehe DATA-03 in
[Engineering-Standards.md](Engineering-Standards.md).

---

## 6. Offene Punkte

| Punkt | Warum offen |
|---|---|
| **Sicherungsziel liegt lokal** | `repo1-path=/var/lib/pgbackrest` zeigt auf ein Docker-Volume auf derselben Hardware. Schützt gegen Fehlbedienung und logische Fehler, **nicht** gegen Plattendefekt oder Totalverlust. Ziel auf NAS oder S3 umstellen — Vorlage steht in `docker/postgres/pgbackrest.conf` |
| **MQTT ohne Zugangsdaten** | `allow_anonymous true`. Härtung ist vorbereitet und in `mosquitto/mosquitto.conf` beschrieben (~15 Minuten) |
| **Keine Anmeldung am Dashboard** | Jeder im Netz kann Grenzwerte ändern, ohne dass festgehalten wird, wer. Siehe AUD-01 in [Engineering-Standards.md](Engineering-Standards.md) |
| **Feldgeräte-Pufferung ungeprüft** | Die Verlustfreiheit ab Broker ist nachgewiesen. Ob ein Gerät bei Broker-Ausfall selbst puffert, hängt an dessen Firmware |
