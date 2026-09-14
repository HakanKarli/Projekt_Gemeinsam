/**
 * Sensor-Register.
 *
 * Sensoren werden nicht angelegt, sondern melden sich selbst — der Ingest trägt sie
 * beim ersten Kontakt ein. Hier lassen sie sich benennen, einsehen und entfernen.
 */

const db = require('../lib/db');
const { NotFoundError } = require('../lib/errors');

const LIST_SQL = `
  SELECT r.sensor_uuid, r.name, r.gateway_id, r.event_driven, r.created_at,
         sa.cleanroom_id, c.name AS cleanroom_name,
         COALESCE(q.quantities, ARRAY[]::text[]) AS quantities
  FROM sensor_registry r
  LEFT JOIN sensor_assignments sa
    ON sa.sensor_uuid = r.sensor_uuid AND sa.valid_during @> now()
  LEFT JOIN cleanrooms c ON c.id = sa.cleanroom_id
  LEFT JOIN (
    SELECT sensor_uuid, array_agg(quantity ORDER BY quantity) AS quantities
    FROM (SELECT DISTINCT sensor_uuid, quantity FROM sensor_data) d
    GROUP BY sensor_uuid
  ) q ON q.sensor_uuid = r.sensor_uuid
  ORDER BY r.created_at
`;

async function list() {
  const { rows } = await db.query(LIST_SQL);
  return rows;
}

async function rename(sensorUuid, name) {
  const { rows, rowCount } = await db.query(
    `UPDATE sensor_registry SET name = $1 WHERE sensor_uuid = $2
     RETURNING sensor_uuid, name, gateway_id, event_driven, created_at`,
    [name, sensorUuid],
  );
  if (rowCount === 0) throw new NotFoundError('Sensor');
  return rows[0];
}

/**
 * Entfernt einen Sensor samt aller abhängigen Datensätze.
 *
 * Die durch die Fremdschlüssel vorgegebene Reihenfolge liegt in `delete_sensor`.
 * Messdaten bleiben bewusst erhalten: Sie tragen keinen Fremdschlüssel und gehören
 * zur Historie des Reinraums, nicht zum Gerät.
 */
async function remove(sensorUuid) {
  const { rows } = await db.query('SELECT * FROM delete_sensor($1)', [sensorUuid]);
  if (rows.length === 0) throw new NotFoundError('Sensor');
  return { deleted: true };
}

module.exports = { list, rename, remove };
