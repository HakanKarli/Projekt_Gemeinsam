-- =============================================================
-- Vollständigere Benachrichtigung bei Schwellenwert-Verletzungen.
--
-- Zwei Ergänzungen am Notify-Payload:
--
--   1. `id` — die ID des angelegten Ereignisses. Ohne sie kann der Abgleich
--      (alerts/reconciler.js) nicht erkennen, ob ein per NOTIFY zugestellter Alarm
--      derselbe ist, den er beim Poll findet. Erst damit ist die Entdopplung
--      zwischen den beiden Alarmwegen möglich.
--
--   2. `sensor_name` / `cleanroom_name` — Klartext statt UUIDs. Push-Nachricht und
--      Live-Banner werden damit ohne zusätzliche Abfrage im Frontend lesbar.
--
-- Die beiden zusätzlichen SELECTs laufen ausschließlich beim ÖFFNEN eines
-- Ereignisses, nicht bei jedem Messwert.
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

-- Down Migration
-- Stellt die Fassung aus 0001 wieder her (Payload ohne id und Klartextnamen).

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
