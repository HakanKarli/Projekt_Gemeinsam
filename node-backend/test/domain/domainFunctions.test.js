/**
 * Die zeitliche Invariante in der Datenbank.
 *
 * Der Prüfgegenstand ist nicht, dass die Anwendung das Richtige tut — das prüfen die
 * Vertragstests. Hier geht es um die Frage dahinter: **Hält die Invariante auch,
 * wenn niemand die Anwendung benutzt?**
 *
 * Alle Aufrufe unten gehen deshalb direkt auf die Datenbank, ohne Service, ohne
 * Express, ohne Zod. Genau so, wie ein Importskript, ein Wartungseingriff über psql
 * oder ein zweites Werkzeug schreiben würde.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, resetData } from '../helpers/testDb.js';
import { SENSOR_A, SENSOR_B, createSensor, createCleanroom } from '../helpers/fixtures.js';

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
  await createSensor(client, SENSOR_A, 'Sensor A');
});

/** Zuordnungen eines Sensors, älteste zuerst. */
async function assignments(sensorUuid = SENSOR_A) {
  const { rows } = await client.query(
    `SELECT id, cleanroom_id,
            lower(valid_during) AS von,
            CASE WHEN upper(valid_during) = 'infinity' THEN NULL
                 ELSE upper(valid_during) END AS bis
     FROM sensor_assignments WHERE sensor_uuid = $1
     ORDER BY lower(valid_during), id`,
    [sensorUuid],
  );
  return rows;
}

async function thresholds(sensorUuid = SENSOR_A) {
  const { rows } = await client.query(
    `SELECT id, quantity, min_value, max_value,
            lower(valid_during) AS von,
            CASE WHEN upper(valid_during) = 'infinity' THEN NULL
                 ELSE upper(valid_during) END AS bis
     FROM sensor_thresholds WHERE sensor_uuid = $1
     ORDER BY lower(valid_during), id`,
    [sensorUuid],
  );
  return rows;
}

