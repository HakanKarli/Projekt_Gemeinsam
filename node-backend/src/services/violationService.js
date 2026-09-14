/**
 * Schwellenwert-Verletzungen.
 *
 * Ein Datensatz ist ein EREIGNIS, kein Einzelmesswert: Eine zehnminütige
 * Überschreitung bei 2-Sekunden-Takt erzeugt 300 Messwerte, aber genau einen
 * Eintrag mit Extremwert, Dauer und Anzahl der betroffenen Punkte.
 */

const db = require('../lib/db');
const { NotFoundError } = require('../lib/errors');

const SELECT_COLUMNS = `
  v.id, v.sensor_uuid, r.name AS sensor_name,
  v.cleanroom_id, c.name AS cleanroom_name,
  v.quantity, v.violation_type,
  v.threshold_min, v.threshold_max,
  lower(v.valid_during) AS started_at,
  CASE WHEN upper(v.valid_during) = 'infinity' THEN NULL
       ELSE upper(v.valid_during) END AS ended_at,
  CASE WHEN upper(v.valid_during) = 'infinity' THEN NULL
       ELSE EXTRACT(EPOCH FROM (upper(v.valid_during) - lower(v.valid_during))) END AS duration_sec,
  v.first_value, v.last_value, v.peak_value,
  v.data_points, v.acknowledged
`;

/**
 * Baut die WHERE-Bedingungen. Alle Werte werden als Parameter gebunden — auch das
 * Limit, das zuvor per Zeichenkette in die Abfrage interpoliert wurde.
 *
 * @param {object} query bereits validierte Filter
 */
function buildFilter(query) {
  const conditions = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };

  if (query.cleanroom_id) add('v.cleanroom_id = ?', query.cleanroom_id);
  if (query.sensor_uuid) add('v.sensor_uuid = ?', query.sensor_uuid);
  if (query.quantity) add('v.quantity = ?', query.quantity);

  if (query.from && query.to) {
    params.push(query.from, query.to);
    conditions.push(`v.valid_during && tstzrange($${params.length - 1}::timestamptz, $${params.length}::timestamptz)`);
  } else if (query.from) {
    add('upper(v.valid_during) >= ?::timestamptz', query.from);
  } else if (query.to) {
    add('lower(v.valid_during) <= ?::timestamptz', query.to);
  }

  if (query.active === 'true') conditions.push(`upper(v.valid_during) = 'infinity'`);
  else if (query.active === 'false') conditions.push(`upper(v.valid_during) < 'infinity'`);

  if (query.acknowledged !== undefined) add('v.acknowledged = ?', query.acknowledged === 'true');

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

async function list(query) {
  const { where, params } = buildFilter(query);
  params.push(query.limit);

  const { rows } = await db.query(
    `SELECT ${SELECT_COLUMNS}
     FROM threshold_violations v
     LEFT JOIN sensor_registry r ON r.sensor_uuid = v.sensor_uuid
     LEFT JOIN cleanrooms c ON c.id = v.cleanroom_id
     ${where}
     ORDER BY lower(v.valid_during) DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** Aggregat je Raum, Messgröße und Verletzungsart. */
async function summary({ from, to }) {
  const params = [];
  let where = '';

  if (from && to) {
    params.push(from, to);
    where = `WHERE v.valid_during && tstzrange($1::timestamptz, $2::timestamptz)`;
  }
  params.push(to ?? null);

  const { rows } = await db.query(
    `SELECT v.cleanroom_id, c.name AS cleanroom_name,
            v.quantity, v.violation_type,
            count(*)::int              AS event_count,
            sum(v.data_points)::int    AS total_data_points,
            sum(EXTRACT(EPOCH FROM (
              LEAST(upper(v.valid_during), COALESCE($${params.length}::timestamptz, now()))
              - lower(v.valid_during)
            )))                        AS total_duration_sec,
            min(lower(v.valid_during)) AS first_event,
            max(CASE WHEN upper(v.valid_during) = 'infinity' THEN now()
                     ELSE upper(v.valid_during) END) AS last_event
     FROM threshold_violations v
     LEFT JOIN cleanrooms c ON c.id = v.cleanroom_id
     ${where}
     GROUP BY v.cleanroom_id, c.name, v.quantity, v.violation_type
     ORDER BY event_count DESC`,
    params,
  );
  return rows;
}

async function acknowledge(id) {
  const { rows, rowCount } = await db.query(
    `UPDATE threshold_violations SET acknowledged = TRUE
     WHERE id = $1
     RETURNING id, sensor_uuid, quantity, violation_type, acknowledged,
               lower(valid_during) AS started_at,
               CASE WHEN upper(valid_during) = 'infinity' THEN NULL
                    ELSE upper(valid_during) END AS ended_at`,
    [id],
  );

  if (rowCount === 0) throw new NotFoundError('Verletzung');
  return rows[0];
}

module.exports = { list, summary, acknowledge };
