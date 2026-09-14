/**
 * Messdaten.
 *
 * Die Obergrenze für `limit` steht bereits im Schema; hier wird sie nicht erneut
 * geprüft. Genau dafür gibt es die Validierung an der Systemgrenze — doppelte
 * Prüfungen laufen erfahrungsgemäß irgendwann auseinander.
 */

const db = require('../lib/db');

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ sensor_uuid: string, quantity: string, from?: string, to?: string, limit: number }} query
 * @returns {Promise<Array<{ time: Date, quantity: string, unit: string, value: number }>>}
 */
async function list({ sensor_uuid, quantity, from, to, limit }) {
  const toTime = to ?? new Date().toISOString();
  const fromTime = from ?? new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString();

  // Neueste zuerst holen, damit bei Erreichen des Limits die AKTUELLEN Werte
  // ankommen und nicht die ältesten. Für die Ausgabe wieder aufsteigend.
  const { rows } = await db.query(
    `SELECT time, quantity, unit, value
     FROM sensor_data
     WHERE sensor_uuid = $1 AND quantity = $2
       AND time >= $3 AND time <= $4
     ORDER BY time DESC
     LIMIT $5`,
    [sensor_uuid, quantity, fromTime, toTime, limit],
  );

  return rows.reverse();
}

/** Alle Messgrößen, für die dieser Sensor je Daten geliefert hat. */
async function quantities(sensorUuid) {
  const { rows } = await db.query(
    'SELECT DISTINCT quantity FROM sensor_data WHERE sensor_uuid = $1 ORDER BY quantity',
    [sensorUuid],
  );
  return rows.map((row) => row.quantity);
}

module.exports = { list, quantities };
