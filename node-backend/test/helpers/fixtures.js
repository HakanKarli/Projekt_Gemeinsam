/**
 * Fachliche Hilfsfunktionen für Tests.
 *
 * Die Tests sollen sich wie Fachsprache lesen — `insertMeasurement(30, '10:00:00')`
 * statt eines INSERT-Statements. Das macht die zwölf Fälle des Zustandsautomaten
 * überhaupt erst überprüfbar auf Vollständigkeit.
 */

export const SENSOR_A = 'a1b2c3d4-0001-0001-0001-000000000001';
export const SENSOR_B = 'a1b2c3d4-0001-0001-0001-000000000002';

/** Fester Bezugstag, damit Zeitpunkte in Tests als "10:00:02" lesbar bleiben. */
const BASE_DAY = '2026-01-01T';

/** @param {string} hms z.B. "10:00:02" */
export const at = (hms) => `${BASE_DAY}${hms}Z`;

/**
 * @param {import('pg').Client} client
 */
export async function createSensor(client, uuid = SENSOR_A, name = 'Testsensor') {
  await client.query(
    `INSERT INTO sensor_registry (sensor_uuid, name, gateway_id)
     VALUES ($1, $2, 'gw-test') ON CONFLICT (sensor_uuid) DO NOTHING`,
    [uuid, name],
  );
  return uuid;
}

export async function createCleanroom(client, name = 'Testraum') {
  const { rows } = await client.query(
    `INSERT INTO cleanrooms (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [name],
  );
  return rows[0].id;
}

export async function assignSensor(client, uuid, cleanroomId, from = at('00:00:00')) {
  await client.query(
    `INSERT INTO sensor_assignments (sensor_uuid, cleanroom_id, valid_during)
     VALUES ($1, $2, tstzrange($3::timestamptz, 'infinity'))`,
    [uuid, cleanroomId, from],
  );
}

/**
 * @param {{ min?: number|null, max?: number|null, from?: string }} bounds
 */
export async function setThreshold(client, uuid, quantity, bounds = {}) {
  const { min = null, max = null, from = at('00:00:00') } = bounds;
  await client.query(
    `INSERT INTO sensor_thresholds (sensor_uuid, quantity, min_value, max_value, valid_during)
     VALUES ($1, $2, $3, $4, tstzrange($5::timestamptz, 'infinity'))`,
    [uuid, quantity, min, max, from],
  );
}

/** Schließt den aktuell gültigen Schwellenwert ab — entspricht dem Soft-Delete der API. */
export async function endThreshold(client, uuid, quantity, endAt) {
  await client.query(
    `UPDATE sensor_thresholds
     SET valid_during = tstzrange(lower(valid_during), $3::timestamptz)
     WHERE sensor_uuid = $1 AND quantity = $2 AND upper(valid_during) = 'infinity'`,
    [uuid, quantity, endAt],
  );
}

export async function insertMeasurement(client, uuid, quantity, value, time, unit = '°C') {
  await client.query(
    `INSERT INTO sensor_data (time, sensor_uuid, quantity, unit, value)
     VALUES ($1::timestamptz, $2, $3, $4, $5)`,
    [time, uuid, quantity, unit, value],
  );
}

/** Verletzungs-Ereignisse in chronologischer Reihenfolge. */
export async function violations(client, uuid, quantity) {
  const { rows } = await client.query(
    `SELECT id, violation_type, threshold_min, threshold_max,
            first_value, last_value, peak_value, data_points, acknowledged,
            cleanroom_id,
            lower(valid_during) AS started_at,
            CASE WHEN upper(valid_during) = 'infinity' THEN NULL
                 ELSE upper(valid_during) END AS ended_at
     FROM threshold_violations
     WHERE sensor_uuid = $1 AND quantity = $2
     ORDER BY lower(valid_during), id`,
    [uuid, quantity],
  );
  return rows;
}

export async function countRows(client, table) {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}
