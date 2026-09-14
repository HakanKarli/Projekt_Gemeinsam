-- =============================================================
-- OHB Seed-Daten – nur Reinraeume
-- Sensoren registrieren sich automatisch per MQTT (sensor_registry).
-- =============================================================

INSERT INTO cleanrooms (name) VALUES ('Reinraum 221') ON CONFLICT DO NOTHING;
INSERT INTO cleanrooms (name) VALUES ('Infoboard')    ON CONFLICT DO NOTHING;

SELECT 'cleanrooms' AS tabelle, COUNT(*) FROM cleanrooms;
