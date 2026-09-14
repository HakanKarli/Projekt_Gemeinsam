-- =============================================================
-- Die zeitliche Invariante wandert in die Datenbank.
--
-- AUSGANGSLAGE: Das Muster "alten Gültigkeitszeitraum schließen, neuen öffnen"
-- lag in JavaScript — in assignmentService.assign() und thresholdService.set().
-- Die Datenbank erzwang nur die Abwesenheit von ÜBERSCHNEIDUNGEN (EXCLUDE), nicht
-- die Vollständigkeit des Vorgangs. Wer mit psql, einem Importskript oder einem
-- Wartungseingriff daran vorbeischrieb, konnte eine Lücke hinterlassen, ohne dass
-- irgendetwas es bemerkt hätte.
--
-- Für ein System, dessen Wert die Nachvollziehbarkeit ist, darf die Nachvollzieh-
-- barkeit nicht von der Disziplin des Aufrufers abhängen. Die Schwellenwert-Prüfung
-- liegt aus genau diesem Grund bereits als Trigger in der Datenbank — dieser Schritt
-- führt den Gedanken zu Ende.
--
-- DANACH: Die Services rufen nur noch diese Funktionen auf. Sie enthalten kein SQL
-- mehr, das eine Invariante herstellen müsste.
--
-- NOCH OFFEN (gehört zu AUD-01): Ein eigener Anwendungs-Datenbankbenutzer ohne
-- direktes INSERT/UPDATE auf sensor_assignments und sensor_thresholds. Erst dann
-- sind die Funktionen nicht nur der bequeme, sondern der EINZIGE Weg. Solange die
-- Anwendung als Superuser verbindet, bleibt es eine Konvention.
-- =============================================================

-- Up Migration

-- ── 1. Bedingungen, die schon immer hätten gelten müssen ──────────────
--
-- Ein Schwellenwert ohne jede Grenze sieht konfiguriert aus, schaltet die
-- Alarmierung für diesen Kanal aber faktisch ab: Der Trigger findet ihn, ermittelt
-- keinen Verletzungstyp und schließt stattdessen offene Ereignisse.
--
-- NOT VALID: Bestehende Zeilen werden nicht geprüft — beim Anlegen dieser Migration
-- existierte genau ein solcher Altsatz. Neue und geänderte Zeilen unterliegen der
-- Bedingung ab sofort. Nach Bereinigung des Bestands validieren mit:
--   ALTER TABLE sensor_thresholds VALIDATE CONSTRAINT chk_threshold_hat_grenze;
ALTER TABLE sensor_thresholds
    ADD CONSTRAINT chk_threshold_hat_grenze
    CHECK (min_value IS NOT NULL OR max_value IS NOT NULL) NOT VALID;

ALTER TABLE sensor_thresholds
    ADD CONSTRAINT chk_threshold_grenzen_sortiert
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value) NOT VALID;

-- ── 2. Sensor einem Reinraum zuordnen ─────────────────────────────────
CREATE OR REPLACE FUNCTION assign_sensor(
    p_sensor_uuid  UUID,
    p_cleanroom_id INTEGER
)
RETURNS SETOF sensor_assignments
LANGUAGE plpgsql
AS $$
DECLARE
    -- now() liefert den Beginn der TRANSAKTION und ist damit für das Schließen und
    -- das Öffnen identisch. Zwei getrennte Aufrufe könnten sonst eine Lücke von
    -- wenigen Mikrosekunden hinterlassen.
    _jetzt timestamptz := now();
BEGIN
    -- Sperrt die Registerzeile: Zwei gleichzeitige Zuordnungen desselben Sensors
    -- werden serialisiert statt sich gegenseitig an der EXCLUDE-Bedingung zu
    -- zerlegen. Prüft nebenbei, ob der Sensor überhaupt existiert.
    PERFORM 1 FROM sensor_registry WHERE sensor_uuid = p_sensor_uuid FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;   -- keine Zeile — der Aufrufer meldet "nicht gefunden"
    END IF;

    PERFORM 1 FROM cleanrooms WHERE id = p_cleanroom_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reinraum % existiert nicht', p_cleanroom_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    UPDATE sensor_assignments
       SET valid_during = tstzrange(lower(valid_during), _jetzt)
     WHERE sensor_uuid = p_sensor_uuid
       AND valid_during @> _jetzt;

    RETURN QUERY
    INSERT INTO sensor_assignments (sensor_uuid, cleanroom_id, valid_during)
    VALUES (p_sensor_uuid, p_cleanroom_id, tstzrange(_jetzt, 'infinity'))
    RETURNING *;
END;
$$;

COMMENT ON FUNCTION assign_sensor(UUID, INTEGER) IS
    'Ordnet einen Sensor einem Reinraum zu: schließt die bisherige Zuordnung und '
    'öffnet die neue mit demselben Zeitpunkt. Liefert keine Zeile, wenn der Sensor '
    'unbekannt ist.';

-- ── 3. Schwellenwert setzen ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_threshold(
    p_sensor_uuid UUID,
    p_quantity    TEXT,
    p_min_value   DOUBLE PRECISION,
    p_max_value   DOUBLE PRECISION
)
RETURNS SETOF sensor_thresholds
LANGUAGE plpgsql
AS $$
DECLARE
    _jetzt timestamptz := now();
