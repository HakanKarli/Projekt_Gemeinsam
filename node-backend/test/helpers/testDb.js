/**
 * Test-Datenbank auf Basis von Testcontainers.
 *
 * Bewusst eine ECHTE TimescaleDB statt eines Mocks: Der Prüfgegenstand ist die
 * `tstzrange`-Semantik und ein PL/pgSQL-Trigger. Beides lässt sich nicht nachbilden —
 * ein Mock würde genau die Logik wegabstrahieren, die getestet werden soll.
 *
 * Das Schema entsteht über dieselben Migrationen wie im Betrieb. Damit prüft jeder
 * Testlauf nebenbei, dass sich das Schema aus dem Nichts reproduzieren lässt.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../../src/lib/migrate.js';

const IMAGE = 'timescale/timescaledb:latest-pg17';

/**
 * Startet Container, migriert das Schema und liefert eine offene Verbindung.
 * @returns {Promise<{ client: pg.Client, url: string, stop: () => Promise<void> }>}
 */
export async function startTestDb() {
  const container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('ohb_test')
    .withUsername('postgres')
    .withPassword('test')
    .start();

  const url = container.getConnectionUri();
  await runMigrations({ databaseUrl: url });

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  return {
    client,
    url,
    stop: async () => {
      await client.end().catch(() => {});
      await container.stop();
    },
  };
}

/**
 * Leert alle fachlichen Tabellen zwischen zwei Testfällen — schneller als ein
 * neuer Container und ausreichend, weil das Schema unverändert bleibt.
 * @param {pg.Client} client
 */
export async function resetData(client) {
  await client.query(`
    TRUNCATE threshold_violations, sensor_data, sensor_thresholds,
             sensor_assignments, ingest_rejects RESTART IDENTITY CASCADE;
    DELETE FROM sensor_registry;
    DELETE FROM cleanrooms;
  `);
}
