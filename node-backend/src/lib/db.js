/**
 * Datenbankzugriff: Verbindungs-Pool und Transaktionsklammer.
 *
 * `withTransaction` ersetzt das BEGIN/COMMIT/ROLLBACK/release-Muster, das zuvor in
 * drei Routen kopiert war — inklusive der Variante, die nach dem ROLLBACK erneut
 * warf und damit den Prozess beendete.
 *
 * Schema-Änderungen laufen ausschließlich über `migrations/` (node-pg-migrate).
 * Das frühere `ensureSchema()` mit ad-hoc ALTER TABLE ist entfallen.
 */

const { Pool } = require('pg');
const config = require('../config');
const logger = require('./logger');
const { fromPgError } = require('./errors');

const pool = new Pool({
  ...config.db,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'ohb-backend',
});

pool.on('error', (err) => {
  // Fehler auf einer im Pool ruhenden Verbindung — pg entfernt sie selbstständig.
  logger.error({ err }, 'Unerwarteter Fehler auf einer Pool-Verbindung');
});

/**
 * Führt eine Abfrage aus und übersetzt fachlich deutbare PostgreSQL-Fehler.
 * @param {string} text
 * @param {unknown[]} [params]
 */
async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    throw fromPgError(err);
  }
}

/**
 * Führt `fn` in einer Transaktion aus. Commit bei Erfolg, Rollback bei jedem Fehler,
 * Verbindung wird in jedem Fall zurückgegeben.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // Ein fehlgeschlagenes ROLLBACK darf den ursprünglichen Fehler nicht verdecken.
    await client.query('ROLLBACK').catch((rollbackErr) => {
      logger.error({ err: rollbackErr }, 'ROLLBACK fehlgeschlagen');
    });
    throw fromPgError(err);
  } finally {
    client.release();
  }
}

/** Leichtgewichtige Bereitschaftsprüfung für /readyz. */
async function ping() {
  await pool.query('SELECT 1');
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, ping, close };
