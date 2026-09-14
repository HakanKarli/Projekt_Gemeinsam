/**
 * Schwellenwerte — zeitraum-versioniert wie die Zuordnungen.
 *
 * Die Invariante liegt in den Datenbankfunktionen `set_threshold` und
 * `retire_threshold`; die Plausibilität der Grenzen in den CHECK-Bedingungen der
 * Tabelle. Beides gilt damit auch für Schreibzugriffe, die nicht durch diese
 * Anwendung laufen.
 *
 * Die Zod-Prüfung an der HTTP-Grenze bleibt bestehen — nicht als zweite Zusicherung,
 * sondern für die verständliche Fehlermeldung. Die Zusicherung gibt die Datenbank.
 */

const db = require('../lib/db');
const { NotFoundError } = require('../lib/errors');

async function listActive(sensorUuid) {
  const params = [];
  let sql = `SELECT id, sensor_uuid, quantity, min_value, max_value, valid_during
             FROM sensor_thresholds WHERE valid_during @> now()`;

  if (sensorUuid) {
    params.push(sensorUuid);
    sql += ` AND sensor_uuid = $1`;
  }
  sql += ' ORDER BY sensor_uuid, quantity';

  const { rows } = await db.query(sql, params);
  return rows;
}

/**
 * Setzt einen neuen Grenzwert und schließt den bisherigen ab.
 *
 * @param {{ sensor_uuid: string, quantity: string, min_value?: number|null, max_value?: number|null }} input
 * @throws {NotFoundError}   wenn der Sensor unbekannt ist
 * @throws {ValidationError} wenn die Grenzen die CHECK-Bedingungen verletzen
 */
async function set({ sensor_uuid, quantity, min_value, max_value }) {
  const { rows } = await db.query('SELECT * FROM set_threshold($1, $2, $3, $4)', [
    sensor_uuid,
    quantity,
    min_value ?? null,
    max_value ?? null,
  ]);

  if (rows.length === 0) throw new NotFoundError('Sensor');
  return rows[0];
}

/** Schließt den Gültigkeitszeitraum. Die Zeile bleibt als historischer Beleg erhalten. */
async function softDelete(id) {
  const { rows } = await db.query('SELECT * FROM retire_threshold($1)', [id]);
  if (rows.length === 0) throw new NotFoundError('Aktiver Schwellenwert');
  return { deleted: true, threshold: rows[0] };
}

module.exports = { listActive, set, softDelete };
