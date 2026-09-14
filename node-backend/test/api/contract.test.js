/**
 * Vertragstests der HTTP-Schnittstelle.
 *
 * Der wichtigste Fall steht in "Fehlerbehandlung": Vor dem Umbau beendete eine
 * fehlerhafte Anfrage wie `?sensor_uuid=abc` den gesamten Prozess — Express 4 fängt
 * abgelehnte Promises aus async-Handlern nicht ab, und Node behandelt eine
 * unbehandelte Ablehnung als fatalen Fehler. Jeder Nutzer konnte die API mit einem
 * veralteten Lesezeichen abschießen.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, resetData } from '../helpers/testDb.js';
import { SENSOR_A, at, createSensor, createCleanroom, assignSensor, setThreshold, insertMeasurement } from '../helpers/fixtures.js';

let db;
let client;
let app;

beforeAll(async () => {
  db = await startTestDb();
  client = db.client;

  const url = new URL(db.url);
  process.env.POSTGRES_HOST = url.hostname;
  process.env.POSTGRES_PORT = url.port;
  process.env.POSTGRES_DB = url.pathname.slice(1);
  process.env.POSTGRES_USER = decodeURIComponent(url.username);
  process.env.POSTGRES_PASSWORD = decodeURIComponent(url.password);
  process.env.LOG_LEVEL = 'silent';

  const { createApp } = await import('../../src/app.js');
  app = createApp();
});

afterAll(async () => {
  const { close } = await import('../../src/lib/db.js');
  await close().catch(() => {});
  await db?.stop();
});

beforeEach(async () => {
  await resetData(client);
});

describe('Fehlerbehandlung', () => {
  it('beantwortet eine ungültige UUID mit 400 statt abzustürzen', async () => {
    const res = await request(app)
      .get('/api/sensordata')
      .query({ sensor_uuid: 'abc', quantity: 'temperature' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details[0].field).toBe('sensor_uuid');
    expect(res.body.requestId).toBeTruthy();

    // Der entscheidende Nachweis: Die Anwendung bedient danach weiter Anfragen.
    await request(app).get('/healthz').expect(200);
  });

  it('liefert für unbekannte Pfade dieselbe Fehlerform', async () => {
    const res = await request(app).get('/api/gibtesnicht').expect(404);

    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
    expect(res.body.requestId).toBeTruthy();
  });

  it('gibt die Korrelations-ID auch im Header zurück', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('übernimmt eine mitgelieferte Korrelations-ID', async () => {
    const res = await request(app).get('/healthz').set('X-Request-Id', 'vorgabe-123');
    expect(res.headers['x-request-id']).toBe('vorgabe-123');
  });

  it('weist fehlerhaftes JSON im Body mit 400 ab', async () => {
    const res = await request(app)
      .post('/api/cleanrooms')
      .set('Content-Type', 'application/json')
      .send('{kaputt');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('Reinräume', () => {
  it('durchläuft Anlegen, Auflisten und Löschen', async () => {
    const created = await request(app).post('/api/cleanrooms').send({ name: 'Reinraum 221' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Reinraum 221' });

    const list = await request(app).get('/api/cleanrooms').expect(200);
    expect(list.body).toHaveLength(1);

    await request(app).delete(`/api/cleanrooms/${created.body.id}`).expect(200);
    await request(app).delete(`/api/cleanrooms/${created.body.id}`).expect(404);
  });

  it('meldet einen doppelten Namen mit 409', async () => {
    await request(app).post('/api/cleanrooms').send({ name: 'Doppelt' }).expect(201);

    const res = await request(app).post('/api/cleanrooms').send({ name: 'Doppelt' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('lehnt einen leeren Namen ab', async () => {
    await request(app).post('/api/cleanrooms').send({ name: '' }).expect(400);
  });
});

describe('Schwellenwerte', () => {
  beforeEach(async () => {
    await createSensor(client);
  });

  it('lehnt min größer als max ab', async () => {
    const res = await request(app)
      .post('/api/thresholds')
      .send({ sensor_uuid: SENSOR_A, quantity: 'temperature', min_value: 30, max_value: 20 });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toMatch(/min_value/);
  });

  it('lehnt einen Eintrag ohne jede Grenze ab', async () => {
    await request(app)
      .post('/api/thresholds')
      .send({ sensor_uuid: SENSOR_A, quantity: 'temperature' })
      .expect(400);
  });

  it('setzt einen neuen Wert und schließt den bisherigen ab', async () => {
    await request(app)
      .post('/api/thresholds')
      .send({ sensor_uuid: SENSOR_A, quantity: 'temperature', max_value: 25 })
      .expect(201);

    await request(app)
      .post('/api/thresholds')
      .send({ sensor_uuid: SENSOR_A, quantity: 'temperature', max_value: 23 })
      .expect(201);

    // Aktiv ist genau einer …
    const active = await request(app).get('/api/thresholds').expect(200);
    expect(active.body).toHaveLength(1);
    expect(active.body[0].max_value).toBe(23);

    // … der frühere bleibt als historischer Beleg erhalten.
    const { rows } = await client.query('SELECT count(*)::int AS n FROM sensor_thresholds');
    expect(rows[0].n).toBe(2);
  });

  it('setzt einen Wert per Soft-Delete außer Kraft', async () => {
    const created = await request(app)
      .post('/api/thresholds')
      .send({ sensor_uuid: SENSOR_A, quantity: 'temperature', max_value: 25 });

    await request(app).delete(`/api/thresholds/${created.body.id}`).expect(200);
    await request(app).delete(`/api/thresholds/${created.body.id}`).expect(404);

    expect((await request(app).get('/api/thresholds')).body).toHaveLength(0);
    const { rows } = await client.query('SELECT count(*)::int AS n FROM sensor_thresholds');
    expect(rows[0].n).toBe(1);
  });
});

describe('Panel-Manifest', () => {
  it('liefert nur Kanäle zugeordneter Sensoren, samt Schwellenwert', async () => {
    await createSensor(client, SENSOR_A, 'Sensor Eingang');
    await insertMeasurement(client, SENSOR_A, 'temperature', 22, at('10:00:00'));

    // Ohne Raumzuordnung: unsichtbar
    expect((await request(app).get('/api/panels')).body).toHaveLength(0);

    const roomId = await createCleanroom(client, 'Reinraum 221');
    await assignSensor(client, SENSOR_A, roomId);
    await setThreshold(client, SENSOR_A, 'temperature', { min: 20, max: 25 });

    const res = await request(app).get('/api/panels').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: `${SENSOR_A}/temperature`,
      sensor_name: 'Sensor Eingang',
      quantity: 'temperature',
      unit: '°C',
      cleanroom_name: 'Reinraum 221',
      min_value: 20,
      max_value: 25,
    });
  });
});

describe('Messdaten', () => {
  it('liefert die Zeitreihe aufsteigend sortiert', async () => {
    await createSensor(client);
    for (const [value, time] of [[21, '10:00:00'], [22, '10:00:02'], [23, '10:00:04']]) {
      await insertMeasurement(client, SENSOR_A, 'temperature', value, at(time));
    }

    const res = await request(app)
      .get('/api/sensordata')
      .query({ sensor_uuid: SENSOR_A, quantity: 'temperature', from: at('09:00:00'), to: at('11:00:00') })
      .expect(200);

    expect(res.body.map((r) => r.value)).toEqual([21, 22, 23]);
  });

  it('gibt bei Erreichen des Limits die JÜNGSTEN Werte zurück', async () => {
    await createSensor(client);
    for (const [value, time] of [[21, '10:00:00'], [22, '10:00:02'], [23, '10:00:04']]) {
      await insertMeasurement(client, SENSOR_A, 'temperature', value, at(time));
    }

    const res = await request(app)
      .get('/api/sensordata')
      .query({
        sensor_uuid: SENSOR_A,
        quantity: 'temperature',
        from: at('09:00:00'),
        to: at('11:00:00'),
        limit: 2,
      })
      .expect(200);

    expect(res.body.map((r) => r.value)).toEqual([22, 23]);
  });

  it('begrenzt limit auf das Maximum', async () => {
    await createSensor(client);
    await request(app)
      .get('/api/sensordata')
      .query({ sensor_uuid: SENSOR_A, quantity: 'temperature', limit: 99999 })
      .expect(400);
  });
});

describe('Schnittstellenbeschreibung', () => {
  it('liefert ein gültiges OpenAPI-Dokument', async () => {
    const res = await request(app).get('/api/openapi.json').expect(200);

    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(15);
    expect(res.body.components.schemas.ErrorResponse).toBeTruthy();
  });

  it('stellt die Oberfläche unter /api/docs bereit', async () => {
    const res = await request(app).get('/api/docs/').expect(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.headers['content-security-policy']).toMatch(/unsafe-inline/);
  });
});
