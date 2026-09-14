/**
 * Inhalt der LISTEN/NOTIFY-Benachrichtigung.
 *
 * Zwei Zusicherungen, an denen jeweils ein Fehler der Vorgängerfassung hing:
 *
 *  - Die Feldnamen. Der Push-Versand las `metric` und `sensor_id`; beide existieren
 *    nicht, die Handy-Nachricht enthielt "undefined".
 *  - Die `id`. Ohne sie kann der Abgleich (alerts/reconciler.js) nicht erkennen, ob
 *    ein per Poll gefundener Alarm bereits über NOTIFY verkündet wurde.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { startTestDb, resetData } from '../helpers/testDb.js';
import {
  at,
  SENSOR_A,
  createSensor,
  createCleanroom,
  assignSensor,
  setThreshold,
  insertMeasurement,
} from '../helpers/fixtures.js';

let db;
let client;
/** @type {pg.Client} */
let listener;

beforeAll(async () => {
  db = await startTestDb();
  client = db.client;

  listener = new pg.Client({ connectionString: db.url });
  await listener.connect();
  await listener.query('LISTEN threshold_alert');
});

afterAll(async () => {
  await listener?.end().catch(() => {});
  await db?.stop();
});

beforeEach(async () => {
  await resetData(client);
  await createSensor(client, SENSOR_A, 'Temperatursensor Eingang');
});

/** Wartet auf die nächste Benachrichtigung. */
function nextNotification(timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listener.removeListener('notification', onNotify);
      reject(new Error('Keine Benachrichtigung innerhalb des Zeitlimits'));
    }, timeoutMs);

    function onNotify(message) {
      clearTimeout(timer);
      listener.removeListener('notification', onNotify);
      resolve(JSON.parse(message.payload));
    }

    listener.on('notification', onNotify);
  });
}

describe('Benachrichtigung bei Schwellenwert-Verletzung', () => {
  it('enthält ID, Klartextnamen und die Felder, die der Versand erwartet', async () => {
    const roomId = await createCleanroom(client, 'Reinraum 221');
    await assignSensor(client, SENSOR_A, roomId);
    await setThreshold(client, SENSOR_A, 'temperature', { min: 20, max: 25 });

    const received = nextNotification();
    await insertMeasurement(client, SENSOR_A, 'temperature', 30.5, at('10:00:00'));
    const payload = await received;

    expect(payload).toMatchObject({
      sensor_uuid: SENSOR_A,
      sensor_name: 'Temperatursensor Eingang',
      cleanroom_id: roomId,
      cleanroom_name: 'Reinraum 221',
      quantity: 'temperature',
      violation_type: 'above_max',
      value: 30.5,
      threshold_min: 20,
      threshold_max: 25,
    });
    expect(typeof payload.id).toBe('number');

    // Die ID muss auf den tatsächlich angelegten Datensatz zeigen.
    const { rows } = await client.query('SELECT id FROM threshold_violations');
    expect(rows).toHaveLength(1);
    expect(payload.id).toBe(Number(rows[0].id));
  });

  it('meldet nur beim Öffnen, nicht bei jedem weiteren Verstoß', async () => {
    await setThreshold(client, SENSOR_A, 'temperature', { max: 25 });

    const first = nextNotification();
    await insertMeasurement(client, SENSOR_A, 'temperature', 30, at('10:00:00'));
    await first;

    // Zweiter Verstoß desselben Ereignisses darf keine Benachrichtigung auslösen.
    const second = nextNotification(1_500);
    await insertMeasurement(client, SENSOR_A, 'temperature', 31, at('10:00:02'));

    await expect(second).rejects.toThrow(/Zeitlimit/);
  });
});
