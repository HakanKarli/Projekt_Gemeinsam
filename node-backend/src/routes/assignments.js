const { Router } = require('express');
const pool = require('../db');

const router = Router();

// GET /api/assignments -- Alle aktiven Zuordnungen
router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT sa.id, sa.sensor_uuid, r.name AS sensor_name, r.gateway_id,
           sa.cleanroom_id, c.name AS cleanroom_name, sa.valid_during
    FROM sensor_assignments sa
    JOIN sensor_registry r ON r.sensor_uuid = sa.sensor_uuid
    JOIN cleanrooms c ON c.id = sa.cleanroom_id
    WHERE sa.valid_during @> now()
    ORDER BY r.name
  `);
  res.json(rows);
});

// GET /api/assignments/history?sensor_uuid=xxx
router.get('/history', async (req, res) => {
  const { sensor_uuid } = req.query;
  if (!sensor_uuid) {
    return res.status(400).json({ error: 'sensor_uuid ist erforderlich' });
  }

  const { rows } = await pool.query(`
    SELECT sa.id, sa.sensor_uuid, sa.cleanroom_id, c.name AS cleanroom_name,
           lower(sa.valid_during) AS valid_from,
           upper(sa.valid_during) AS valid_to
    FROM sensor_assignments sa
    JOIN cleanrooms c ON c.id = sa.cleanroom_id
    WHERE sa.sensor_uuid = $1
    ORDER BY lower(sa.valid_during) DESC
  `, [sensor_uuid]);
  res.json(rows);
});

// POST /api/assignments -- Sensor einem Raum zuordnen
router.post('/', async (req, res) => {
  const { sensor_uuid, cleanroom_id } = req.body;
  if (!sensor_uuid || !cleanroom_id) {
    return res.status(400).json({ error: 'sensor_uuid und cleanroom_id sind erforderlich' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE sensor_assignments
      SET valid_during = tstzrange(lower(valid_during), now())
      WHERE sensor_uuid = $1 AND valid_during @> now()
    `, [sensor_uuid]);

    const { rows } = await client.query(`
      INSERT INTO sensor_assignments (sensor_uuid, cleanroom_id, valid_during)
      VALUES ($1, $2, tstzrange(now(), 'infinity'))
      RETURNING *
    `, [sensor_uuid, cleanroom_id]);

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;
