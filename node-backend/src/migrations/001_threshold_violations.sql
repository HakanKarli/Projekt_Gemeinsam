-- ============================================================
-- Migration: threshold_violations mit tstzrange
-- Konsistent mit sensor_assignments + sensor_thresholds.
-- PostgreSQL trackt Verletzungs-EREIGNISSE mit Zeitbereich.
-- ============================================================

-- Alte Version droppen
DROP TRIGGER IF EXISTS trg_check_threshold ON sensor_data;
DROP FUNCTION IF EXISTS check_threshold_violation();
DROP TABLE IF EXISTS threshold_violations;

-- 1. Tabelle fuer Schwellenwert-Verletzungs-Ereignisse
CREATE TABLE IF NOT EXISTS threshold_violations (
    id              BIGSERIAL PRIMARY KEY,
    sensor_id       TEXT NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    cleanroom_id    INTEGER REFERENCES cleanrooms(id) ON DELETE SET NULL,
    metric          TEXT NOT NULL,
    violation_type  TEXT NOT NULL CHECK (violation_type IN ('below_min', 'above_max')),
    threshold_min   DOUBLE PRECISION,
    threshold_max   DOUBLE PRECISION,
    -- Zeitbereich als tstzrange (konsistent mit assignments + thresholds)
    valid_during    TSTZRANGE NOT NULL DEFAULT tstzrange(now(), 'infinity'),
    -- Werte waehrend des Events
    first_value     DOUBLE PRECISION NOT NULL,
    last_value      DOUBLE PRECISION,
    peak_value      DOUBLE PRECISION NOT NULL,  -- extremster Wert
    data_points     INTEGER NOT NULL DEFAULT 1,
    -- Status
    acknowledged    BOOLEAN NOT NULL DEFAULT FALSE
);

-- GiST-Index fuer Range-Queries (wie bei assignments + thresholds)
CREATE INDEX IF NOT EXISTS idx_violations_range      ON threshold_violations USING GIST (valid_during);
CREATE INDEX IF NOT EXISTS idx_violations_active     ON threshold_violations (sensor_id, metric)
    WHERE upper(valid_during) = 'infinity';
CREATE INDEX IF NOT EXISTS idx_violations_sensor     ON threshold_violations (sensor_id);
CREATE INDEX IF NOT EXISTS idx_violations_room       ON threshold_violations (cleanroom_id);
CREATE INDEX IF NOT EXISTS idx_violations_ack        ON threshold_violations (acknowledged) WHERE NOT acknowledged;

-- 2. Trigger-Funktion: Event-basiert mit tstzrange
CREATE OR REPLACE FUNCTION check_threshold_violation()
RETURNS TRIGGER AS $$
DECLARE
    _threshold   RECORD;
    _cleanroom   INTEGER;
    _vtype       TEXT;
    _open_event  RECORD;
BEGIN
    -- Aktuellen Schwellenwert fuer diesen Sensor + Metrik finden
    SELECT min_value, max_value INTO _threshold
    FROM sensor_thresholds
    WHERE sensor_id = NEW.sensor_id
      AND metric = NEW.metric
      AND valid_during @> NEW.time
    LIMIT 1;

    -- Kein Schwellenwert definiert -> offene Events schliessen
    IF NOT FOUND THEN
        UPDATE threshold_violations
        SET valid_during = tstzrange(lower(valid_during), NEW.time)
        WHERE sensor_id = NEW.sensor_id
          AND metric    = NEW.metric
          AND upper(valid_during) = 'infinity';
        RETURN NEW;
    END IF;

    -- Pruefen ob Verletzung vorliegt
    _vtype := NULL;
    IF _threshold.min_value IS NOT NULL AND NEW.value < _threshold.min_value THEN
        _vtype := 'below_min';
    ELSIF _threshold.max_value IS NOT NULL AND NEW.value > _threshold.max_value THEN
        _vtype := 'above_max';
    END IF;

    -- Fall A: Keine Verletzung -> offenes Event schliessen
    IF _vtype IS NULL THEN
        UPDATE threshold_violations
        SET valid_during = tstzrange(lower(valid_during), NEW.time)
        WHERE sensor_id = NEW.sensor_id
          AND metric    = NEW.metric
          AND upper(valid_during) = 'infinity';
        RETURN NEW;
    END IF;

    -- Fall B: Verletzung liegt vor
    -- Gibt es bereits ein offenes Event desselben Typs?
    SELECT * INTO _open_event
    FROM threshold_violations
    WHERE sensor_id      = NEW.sensor_id
      AND metric         = NEW.metric
      AND violation_type = _vtype
      AND upper(valid_during) = 'infinity'
    LIMIT 1;

    IF FOUND THEN
        -- Bestehendes Event aktualisieren
        UPDATE threshold_violations
        SET last_value   = NEW.value,
            peak_value   = CASE
                WHEN _vtype = 'above_max' THEN GREATEST(threshold_violations.peak_value, NEW.value)
                ELSE LEAST(threshold_violations.peak_value, NEW.value)
            END,
            data_points  = threshold_violations.data_points + 1
        WHERE id = _open_event.id;
    ELSE
        -- Falls ein offenes Event ANDEREN Typs existiert: zuerst schliessen
        UPDATE threshold_violations
        SET valid_during = tstzrange(lower(valid_during), NEW.time)
        WHERE sensor_id = NEW.sensor_id
          AND metric    = NEW.metric
          AND upper(valid_during) = 'infinity';

        -- Reinraum bestimmen
        SELECT cleanroom_id INTO _cleanroom
        FROM sensor_assignments
        WHERE sensor_id = NEW.sensor_id
          AND valid_during @> NEW.time
        LIMIT 1;

        -- Neues Event erstellen (offen bis infinity)
        INSERT INTO threshold_violations
            (sensor_id, cleanroom_id, metric, violation_type,
             threshold_min, threshold_max,
             valid_during, first_value, last_value, peak_value, data_points)
        VALUES
            (NEW.sensor_id, _cleanroom, NEW.metric, _vtype,
             _threshold.min_value, _threshold.max_value,
             tstzrange(NEW.time, 'infinity'),
             NEW.value, NEW.value, NEW.value, 1);

        -- Backend ueber neues Violation-Event benachrichtigen
        PERFORM pg_notify('threshold_alert', json_build_object(
            'sensor_id',      NEW.sensor_id,
            'cleanroom_id',   _cleanroom,
            'metric',         NEW.metric,
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

-- 3. Trigger auf sensor_data Tabelle
CREATE TRIGGER trg_check_threshold
    AFTER INSERT ON sensor_data
    FOR EACH ROW
    EXECUTE FUNCTION check_threshold_violation();
