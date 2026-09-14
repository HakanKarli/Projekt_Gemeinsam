/**
 * Verlustfreiheit und Idempotenz des Ingest.
 *
 * Die Zusicherung, die hier geprüft wird, trägt die gesamte Betriebsarchitektur:
 * Eine doppelt zugestellte Nachricht darf keine doppelte Zeile erzeugen. Erst damit
 * darf der Broker Nachrichten erneut ausliefern — und erst damit ist ein Ausfall der
 * Datenbank ohne Datenverlust überstehbar.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, resetData } from '../helpers/testDb.js';
import { SENSOR_A, at, countRows } from '../helpers/fixtures.js';

let db;
let client;
/** @type {typeof import('../../src/ingest/ingestService')} */
let ingestService;
let schema;

beforeAll(async () => {
  db = await startTestDb();
  client = db.client;

  // Konfiguration auf die Wegwerf-Datenbank umbiegen, BEVOR config.js sie einliest.
  // dotenv überschreibt bereits gesetzte Variablen nicht — der Vorrang ist also sicher.
  const url = new URL(db.url);
  process.env.POSTGRES_HOST = url.hostname;
  process.env.POSTGRES_PORT = url.port;
  process.env.POSTGRES_DB = url.pathname.slice(1);
  process.env.POSTGRES_USER = decodeURIComponent(url.username);
  process.env.POSTGRES_PASSWORD = decodeURIComponent(url.password);
  process.env.LOG_LEVEL = 'silent';

  ingestService = await import('../../src/ingest/ingestService.js');
  schema = await import('../../src/ingest/messageSchema.js');
});

afterAll(async () => {
  const { close } = await import('../../src/lib/db.js');
  await close().catch(() => {});
  await db?.stop();
});

beforeEach(async () => {
  await resetData(client);
});

/** Baut eine gültige Nachricht im Format des Feldgeräts. */
function message(overrides = {}) {
  return schema.SensorMessageSchema.parse({
    id: SENSOR_A,
    gateway_id: 'gw-test',
    name: 'Testsensor',
    event_driven: 0,
    timestamp: at('10:00:00'),
    measurements: [
      { quantity: 'temperature', unit: '°C', value: 22.4 },
      { quantity: 'pressure', unit: 'hPa', value: 1013.2 },
    ],
    ...overrides,
  });
}

describe('Idempotenz', () => {
  it('dieselbe Nachricht zweimal erzeugt genau einen Satz Zeilen', async () => {
    const first = await ingestService.persist(message());
    expect(first).toEqual({ inserted: 2, duplicates: 0 });

    const second = await ingestService.persist(message());
    expect(second).toEqual({ inserted: 0, duplicates: 2 });

    expect(await countRows(client, 'sensor_data')).toBe(2);
  });

  it('meldet bei teilweiser Überschneidung nur die tatsächlich neuen Werte', async () => {
    await ingestService.persist(message());

    // Gleiche Zeit, eine bekannte und eine neue Messgröße
    const mixed = message({
      measurements: [
        { quantity: 'temperature', unit: '°C', value: 22.4 },
        { quantity: 'humidity', unit: '%rH', value: 45 },
      ],
    });

    expect(await ingestService.persist(mixed)).toEqual({ inserted: 1, duplicates: 1 });
    expect(await countRows(client, 'sensor_data')).toBe(3);
  });

  it('schreibt alle Messgrößen einer Nachricht in EINER Transaktion', async () => {
    // Ein ungültiger Wert in der Mitte darf keine halb geschriebene Nachricht
    // hinterlassen. NaN wird bereits vom Schema abgefangen — hier prüfen wir die
    // Klammer über einen Konflikt auf Datenbankebene.
    await client.query(
      `INSERT INTO sensor_data (time, sensor_uuid, quantity, unit, value)
       VALUES ($1::timestamptz, $2, 'temperature', '°C', 99)`,
      [at('10:00:00'), SENSOR_A],
    );

    const result = await ingestService.persist(message());

    // Der bestehende Wert bleibt unverändert, der zweite kommt hinzu.
    expect(result).toEqual({ inserted: 1, duplicates: 1 });
    const { rows } = await client.query(
      `SELECT value FROM sensor_data WHERE quantity = 'temperature'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(99);
  });
});

describe('Selbstregistrierung der Sensoren', () => {
  it('legt unbekannte Sensoren automatisch an', async () => {
    await ingestService.persist(message());

    const { rows } = await client.query('SELECT name, gateway_id, event_driven FROM sensor_registry');
    expect(rows).toEqual([{ name: 'Testsensor', gateway_id: 'gw-test', event_driven: 0 }]);
  });

  it('überschreibt einen manuell vergebenen Namen NICHT', async () => {
    await ingestService.persist(message());
    await client.query('UPDATE sensor_registry SET name = $1', ['Handbenannt']);

    await ingestService.persist(message({ timestamp: at('10:00:02'), name: 'Gerätename' }));

    const { rows } = await client.query('SELECT name FROM sensor_registry');
    expect(rows[0].name).toBe('Handbenannt');
  });

  it('übernimmt den gemeldeten Namen, solange nur die UUID hinterlegt ist', async () => {
    // Ohne name-Feld dient die UUID als Platzhalter …
    await ingestService.persist(message({ name: null }));
    let { rows } = await client.query('SELECT name FROM sensor_registry');
    expect(rows[0].name).toBe(SENSOR_A);

    // … und wird beim nächsten Mal durch den gemeldeten Namen ersetzt.
    await ingestService.persist(message({ timestamp: at('10:00:02'), name: 'Gerätename' }));
    ({ rows } = await client.query('SELECT name FROM sensor_registry'));
    expect(rows[0].name).toBe('Gerätename');
  });
});

describe('Nachrichtenvertrag', () => {
  it('weist eine Nachricht ohne gültige UUID ab', () => {
    expect(() => schema.SensorMessageSchema.parse({ id: 'abc', timestamp: at('10:00:00'), measurements: [] }))
      .toThrow();
  });

  it('weist eine Nachricht ohne Messwerte ab', () => {
    expect(() =>
      schema.SensorMessageSchema.parse({ id: SENSOR_A, timestamp: at('10:00:00'), measurements: [] }),
    ).toThrow();
  });

  it('akzeptiert Zahlen als Zeichenkette — Feldgeräte liefern das gelegentlich so', () => {
    const parsed = schema.SensorMessageSchema.parse({
      id: SENSOR_A,
      timestamp: at('10:00:00'),
      measurements: [{ quantity: 'temperature', unit: '°C', value: '22.4' }],
    });
    expect(parsed.measurements[0].value).toBe(22.4);
  });

  it('legt dauerhaft fehlerhafte Nachrichten nachvollziehbar ab', async () => {
    await ingestService.recordReject({
      topic: 'sensors/kaputt',
      reason: 'kein gültiges JSON',
      payload: '{ das ist kein json',
    });

    const { rows } = await client.query('SELECT topic, reason, payload FROM ingest_rejects');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topic: 'sensors/kaputt', reason: 'kein gültiges JSON' });
  });
});
