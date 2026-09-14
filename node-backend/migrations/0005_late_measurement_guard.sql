-- =============================================================
-- FEHLERBEHEBUNG: verspätete Messwerte beschädigten den Zeitbereich.
--
-- Gefunden durch test/trigger/thresholdTrigger.test.js, Fall 12.
--
-- Ausgangslage: Die drei "Ereignis schließen"-Zweige setzten bedingungslos
--   valid_during = tstzrange(lower(valid_during), NEW.time)
-- Trifft ein Messwert ein, dessen Zeitstempel ÄLTER ist als der Beginn des offenen
-- Ereignisses, entsteht daraus tstzrange('10:00:04', '10:00:02') — PostgreSQL weist
-- das mit SQLSTATE 22000 ab, der INSERT scheitert.
--
-- Folge im Betrieb: Mit QoS 1 und Bestätigung nach dem Commit wird eine solche
-- Nachricht nicht bestätigt, der Broker stellt sie erneut zu, sie scheitert erneut —
-- eine Endlosschleife, die den Ingest dauerhaft blockiert. Genau dieser Fall wird
-- durch Wiederzustellungen nach einem Reconnect erst möglich.
--
-- Behebung: Ein Messwert von VOR dem Beginn eines Ereignisses sagt nichts darüber
-- aus, ob dieses Ereignis beendet ist. Die Bedingung `NEW.time > lower(valid_during)`
-- lässt ihn das Ereignis schlicht nicht schließen.
-- =============================================================

-- Up Migration

CREATE OR REPLACE FUNCTION check_threshold_violation()
RETURNS TRIGGER AS $$
DECLARE
    _threshold      RECORD;
    _cleanroom      INTEGER;
    _cleanroom_name TEXT;
    _sensor_name    TEXT;
    _vtype          TEXT;
    _open_event     RECORD;
    _new_id         BIGINT;
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
          AND upper(valid_during) = 'infinity'
          AND NEW.time > lower(valid_during);
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
          AND upper(valid_during) = 'infinity'
          AND NEW.time > lower(valid_during);
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
          AND upper(valid_during) = 'infinity'
          AND NEW.time > lower(valid_during);

        SELECT sa.cleanroom_id, c.name INTO _cleanroom, _cleanroom_name
        FROM sensor_assignments sa
        LEFT JOIN cleanrooms c ON c.id = sa.cleanroom_id
        WHERE sa.sensor_uuid = NEW.sensor_uuid
          AND sa.valid_during @> NEW.time
        LIMIT 1;

        SELECT name INTO _sensor_name
        FROM sensor_registry
        WHERE sensor_uuid = NEW.sensor_uuid;

        INSERT INTO threshold_violations
            (sensor_uuid, cleanroom_id, quantity, violation_type,
             threshold_min, threshold_max,
             valid_during, first_value, last_value, peak_value, data_points)
        VALUES
            (NEW.sensor_uuid, _cleanroom, NEW.quantity, _vtype,
             _threshold.min_value, _threshold.max_value,
             tstzrange(NEW.time, 'infinity'),
             NEW.value, NEW.value, NEW.value, 1)
        RETURNING id INTO _new_id;

        PERFORM pg_notify('threshold_alert', json_build_object(
            'id',             _new_id,
            'sensor_uuid',    NEW.sensor_uuid,
            'sensor_name',    _sensor_name,
            'cleanroom_id',   _cleanroom,
            'cleanroom_name', _cleanroom_name,
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

-- Down Migration
-- Nimmt die Absicherung zurück (Stand 0004). Nur zu Testzwecken sinnvoll —
-- danach ist der Fehler aus Fall 12 wieder vorhanden.

CREATE OR REPLACE FUNCTION check_threshold_violation()
RETURNS TRIGGER AS $$
DECLARE
    _threshold      RECORD;
    _cleanroom      INTEGER;
    _cleanroom_name TEXT;
    _sensor_name    TEXT;
    _vtype          TEXT;
    _open_event     RECORD;
    _new_id         BIGINT;
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

        SELECT sa.cleanroom_id, c.name INTO _cleanroom, _cleanroom_name
        FROM sensor_assignments sa
        LEFT JOIN cleanrooms c ON c.id = sa.cleanroom_id
        WHERE sa.sensor_uuid = NEW.sensor_uuid
          AND sa.valid_during @> NEW.time
        LIMIT 1;

        SELECT name INTO _sensor_name
        FROM sensor_registry
        WHERE sensor_uuid = NEW.sensor_uuid;

        INSERT INTO threshold_violations
            (sensor_uuid, cleanroom_id, quantity, violation_type,
             threshold_min, threshold_max,
             valid_during, first_value, last_value, peak_value, data_points)
        VALUES
            (NEW.sensor_uuid, _cleanroom, NEW.quantity, _vtype,
             _threshold.min_value, _threshold.max_value,
             tstzrange(NEW.time, 'infinity'),
             NEW.value, NEW.value, NEW.value, 1)
        RETURNING id INTO _new_id;

        PERFORM pg_notify('threshold_alert', json_build_object(
            'id',             _new_id,
            'sensor_uuid',    NEW.sensor_uuid,
            'sensor_name',    _sensor_name,
            'cleanroom_id',   _cleanroom,
            'cleanroom_name', _cleanroom_name,
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
