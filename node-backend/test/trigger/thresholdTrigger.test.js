/**
 * Der Zustandsautomat der Schwellenwert-Prüfung.
 *
 * Diese Suite deckt die riskanteste Komponente des Systems ab: einen PL/pgSQL-Trigger
 * mit fünf Verzweigungen, der über Zeitbereiche operiert. Fehler darin sind still —
 * ein falsch geschlossenes Ereignis fällt niemandem auf, ein nicht ausgelöster Alarm
 * ebenso wenig.
 *
 * Die Fälle sind so numeriert wie in docs/Engineering-Standards.md §4.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startTestDb,
  resetData,
} from '../helpers/testDb.js';
import {
  at,
  SENSOR_A,
  createSensor,
  createCleanroom,
  assignSensor,
  setThreshold,
  endThreshold,
  insertMeasurement,
  violations,
} from '../helpers/fixtures.js';

const QTY = 'temperature';

/** @type {Awaited<ReturnType<typeof startTestDb>>} */
let db;
let client;

beforeAll(async () => {
  db = await startTestDb();
  client = db.client;
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(async () => {
  await resetData(client);
  await createSensor(client);
});

/** Kurzschreibweise: Messwert für den Standardsensor. */
const measure = (value, hms) => insertMeasurement(client, SENSOR_A, QTY, value, at(hms));
const events = () => violations(client, SENSOR_A, QTY);

describe('Fall 1–2 · Grenzen und Randwerte', () => {
  it('Fall 1: Wert innerhalb der Grenzen erzeugt kein Ereignis', async () => {
    await setThreshold(client, SENSOR_A, QTY, { min: 20, max: 25 });

    await measure(22.5, '10:00:00');
    await measure(24.9, '10:00:02');

    expect(await events()).toHaveLength(0);
  });

  it('Fall 2: Wert exakt auf der Grenze ist KEINE Verletzung', async () => {
    // Der Trigger vergleicht mit < und >, nicht mit <= und >=. Dieser Test hält
    // diese Entscheidung fest, damit sie nicht unbemerkt umgedreht wird.
    await setThreshold(client, SENSOR_A, QTY, { min: 20, max: 25 });

    await measure(25, '10:00:00'); // genau max
    await measure(20, '10:00:02'); // genau min

    expect(await events()).toHaveLength(0);
  });
});

describe('Fall 3–6 · Ereignis öffnen und fortschreiben', () => {
  beforeEach(async () => {
    await setThreshold(client, SENSOR_A, QTY, { min: 20, max: 25 });
  });

  it('Fall 3: erste Überschreitung öffnet genau ein Ereignis', async () => {
    await measure(30, '10:00:00');

    const [event, ...rest] = await events();
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      violation_type: 'above_max',
      first_value: 30,
      peak_value: 30,
      data_points: 1,
      threshold_min: 20,
      threshold_max: 25,
      acknowledged: false,
    });
    expect(event.ended_at).toBeNull();
    expect(event.started_at).toEqual(new Date(at('10:00:00')));
  });

  it('Fall 4: weitere Überschreitungen schreiben dasselbe Ereignis fort', async () => {
    await measure(30, '10:00:00');
    await measure(31, '10:00:02');
    await measure(29, '10:00:04');

    const all = await events();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ data_points: 3, first_value: 30, last_value: 29 });
  });

  it('Fall 5: peak_value wächst bei above_max monoton', async () => {
    await measure(30, '10:00:00');
    await measure(35, '10:00:02');
    await measure(28, '10:00:04'); // niedriger, aber weiterhin Verletzung

    const [event] = await events();
    expect(event.peak_value).toBe(35);
    expect(event.last_value).toBe(28);
  });

  it('Fall 6: peak_value fällt bei below_min monoton', async () => {
    await measure(15, '10:00:00');
    await measure(10, '10:00:02');
    await measure(18, '10:00:04'); // höher, aber weiterhin Verletzung

    const [event] = await events();
    expect(event.violation_type).toBe('below_min');
    expect(event.peak_value).toBe(10);
    expect(event.last_value).toBe(18);
  });
});

