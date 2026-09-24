# Quantity-Abgleich — Antwort auf die offene To-Do

Bezug: offene Abnahme-Notiz ("Die `quantity`-Strings bestätigen ... Lauf das bei
Gruppe 1 (oder gegen deren Dump)").

## Status

**Noch offen:** Die Abfrage konnte hier nicht gegen Gruppe 1s Datenbank oder Dump
laufen — es liegt kein Dump im Repo, und lokal läuft keine Datenbank (Docker ist
auf dieser Maschine gerade nicht gestartet). Dieses Dokument liefert daher:

1. die kanonischen `quantity`-Werte **dieses** Projekts, mit Beleg im Code,
2. den Abgleich mit den in der Notiz genannten Bezeichnungen,
3. die Abfrage, fertig zum Ausführen bei Gruppe 1,
4. eine Tabelle zum Ausfüllen, sobald das Ergebnis vorliegt.

Sobald die `SELECT DISTINCT`-Liste von Gruppe 1 da ist, Abschnitt 4 ausfüllen und
das Dokument zurückschicken — mehr braucht es für die Abgabe nicht.

## 1. Kanonische Werte dieses Projekts

Quelle der Wahrheit: [`edge-agent/ohb_edge/sensors.py`](../edge-agent/ohb_edge/sensors.py)
(Klasse `Quantity`). Der Simulator in
[`MQTT_Publish_Test/mqtt_simulator.py`](../MQTT_Publish_Test/mqtt_simulator.py)
verwendet exakt dieselben Strings — geprüft, keine Abweichung.

| `quantity` | Bedeutung | Einheit |
|---|---|---|
| `temperature` | Temperatur | `°C` |
| `humidity` | Luftfeuchte | `%rH` |
| `pressure` | Druck | `hPa` |
| `eco2` | eCO2 | `ppm` |
| `tvoc` | TVOC | `ppb` |
| `wind_speed` | Luftströmung | `m/s` |
| `pm2_5` | Feinstaub PM2.5 | `µg/m³` |
| `pm10` | Feinstaub PM10 | `µg/m³` |

Im Datenbankschema selbst gibt es **keine** feste Enum-Liste — `sensor_data.quantity`
ist `TEXT NOT NULL` (siehe Abschnitt 5). Die Liste oben ist eine Vereinbarung
zwischen Edge-Agent/Simulator und Server, keine DB-Constraint.

## 2. Abgleich mit der Abnahme-Notiz

Die Notiz nennt: `pm25`, `eco2`, `tvoc`, `mps`, `temperature`, `humidity`, …

| Notiz | Dieses Projekt | Übereinstimmung |
|---|---|---|
| `temperature` | `temperature` | ✅ identisch |
| `humidity` | `humidity` | ✅ identisch |
| `eco2` | `eco2` | ✅ identisch |
| `tvoc` | `tvoc` | ✅ identisch |
| `pm25` | `pm2_5` | ⚠️ abweichend (Unterstrich) |
| `mps` | `wind_speed` | ⚠️ abweichend (anderer Name) |

Nur `pm25`/`pm2_5` und `mps`/`wind_speed` weichen ab. Falls Gruppe 1 tatsächlich
`pm25` und `mps` schreibt, betrifft das genau zwei Panels — pro Panel ein Einzeiler
(Quantity-String im Panel-Mapping anpassen), keine Schemaänderung nötig.

## 3. Abfrage für Gruppe 1

```sql
SELECT DISTINCT quantity
FROM sensor_data
ORDER BY quantity;
```

Läuft entweder direkt bei Gruppe 1 (`psql`, DBeaver, o.ä.) oder gegen einen Dump:

```bash
# falls es ein pg_dump-Archiv ist:
pg_restore -l gruppe1.dump | grep sensor_data   # zur Orientierung
psql -f gruppe1.dump gruppe1_db -c "SELECT DISTINCT quantity FROM sensor_data ORDER BY quantity;"
```

## 4. Ergebnis von Gruppe 1 (ausfüllen, sobald verfügbar)

| `quantity` bei Gruppe 1 | erwartet? | Aktion |
|---|---|---|
| _(noch offen)_ | | |

Sobald befüllt: jede Zeile mit ⚠️ bekommt eine Zeile "Panel X: `<alt>` → `<neu>`"
im Dashboard-Mapping.

## 5. Wie das Schema aussieht

Maßgeblich für den tatsächlich laufenden Stack:
[`db-init/001_schema.sql`](../db-init/001_schema.sql) — siehe
[schema-mapping.md](schema-mapping.md) zur Einordnung gegenüber
`node-backend/migrations/`, das nicht gegen die laufende Datenbank angewendet wird.

```sql
-- Messdaten als TimescaleDB-Hypertable
CREATE TABLE IF NOT EXISTS sensor_data (
    time         TIMESTAMPTZ      NOT NULL,
    sensor_uuid  UUID             NOT NULL,
    quantity     TEXT             NOT NULL,
    unit         TEXT             NOT NULL DEFAULT '',
    value        DOUBLE PRECISION NOT NULL
);
SELECT create_hypertable('sensor_data', 'time', if_not_exists => TRUE);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sensor_data_uniq
    ON sensor_data (sensor_uuid, quantity, time);
```

Wichtigste Nachbartabellen, weil `quantity` dort wiederkehrt:

```sql
-- Schwellenwerte gelten pro (sensor_uuid, quantity) und Zeitfenster
CREATE TABLE IF NOT EXISTS sensor_thresholds (
    id            SERIAL    PRIMARY KEY,
    sensor_uuid   UUID      NOT NULL REFERENCES sensor_registry(sensor_uuid),
    quantity      TEXT      NOT NULL,
    min_value     DOUBLE PRECISION,
    max_value     DOUBLE PRECISION,
    valid_during  TSTZRANGE NOT NULL DEFAULT tstzrange(now(), 'infinity'),
    EXCLUDE USING gist (sensor_uuid WITH =, quantity WITH =, valid_during WITH &&)
);

-- Verletzungs-Ereignisse, ebenfalls pro quantity
CREATE TABLE IF NOT EXISTS threshold_violations (
    id              BIGSERIAL PRIMARY KEY,
    sensor_uuid     UUID      NOT NULL REFERENCES sensor_registry(sensor_uuid) ON DELETE CASCADE,
    cleanroom_id    INTEGER   REFERENCES cleanrooms(id) ON DELETE SET NULL,
    quantity        TEXT      NOT NULL,
    violation_type  TEXT      NOT NULL CHECK (violation_type IN ('below_min', 'above_max')),
    threshold_min   DOUBLE PRECISION,
    threshold_max   DOUBLE PRECISION,
    valid_during    TSTZRANGE NOT NULL DEFAULT tstzrange(now(), 'infinity'),
    first_value     DOUBLE PRECISION NOT NULL,
    last_value      DOUBLE PRECISION,
    peak_value      DOUBLE PRECISION NOT NULL,
    data_points     INTEGER   NOT NULL DEFAULT 1,
    acknowledged    BOOLEAN   NOT NULL DEFAULT FALSE
);
```

**Kernpunkt:** `quantity` ist überall `TEXT`, ohne Fremdschlüssel oder Enum. Ein
falscher String erzeugt keinen Fehler, sondern einen neuen, stillen Kanal ohne
Schwellenwert und ohne Alarmierung (Kommentar dazu direkt in
[`sensors.py`](../edge-agent/ohb_edge/sensors.py), Zeile 27–29) — deshalb die
Vorsicht bei diesem Abgleich.

## Einordnung (Kontext, nicht Teil der Notiz)

Die Werte in Abschnitt 1 sind bereits ausführlich dokumentiert in
[`schema-mapping.md`](./schema-mapping.md) — dieses Dokument fasst sie nur für die
konkrete Abgabe-Antwort zusammen und ergänzt Abschnitt 4 als auszufüllende Vorlage.
