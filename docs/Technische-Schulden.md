# Technische Schulden

> Bestandsaufnahme dessen, was im tatsächlich laufenden System (siehe
> [Architektur.md](Architektur.md)) fehlt, brüchig ist oder von unbenutztem Code
> überlagert wird. Jeder Befund ist am Code verifiziert, mit Fundstelle.
>
> **Stand:** 23.09.2026.
>
> Was der unbenutzte Code tatsächlich kann und wie er angeschlossen würde:
> [Neue-Codebase.md](Neue-Codebase.md) · [Integration-Neue-Codebase.md](Integration-Neue-Codebase.md).

---

## 1. Der wichtigste Befund: zwei parallele Implementierungen

Im Repository liegt neben dem tatsächlich laufenden Code ein zweiter,
augenscheinlich weiter entwickelter Code-Pfad — vollständig vorhanden, mit eigener
Testsuite, aber an keiner Stelle gestartet. `docker-compose.yml`, das
`node-backend/Dockerfile` (`CMD`) und `package.json` (`main`/`scripts`) zeigen
durchgängig auf den älteren Pfad.

| Bereich | Läuft tatsächlich (von Docker/Compose gestartet) | Existiert zusätzlich, wird nirgends gestartet |
|---|---|---|
| API-Server | `node-backend/src/server.js` (monolithisch, `require('./db')`) | `src/app.js` + `src/http/routes/*` + `src/services/*` + `src/domain/schemas/*` (Zod-Validierung, `express-async-errors`, strukturiertes Logging mit `pino`) |
| Ingest | `node-backend/src/mqttBridge.js` (kein Retry, kein Ack-nach-Commit) | `src/ingest.js` + `src/ingest/*` (Backoff-Retry, Ack erst nach Commit, Watchdog/Self-Exit, Heartbeat an Uptime Kuma) |
| Alarme | `src/alertListener.js` | `src/alerts/*` (`listener.js`, `notifier.js`, `reconciler.js`, `sseHub.js`) |
| Datenbankzugriff | `src/db.js` (`ensureSchema()` per `ALTER TABLE`) | `src/lib/db.js` + `node-backend/migrations/*.sql` (node-pg-migrate, u. a. Unique-Index für Idempotenz, `ingest_rejects`, Domänenfunktionen `assign_sensor`/`set_threshold`/…) |
| Frontend-Stammdaten | verstreute `getSensors()`/`getCleanrooms()`-Aufrufe je Komponente, `MqttContext.jsx` | `ohb-dashboard/src/store/RegistryContext.jsx` + `hooks/useSensorPanels.js`, erwartet einen `GET /api/panels`-Endpunkt, der im laufenden Backend nicht existiert |
| Frontend-Texte | hart codierte deutsche Strings je Komponente | `ohb-dashboard/src/i18n/de.js`, wird von keiner Komponente importiert |
| Frontend-Fehlergrenze | Fehler in einem Chart reißt die ganze Ansicht mit | `ohb-dashboard/src/components/PanelBoundary.jsx`, von keiner Komponente eingebunden |
| Frontend-Broker-URL | fest `ws://localhost:9001` in `MqttContext.jsx` | `defaultBrokerUrl()` in `store/useMqttContext.js`, leitet `wss://<host>/mqtt` aus dem aktuellen Origin ab — nirgends aufgerufen |

**Was daraus folgt:**

- `node-backend/test/**` (45 Testfälle laut `docker-compose`-unabhängiger CI) prüft
  ausschließlich den **unbenutzten** Pfad — über `src/app.js` und gegen Migrationen,
  die auf die laufende Produktionsdatenbank nie angewendet werden. Eine grüne CI
  belegt nicht, dass `server.js`/`mqttBridge.js` funktionieren.
- `docs/openapi.yaml` (von `npm run openapi:export` erzeugt und von der CI
  gegengeprüft) beschreibt die API von `src/app.js`, nicht die tatsächlich unter
  Port 3001 laufende.
- `CHANGELOG.md` führt unter „2.0.0“ mehrere Punkte auf (u. a. Idempotenz,
  Ack-nach-Commit, zentrale Fehler-Middleware, `GET /api/panels`, gemeinsamer
  Frontend-Stammdaten-Context), die **im unbenutzten Pfad** umgesetzt sind, aber
  nicht im tatsächlich laufenden System wirken.
- `ohb-dashboard/src/store/useMqttContext.js`/`store/useRegistry.js`/
  `hooks/useSensorPanels.js` würden beim tatsächlichen Einsatz sofort fehlschlagen,
  da `getPanels` in `api.js` gar nicht exportiert wird.

