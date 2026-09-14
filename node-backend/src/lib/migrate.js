/**
 * Programmatischer Zugriff auf node-pg-migrate.
 *
 * Wird von drei Stellen gebraucht: `npm run migrate:up` im Betrieb, dem
 * `migrate`-Container im Compose-Stack und dem Test-Harness, der gegen eine frische
 * Wegwerf-Datenbank migriert. Ein gemeinsamer Einstiegspunkt verhindert, dass diese
 * drei Wege auseinanderlaufen.
 *
 * node-pg-migrate 9 ist ein reines ES-Modul, das Backend ist CommonJS — daher der
 * dynamische Import.
 */

const path = require('node:path');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

/**
 * Baut eine Verbindungs-URL. Passwörter werden kodiert, damit Sonderzeichen die URL
 * nicht zerlegen.
 * @param {{ host: string, port: number, database: string, user: string, password: string }} db
 */
function toDatabaseUrl(db) {
  const user = encodeURIComponent(db.user);
  const password = encodeURIComponent(db.password);
  return `postgres://${user}:${password}@${db.host}:${db.port}/${db.database}`;
}

/**
 * @param {object} options
 * @param {string} options.databaseUrl
 * @param {'up' | 'down'} [options.direction]
 * @param {number} [options.count]     Anzahl Migrationen (down: Standard 1)
 * @param {boolean} [options.verbose]
 * @returns {Promise<{ name: string }[]>} ausgeführte Migrationen
 */
async function runMigrations({ databaseUrl, direction = 'up', count, verbose = false }) {
  const { runner } = await import('node-pg-migrate');

  return runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction,
    count: count ?? (direction === 'down' ? 1 : Infinity),
    migrationsTable: 'pgmigrations',
    verbose,
    // Eine Sperre verhindert, dass zwei gleichzeitig startende Container
    // dieselbe Migration nebeneinander ausführen.
    noLock: false,
  });
}

module.exports = { runMigrations, toDatabaseUrl, MIGRATIONS_DIR };
