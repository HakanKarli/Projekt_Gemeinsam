/**
 * Reinräume.
 *
 * Die Services kennen kein HTTP. Sie werfen fachliche Fehler; die Zuordnung auf
 * Statuscodes passiert zentral in der Fehler-Middleware.
 */

const db = require('../lib/db');
const { NotFoundError } = require('../lib/errors');

async function list() {
  const { rows } = await db.query('SELECT id, name FROM cleanrooms ORDER BY id');
  return rows;
}

/**
 * @param {string} name
 * @throws {ConflictError} bei bereits vergebenem Namen (UNIQUE-Verletzung)
 */
async function create(name) {
  const { rows } = await db.query(
    'INSERT INTO cleanrooms (name) VALUES ($1) RETURNING id, name',
    [name],
  );
  return rows[0];
}

/**
 * Entfernt einen Reinraum und löst seine Verknüpfungen.
 *
 * Der mehrschrittige Ablauf — laufende Zuordnungen abschließen, Zuordnungen löschen,
 * Verletzungen vom Raum lösen, Raum löschen — liegt in `delete_cleanroom`. Er gehört
 * zur Domäne, nicht zum Transport: Wer ihn unvollständig ausführt, hinterlässt
 * Zuordnungen auf einen Raum, den es nicht mehr gibt.
 */
async function remove(id) {
  const { rows } = await db.query('SELECT * FROM delete_cleanroom($1)', [id]);
  if (rows.length === 0) throw new NotFoundError('Reinraum');
  return { deleted: true };
}

module.exports = { list, create, remove };
