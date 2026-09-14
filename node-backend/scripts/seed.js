#!/usr/bin/env node
/**
 * Grunddaten anlegen.
 *
 * Nur Reinräume — Sensoren registrieren sich beim ersten MQTT-Kontakt selbst.
 * Nutzt denselben Pool wie die Anwendung; die frühere Fassung baute eine zweite,
 * getrennt konfigurierte Verbindung auf.
 */

const db = require('../src/lib/db');
const logger = require('../src/lib/logger');

const CLEANROOMS = ['Reinraum 221', 'Infoboard'];

async function main() {
  for (const name of CLEANROOMS) {
    await db.query('INSERT INTO cleanrooms (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
  }

  const { rows } = await db.query(`
    SELECT 'cleanrooms' AS tabelle, count(*)::int AS anzahl FROM cleanrooms
    UNION ALL SELECT 'sensor_registry',    count(*)::int FROM sensor_registry
    UNION ALL SELECT 'sensor_assignments', count(*)::int FROM sensor_assignments
  `);

  logger.info({ bestand: Object.fromEntries(rows.map((r) => [r.tabelle, r.anzahl])) }, 'Grunddaten aktuell');
}

main()
  .then(() => db.close())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'Anlegen der Grunddaten fehlgeschlagen');
    process.exit(1);
  });