**Zusätzlich fehlen dem unbenutzten Pfad seine Abhängigkeiten.**
`node-backend/package.json` wurde seit dem ersten Commit nur um `eslint` ergänzt
und listet weder `zod`, `express-async-errors`, `helmet`, `pino`, `pino-http`,
`pino-pretty`, `@asteasolutions/zod-to-openapi`, `swagger-ui-express`,
`node-pg-migrate` noch `yaml` (alle von `src/app.js`/`src/ingest.js`/
`scripts/exportOpenApi.js` zur Laufzeit benötigt), noch `vitest`,
`@testcontainers/postgresql` oder `supertest` (von der Testsuite benötigt).
Keines dieser Pakete liegt in `node_modules` oder `package-lock.json`. Ein
`npm ci` installiert deshalb nur die sechs alten Laufzeitabhängigkeiten;
`node-backend/package.json` definiert außerdem weder ein `"test"`- noch ein
`"openapi:export"`-Skript. Wer den neuen Pfad wirklich starten oder testen
will, muss beides zuerst nachtragen — siehe
[Integration-Neue-Codebase.md](Integration-Neue-Codebase.md#schritt-1-abhängigkeiten-und-skripte-nachtragen).

**Zu entscheiden, nicht automatisch zu lösen:** Ob der neue Pfad fertig ist und nur
verdrahtet werden muss, oder ob er verworfen werden soll, konnte im Rahmen dieser
Dokumentation nicht geklärt werden — das ist eine Entscheidung des Projektteams.
Diese Datei beschreibt nur den Ist-Zustand.

---

## 2. Verlustrisiko im tatsächlich laufenden Ingest

`mqttBridge.js` bestätigt MQTT-Nachrichten automatisch (Standardverhalten von
`mqtt.js`, keine manuelle Ack-Steuerung) und schreibt **vor** jeder Bestätigung
faktisch nichts ab, das eine Wiederholung erzwingen würde. Zusätzlich:

- Kein Unique-Index auf `sensor_data` → eine doppelt zugestellte Nachricht erzeugt
  eine doppelte Zeile statt erkannt zu werden.
- Jede Messgröße einer Nachricht ist ein eigenes `INSERT` ohne gemeinsame
  Transaktion — bei einem Fehler mitten in der Schleife sind bereits geschriebene
  Messgrößen persistiert, die übrigen nicht, ohne dass das irgendwo sichtbar wird.
- Ein Fehler beim Insert wird nur mit `console.error` protokolliert; es gibt keine
  Ablagetabelle für nicht verarbeitbare Nachrichten.
- Der mitgelieferte Simulator sendet zusätzlich mit QoS 0 und ohne persistente
  Session — auch auf der Sendeseite gibt es keine Zusicherung.

Kurz: Die im Repository dokumentierte und getestete Verlustfreiheits-Kette
existiert nur im unbenutzten Ingest-Pfad (Abschnitt 1). Im tatsächlich laufenden
System ist ein Datenverlust bei einer kurzen Datenbank- oder Netzwerkstörung
möglich und wird nicht protokolliert.

## 3. Backup- und Überwachungswerkzeuge sind vorbereitet, aber nicht angeschlossen

- `docker/postgres/Dockerfile` baut ein Postgres-Image **mit** `pgbackrest`; der
  tatsächlich in `docker-compose.yml` verwendete `postgres`-Dienst nutzt aber das
  unveränderte Basis-Image `timescale/timescaledb:latest-pg17` **ohne**
  `pgbackrest`. `ops/backup.ps1` und `ops/install-backup-tasks.ps1` würden gegen den
  laufenden Container fehlschlagen.
- Es gibt keinen Uptime-Kuma- oder sonstigen Monitoring-Dienst in
  `docker-compose.yml`. Ausfälle werden nicht automatisch gemeldet.
- Es existiert kein Tiefenzustands-Endpunkt (`/api/health/deep` o. ä.); `/api/health`
  liefert nur eine statische `{status: 'ok'}`-Antwort ohne Prüfung von
  Ingest-Verzögerung, Speicherplatz oder offenen Alarmen.

## 4. Sicherheit und Zugriff

- Kein Authentifizierungslayer auf der REST-API. CORS ist ohne Einschränkung offen
  (`app.use(cors())`).
- Mosquitto läuft mit `allow_anonymous true` auf beiden Listenern (`mosquitto.conf`).
  Jeder mit Netzwerkzugriff kann Sensordaten einspeisen oder mitlesen.
- Kein Audit-Trail mit Identität: `PATCH /api/violations/:id/acknowledge` speichert
  nicht, wer quittiert hat; Änderungen an Schwellenwerten/Zuordnungen tragen keinen
  Urheber.
- `.env`-Dateien mit Zugangsdaten sind über `.gitignore` von der Versionsverwaltung
  ausgeschlossen; ob ein Passwort jemals in der Git-Historie stand, wurde im Rahmen
  dieser Dokumentation nicht geprüft.

## 5. Fehlerbehandlung im tatsächlich laufenden Backend

Express 4 fängt abgelehnte Promises aus `async`-Routenhandlern nicht ab — eine
unbehandelte Rejection beendet den Node-Prozess. Durchsicht von
`node-backend/src/routes/*.js`:

| Datei | Routen | Mit eigenem `try/catch` |
|---|---|---|
| `sensordata.js` | 2 | 0 |
| `sensors.js` | 2 (PATCH, DELETE) | 1 (DELETE) |
| `thresholds.js` | 3 | 0 |
| `assignments.js` | 3 | 1 (POST, wirft aber nach `ROLLBACK` weiter) |
| `cleanrooms.js` | 3 | 2 (POST, DELETE) |
| `violations.js` | 3 | 3 |
| `report.js` | 1 | 1 |

Für Routen ohne eigenes `try/catch` gilt: Ein Datenbankfehler (z. B. eine ungültige
UUID in einem Query-Parameter) beendet den `api`-Prozess. `restart: unless-stopped`
startet ihn neu, aber jede laufende Anfrage anderer Clients wird währenddessen
unterbrochen.

## 6. Bekannter funktionaler Fehler: Push-Titel zeigt „undefined“

In `alertListener.js` liest `sendNtfy()` `data.metric` und `data.sensor_id`; der
Trigger sendet im `pg_notify`-Payload aber `quantity` und `sensor_uuid`. Der
Push-Titel lautet dadurch immer `undefined - <TYP>`. Die Konsolen-Ausgabe und die
SSE-Nachricht ans Dashboard sind davon nicht betroffen, da sie die korrekten
Feldnamen verwenden.

## 7. Datenmodell

- `quantity` ist unkontrollierter Freitext ohne Enum/Fremdschlüssel — ein
  Schreibfehler in der Messgröße erzeugt einen neuen, alarmlosen Kanal (siehe
  [Architektur.md](Architektur.md), Abschnitt 6).
- `unit` steht pro Messzeile statt pro Kanal; nichts verhindert einen
  Einheitenwechsel mitten in einer Zeitreihe.
- Kein Kompressions- oder Aufbewahrungs-Policy auf der Hypertable `sensor_data` —
  TimescaleDB unterstützt beides, wird hier nicht genutzt.

## 8. Frontend

- N+1-Anfragen und mehrfaches, unabhängiges Laden derselben Stammdaten, siehe
  [Architektur.md](Architektur.md), Abschnitt 11.
- Keine Barrierefreiheits-Attribute (`aria-*`, `role`) in den `.jsx`-Dateien.
- `API_BASE` doppelt definiert (`api.js`, `AlertPanel.jsx`).
- Uneinheitliche Schreibweise deutscher Begriffe im selben Bildschirm (z. B.
  „Reinraeume“ neben „Übersicht“) — die vorbereitete `i18n/de.js` würde das lösen,
  ist aber nicht eingebunden (Abschnitt 1).

## 9. Prozess

- Zum Zeitpunkt dieser Dokumentation hat das Repository einen einzelnen,
  umfassenden Ausgangs-Commit plus drei CI-bezogene Folge-Commits — keine feingranulare,
  bisektierbare Historie.
- `node-backend/migrations.zip` liegt versioniert im Repository neben dem
  identischen, entpackten `node-backend/migrations/`-Ordner.

---

## Priorisierung, nach Wirkung

Diese Reihenfolge bewertet, was am tatsächlich laufenden System etwas ändern würde
— nicht, was am saubersten wäre:

1. **Klären, ob der unbenutzte Backend-/Frontend-Pfad verdrahtet oder entfernt
   wird** (Abschnitt 1). Ohne diese Entscheidung ist jeder weitere Aufwand am
   falschen Pfad möglich.
2. **Verlustrisiko im Ingest schließen** (Abschnitt 2) — entweder durch Verdrahten
   des vorhandenen, getesteten Ingest-Pfads, oder durch gezielte Nachrüstung von
   Unique-Index + Transaktion in `mqttBridge.js`.
3. **`sendNtfy()`-Feldnamen korrigieren** (Abschnitt 6) — wenige Minuten Aufwand,
   behebt eine sichtbare, seit Längerem bestehende Fehlfunktion.
4. **Backup-Tooling entweder anschließen (Postgres-Image wechseln) oder aus dem
   Repository entfernen** (Abschnitt 3) — im aktuellen Zustand suggeriert es eine
   Absicherung, die nicht existiert.
5. Sicherheit, Fehlerbehandlung, Datenmodell, Frontend (Abschnitte 4, 5, 7, 8) —
   in der Reihenfolge, in der sie für den geplanten Einsatzzweck (Auditsicherheit,
   Netzwerkumfeld) relevant werden.
