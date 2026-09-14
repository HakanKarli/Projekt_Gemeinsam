-- =============================================================
-- Idempotenz der Messdaten.
--
-- Das Fundament der Verlustfreiheit: Erst wenn ein doppelt zugestellter Messwert
-- folgenlos bleibt, darf der Ingest Nachrichten erneut zustellen lassen (QoS 1,
-- Redelivery nach Reconnect). Ohne diesen Index wäre jede Wiederholung ein
-- Datenfehler, und mehrere Ingest-Instanzen wären grundsätzlich unmöglich.
--
-- Der bisherige Lookup-Index wird ERSETZT, nicht ergänzt: Dieselben Spalten in
-- derselben Reihenfolge bedienen die vorhandenen Abfragen weiterhin
-- (ORDER BY time DESC nutzt einen Rückwärts-Scan). Die Idempotenz kostet damit
-- keine zusätzliche Schreiblast.
-- =============================================================

-- Up Migration

-- Bestehende Duplikate entfernen — sonst schlägt der eindeutige Index fehl.
-- Der ctid-Vergleich ist zulässig, weil Zeilen mit identischem `time` zwingend im
-- selben Hypertable-Chunk liegen und ctid dort eindeutig ist.
DELETE FROM sensor_data a
USING sensor_data b
WHERE a.ctid > b.ctid
  AND a.sensor_uuid = b.sensor_uuid
  AND a.quantity    = b.quantity
  AND a.time        = b.time;

DROP INDEX IF EXISTS idx_sensor_data_lookup;

-- Der Partitionierungsschlüssel `time` MUSS Teil eines eindeutigen Index auf einer
-- Hypertable sein — hier ohnehin gegeben.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sensor_data_uniq
    ON sensor_data (sensor_uuid, quantity, time);

-- Down Migration

DROP INDEX IF EXISTS idx_sensor_data_uniq;
CREATE INDEX IF NOT EXISTS idx_sensor_data_lookup
    ON sensor_data (sensor_uuid, quantity, time DESC);