describe('Fall 7–9 · Ereignis beenden', () => {
  it('Fall 7: Rückkehr in den Normalbereich schließt das Ereignis', async () => {
    await setThreshold(client, SENSOR_A, QTY, { min: 20, max: 25 });

    await measure(30, '10:00:00');
    await measure(22, '10:00:04');

    const [event] = await events();
    expect(event.ended_at).toEqual(new Date(at('10:00:04')));
    expect(event.data_points).toBe(1);
  });

  it('Fall 8: Typwechsel schließt das alte Ereignis und öffnet genau ein neues', async () => {
    await setThreshold(client, SENSOR_A, QTY, { min: 20, max: 25 });

    await measure(30, '10:00:00'); // above_max
    await measure(31, '10:00:02'); // dasselbe Ereignis
    await measure(15, '10:00:04'); // below_min -> Wechsel

    const all = await events();
    expect(all).toHaveLength(2);

    expect(all[0]).toMatchObject({ violation_type: 'above_max', peak_value: 31, data_points: 2 });
    expect(all[0].ended_at).toEqual(new Date(at('10:00:04')));

    expect(all[1]).toMatchObject({ violation_type: 'below_min', first_value: 15, data_points: 1 });
    expect(all[1].ended_at).toBeNull();
  });

  it('Fall 9: entfällt der Schwellenwert, wird ein offenes Ereignis geschlossen', async () => {
    await setThreshold(client, SENSOR_A, QTY, { min: 20, max: 25 });
    await measure(30, '10:00:00');

    // Soft-Delete wie in der API: Gültigkeitszeitraum abschließen
    await endThreshold(client, SENSOR_A, QTY, at('10:00:03'));
    await measure(99, '10:00:06'); // ohne Grenzwert keine Bewertung mehr

    const all = await events();
    expect(all).toHaveLength(1);
    expect(all[0].ended_at).toEqual(new Date(at('10:00:06')));
  });
});

describe('Fall 10–11 · Sonderfälle der Konfiguration', () => {
  it('Fall 10: fehlt max, ist keine Überschreitung nach oben möglich', async () => {
    await setThreshold(client, SENSOR_A, QTY, { min: 20, max: null });

    await measure(1000, '10:00:00');
    expect(await events()).toHaveLength(0);

    await measure(19, '10:00:02');
    const all = await events();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ violation_type: 'below_min', threshold_max: null });
  });

  it('Fall 11: ohne Raumzuordnung entsteht das Ereignis mit cleanroom_id NULL', async () => {
    await setThreshold(client, SENSOR_A, QTY, { max: 25 });

    await measure(30, '10:00:00');

    const [event] = await events();
    expect(event.cleanroom_id).toBeNull();
  });

  it('Fall 11b: mit Raumzuordnung wird der Raum zum Messzeitpunkt festgehalten', async () => {
    const roomId = await createCleanroom(client, 'Reinraum 221');
    await assignSensor(client, SENSOR_A, roomId);
    await setThreshold(client, SENSOR_A, QTY, { max: 25 });

    await measure(30, '10:00:00');

    const [event] = await events();
    expect(event.cleanroom_id).toBe(roomId);
  });
});

describe('Fall 12 · Nachzügler aus einer Wiederzustellung', () => {
  it('Fall 12: ein verspäteter Messwert erzeugt keinen ungültigen Zeitbereich', async () => {
    // Nach einem Reconnect kann der Broker unbestätigte Nachrichten erneut zustellen.
    // Trifft dabei ein Messwert ein, der ÄLTER ist als der Beginn des offenen
    // Ereignisses, darf daraus kein Zeitbereich mit upper < lower entstehen — das
    // würde PostgreSQL abweisen, den INSERT scheitern lassen und im Ingest eine
    // Endlosschleife aus Zustellung und Fehlschlag auslösen.
    await setThreshold(client, SENSOR_A, QTY, { min: 20, max: 25 });

    await measure(30, '10:00:04'); // Ereignis beginnt 10:00:04

    await expect(measure(22, '10:00:02')).resolves.not.toThrow();

    const all = await events();
    expect(all).toHaveLength(1);
    // Der Nachzügler sagt nichts darüber aus, ob das Ereignis beendet ist.
    expect(all[0].ended_at).toBeNull();
    expect(all[0].started_at).toEqual(new Date(at('10:00:04')));
  });

  it('Fall 12b: ein verspäteter, ebenfalls verletzender Wert schreibt nur fort', async () => {
    await setThreshold(client, SENSOR_A, QTY, { min: 20, max: 25 });

    await measure(30, '10:00:04');
    await measure(35, '10:00:02'); // Nachzügler, ebenfalls über Maximum

    const all = await events();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ data_points: 2, peak_value: 35 });
    expect(all[0].started_at).toEqual(new Date(at('10:00:04')));
    expect(all[0].ended_at).toBeNull();
  });

  it('Fall 12c: exakt derselbe Messwert zweimal wird von der Datenbank abgewiesen', async () => {
    // Grundlage der Verlustfreiheit: Der eindeutige Index macht Wiederzustellungen
    // folgenlos. Der Ingest nutzt dafür ON CONFLICT DO NOTHING.
    await measure(22, '10:00:00');

    await expect(measure(22, '10:00:00')).rejects.toThrow(/duplicate key/i);

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM sensor_data WHERE sensor_uuid = $1 AND quantity = $2`,
      [SENSOR_A, QTY],
    );
    expect(rows[0].n).toBe(1);
  });
});
