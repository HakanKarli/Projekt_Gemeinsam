/**
 * Panel-Manifest für das Dashboard.
 *
 * Ersetzt das bisherige Vorgehen im Frontend: eine Anfrage für die Sensorliste und
 * danach ZWEI weitere je Sensor (Messgrößen + Schwellenwerte). Bei 5 Sensoren waren
 * das 11 Anfragen pro Minute, bei 50 bereits 101 — jede mit eigener Verbindung aus
 * dem Pool.
 *
 * Hier liefert EIN Statement alles: Sensor, Raum, Messgröße, Einheit und den aktuell
 * gültigen Schwellenwert. Ein Kanal ist das Paar (sensor_uuid, quantity).
 */

const db = require('../lib/db');

const PANELS_SQL = `
  WITH channels AS (
    -- Zuletzt bekannte Einheit je Kanal. DISTINCT ON nutzt den vorhandenen
    -- Index (sensor_uuid, quantity, time) und liefert den jüngsten Eintrag.
    SELECT DISTINCT ON (sensor_uuid, quantity)
           sensor_uuid, quantity, unit
    FROM sensor_data
    ORDER BY sensor_uuid, quantity, time DESC
  )
  SELECT ch.sensor_uuid || '/' || ch.quantity AS id,
         ch.sensor_uuid,
         r.name         AS sensor_name,
         ch.quantity,
         ch.unit,
         sa.cleanroom_id,
         c.name         AS cleanroom_name,
         th.min_value,
         th.max_value
  FROM channels ch
  JOIN sensor_registry r ON r.sensor_uuid = ch.sensor_uuid
  JOIN sensor_assignments sa
    ON sa.sensor_uuid = ch.sensor_uuid AND sa.valid_during @> now()
  JOIN cleanrooms c ON c.id = sa.cleanroom_id
  LEFT JOIN sensor_thresholds th
    ON th.sensor_uuid = ch.sensor_uuid
   AND th.quantity    = ch.quantity
   AND th.valid_during @> now()
  WHERE ($1::int IS NULL OR sa.cleanroom_id = $1)
  ORDER BY c.name, r.name, ch.quantity
`;

/**
 * Nur Kanäle zugeordneter Sensoren erscheinen — ein registrierter, aber keinem Raum
 * zugewiesener Sensor bleibt unsichtbar. Das verhindert, dass fremde Teilnehmer im
 * MQTT-Netz das Dashboard fluten.
 *
 * @param {{ cleanroom_id?: number }} [filter]
 */
async function list({ cleanroom_id } = {}) {
  const { rows } = await db.query(PANELS_SQL, [cleanroom_id ?? null]);
  return rows;
}

module.exports = { list };