BEGIN
    PERFORM 1 FROM sensor_registry WHERE sensor_uuid = p_sensor_uuid FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Die Plausibilität der Grenzen prüfen die CHECK-Bedingungen aus Abschnitt 1.
    -- Hier wird sie bewusst NICHT wiederholt: Eine Regel an zwei Stellen läuft
    -- früher oder später auseinander. Die verständliche Fehlermeldung liefert die
    -- Zod-Prüfung an der HTTP-Grenze, die Zusicherung diese Tabelle.
    UPDATE sensor_thresholds
       SET valid_during = tstzrange(lower(valid_during), _jetzt)
     WHERE sensor_uuid = p_sensor_uuid
       AND quantity    = p_quantity
       AND valid_during @> _jetzt;

    RETURN QUERY
    INSERT INTO sensor_thresholds (sensor_uuid, quantity, min_value, max_value, valid_during)
    VALUES (p_sensor_uuid, p_quantity, p_min_value, p_max_value, tstzrange(_jetzt, 'infinity'))
    RETURNING *;
END;
$$;

COMMENT ON FUNCTION set_threshold(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) IS
    'Setzt einen Schwellenwert: schließt den bisherigen und öffnet den neuen mit '
    'demselben Zeitpunkt. Liefert keine Zeile, wenn der Sensor unbekannt ist.';

-- ── 4. Schwellenwert außer Kraft setzen ───────────────────────────────
CREATE OR REPLACE FUNCTION retire_threshold(p_id INTEGER)
RETURNS SETOF sensor_thresholds
LANGUAGE plpgsql
AS $$
BEGIN
    -- Kein echtes Löschen: Die Zeile bleibt als historischer Beleg erhalten und
    -- erhält lediglich eine Obergrenze. Sonst wäre nicht mehr feststellbar, welche
    -- Grenze zu einem vergangenen Zeitpunkt galt.
    RETURN QUERY
    UPDATE sensor_thresholds
       SET valid_during = tstzrange(lower(valid_during), now())
     WHERE id = p_id
       AND valid_during @> now()
    RETURNING *;
END;
$$;

COMMENT ON FUNCTION retire_threshold(INTEGER) IS
    'Schließt den Gültigkeitszeitraum eines aktiven Schwellenwerts. Liefert keine '
    'Zeile, wenn er nicht existiert oder bereits abgeschlossen ist.';

-- ── 5. Reinraum entfernen ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_cleanroom(p_id INTEGER)
RETURNS SETOF cleanrooms
LANGUAGE plpgsql
AS $$
DECLARE
    _jetzt timestamptz := now();
BEGIN
    -- Laufende Zuordnungen abschließen, bevor sie verschwinden: Die Historie der
    -- Messdaten bleibt damit auswertbar, auch wenn der Raum nicht mehr existiert.
    UPDATE sensor_assignments
       SET valid_during = tstzrange(lower(valid_during), _jetzt)
     WHERE cleanroom_id = p_id
       AND valid_during @> _jetzt;

    DELETE FROM sensor_assignments WHERE cleanroom_id = p_id;

    -- Verletzungs-Ereignisse behalten ihre Historie und verlieren nur den Raumbezug.
    UPDATE threshold_violations SET cleanroom_id = NULL WHERE cleanroom_id = p_id;

    RETURN QUERY
    DELETE FROM cleanrooms WHERE id = p_id RETURNING *;
END;
$$;

COMMENT ON FUNCTION delete_cleanroom(INTEGER) IS
    'Entfernt einen Reinraum und löst seine Verknüpfungen. Liefert keine Zeile, '
    'wenn er nicht existiert.';

-- ── 6. Sensor entfernen ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_sensor(p_sensor_uuid UUID)
RETURNS SETOF sensor_registry
LANGUAGE plpgsql
AS $$
BEGIN
    -- Reihenfolge durch die Fremdschlüssel vorgegeben.
    DELETE FROM threshold_violations WHERE sensor_uuid = p_sensor_uuid;
    DELETE FROM sensor_thresholds    WHERE sensor_uuid = p_sensor_uuid;
    DELETE FROM sensor_assignments   WHERE sensor_uuid = p_sensor_uuid;

    -- Messdaten bleiben bewusst erhalten: Sie tragen keinen Fremdschlüssel und
    -- gehören zur Historie des Reinraums, nicht zum Gerät.
    RETURN QUERY
    DELETE FROM sensor_registry WHERE sensor_uuid = p_sensor_uuid RETURNING *;
END;
$$;

COMMENT ON FUNCTION delete_sensor(UUID) IS
    'Entfernt einen Sensor samt Zuordnungen, Schwellenwerten und Verletzungen. '
    'Messdaten bleiben erhalten. Liefert keine Zeile, wenn er nicht existiert.';

-- Down Migration

DROP FUNCTION IF EXISTS delete_sensor(UUID);
DROP FUNCTION IF EXISTS delete_cleanroom(INTEGER);
DROP FUNCTION IF EXISTS retire_threshold(INTEGER);
DROP FUNCTION IF EXISTS set_threshold(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS assign_sensor(UUID, INTEGER);

ALTER TABLE sensor_thresholds DROP CONSTRAINT IF EXISTS chk_threshold_grenzen_sortiert;
ALTER TABLE sensor_thresholds DROP CONSTRAINT IF EXISTS chk_threshold_hat_grenze;
