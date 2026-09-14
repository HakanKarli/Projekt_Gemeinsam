const { Router } = require('express');
const pool = require('../db');

const router = Router();

// GET /api/sensors -- Alle Sensoren aus sensor_registry
// (inkl. aktuellem Raum, event_driven-Flag und den gemessenen Groessen)
router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT r.sensor_uuid, r.name, r.gateway_id, r.event_driven, r.created_at,
           sa.cleanroom_id, c.name AS cleanroom_name,
           COALESCE(q.quantities, ARRAY[]::text[]) AS quantities
    FROM sensor_registry r
    LEFT JOIN sensor_assignments sa ON sa.sensor_uuid = r.sensor_uuid AND sa.valid_during @> now()
    LEFT JOIN cleanrooms c ON c.id = sa.cleanroom_id
    LEFT JOIN (
      SELECT sensor_uuid, array_agg(quantity ORDER BY quantity) AS quantities
      FROM (SELECT DISTINCT sensor_uuid, quantity FROM sensor_data) d
      GROUP BY sensor_uuid
    ) q ON q.sensor_uuid = r.sensor_uuid
    ORDER BY r.created_at
  `);
  res.json(rows);
});

// PATCH /api/sensors/:sensor_uuid -- Sensorname aktualisieren
router.patch('/:sensor_uuid', async (req, res) => {
  const { sensor_uuid } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name ist erforderlich' });

  const { rows, rowCount } = await pool.query(
    `UPDATE sensor_registry SET name = $1 WHERE sensor_uuid = $2 RETURNING *`,
    [name, sensor_uuid]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Sensor nicht gefunden' });
  res.json(rows[0]);
});

// DELETE /api/sensors/:sensor_uuid
router.delete('/:sensor_uuid', async (req, res) => {
  const { sensor_uuid } = req.params;
  try {
    await pool.query('DELETE FROM threshold_violations  WHERE sensor_uuid = $1', [sensor_uuid]);
    await pool.query('DELETE FROM sensor_thresholds     WHERE sensor_uuid = $1', [sensor_uuid]);
    await pool.query('DELETE FROM sensor_assignments    WHERE sensor_uuid = $1', [sensor_uuid]);
    const { rowCount } = await pool.query('DELETE FROM sensor_registry WHERE sensor_uuid = $1', [sensor_uuid]);
    if (rowCount === 0) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[SENSORS] DELETE Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
