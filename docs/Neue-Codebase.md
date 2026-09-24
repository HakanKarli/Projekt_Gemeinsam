# Die neue Codebase — was sie kann

> Vollständige Bestandsaufnahme des Codes, der im Repository liegt, aber von
> `docker-compose.yml` nicht gestartet wird (Backend) bzw. von keiner Komponente
> eingebunden ist (Frontend). Einordnung und Fundstellen der Lücke:
> [Technische-Schulden.md](Technische-Schulden.md#1-der-wichtigste-befund-zwei-parallele-implementierungen).
> Schritt-für-Schritt-Anleitung zum tatsächlichen Anschließen:
> [Integration-Neue-Codebase.md](Integration-Neue-Codebase.md).
>
> **Stand:** 23.09.2026. Jede Aussage unten ist am Code verifiziert — dieses
> Dokument beschreibt, was der Code **leistet, wenn er läuft**, nicht, ob er
> gerade läuft (er läuft nicht, siehe oben).
>
> Verwandt: [Architektur.md](Architektur.md) (was stattdessen tatsächlich läuft) ·
> [CI-Pipeline.md](CI-Pipeline.md)

---

## Inhaltsverzeichnis

1. [Überblick](#1-überblick)
2. [Backend — Konfiguration und Grundgerüst](#2-backend--konfiguration-und-grundgerüst)
3. [Backend — Validierung als einzige Quelle der Wahrheit](#3-backend--validierung-als-einzige-quelle-der-wahrheit)
4. [Backend — REST-API](#4-backend--rest-api)
5. [Backend — OpenAPI-Dokumentation und Swagger UI](#5-backend--openapi-dokumentation-und-swagger-ui)
6. [Backend — Datenbankschicht](#6-backend--datenbankschicht)
7. [Backend — Domänenfunktionen und Datenintegrität](#7-backend--domänenfunktionen-und-datenintegrität)
8. [Backend — Migrationen](#8-backend--migrationen)
9. [Backend — Ingest mit Verlustfreiheits-Garantie](#9-backend--ingest-mit-verlustfreiheits-garantie)
10. [Backend — Alarmkette](#10-backend--alarmkette)
11. [Backend — Betriebszustand](#11-backend--betriebszustand)
12. [Backend — Strukturiertes Logging](#12-backend--strukturiertes-logging)
13. [Backend — Geordnetes Beenden und Selbstheilung](#13-backend--geordnetes-beenden-und-selbstheilung)
14. [Backend — Testsuite](#14-backend--testsuite)
15. [Frontend — vorbereitete, unbenutzte Bausteine](#15-frontend--vorbereitete-unbenutzte-bausteine)

---

## 1. Überblick

| Baustein | Ersetzt (Ist-Zustand) | Kernnutzen |
|---|---|---|
| `src/app.js` + `src/http/` | `src/server.js` | Validierung, zentrale Fehlerbehandlung, OpenAPI, Sicherheits-Header |
| `src/domain/schemas/` | verstreute, ungeprüfte `req.body`/`req.query`-Zugriffe | eine Schemadefinition für Prüfung, Dokumentation und Typen |
| `src/services/` | SQL direkt in den Routen (`src/routes/*.js`) | HTTP von Fachlogik getrennt, einzeln testbar |
| `src/lib/db.js` | `src/db.js` | Transaktionsklammer, PostgreSQL-Fehler → sprechende Fachfehler |
| `node-backend/migrations/0001`–`0006` | `db-init/*.sql` + `ensureSchema()` | eine Quelle für das Schema, inkl. Idempotenz-Index und Domänenfunktionen |
| `src/ingest.js` + `src/ingest/` | `src/mqttBridge.js` | Ack erst nach Commit, Retry mit Backoff, Watchdog, Dead-Letter-Ablage |
| `src/alerts/` | `src/alertListener.js` | korrigierter Push-Text, kein doppelter Listener, Nachmelde-Abgleich |
| `src/lib/logger.js` | verstreute `console.log`/`console.error` | strukturiertes JSON-Logging mit Redaktion |
| `src/lib/shutdown.js`, `src/lib/watchdog.js` | kein Äquivalent | geordnetes Beenden, Selbstabschaltung bei unheilbaren Fehlern |
| `ohb-dashboard/src/store/RegistryContext.jsx` + `hooks/useSensorPanels.js` | verstreute `getSensors()`/`getCleanrooms()`-Aufrufe | ein gemeinsamer Ladepunkt statt N+1-Anfragen |
| `ohb-dashboard/src/i18n/de.js` | hart codierte Strings je Komponente | eine Textquelle |
| `ohb-dashboard/src/components/PanelBoundary.jsx` | kein Äquivalent | Fehlergrenze je Chart-Panel |

## 2. Backend — Konfiguration und Grundgerüst

`src/config.js` liest `.env` einmal beim Start und prüft **alle** erwarteten
Variablen gegen ein Zod-Schema (`EnvSchema`). Fehlt eine Pflichtvariable oder hat
den falschen Typ, beendet sich der Prozess sofort mit einer Liste der konkreten
Fehler — statt dass ein `undefined` drei Schichten tiefer im Verbindungsaufbau
eine unverständliche Meldung erzeugt. Zusätzlich konfigurierbar gegenüber dem
Ist-Zustand: `LOG_LEVEL`, `MQTT_CLIENT_ID`, `MQTT_TOPIC`, `HEALTH_PORT`,
`CORS_ORIGINS` (statt pauschal offen), `KUMA_PUSH_URL`,
`HEALTH_MAX_INGEST_LAG_SEC`, `HEALTH_MAX_ARCHIVE_BACKLOG`.

`src/app.js` baut die Express-Anwendung **ohne sie zu starten** (Trennung von
`server.js`, die es im neuen Pfad nicht mehr gibt — gestartet würde stattdessen
direkt über einen `listen()`-Aufruf, siehe [Integrationsleitfaden](Integration-Neue-Codebase.md)).
Middleware-Kette in fester Reihenfolge:

1. `requestId` — jede Anfrage bekommt eine Korrelations-ID, im Antwort-Header
   `X-Request-Id` und in jeder zugehörigen Logzeile.
2. `pino-http` — strukturiertes Request-Logging, `/healthz`/`/readyz`/`/api/health/deep`
   bewusst ausgenommen (sonst würden Sekundentakt-Healthchecks jede andere
   Logzeile überdecken).
3. `helmet` mit deaktivierter `Content-Security-Policy` (die API liefert JSON,
   eine CSP hätte dort keine Wirkung — für die einzige HTML-Antwort, Swagger UI,
   wird sie gezielt in `http/openapi.js` gesetzt).
4. `cors`, eingeschränkt auf `config.http.corsOrigins` statt pauschal offen.
5. `express.json({ limit: '1mb' })`.
6. Alle Routen (Abschnitt 4).
7. `notFound` — unbekannte Pfade liefern dieselbe Fehlerform wie jeder andere
   Fehler, statt einer HTML-404-Seite.
8. `errorHandler` — siehe Abschnitt 3.

## 3. Backend — Validierung als einzige Quelle der Wahrheit

`src/domain/schemas/index.js` definiert jede Datenform (`Cleanroom`, `Sensor`,
`Assignment`, `Threshold`, `Panel`, `Violation`, `HealthReport`, …) **einmal** als
Zod-Schema. Dieselbe Definition dient drei Zwecken gleichzeitig:

- **Prüfung an der Systemgrenze** über `http/middleware/validate.js`: Query,
  Params und Body werden gegen das jeweilige Schema geprüft, bevor eine Route sie
  zu Gesicht bekommt. Ergebnis liegt in `req.valid`, nicht in `req.query` (in
  Express 5 ist `req.query` nur noch lesbar — das Original bleibt deshalb
  unangetastet).
- **OpenAPI-Beschreibung** über `zod-to-openapi` (Abschnitt 5) — aus demselben
  Objekt, gegen das geprüft wird.
- **Editor-Typinformation** über `z.infer`.

Ein Sonderfall in `domain/schemas/common.js`: Die UUID-Prüfung nutzt bewusst
`z.guid()` statt `z.uuid()`, weil Zods `uuid()` RFC-4122-Versions-/Variantenbits
verlangt, PostgreSQL im Spaltentyp `uuid` aber jede 32-stellige Hex-Folge
akzeptiert — und die Feldgeräte strukturierte Kennungen wie
`a1b2c3d4-0001-0001-0001-000000000001` verwenden, die RFC 4122 verletzen. Mit
`uuid()` würde die Anwendung reale Sensoren abweisen.

Fehler laufen zentral durch `http/middleware/errorHandler.js` zusammen —
zusammen mit `express-async-errors` (muss vor der Routendefinition geladen
werden) fängt das genau die Fehlerklasse ab, die im Ist-Zustand den Prozess
beendet (Abschnitt 5 in [Technische-Schulden.md](Technische-Schulden.md)).
Antwortform durchgängig:

```jsonc
{ "error": { "code": "validation_failed", "message": "…", "details": [...] }, "requestId": "…" }
```

`src/lib/errors.js` übersetzt zusätzlich bekannte PostgreSQL-Fehlercodes
(`unique_violation`, `exclusion_violation`, `foreign_key_violation`,
`check_violation`, ungültiges UUID-/Datumsformat) in verständliche
Fachfehler mit passendem HTTP-Status — inklusive einer Übersetzungstabelle für
konkrete Constraint-Namen (z. B. „Für diesen Sensor besteht im angegebenen
Zeitraum bereits eine Zuordnung“ statt eines rohen Postgres-Fehlertexts).

## 4. Backend — REST-API

Alle Routen unter `src/http/routes/`, registriert in `http/routes/index.js`.
Gegenüber dem Ist-Zustand (siehe [Architektur.md](Architektur.md#9-rest-api))
**zusätzlich vorhanden**:

| Methode | Pfad | Neu gegenüber dem Ist-Zustand |
|---|---|---|
| `GET` | `/healthz` | Lebenszeichen ohne Datenbankzugriff, für den Docker-Healthcheck |
| `GET` | `/readyz` | prüft die Datenbankverbindung, für die Startreihenfolge |
| `GET` | `/api/health/deep` | Ingest-Lag, offene Alarme, WAL-Archiv-Zustand, Datenbankgröße — 503 bei Überschreitung |
| `GET` | `/api/panels` | Panel-Manifest in **einer** Anfrage (Sensor, Raum, Messgröße, Einheit, aktueller Schwellenwert) statt `1 + 2N` |
| `GET` | `/api/openapi.json`, `/api/docs` | maschinenlesbare Spezifikation und Swagger UI |

Alle bereits im Ist-Zustand vorhandenen Pfade (`/api/cleanrooms`, `/api/sensors`,
`/api/assignments`, `/api/thresholds`, `/api/sensordata`, `/api/violations`,
`/api/report`, `/api/alerts/stream`) existieren ebenfalls, jetzt aber
durchgängig mit Eingabeprüfung, einheitlichem Fehlerformat und — wo fachlich
zutreffend — abgesichert durch die Datenbankfunktionen aus Abschnitt 7.

Jede Route ist dünn: Validierung (Middleware) → Aufruf eines Service →
`res.json(...)`. Kein `try/catch` in den Routen selbst nötig — dafür sorgt
`express-async-errors` zusammen mit der zentralen Fehler-Middleware.

## 5. Backend — OpenAPI-Dokumentation und Swagger UI

`src/http/openapi.js` erzeugt aus der `OpenAPIRegistry` (befüllt von jeder Route
beim Laden) ein vollständiges OpenAPI-3.1-Dokument — Titel, Version aus
`package.json`, Tag-Gruppen je Fachbereich, Fehlerformat und
Zeitraum-Versionierung als Freitext-Beschreibung. Ausgeliefert unter
`GET /api/openapi.json`; `docs/openapi.yaml` im Repository ist der exportierte
Stand dieses Dokuments (`npm run openapi:export`, siehe
[Integrationsleitfaden](Integration-Neue-Codebase.md)).

`GET /api/docs` bindet Swagger UI ein — interaktive Oberfläche, in der jede Route
inklusive Beispielen direkt ausprobiert werden kann, mit eigens gelockerter
`Content-Security-Policy` nur für diesen einen Pfad.

## 6. Backend — Datenbankschicht

`src/lib/db.js` ersetzt das direkte `pg.Pool` aus dem Ist-Zustand um:

- `query()` — wie zuvor, aber jeder PostgreSQL-Fehler läuft durch
  `fromPgError()` (Abschnitt 3) und kommt als Fachfehler beim Aufrufer an.
- `withTransaction(fn)` — ersetzt das in drei Routen kopierte
  `BEGIN`/`COMMIT`/`ROLLBACK`/`release`-Muster, **inklusive** der im Ist-Zustand
  vorhandenen Variante, die nach einem `ROLLBACK` erneut warf und dadurch den
  Prozess beendete. Ein fehlgeschlagenes `ROLLBACK` selbst verdeckt nie den
  ursprünglichen Fehler.
- `ping()` — für `/readyz`.

Schema-Änderungen laufen ausschließlich über die Migrationen (Abschnitt 8); das
Äquivalent zu `ensureSchema()` entfällt ersatzlos.

## 7. Backend — Domänenfunktionen und Datenintegrität

Migration `0006_domain_functions.sql` verlagert die zeitraum-versionierten
Schreiboperationen von JavaScript in die Datenbank:

| Funktion | Ersetzt | Zusicherung |
|---|---|---|
| `assign_sensor(uuid, id)` | `assignmentService`-Transaktion im Ist-Zustand | schließt alte Zuordnung und öffnet neue **mit demselben Zeitpunkt**, sperrt die Registerzeile gegen gleichzeitige Zuordnung |
| `set_threshold(uuid, quantity, min, max)` | `thresholdService`-Transaktion | dieselbe Garantie für Schwellenwerte |
| `retire_threshold(id)` | manuelles Zeitraum-Schließen | Soft-Delete, Zeile bleibt als historischer Beleg |
| `delete_cleanroom(id)` | mehrere Einzelabfragen | schließt Zuordnungen, löst Verletzungen vom Raum, löscht den Raum — in dieser Reihenfolge, garantiert |
| `delete_sensor(uuid)` | mehrere Einzelabfragen | löscht Verletzungen → Schwellenwerte → Zuordnungen → Register, Messdaten bleiben erhalten |

Dazu zwei `CHECK`-Constraints auf `sensor_thresholds`: mindestens eine Grenze
gesetzt (`chk_threshold_hat_grenze`), `min_value <= max_value`
(`chk_threshold_grenzen_sortiert`). Diese Regeln gelten damit für **jeden**
Schreibzugriff — auch für einen, der nicht über diese Anwendung läuft (ein
Importskript, ein `psql`-Wartungseingriff).

## 8. Backend — Migrationen

`node-pg-migrate`, angesteuert über `src/lib/migrate.js`, sechs Migrationen:

| Datei | Inhalt |
|---|---|
| `0001_init.sql` | Basisschema, identisch zum Ist-Zustand (`db-init/001_schema.sql`) |
| `0002_sensor_data_idempotency.sql` | entfernt vorhandene Duplikate, ersetzt `idx_sensor_data_lookup` durch `idx_sensor_data_uniq` (eindeutig) — Grundlage für `ON CONFLICT DO NOTHING` im Ingest |
| `0003_ingest_rejects.sql` | Tabelle `ingest_rejects` — Ablage für dauerhaft ungültige Nachrichten |
| `0004_violation_notify_payload.sql` | Trigger liefert zusätzlich `id`, `sensor_name`, `cleanroom_name` im `pg_notify`-Payload |
| `0005_late_measurement_guard.sql` | behebt einen Fehler, bei dem ein verspätet nachgelieferter Messwert (älter als der Beginn eines offenen Alarm-Ereignisses) den Trigger mit `SQLSTATE 22000` scheitern ließ — gefunden über Testfall 12 der Trigger-Testsuite |
| `0006_domain_functions.sql` | die fünf Funktionen aus Abschnitt 7 plus die beiden `CHECK`-Constraints |

Jede Migration ist idempotent und besitzt eine Down-Migration. `runMigrations()`
wird von drei Stellen aus demselben Code aufgerufen: einem geplanten
`migrate`-Schritt im Betrieb, `npm run migrate:up`/`migrate:down` und dem
Test-Harness, der gegen eine frische Wegwerf-Datenbank migriert — ein
gemeinsamer Einstiegspunkt verhindert, dass diese drei Wege auseinanderlaufen.

## 9. Backend — Ingest mit Verlustfreiheits-Garantie

`src/ingest.js` + `src/ingest/*` gegenüber `src/mqttBridge.js`:

- **MQTT-Verbindung** (`ingest/mqttClient.js`): feste `clientId`, `clean: false`
  (persistente Session — der Broker hält unbestätigte Nachrichten vor), `qos: 1`.
  Bestätigung (`PUBACK`) läuft über `mqtt.js`s `handleMessage`-Override und wird
  erst nach erfolgreichem Datenbank-Commit ausgelöst.
- **Nachrichtenprüfung** (`ingest/messageSchema.js`): dieselbe Art Zod-Schema wie
  im HTTP-Teil, unterscheidet **dauerhafte** Fehler (Payload passt nicht →
  bestätigen und in `ingest_rejects` ablegen, sonst Endlosschleife) von
  **vorübergehenden** (Datenbank kurz weg → nicht bestätigen, erneut versuchen).
- **Persistenz** (`ingest/ingestService.js`): **eine** Transaktion je Nachricht,
  **ein** `INSERT ... SELECT ... FROM unnest(...) ON CONFLICT DO NOTHING` für
  alle Messgrößen einer Nachricht zusammen — statt eines separaten, unverklammerten
  `INSERT` je Messgröße im Ist-Zustand. Damit ist eine Nachricht atomar (alle
  Werte oder keiner) und eine Wiederholung folgenlos.
- **Wiederholung mit Backoff** (`ingest.js`, `RETRY_DELAYS_MS`): 250 ms, 500 ms,
  1 s, 2 s, 4 s (≈ 8 s gesamt) bei Datenbankfehlern, bevor der Prozess sich
  **ohne** Bestätigung beendet — der Broker hält die Nachricht, ein Neustart
  (`restart: unless-stopped`) nimmt die Session wieder auf und bekommt sie erneut
  zugestellt.
- **Health-Server** (`ingest/healthServer.js`): eigener `node:http`-Server auf
  `HEALTH_PORT` (Default 3002), unabhängig von Express — für den Docker-Healthcheck
  des `ingest`-Containers, den es im Ist-Zustand nicht gibt.
- **Heartbeat an Uptime Kuma** (`ingest.js`, `startHeartbeat`): optional, nur wenn
  `KUMA_PUSH_URL` gesetzt ist — meldet Lebenszeichen alle 30 s.
- **Watchdog** (`lib/watchdog.js`): beendet den Prozess selbst, wenn MQTT seit
  120 s getrennt ist oder seit 15 Minuten trotz bestehender Verbindung keine
  Nachricht ankam — Docker startet neu. Grund: `restart: unless-stopped` greift
  nur bei einem **beendeten** Prozess, nicht bei einem hängenden.

## 10. Backend — Alarmkette

`src/alerts/` gegenüber `src/alertListener.js`:

- **`listener.js`** — LISTEN/NOTIFY mit genau **einem** Reconnect-Pfad (behebt den
  Fehler im Ist-Zustand, bei dem `error` **und** `end` je einen eigenen Timer
  starteten und sich die Zahl der Listener — und damit der Push-Nachrichten — bei
  wiederholten Störungen vervielfachte).
- **`notifier.js`** — liest `event.quantity`/`event.sensor_uuid` (behebt den
  „undefined“-Fehler im Push-Titel aus dem Ist-Zustand, der `data.metric`/
  `data.sensor_id` las).
- **`reconciler.js`** — Sicherheitsnetz gegen die Flüchtigkeit von `pg_notify`:
  War beim Auslösen kein Listener verbunden, ist die Benachrichtigung
  unwiederbringlich weg, obwohl die Zeile in `threshold_violations` existiert.
  Pollt alle 60 s die offenen, unquittierten Verletzungen und meldet nach, was
  innerhalb der letzten 10 Minuten geöffnet wurde und noch nicht verkündet ist —
  ein Alarm von vor drei Stunden löst dabei **keine** erneute Push-Welle aus.
- **`sseHub.js`** — Verteiler an SSE-Clients, mit Heartbeat (`: ping` alle 20 s),
  damit Proxys die Verbindung nicht wegen Leerlaufs schließen.
- **`index.js`** — führt beide Quellen (NOTIFY und Abgleich) über
  `markAnnounced()` zusammen, damit ein Alarm nicht doppelt gemeldet wird, egal
  über welchen Weg er zuerst ankam.

## 11. Backend — Betriebszustand

`services/healthService.js`, ausgeliefert über `GET /api/health/deep`:

- `worst_lag_sec` — Alter der jüngsten Messung des am längsten schweigenden
  **zugeordneten** Sensors. Ein Dashboard mit einer drei Stunden alten Kurve
  sieht aus wie ein funktionierendes Dashboard; nur diese Kennzahl entlarvt es.
- `open_alerts`, `db_bytes`.
- `archive_enabled`, `archive_backlog`, `archive_last_failed`,
  `archive_last_success` — fängt die häufigste PostgreSQL-Störung ab (WAL-Archiv
  scheitert still, Platte läuft voll), sofern die Anwendung die nötigen Rechte
  hat; sonst wird dieser Teil als „unbekannt“ gemeldet statt die gesamte Antwort
  scheitern zu lassen. Setzt allerdings ein aktiviertes Archivierungsverfahren
  voraus, das im Ist-Zustand nicht existiert (siehe
  [Technische-Schulden.md](Technische-Schulden.md#3-backup--und-überwachungswerkzeuge-sind-vorbereitet-aber-nicht-angeschlossen)).
- Antwortet mit `503`, sobald `worst_lag_sec` oder `archive_backlog` die in
  `config.health` konfigurierten Schwellen überschreiten, oder die Archivierung
  scheitert — sonst `200`.

Protokolliert wird nur der **Wechsel** des Zustands, nicht jeder Aufruf — bei
Sekundentakt-Abfragen durch eine Überwachung wäre sonst jede andere Logzeile
begraben.

## 12. Backend — Strukturiertes Logging

`src/lib/logger.js`: `pino`, JSON auf stdout in Produktion (maschinenlesbar,
`docker compose logs` bleibt greppbar), `pino-pretty` mit Farben in der
Entwicklung. Ersetzt die verstreuten `console.log('[BRIDGE] …')`-Aufrufe des
Ist-Zustands, die weder Schweregrad noch strukturierten Kontext hatten. Eigener
Serializer für Fehlerobjekte (sonst hängt ein `pg`-Fehler das komplette
Client-Objekt an die Logzeile). `redact` verhindert, dass Passwörter — auch über
ein mitgeloggtes Konfigurationsobjekt — jemals im Log landen.

## 13. Backend — Geordnetes Beenden und Selbstheilung

- **`lib/shutdown.js`** — registrierte Aufräumschritte laufen bei `SIGTERM`/
  `SIGINT` in umgekehrter Reihenfolge ab (zuletzt Gestartetes zuerst beendet), mit
  9-Sekunden-Sicherheitsnetz, bevor Docker ohnehin `SIGKILL` nachschiebt.
- **`lib/watchdog.js`** — `installCrashHandlers()` fängt `unhandledRejection` und
  `uncaughtException` ab und beendet den Prozess **kontrolliert** statt
  unkontrolliert; `startWatchdog()` erlaubt beliebige periodische
  Selbstprüfungen (im Ingest: MQTT-Verbindung, Nachrichtenfluss).

## 14. Backend — Testsuite

45 Fälle unter `node-backend/test/`, ausschließlich gegen den neuen Pfad, über
`@testcontainers/postgresql` gegen ein **echtes** TimescaleDB-Image (kein Mock —
`tstzrange`-Semantik und ein PL/pgSQL-Trigger lassen sich nicht sinnvoll
nachbilden):

| Datei | Prüft |
|---|---|
| `test/api/contract.test.js` | HTTP-Vertrag über `supertest`, u. a. dass eine ungültige UUID mit `400` beantwortet wird **und die Anwendung danach weiter bedient** — der zentrale Nachweis gegen den REL-01-Fehler des Ist-Zustands |
| `test/domain/domainFunctions.test.js` | 17 Fälle direkt gegen die Datenbankfunktionen aus Abschnitt 7, ohne Service, ohne Express |
| `test/ingest/idempotency.test.js` | dieselbe Nachricht zweimal → keine doppelte Zeile; Teilüberschneidung → nur die neuen Werte |
| `test/trigger/thresholdTrigger.test.js` | 15 Fälle des Trigger-Zustandsautomaten, inklusive des Nachzügler-Falls aus Migration `0005` |
| `test/trigger/notifyPayload.test.js` | `pg_notify` feuert nur beim Öffnen eines Ereignisses, nicht bei jedem Verstoß |

Ohne die in [Technische-Schulden.md](Technische-Schulden.md#1-der-wichtigste-befund-zwei-parallele-implementierungen)
beschriebenen fehlenden npm-Pakete lässt sich diese Suite lokal nicht ausführen.

## 15. Frontend — vorbereitete, unbenutzte Bausteine

| Baustein | Leistet |
|---|---|
| `store/RegistryContext.jsx` + `store/useRegistry.js` | **ein** gemeinsamer Ladepunkt für Sensoren und Reinräume statt der im Ist-Zustand verstreuten, unabhängigen `getSensors()`/`getCleanrooms()`-Aufrufe in `DashboardGrid`, `Sidebar`, `ConfigPanel`, `HistoryView` und `MqttContext`. `refresh()` lädt neu und erhöht eine `version`, die abhängige Ansichten als Reload-Signal nutzen können — ersetzt das bisherige Durchreichen eines `dataVersion`-Zählers durch die Komponentenhierarchie. `nameOf()` liefert den Anzeigenamen eines Sensors mit Rückfall auf einen `localStorage`-Cache, falls das Backend kurz nicht antwortet |
| `hooks/useSensorPanels.js` | lädt das Panel-Manifest über `GET /api/panels` (Abschnitt 4) — ersetzt das `1 + 2N`-Anfragemuster in `DashboardGrid`/`RoomView`. Ruft `getPanels()` auf, das in `api.js` heute nicht existiert — siehe [Integrationsleitfaden](Integration-Neue-Codebase.md) |
| `i18n/de.js` | eine zentrale Textquelle für alle sichtbaren Zeichenketten — behebt nebenbei die uneinheitliche Schreibweise („Reinraeume“ neben „Übersicht“) im Ist-Zustand |
| `components/PanelBoundary.jsx` | React-Fehlergrenze **je Panel** — ein Fehler in einem einzelnen Plotly-Chart nimmt in React 19 sonst den kompletten Baum mit. Zeigt einen Wiederherstellungs-Button statt eines weißen Bildschirms |
| `store/useMqttContext.js`, Funktion `defaultBrokerUrl()` | leitet `wss://<host>/mqtt` aus dem aktuellen Browser-Origin ab, statt `ws://localhost:9001` fest zu verdrahten — funktioniert damit auch über TLS und aus dem übrigen Netz, sofern die nginx-Proxy-Route genutzt wird (siehe [Architektur.md](Architektur.md#3-systemarchitektur)) |

Keiner dieser Bausteine benötigt zusätzliche npm-Pakete — anders als beim
Backend ist hier ausschließlich **Verdrahtung** offen, keine fehlende
Abhängigkeit.
