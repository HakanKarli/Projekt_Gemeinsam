/**
 * Datenbeschaffung für den Audit-Report.
 *
 * Bewusst getrennt von der Darstellung (`report/pdfRenderer.js`): Die Auswahl der
 * Daten ist die fachlich heikle Hälfte und muss unabhängig vom PDF prüfbar bleiben.
 *
 * Kern der Audit-Tauglichkeit: Alle Abfragen greifen auf die HISTORISCHEN Zuordnungen
 * und Grenzwerte zu, nicht auf den heutigen Stand. Ein Sensor, der inzwischen in einem
 * anderen Raum hängt, erscheint für den Zeitraum, in dem er zu diesem Raum gehörte —
 * mit dem Grenzwert, der damals galt.
 */

const db = require('../lib/db');
const { NotFoundError, ValidationError } = require('../lib/errors');

/**
 * @param {{ cleanroom_id: number, from: string, to: string }} params
 */
async function collect({ cleanroom_id, from, to }) {
  const { rows: roomRows } = await db.query('SELECT id, name FROM cleanrooms WHERE id = $1', [
    cleanroom_id,
  ]);
  if (roomRows.length === 0) throw new NotFoundError('Reinraum');
  const room = roomRows[0];

  // Überschneidung (&&), nicht Enthaltensein: Eine Zuordnung, die vor dem Zeitraum
  // begann und in ihn hineinreicht, ist relevant.
  const { rows: assignments } = await db.query(
    `SELECT sa.sensor_uuid, r.name AS sensor_name, r.gateway_id,
            lower(sa.valid_during) AS assigned_from,
            CASE WHEN upper(sa.valid_during) = 'infinity' THEN NULL
                 ELSE upper(sa.valid_during) END AS assigned_to
     FROM sensor_assignments sa
     JOIN sensor_registry r ON r.sensor_uuid = sa.sensor_uuid
     WHERE sa.cleanroom_id = $1
       AND sa.valid_during && tstzrange($2::timestamptz, $3::timestamptz)
     ORDER BY r.name, lower(sa.valid_during)`,
    [cleanroom_id, from, to],
  );

  const sensorUuids = [...new Set(assignments.map((a) => a.sensor_uuid))];
  if (sensorUuids.length === 0) {
    throw new ValidationError(
      'Im gewählten Zeitraum war diesem Reinraum kein Sensor zugeordnet.',
    );
  }

  const { rows: data } = await db.query(
    `SELECT sensor_uuid, quantity, unit, time, value
     FROM sensor_data
     WHERE sensor_uuid = ANY($1) AND time >= $2 AND time <= $3
     ORDER BY sensor_uuid, quantity, time`,
    [sensorUuids, from, to],
  );

  const { rows: thresholds } = await db.query(
    `SELECT sensor_uuid, quantity, min_value, max_value,
            lower(valid_during) AS valid_from,
            CASE WHEN upper(valid_during) = 'infinity' THEN NULL
                 ELSE upper(valid_during) END AS valid_to
     FROM sensor_thresholds
     WHERE sensor_uuid = ANY($1)
       AND valid_during && tstzrange($2::timestamptz, $3::timestamptz)
     ORDER BY sensor_uuid, quantity, lower(valid_during)`,
    [sensorUuids, from, to],
  );

  const { rows: violations } = await db.query(
    `SELECT id, sensor_uuid, quantity, violation_type,
            threshold_min, threshold_max,
            lower(valid_during) AS started_at,
            CASE WHEN upper(valid_during) = 'infinity' THEN NULL
                 ELSE upper(valid_during) END AS ended_at,
            CASE WHEN upper(valid_during) = 'infinity' THEN NULL
                 ELSE EXTRACT(EPOCH FROM (upper(valid_during) - lower(valid_during))) END AS duration_sec,
            first_value, last_value, peak_value, data_points
     FROM threshold_violations
     WHERE sensor_uuid = ANY($1)
       AND cleanroom_id = $2
       AND valid_during && tstzrange($3::timestamptz, $4::timestamptz)
     ORDER BY sensor_uuid, quantity, lower(valid_during)`,
    [sensorUuids, cleanroom_id, from, to],
  );

  return {
    room,
    period: { from, to },
    assignments,
    sensorUuids,
    measurements: groupBySensorAndQuantity(data),
    thresholds: groupBySensorAndQuantity(thresholds),
    violations: groupBySensorAndQuantity(violations),
    totals: {
      dataPoints: data.length,
      violationEvents: violations.length,
      violationSeconds: violations.reduce((sum, v) => sum + (Number(v.duration_sec) || 0), 0),
    },
  };
}

/**
 * @template {{ sensor_uuid: string, quantity: string }} T
 * @param {T[]} rows
 * @returns {Record<string, Record<string, T[]>>}
 */
function groupBySensorAndQuantity(rows) {
  /** @type {Record<string, Record<string, any[]>>} */
  const grouped = {};
  for (const row of rows) {
    (grouped[row.sensor_uuid] ??= {})[row.quantity] ??= [];
    grouped[row.sensor_uuid][row.quantity].push(row);
  }
  return grouped;
}

module.exports = { collect };
