const { Router } = require('express');
const pool = require('../db');

const router = Router();

// GET /api/cleanrooms -- Alle Reinraeume
router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cleanrooms ORDER BY id');
  res.json(rows);
});

// POST /api/cleanrooms -- Neuen Reinraum anlegen
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name ist erforderlich' });

  try {
    const { rows } = await pool.query(
      'INSERT INTO cleanrooms (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Reinraum existiert bereits' });
    }
    throw err;
  }
});

// DELETE /api/cleanrooms/:id
router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  try {
    // Offene Zuweisungen schliessen
    await pool.query(
      `UPDATE sensor_assignments
       SET valid_during = tstzrange(lower(valid_during), now())
       WHERE cleanroom_id = $1 AND upper(valid_during) = 'infinity'`,
      [id]
    );
    // Zuweisungen loeschen
    await pool.query(
      'DELETE FROM sensor_assignments WHERE cleanroom_id = $1',
      [id]
    );
    // Violations loesen
    await pool.query(
      'UPDATE threshold_violations SET cleanroom_id = NULL WHERE cleanroom_id = $1',
      [id]
    );
    const { rowCount } = await pool.query('DELETE FROM cleanrooms WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[CLEANROOMS] DELETE Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
