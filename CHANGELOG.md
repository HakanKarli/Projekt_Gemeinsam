# Änderungsverlauf

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [2.0.0] — 2026-07-28

Umbau auf einen containerisierten, selbstheilenden Betrieb mit verlustfreier
Ingest-Kette.

> ⚠️ **Nachträglicher Hinweis (23.09.2026):** Ein erheblicher Teil der unten
> gelisteten Punkte (Idempotenz, Ack-nach-Commit, Watchdog, zentrale
> Fehler-Middleware, `GET /api/panels`, gemeinsamer Frontend-Stammdaten-Context,
> strukturiertes Logging) ist in einem parallelen Code-Pfad umgesetzt, der von
> `docker-compose.yml` nicht gestartet wird. Was tatsächlich läuft, steht in
> [docs/Architektur.md](docs/Architektur.md); die Lücke ist beschrieben in
> [docs/Technische-Schulden.md](docs/Technische-Schulden.md#1-der-wichtigste-befund-zwei-parallele-implementierungen).

### Sicherheit

- **Datenbank-Passwort rotiert** und beide `.env`-Dateien aus der Versionsverwaltung
  entfernt; `.gitignore` im Wurzelverzeichnis angelegt (SEC-01).
  Die Bereinigung der Git-Historie steht noch aus — sie schreibt alle Commit-Hashes neu
  und ist deshalb eine Entscheidung des Repository-Eigners.
- `docker-compose.yml` verlangt `POSTGRES_PASSWORD`, statt einen Vorgabewert zu setzen.
- Helmet als Sicherheitskopfzeilen-Schicht; CORS über `CORS_ORIGINS` einschränkbar
  statt pauschal offen.

### Verlustfreiheit

- **Idempotente Messdaten:** eindeutiger Index auf `(sensor_uuid, quantity, time)`,
  Einfügen mit `ON CONFLICT DO NOTHING`. Ersetzt den bisherigen Lookup-Index und kostet
  damit keine zusätzliche Schreiblast. Beim Anwenden wurden **330 bereits vorhandene
  Duplikate** entfernt.
- **Bestätigung nach dem Commit:** Der Ingest bestätigt eine MQTT-Nachricht erst, wenn
  sie in der Datenbank steht. Bei Fehlern wird mit Backoff wiederholt (~8 s) und danach
  der Prozess beendet — der Neustart nimmt die Session wieder auf, der Broker stellt
  erneut zu.
- **Persistente MQTT-Session:** QoS 1, `clean: false`, feste ClientId.
- **Broker als Puffer:** `persistence true`, `max_queued_messages 500000`
  (Standard waren 1000 — rund 400 Sekunden Puffer).
- **Trennung der Fehlerarten:** Ungültige Nachrichten werden bestätigt und in
  `ingest_rejects` abgelegt (keine Endlosschleife), Datenbankfehler nicht bestätigt.
- Eine Transaktion und ein einziges `INSERT` je Nachricht statt eines Statements
  je Messgröße.

### Behobene Fehler

- **API-Absturz durch fehlerhafte Anfragen** (REL-01): 12 von 18 Routen beendeten bei
  einem Datenbankfehler den Prozess. Behoben durch `express-async-errors`,
  Eingabeprüfung mit Zod und eine zentrale Fehler-Middleware.
- **Ungültiger Zeitbereich durch verspätete Messwerte:** Ein Messwert, der älter war
  als der Beginn eines offenen Verletzungs-Ereignisses, ließ den Trigger mit
  SQLSTATE 22000 scheitern. Mit Wiederzustellung wäre daraus eine Endlosschleife
  geworden. Gefunden durch Testfall 12, behoben in Migration `0005`.
- **Push-Nachrichten zeigten „undefined":** Der Versand las `metric` und `sensor_id`;
  der Trigger sendet `quantity` und `sensor_uuid`.
- **Vervielfachte Alarm-Listener:** `error` und `end` starteten je einen neuen
  Listener; nach n Störungen gab es n-fache Push-Nachrichten. Jetzt genau ein
  Reconnect-Pfad.
- **Verlorene Alarme:** `pg_notify` ist flüchtig. Ein Abgleich meldet offene,
  unquittierte Verletzungen nach, die während einer Unterbrechung entstanden.
- **Health-Prüfung über `localhost` im Container** schlug fehl, weil `localhost`
  zuerst auf IPv6 auflöst, der Server aber auf IPv4 lauscht.

### Neu

- **OpenAPI 3.1** unter `/api/openapi.json`, Oberfläche unter `/api/docs`, erzeugt aus
  denselben Zod-Schemata, gegen die geprüft wird. Export nach
  [docs/openapi.yaml](docs/openapi.yaml); die CI bricht bei Abweichung ab.
- **`GET /api/panels`** — liefert das Panel-Manifest in einer Anfrage statt in 1 + 2N.
- **`/healthz`, `/readyz`, `/api/health/deep`** — letzteres meldet Ingest-Verzögerung,
  Archiv-Stau und offene Alarme und antwortet mit 503.
- **Betriebsstack** aus sechs Containern inklusive nginx als einzigem Einstiegspunkt,
  Uptime Kuma zur Überwachung und pgBackRest für WAL-Archivierung und Sicherungen.
- **Testsuite:** 45 Tests im Backend (Trigger-Zustandsautomat, Idempotenz,
  Schnittstellenvertrag) gegen eine echte TimescaleDB über Testcontainers,
  19 Tests im Frontend.
- **CI** mit Lint, Migrationen gegen eine frische Datenbank, Tests, Build und
  Sicherheitsprüfung der Laufzeitabhängigkeiten.
- [docs/Betriebshandbuch.md](docs/Betriebshandbuch.md) — Einrichtung, Alarmreaktionen,
  Wiederherstellung.

### Geändert

- **Backend neu geschnitten:** `http/routes` (dünn) → `services` (SQL und Fachlogik),
  dazu `domain/schemas` als einzige Quelle für Prüfung, Typen und Dokumentation.
  Bewusst ohne Repository-Schicht — die Fachlogik ist hier SQL.
- **Ein Migrationsweg** (node-pg-migrate) statt dreier konkurrierender Mechanismen;
  `db-init/` und `ensureSchema()` entfallen.
- **Strukturiertes Logging** (pino) mit Korrelations-ID je Anfrage statt `console.log`.
- **Frontend:** relative API-Basis `/api`, gemeinsamer Stammdaten-Context statt fünf
  unabhängiger Abrufe derselben Sensorliste, Fehlergrenze je Panel, gemeinsame
  Dialoghülle mit Rolle, Beschriftung, Fokusfalle und Escape, alle Zeichenketten in
  `i18n/de.js` (beseitigt „Uebersicht" neben „Übersicht").
- Konfiguration wird beim Start gegen ein Schema geprüft — fehlende Werte beenden den
  Prozess mit einer lesbaren Meldung.

### Entfernt

- `src/mqttBridge.js`, `src/alertListener.js`, `src/db.js`, `src/routes/` — als
  ersetzt vorgesehen, **liegen aber weiterhin im Repository und sind die
  tatsächlich von `docker-compose.yml` gestarteten Dateien** (Stand 23.09.2026,
  siehe [docs/Technische-Schulden.md](docs/Technische-Schulden.md)).
- `migrations/001_threshold_violations.sql` — bezog sich auf ein Schema, das es seit
  Längerem nicht mehr gibt, und wäre beim Ausführen gescheitert.
- `hooks/useSensorPoller.js` und die wirkungslosen `subscribe`/`unsubscribe`-Hüllen.
- `db-init/` — als in die Migrationen überführt vorgesehen, **ist aber weiterhin
  die Quelle des tatsächlich verwendeten Schemas** (siehe
  [docs/schema-mapping.md](docs/schema-mapping.md)).

### Noch offen

- Audit-Trail ohne Identität (`changed_by`, Anmeldung) — bewusst vertagt, siehe
  [docs/Technische-Schulden.md](docs/Technische-Schulden.md).
- Sicherungsziel liegt auf derselben Hardware wie die Datenbank.
- Kontrolliertes Vokabular für Messgrößen, Kompression und Aufbewahrungsregel
  (DATA-01 bis DATA-03).

---

## [1.0.0] — 2026-06-03

Erste Fassung: MQTT-Bridge, REST-API, React-Dashboard, PDF-Report,
Schwellenwert-Trigger mit Zeitraum-Versionierung.
