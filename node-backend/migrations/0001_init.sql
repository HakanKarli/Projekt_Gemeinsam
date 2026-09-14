-- =============================================================
-- Basisschema — entspricht dem Stand, den bisher db-init/001_schema.sql
-- beim ersten Start eines leeren Volumes angelegt hat.
--
-- Vollständig idempotent formuliert: Die Migration läuft sowohl gegen eine leere
-- Datenbank als auch gegen eine bereits bestehende Installation, ohne dort etwas
-- zu verändern. Das ist die Voraussetzung dafür, dass die drei bisherigen,
-- konkurrierenden Schema-Mechanismen (db-init, migrations, ensureSchema) durch
-- diesen einen ersetzt werden können.
-- =============================================================

-- Up Migration

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Sensor-Register: Identität aller je gesehenen Sensoren
CREATE TABLE IF NOT EXISTS sensor_registry (
    sensor_uuid  UUID        PRIMARY KEY,
    name         TEXT        NOT NULL,
    gateway_id   TEXT,
    event_driven SMALLINT    NOT NULL DEFAULT 0,   -- 0 = zyklisch, 1 = event-getrieben
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Absicherung für Bestandsinstallationen, die vor Einführung der Spalte angelegt
-- wurden. Ersetzt das frühere ensureSchema() im Anwendungscode.
ALTER TABLE sensor_registry
    ADD COLUMN IF NOT EXISTS event_driven SMALLINT NOT NULL DEFAULT 0;

-- 2. Reinräume
CREATE TABLE IF NOT EXISTS cleanrooms (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- 3. Sensor-Zuordnungen: welcher Sensor war wann in welchem Raum.
--    Die EXCLUDE-Bedingung macht überlappende Zeiträume physisch unmöglich —
--    Integrität wird von der Datenbank erzwungen, nicht von der Anwendung gehofft.
CREATE TABLE IF NOT EXISTS sensor_assignments (
    id            SERIAL    PRIMARY KEY,
    sensor_uuid   UUID      NOT NULL REFERENCES sensor_registry(sensor_uuid),
    cleanroom_id  INTEGER   NOT NULL REFERENCES cleanrooms(id),
    valid_during  TSTZRANGE NOT NULL DEFAULT tstzrange(now(), 'infinity'),
    EXCLUDE USING gist (sensor_uuid WITH =, valid_during WITH &&)
);

-- 4. Schwellenwerte: welche Grenze galt wann
CREATE TABLE IF NOT EXISTS sensor_thresholds (
    id            SERIAL    PRIMARY KEY,
    sensor_uuid   UUID      NOT NULL REFERENCES sensor_registry(sensor_uuid),
    quantity      TEXT      NOT NULL,
    min_value     DOUBLE PRECISION,
    max_value     DOUBLE PRECISION,
    valid_during  TSTZRANGE NOT NULL DEFAULT tstzrange(now(), 'infinity'),
    EXCLUDE USING gist (sensor_uuid WITH =, quantity WITH =, valid_during WITH &&)
);

-- 5. Messdaten als TimescaleDB-Hypertable.
--    Bewusst ohne Fremdschlüssel auf sensor_registry: Der Insert-Pfad ist der
--    heißeste im System, die Prüfung übernimmt der Ingest beim Registrieren.
CREATE TABLE IF NOT EXISTS sensor_data (
    time         TIMESTAMPTZ      NOT NULL,
    sensor_uuid  UUID             NOT NULL,
    quantity     TEXT             NOT NULL,
    unit         TEXT             NOT NULL DEFAULT '',
    value        DOUBLE PRECISION NOT NULL
);
SELECT create_hypertable('sensor_data', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_sensor_data_lookup
    ON sensor_data (sensor_uuid, quantity, time DESC);

-- 6. Verletzungs-EREIGNISSE (nicht Einzelmesswerte).
--    Die Grenzwerte werden beim Anlegen eingefroren, damit eine spätere Änderung
--    die Bewertung vergangener Ereignisse nicht rückwirkend verfälscht.
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

CREATE INDEX IF NOT EXISTS idx_violations_range  ON threshold_violations USING GIST (valid_during);
CREATE INDEX IF NOT EXISTS idx_violations_active ON threshold_violations (sensor_uuid, quantity)
    WHERE upper(valid_during) = 'infinity';
CREATE INDEX IF NOT EXISTS idx_violations_sensor ON threshold_violations (sensor_uuid);
CREATE INDEX IF NOT EXISTS idx_violations_room   ON threshold_violations (cleanroom_id);
CREATE INDEX IF NOT EXISTS idx_violations_ack    ON threshold_violations (acknowledged) WHERE NOT acknowledged;

-- 7. Schwellenwert-Prüfung als Trigger.
--    Bewusst in der Datenbank: So kann kein Client die Prüfung umgehen, egal
--    welcher Weg die Daten schreibt.
CREATE OR REPLACE FUNCTION check_threshold_violation()
RETURNS TRIGGER AS $$
DECLARE
    _threshold   RECORD;
    _cleanroom   INTEGER;
    _vtype       TEXT;
    _open_event  RECORD;
BEGIN
    SELECT min_value, max_value INTO _threshold
    FROM sensor_thresholds
    WHERE sensor_uuid = NEW.sensor_uuid
      AND quantity    = NEW.quantity
      AND valid_during @> NEW.time
    LIMIT 1;

    -- Kein Grenzwert definiert: ein etwaig offenes Ereignis wird beendet.
    IF NOT FOUND THEN
        UPDATE threshold_violations
        SET valid_during = tstzrange(lower(valid_during), NEW.time)
        WHERE sensor_uuid = NEW.sensor_uuid
          AND quantity    = NEW.quantity
          AND upper(valid_during) = 'infinity';
        RETURN NEW;
    END IF;

    -- Streng kleiner/größer: ein Wert exakt auf der Grenze ist keine Verletzung.
    _vtype := NULL;
    IF _threshold.min_value IS NOT NULL AND NEW.value < _threshold.min_value THEN
        _vtype := 'below_min';
    ELSIF _threshold.max_value IS NOT NULL AND NEW.value > _threshold.max_value THEN
        _vtype := 'above_max';
    END IF;

    IF _vtype IS NULL THEN
        UPDATE threshold_violations
        SET valid_during = tstzrange(lower(valid_during), NEW.time)
        WHERE sensor_uuid = NEW.sensor_uuid
          AND quantity    = NEW.quantity
          AND upper(valid_during) = 'infinity';
        RETURN NEW;
    END IF;

    SELECT * INTO _open_event
    FROM threshold_violations
    WHERE sensor_uuid    = NEW.sensor_uuid
      AND quantity       = NEW.quantity
      AND violation_type = _vtype
      AND upper(valid_during) = 'infinity'
    LIMIT 1;

    IF FOUND THEN
        -- Laufendes Ereignis fortschreiben statt ein zweites anzulegen.
        UPDATE threshold_violations
        SET last_value  = NEW.value,
            peak_value  = CASE
                WHEN _vtype = 'above_max' THEN GREATEST(threshold_violations.peak_value, NEW.value)
                ELSE LEAST(threshold_violations.peak_value, NEW.value)
            END,
            data_points = threshold_violations.data_points + 1
        WHERE id = _open_event.id;
    ELSE
        -- Typwechsel: erst das Ereignis der Gegenrichtung schließen.
        UPDATE threshold_violations
        SET valid_during = tstzrange(lower(valid_during), NEW.time)
        WHERE sensor_uuid = NEW.sensor_uuid
          AND quantity    = NEW.quantity
          AND upper(valid_during) = 'infinity';

        SELECT cleanroom_id INTO _cleanroom
        FROM sensor_assignments
        WHERE sensor_uuid = NEW.sensor_uuid
          AND valid_during @> NEW.time
        LIMIT 1;

        INSERT INTO threshold_violations
            (sensor_uuid, cleanroom_id, quantity, violation_type,
             threshold_min, threshold_max,
             valid_during, first_value, last_value, peak_value, data_points)
        VALUES
            (NEW.sensor_uuid, _cleanroom, NEW.quantity, _vtype,
             _threshold.min_value, _threshold.max_value,
             tstzrange(NEW.time, 'infinity'),
             NEW.value, NEW.value, NEW.value, 1);

        -- Nur beim ÖFFNEN benachrichtigen, nicht bei jedem Verstoß.
        PERFORM pg_notify('threshold_alert', json_build_object(
            'sensor_uuid',    NEW.sensor_uuid,
            'cleanroom_id',   _cleanroom,
            'quantity',       NEW.quantity,
            'violation_type', _vtype,
            'value',          NEW.value,
            'threshold_min',  _threshold.min_value,
            'threshold_max',  _threshold.max_value,
            'time',           NEW.time
        )::text);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- PostgreSQL kennt kein CREATE TRIGGER IF NOT EXISTS.
DROP TRIGGER IF EXISTS trg_check_threshold ON sensor_data;
CREATE TRIGGER trg_check_threshold
    AFTER INSERT ON sensor_data
    FOR EACH ROW
    EXECUTE FUNCTION check_threshold_violation();

-- Down Migration

DROP TRIGGER IF EXISTS trg_check_threshold ON sensor_data;
DROP FUNCTION IF EXISTS check_threshold_violation();
DROP TABLE IF EXISTS threshold_violations;
DROP TABLE IF EXISTS sensor_data;
DROP TABLE IF EXISTS sensor_thresholds;
DROP TABLE IF EXISTS sensor_assignments;
DROP TABLE IF EXISTS cleanrooms;
DROP TABLE IF EXISTS sensor_registry;
