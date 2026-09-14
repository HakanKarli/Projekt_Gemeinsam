/**
 * Zuordnung von Sensoren zu Reinräumen — zeitraum-versioniert.
 *
 * Die Invariante („alten Zeitraum schließen, neuen öffnen, ohne Lücke und ohne
 * Überschneidung") liegt in der Datenbankfunktion `assign_sensor`, nicht hier.
 *
 * Grund: Sie muss unabhängig davon gelten, wer schreibt. Läge sie in diesem Service,
 * wäre sie nur so verlässlich wie die Disziplin des Aufrufers — ein Importskript
 * oder ein Wartungseingriff über psql könnte eine Lücke hinterlassen, ohne dass es
 * jemand bemerkt. Dieselbe Überlegung steht hinter der Schwellenwert-Prüfung als
 * Trigger.
 *
 * Was hier bleibt: Abfragen ohne Invariante und die Übersetzung „keine Zeile" ->
 * fachlicher Fehler.
 */

const db = require('../lib/db');
const { NotFoundError } = require('../lib/errors');

const ACTIVE_SQL = `
  SELECT sa.id, sa.sensor_uuid, r.name AS sensor_name, r.gateway_id,
         sa.cleanroom_id, c.name AS cleanroom_name, sa.valid_during
  FROM sensor_assignments sa
  JOIN sensor_registry r ON r.sensor_uuid = sa.sensor_uuid
  JOIN cleanrooms c ON c.id = sa.cleanroom_id
  WHERE sa.valid_during @> now()
  ORDER BY r.name
`;

const HISTORY_SQL = `
  SELECT sa.id, sa.sensor_uuid, sa.cleanroom_id, c.name AS cleanroom_name,
         lower(sa.valid_during) AS valid_from,
         CASE WHEN upper(sa.valid_during) = 'infinity' THEN NULL
              ELSE upper(sa.valid_during) END AS valid_to
  FROM sensor_assignments sa
  JOIN cleanrooms c ON c.id = sa.cleanroom_id
  WHERE sa.sensor_uuid = $1
  ORDER BY lower(sa.valid_during) DESC
`;

async function listActive() {
  const { rows } = await db.query(ACTIVE_SQL);
  return rows;
}

async function history(sensorUuid) {
  const { rows } = await db.query(HISTORY_SQL, [sensorUuid]);
  return rows;
}

/**
 * @throws {NotFoundError}   wenn der Sensor unbekannt ist
 * @throws {ValidationError} wenn der Reinraum nicht existiert (Fremdschlüssel)
 * @throws {ConflictError}   bei überlappenden Zeiträumen (EXCLUDE-Bedingung)
 */
async function assign(sensorUuid, cleanroomId) {
  const { rows } = await db.query('SELECT * FROM assign_sensor($1, $2)', [sensorUuid, cleanroomId]);
  if (rows.length === 0) throw new NotFoundError('Sensor');
  return rows[0];
}

module.exports = { listActive, history, assign };
