const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.POSTGRES_HOST || 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB   || 'ohb_sensordata',
  user:     process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '',
});

pool.on('error', (err) => {
  console.error('[DB] Unerwarteter Fehler:', err.message);
});

/**
 * Idempotente Schema-Anpassungen, die sowohl auf frischen (db-init) als auch
 * auf bereits bestehenden Datenbanken laufen. Wird beim Start von Server und
 * Bridge aufgerufen, damit neue Spalten garantiert vorhanden sind.
 */
async function ensureSchema() {
  await pool.query(
    `ALTER TABLE sensor_registry
       ADD COLUMN IF NOT EXISTS event_driven SMALLINT NOT NULL DEFAULT 0`
  );
}

pool.ensureSchema = ensureSchema;

module.exports = pool;
