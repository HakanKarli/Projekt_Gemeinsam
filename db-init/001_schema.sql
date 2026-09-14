-- =============================================================
-- OHB Sensor Dashboard – Datenbank-Schema
-- =============================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Sensor-Registry: UUID → Name Mapping
CREATE TABLE IF NOT EXISTS sensor_registry (
    sensor_uuid  UUID        PRIMARY KEY,
    name         TEXT        NOT NULL,
    gateway_id   TEXT,
    event_driven SMALLINT    NOT NULL DEFAULT 0,   -- 0 = zyklisch, 1 = event-getrieben
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Reinraeume
CREATE TABLE IF NOT EXISTS cleanrooms (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- 3. Sensor-Zuordnungen zu Reinraeumen (tstzrange-basiert)
CREATE TABLE IF NOT EXISTS sensor_assignments (
    id            SERIAL    PRIMARY KEY,
    sensor_uuid   UUID      NOT NULL REFERENCES sensor_registry(sensor_uuid),
    cleanroom_id  INTEGER   NOT NULL REFERENCES cleanrooms(id),
    valid_during  TSTZRANGE NOT NULL DEFAULT tstzrange(now(), 'infinity'),
    EXCLUDE USING gist (sensor_uuid WITH =, valid_during WITH &&)
);

-- 4. Schwellenwerte (tstzrange-basiert)
CREATE TABLE IF NOT EXISTS sensor_thresholds (
    id            SERIAL    PRIMARY KEY,
    sensor_uuid   UUID      NOT NULL REFERENCES sensor_registry(sensor_uuid),
    quantity      TEXT      NOT NULL,
    min_value     DOUBLE PRECISION,
    max_value     DOUBLE PRECISION,
    valid_during  TSTZRANGE NOT NULL DEFAULT tstzrange(now(), 'infinity'),
    EXCLUDE USING gist (sensor_uuid WITH =, quantity WITH =, valid_during WITH &&)
);

-- 5. Messdaten (TimescaleDB Hypertable)
CREATE TABLE IF NOT EXISTS sensor_data (
    time         TIMESTAMPTZ      NOT NULL,
    sensor_uuid  UUID             NOT NULL,
    quantity     TEXT             NOT NULL,
    unit         TEXT             NOT NULL DEFAULT '',
    value        DOUBLE PRECISION NOT NULL
);
SELECT create_hypertable('sensor_data', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_sensor_data_lookup ON sensor_data (sensor_uuid, quantity, time DESC);

-- 6. Schwellenwert-Verletzungen
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
CREATE INDEX IF NOT EXISTS idx_violations_active ON threshold_violations (sensor_uuid, quantity) WHERE upper(valid_during) = 'infinity';
CREATE INDEX IF NOT EXISTS idx_violations_sensor ON threshold_violations (sensor_uuid);
CREATE INDEX IF NOT EXISTS idx_violations_room   ON threshold_violations (cleanroom_id);
CREATE INDEX IF NOT EXISTS idx_violations_ack    ON threshold_violations (acknowledged) WHERE NOT acknowledged;

-- 7. Trigger: Schwellenwert-Pruefung bei neuem Datenpunkt
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

    IF NOT FOUND THEN
        UPDATE threshold_violations
        SET valid_during = tstzrange(lower(valid_during), NEW.time)
        WHERE sensor_uuid = NEW.sensor_uuid
          AND quantity    = NEW.quantity
          AND upper(valid_during) = 'infinity';
        RETURN NEW;
    END IF;

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
        UPDATE threshold_violations
        SET last_value  = NEW.value,
            peak_value  = CASE
                WHEN _vtype = 'above_max' THEN GREATEST(threshold_violations.peak_value, NEW.value)
                ELSE LEAST(threshold_violations.peak_value, NEW.value)
            END,
            data_points = threshold_violations.data_points + 1
        WHERE id = _open_event.id;
    ELSE
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

CREATE TRIGGER trg_check_threshold
    AFTER INSERT ON sensor_data
    FOR EACH ROW
    EXECUTE FUNCTION check_threshold_violation();
