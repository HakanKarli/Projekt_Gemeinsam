#!/usr/bin/env node
/**
 * Migrationen ausführen.
 *
 *   npm run migrate:up            alle ausstehenden anwenden
 *   npm run migrate:down          die zuletzt angewendete zurücknehmen
 *
 * Die Verbindungsdaten stammen aus derselben validierten Konfiguration wie die
 * Anwendung — kein zweiter Satz Umgebungsvariablen, der abweichen kann.
 */

const config = require('../src/config');
const logger = require('../src/lib/logger');
const { runMigrations, toDatabaseUrl } = require('../src/lib/migrate');

async function main() {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';

  logger.info({ direction, database: config.db.database, host: config.db.host }, 'Starte Migration');

  const applied = await runMigrations({
    databaseUrl: toDatabaseUrl(config.db),
    direction,
    verbose: config.logLevel === 'debug' || config.logLevel === 'trace',
  });

  if (applied.length === 0) {
    logger.info('Schema ist aktuell — nichts zu tun');
  } else {
    logger.info({ migrations: applied.map((m) => m.name) }, `${applied.length} Migration(en) ausgeführt`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'Migration fehlgeschlagen');
    process.exit(1);
  });
