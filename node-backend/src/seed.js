/**
 * seed.js – Seed-Daten fuer OHB Sensor Dashboard
 * Fuegt nur Reinraeume ein. Sensoren registrieren sich automatisch
 * beim ersten MQTT-Message in sensor_registry.
 * Aufruf: node seed.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.POSTGRES_HOST || '127.0.0.1',
  port:     parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB   || 'ohb_sensordata',
  user:     process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '',
  connectionTimeoutMillis: 5000,
});

async function seed() {
  const client = await pool.connect();
  try {
    console.log('[SEED] Verbunden mit PostgreSQL');

    await client.query(`INSERT INTO cleanrooms (name) VALUES ('Reinraum 221') ON CONFLICT DO NOTHING`);
    await client.query(`INSERT INTO cleanrooms (name) VALUES ('Infoboard')    ON CONFLICT DO NOTHING`);
    console.log('[SEED] cleanrooms OK');

    const { rows } = await client.query(`
      SELECT 'cleanrooms' AS t, COUNT(*) FROM cleanrooms
      UNION ALL SELECT 'sensor_registry', COUNT(*) FROM sensor_registry
      UNION ALL SELECT 'sensor_assignments', COUNT(*) FROM sensor_assignments
    `);
    console.log('\n[SEED] Ergebnis:');
    rows.forEach(r => console.log(`  ${r.t}: ${r.count}`));
    console.log('\n[SEED] Fertig!');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => {
  console.error('[SEED] FEHLER:', e.message);
  process.exit(1);
});
