const { Router } = require('express');
const pool = require('../db');

const router = Router();

// GET /api/thresholds?sensor_uuid=xxx
router.get('/', async (req, res) => {
  const { sensor_uuid } = req.query;

  let query = `SELECT id, sensor_uuid, quantity, min_value, max_value, valid_during
               FROM sensor_thresholds WHERE valid_during @> now()`;
  const params = [];

  if (sensor_uuid) {
    query += ' AND sensor_uuid = $1';
    params.push(sensor_uuid);
  }

  query += ' ORDER BY sensor_uuid, quantity';
  const { rows } = await pool.query(query, params);
  res.json(rows);
});

// POST /api/thresholds -- Neuen Schwellenwert setzen (schliesst alten ab)
router.post('/', async (req, res) => {
  const { sensor_uuid, quantity, min_value, max_value } = req.body;
  if (!sensor_uuid || !quantity) {
    return res.status(400).json({ error: 'sensor_uuid und quantity sind erforderlich' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE sensor_thresholds
      SET valid_during = tstzrange(lower(valid_during), now())
      WHERE sensor_uuid = $1 AND quantity = $2 AND valid_during @> now()
    `, [sensor_uuid, quantity]);

    const { rows } = await client.query(`
      INSERT INTO sensor_thresholds (sensor_uuid, quantity, min_value, max_value, valid_during)
      VALUES ($1, $2, $3, $4, tstzrange(now(), 'infinity'))
      RETURNING *
    `, [sensor_uuid, quantity, min_value ?? null, max_value ?? null]);

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /api/thresholds/:id -- Schwellenwert "loeschen" (Soft-Delete)
// Ein Hard-Delete wuerde die Historie zerstoeren. Stattdessen wird der
// Gueltigkeitszeitraum auf jetzt geschlossen: Die Zeile bleibt als
// historischer Eintrag in der DB erhalten (valid_during erhaelt eine
// Obergrenze = Loeschzeitpunkt) und wird nicht mehr als aktiv ausgewertet.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const { rows, rowCount } = await pool.query(`
    UPDATE sensor_thresholds
    SET valid_during = tstzrange(lower(valid_during), now())
    WHERE id = $1 AND valid_during @> now()
    RETURNING id, sensor_uuid, quantity, min_value, max_value, valid_during
  `, [id]);

  if (rowCount === 0) {
    return res.status(404).json({ error: 'Aktiver Schwellenwert nicht gefunden' });
  }
  res.json({ deleted: true, threshold: rows[0] });
});

module.exports = router;
