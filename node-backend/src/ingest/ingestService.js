/**
 * Persistenz eingehender Messnachrichten.
 *
 * Zwei Eigenschaften machen den Unterschied zur Vorgängerfassung:
 *
 *  1. EINE Transaktion je Nachricht. Vorher lief pro Messgröße ein eigenes INSERT
 *     ohne Klammer — eine Nachricht mit drei Werten konnte halb ankommen.
 *  2. EIN Statement für alle Messwerte, per unnest. Statt N Rundreisen zur Datenbank
 *     genau eine, und `ON CONFLICT DO NOTHING` macht die Wiederholung folgenlos.
 *
 * Punkt 2 ist die Voraussetzung für QoS 1: Erst wenn eine doppelte Zustellung keine
 * doppelte Zeile erzeugt, darf der Broker Nachrichten erneut ausliefern.
 */

const db = require('../lib/db');
const logger = require('../lib/logger');

/**
 * Registriert den Sensor bzw. hält Metadaten aktuell.
 *
 * Die WHERE-Klausel verhindert Schreibvorgänge, wenn sich nichts geändert hat — bei
 * mehreren Nachrichten pro Sekunde würde die Tabelle sonst unnötig wachsen.
 * Ein manuell vergebener Name wird nie von einer MQTT-Nachricht überschrieben:
 * Übernommen wird der gemeldete Name nur, solange der gespeicherte Name noch der
 * UUID-Platzhalter ist.
 */
const UPSERT_SENSOR_SQL = `
  INSERT INTO sensor_registry (sensor_uuid, name, gateway_id, event_driven)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (sensor_uuid) DO UPDATE
    SET name = CASE
                 WHEN sensor_registry.name = sensor_registry.sensor_uuid::text
                 THEN EXCLUDED.name
                 ELSE sensor_registry.name
               END,
        gateway_id   = EXCLUDED.gateway_id,
        event_driven = EXCLUDED.event_driven
  WHERE sensor_registry.name         = sensor_registry.sensor_uuid::text
     OR sensor_registry.gateway_id   IS DISTINCT FROM EXCLUDED.gateway_id
     OR sensor_registry.event_driven IS DISTINCT FROM EXCLUDED.event_driven
`;

const INSERT_MEASUREMENTS_SQL = `
  INSERT INTO sensor_data (time, sensor_uuid, quantity, unit, value)
  SELECT $1::timestamptz, $2::uuid, q, u, v
  FROM unnest($3::text[], $4::text[], $5::double precision[]) AS m(q, u, v)
  ON CONFLICT DO NOTHING
`;

/**
 * Schreibt eine validierte Nachricht. Wirft bei jedem Datenbankfehler — der Aufrufer
 * entscheidet dann, ob bestätigt wird.
 *
 * @param {import('./messageSchema').SensorMessage} message
 * @returns {Promise<{ inserted: number, duplicates: number }>}
 */
async function persist(message) {
  const sensorUuid = message.id;
  // Ohne gemeldeten Namen dient die UUID als Platzhalter — so erkennt der Upsert,
  // dass noch kein manuell vergebener Name existiert.
  const name = message.name?.trim() || sensorUuid;

  const quantities = message.measurements.map((m) => m.quantity);
  const units = message.measurements.map((m) => m.unit ?? '');
  const values = message.measurements.map((m) => m.value);

  return db.withTransaction(async (client) => {
    await client.query(UPSERT_SENSOR_SQL, [
      sensorUuid,
      name,
      message.gateway_id ?? null,
      message.event_driven,
    ]);

    const result = await client.query(INSERT_MEASUREMENTS_SQL, [
      message.timestamp,
      sensorUuid,
      quantities,
      units,
      values,
    ]);

    const inserted = result.rowCount ?? 0;
    return { inserted, duplicates: message.measurements.length - inserted };
  });
}

/**
 * Legt eine dauerhaft fehlerhafte Nachricht ab, statt sie spurlos zu verwerfen.
 * In einem Auditsystem muss nachweisbar sein, was nicht verarbeitet wurde.
 *
 * @param {{ topic: string, reason: string, payload: string }} reject
 */
async function recordReject({ topic, reason, payload }) {
  try {
    await db.query(
      `INSERT INTO ingest_rejects (topic, reason, payload) VALUES ($1, $2, $3)`,
      [topic, reason, payload.slice(0, 8_000)],
    );
  } catch (err) {
    // Schlägt sogar das fehl, bleibt nur das Log — die Nachricht selbst ist ohnehin
    // nicht verarbeitbar.
    logger.error({ err, topic, reason }, 'Verworfene Nachricht konnte nicht abgelegt werden');
  }
}

module.exports = { persist, recordReject };
