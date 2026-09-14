const { Router } = require('express');
const pool = require('../db');

const router = Router();

// GET /api/violations
router.get('/', async (req, res) => {
  try {
    const { cleanroom_id, sensor_uuid, quantity, from, to, active, acknowledged, limit } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (cleanroom_id)  { conditions.push(`v.cleanroom_id = $${idx++}`);  params.push(cleanroom_id); }
    if (sensor_uuid)   { conditions.push(`v.sensor_uuid = $${idx++}`);   params.push(sensor_uuid); }
    if (quantity)      { conditions.push(`v.quantity = $${idx++}`);      params.push(quantity); }
    if (from && to) {
      conditions.push(`v.valid_during && tstzrange($${idx++}::timestamptz, $${idx++}::timestamptz)`);
      params.push(from, to);
    } else if (from) {
      conditions.push(`upper(v.valid_during) >= $${idx++}::timestamptz`);
      params.push(from);
    } else if (to) {
      conditions.push(`lower(v.valid_during) <= $${idx++}::timestamptz`);
      params.push(to);
    }
    if (active === 'true')  conditions.push(`upper(v.valid_during) = 'infinity'`);
    else if (active === 'false') conditions.push(`upper(v.valid_during) < 'infinity'`);
    if (acknowledged !== undefined) {
      conditions.push(`v.acknowledged = $${idx++}`);
      params.push(acknowledged === 'true');
    }

    const maxRows = Math.min(parseInt(limit) || 200, 5000);
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(`
      SELECT v.id, v.sensor_uuid, r.name AS sensor_name,
             v.cleanroom_id, c.name AS cleanroom_name,
             v.quantity, v.violation_type,
             v.threshold_min, v.threshold_max,
             v.valid_during,
             lower(v.valid_during) AS started_at,
             CASE WHEN upper(v.valid_during) = 'infinity' THEN NULL
                  ELSE upper(v.valid_during) END AS ended_at,
             CASE WHEN upper(v.valid_during) = 'infinity' THEN NULL
                  ELSE EXTRACT(EPOCH FROM (upper(v.valid_during) - lower(v.valid_during))) END AS duration_sec,
             v.first_value, v.last_value, v.peak_value,
             v.data_points, v.acknowledged
      FROM threshold_violations v
      LEFT JOIN sensor_registry r ON r.sensor_uuid = v.sensor_uuid
      LEFT JOIN cleanrooms c ON c.id = v.cleanroom_id
      ${where}
      ORDER BY lower(v.valid_during) DESC
      LIMIT ${maxRows}
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('[VIOLATIONS] GET Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/violations/summary
router.get('/summary', async (req, res) => {
  try {
    const { from, to } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (from && to) {
      conditions.push(`v.valid_during && tstzrange($${idx++}::timestamptz, $${idx++}::timestamptz)`);
      params.push(from, to);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(`
      SELECT v.cleanroom_id, c.name AS cleanroom_name,
             v.quantity, v.violation_type,
             COUNT(*) AS event_count,
             SUM(v.data_points) AS total_data_points,
             SUM(EXTRACT(EPOCH FROM (
               LEAST(upper(v.valid_during), COALESCE($${idx}::timestamptz, now()))
               - lower(v.valid_during)
             ))) AS total_duration_sec,
             MIN(lower(v.valid_during)) AS first_event,
             MAX(CASE WHEN upper(v.valid_during) = 'infinity' THEN now()
                      ELSE upper(v.valid_during) END) AS last_event
      FROM threshold_violations v
      LEFT JOIN cleanrooms c ON c.id = v.cleanroom_id
      ${where}
      GROUP BY v.cleanroom_id, c.name, v.quantity, v.violation_type
      ORDER BY event_count DESC
    `, [...params, to || null]);

    res.json(rows);
  } catch (err) {
    console.error('[VIOLATIONS] SUMMARY Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/violations/:id/acknowledge
router.patch('/:id/acknowledge', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      UPDATE threshold_violations SET acknowledged = TRUE WHERE id = $1
      RETURNING *,
        lower(valid_during) AS started_at,
        CASE WHEN upper(valid_during) = 'infinity' THEN NULL
             ELSE upper(valid_during) END AS ended_at
    `, [id]);

    if (rows.length === 0) return res.status(404).json({ error: 'Verletzung nicht gefunden' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[VIOLATIONS] ACK Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