describe('assign_sensor', () => {
  it('legt die erste Zuordnung offen an', async () => {
    const raum = await createCleanroom(client, 'Reinraum 221');

    const { rows } = await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, raum]);

    expect(rows).toHaveLength(1);
    expect(rows[0].cleanroom_id).toBe(raum);

    const alle = await assignments();
    expect(alle).toHaveLength(1);
    expect(alle[0].bis).toBeNull();
  });

  it('schließt die alte Zuordnung LÜCKENLOS zur neuen', async () => {
    const raumA = await createCleanroom(client, 'Reinraum 221');
    const raumB = await createCleanroom(client, 'Infoboard');

    await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, raumA]);
    await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, raumB]);

    const alle = await assignments();
    expect(alle).toHaveLength(2);

    // Das eigentliche Kriterium: Ende der einen ist EXAKT der Beginn der anderen.
    // Eine Lücke — und sei sie eine Mikrosekunde — hieße, der Sensor war zeitweise
    // nirgends zugeordnet, und ein Messwert aus diesem Moment wäre keinem Raum
    // zuzurechnen.
    expect(alle[0].bis).toEqual(alle[1].von);
    expect(alle[1].bis).toBeNull();
  });

  it('erlaubt nie zwei offene Zuordnungen', async () => {
    const raumA = await createCleanroom(client, 'Reinraum 221');
    const raumB = await createCleanroom(client, 'Infoboard');

    await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, raumA]);
    await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, raumB]);
    await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, raumA]);

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM sensor_assignments
       WHERE sensor_uuid = $1 AND upper(valid_during) = 'infinity'`,
      [SENSOR_A],
    );
    expect(rows[0].n).toBe(1);
  });

  it('liefert keine Zeile für einen unbekannten Sensor', async () => {
    const raum = await createCleanroom(client, 'Reinraum 221');
    const { rows } = await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_B, raum]);
    expect(rows).toHaveLength(0);
  });

  it('weist einen unbekannten Reinraum ab', async () => {
    await expect(client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, 99999])).rejects.toThrow(
      /Reinraum 99999 existiert nicht/,
    );
  });

  it('lässt die Zuordnung eines anderen Sensors unberührt', async () => {
    await createSensor(client, SENSOR_B, 'Sensor B');
    const raumA = await createCleanroom(client, 'Reinraum 221');
    const raumB = await createCleanroom(client, 'Infoboard');

    await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_B, raumA]);
    await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, raumB]);

    const fremd = await assignments(SENSOR_B);
    expect(fremd).toHaveLength(1);
    expect(fremd[0].bis).toBeNull();
  });
});

describe('set_threshold', () => {
  it('schließt den alten Wert lückenlos zum neuen', async () => {
    await client.query('SELECT * FROM set_threshold($1, $2, $3, $4)', [SENSOR_A, 'temperature', 20, 25]);
    await client.query('SELECT * FROM set_threshold($1, $2, $3, $4)', [SENSOR_A, 'temperature', 20, 23]);

    const alle = await thresholds();
    expect(alle).toHaveLength(2);
    expect(alle[0].bis).toEqual(alle[1].von);
    expect(alle[1].max_value).toBe(23);
    expect(alle[1].bis).toBeNull();
  });

  it('trennt Messgrößen sauber voneinander', async () => {
    await client.query('SELECT * FROM set_threshold($1, $2, $3, $4)', [SENSOR_A, 'temperature', 20, 25]);
    await client.query('SELECT * FROM set_threshold($1, $2, $3, $4)', [SENSOR_A, 'humidity', 30, 60]);
    await client.query('SELECT * FROM set_threshold($1, $2, $3, $4)', [SENSOR_A, 'temperature', 21, 24]);

    const { rows } = await client.query(
      `SELECT quantity, count(*)::int AS offen FROM sensor_thresholds
       WHERE sensor_uuid = $1 AND upper(valid_during) = 'infinity'
       GROUP BY quantity ORDER BY quantity`,
      [SENSOR_A],
    );
    expect(rows).toEqual([
      { quantity: 'humidity', offen: 1 },
      { quantity: 'temperature', offen: 1 },
    ]);
  });

  it('liefert keine Zeile für einen unbekannten Sensor', async () => {
    const { rows } = await client.query('SELECT * FROM set_threshold($1, $2, $3, $4)', [
      SENSOR_B, 'temperature', 20, 25,
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe('retire_threshold', () => {
  it('schließt den Zeitraum, ohne die Zeile zu löschen', async () => {
    const { rows: [angelegt] } = await client.query(
      'SELECT * FROM set_threshold($1, $2, $3, $4)',
      [SENSOR_A, 'temperature', 20, 25],
    );

    const { rows } = await client.query('SELECT * FROM retire_threshold($1)', [angelegt.id]);
    expect(rows).toHaveLength(1);

    const alle = await thresholds();
    expect(alle).toHaveLength(1);          // die Zeile bleibt als historischer Beleg
    expect(alle[0].bis).not.toBeNull();    // nur der Zeitraum ist geschlossen
  });

  it('liefert keine Zeile beim zweiten Aufruf', async () => {
    const { rows: [angelegt] } = await client.query(
      'SELECT * FROM set_threshold($1, $2, $3, $4)',
      [SENSOR_A, 'temperature', 20, 25],
    );

    await client.query('SELECT * FROM retire_threshold($1)', [angelegt.id]);
    const { rows } = await client.query('SELECT * FROM retire_threshold($1)', [angelegt.id]);
    expect(rows).toHaveLength(0);
  });
});

describe('Die Bedingungen gelten auch OHNE die Anwendung', () => {
  it('weist einen Schwellenwert ohne jede Grenze ab', async () => {
    await expect(
      client.query(
        `INSERT INTO sensor_thresholds (sensor_uuid, quantity, min_value, max_value)
         VALUES ($1, 'temperature', NULL, NULL)`,
        [SENSOR_A],
      ),
    ).rejects.toThrow(/chk_threshold_hat_grenze/);
  });

  it('weist min größer als max ab', async () => {
    await expect(
      client.query(
        `INSERT INTO sensor_thresholds (sensor_uuid, quantity, min_value, max_value)
         VALUES ($1, 'temperature', 30, 20)`,
        [SENSOR_A],
      ),
    ).rejects.toThrow(/chk_threshold_grenzen_sortiert/);
  });

  it('weist zwei überlappende Zuordnungen ab', async () => {
    const raumA = await createCleanroom(client, 'Reinraum 221');
    const raumB = await createCleanroom(client, 'Infoboard');

    await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, raumA]);

    // Direkter INSERT am Dienst vorbei — genau das, wogegen die Bedingung schützt.
    await expect(
      client.query(
        `INSERT INTO sensor_assignments (sensor_uuid, cleanroom_id, valid_during)
         VALUES ($1, $2, tstzrange(now(), 'infinity'))`,
        [SENSOR_A, raumB],
      ),
    ).rejects.toThrow(/exclusion constraint|überlapp|overlap/i);
  });
});

describe('delete_cleanroom', () => {
  it('schließt laufende Zuordnungen und löst Verletzungen vom Raum', async () => {
    const raum = await createCleanroom(client, 'Reinraum 221');
    await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, raum]);

    await client.query(
      `INSERT INTO threshold_violations
         (sensor_uuid, cleanroom_id, quantity, violation_type, first_value, peak_value)
       VALUES ($1, $2, 'temperature', 'above_max', 30, 30)`,
      [SENSOR_A, raum],
    );

    const { rows } = await client.query('SELECT * FROM delete_cleanroom($1)', [raum]);
    expect(rows).toHaveLength(1);

    expect(await assignments()).toHaveLength(0);

    // Die Verletzung bleibt erhalten — nur ohne Raumbezug.
    const { rows: verletzungen } = await client.query(
      'SELECT cleanroom_id FROM threshold_violations WHERE sensor_uuid = $1',
      [SENSOR_A],
    );
    expect(verletzungen).toHaveLength(1);
    expect(verletzungen[0].cleanroom_id).toBeNull();
  });

  it('liefert keine Zeile für einen unbekannten Raum', async () => {
    const { rows } = await client.query('SELECT * FROM delete_cleanroom($1)', [99999]);
    expect(rows).toHaveLength(0);
  });
});

describe('delete_sensor', () => {
  it('entfernt Abhängigkeiten, behält aber die Messdaten', async () => {
    const raum = await createCleanroom(client, 'Reinraum 221');
    await client.query('SELECT * FROM assign_sensor($1, $2)', [SENSOR_A, raum]);
    await client.query('SELECT * FROM set_threshold($1, $2, $3, $4)', [SENSOR_A, 'temperature', 20, 25]);
    await client.query(
      `INSERT INTO sensor_data (time, sensor_uuid, quantity, unit, value)
       VALUES (now(), $1, 'temperature', '°C', 22)`,
      [SENSOR_A],
    );

    const { rows } = await client.query('SELECT * FROM delete_sensor($1)', [SENSOR_A]);
    expect(rows).toHaveLength(1);

    expect(await assignments()).toHaveLength(0);
    expect(await thresholds()).toHaveLength(0);

    const { rows: messwerte } = await client.query(
      'SELECT count(*)::int AS n FROM sensor_data WHERE sensor_uuid = $1',
      [SENSOR_A],
    );
    expect(messwerte[0].n).toBe(1);
  });
});
