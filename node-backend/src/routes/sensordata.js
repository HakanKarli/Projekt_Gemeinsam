const { Router } = require('express');
const pool = require('../db');

const router = Router();

// GET /api/sensordata?sensor_uuid=xxx&quantity=co2&from=...&to=...&limit=500
router.get('/', async (req, res) => {
  const { sensor_uuid, quantity, from, to, limit } = req.query;

  if (!sensor_uuid || !quantity) {
    return res.status(400).json({ error: 'sensor_uuid und quantity sind erforderlich' });
  }

  const maxRows  = Math.min(parseInt(limit) || 500, 5000);
  const fromTime = from || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const toTime   = to   || new Date().toISOString();

  const { rows } = await pool.query(`
    SELECT time, quantity, unit, value
    FROM sensor_data
    WHERE sensor_uuid = $1 AND quantity = $2
      AND time >= $3 AND time <= $4
    ORDER BY time DESC
    LIMIT $5
  `, [sensor_uuid, quantity, fromTime, toTime, maxRows]);

  res.json(rows.reverse());
});

// GET /api/sensordata/metrics?sensor_uuid=xxx
// Gibt alle vorhandenen Quantities fuer einen Sensor zurueck
router.get('/metrics', async (req, res) => {
  const { sensor_uuid } = req.query;
  if (!sensor_uuid) {
    return res.status(400).json({ error: 'sensor_uuid ist erforderlich' });
  }

  const { rows } = await pool.query(
    `SELECT DISTINCT quantity FROM sensor_data WHERE sensor_uuid = $1 ORDER BY quantity`,
    [sensor_uuid]
  );

  res.json(rows.map(r => r.quantity));
});

module.exports = router;
