/**
 * migrate.js
 * Fuehrt alle SQL-Migrationen im Ordner migrations/ aus.
 * Starten:  node src/migrate.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fs = require('fs');
const pool = require('./db');

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.log('[MIGRATE] Kein migrations/ Ordner gefunden.');
    process.exit(0);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[MIGRATE] Keine .sql Dateien gefunden.');
    process.exit(0);
  }

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`[MIGRATE] Fuehre aus: ${file} ...`);
    try {
      await pool.query(sql);
      console.log(`[MIGRATE] ✓ ${file} erfolgreich.`);
    } catch (err) {
      console.error(`[MIGRATE] ✗ ${file} fehlgeschlagen:`, err.message);
      process.exit(1);
    }
  }

  console.log('[MIGRATE] Alle Migrationen abgeschlossen.');
  await pool.end();
  process.exit(0);
}

runMigrations();
