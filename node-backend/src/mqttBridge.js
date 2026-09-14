/**
 * mqttBridge.js
 * Subscribed auf MQTT-Topic "sensors" und schreibt Messdaten in PostgreSQL/TimescaleDB.
 * Unbekannte Sensoren werden automatisch in sensor_registry registriert.
 *
 * Erwartet Format:
 * {
 *   "id":           "<sensor-uuid>",
 *   "gateway_id":   "<string>",
 *   "name":         "<string>",        // optional, vom Sensor gemeldeter Name
 *   "event_driven": 0,                 // optional, 0 = zyklisch, 1 = event-getrieben
 *   "timestamp":    "<ISO-8601>",
 *   "measurements": [{ "quantity": "<string>", "unit": "<string>", "value": <number> }]
 * }
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const mqtt = require('mqtt');
const pool = require('./db');

const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
let client = null;
let messageCount = 0;

function start() {
  client = mqtt.connect(brokerUrl, {
    clientId: `ohb-bridge-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 3000,
  });

  client.on('connect', () => {
    console.log(`[BRIDGE] Verbunden mit ${brokerUrl}`);
    client.subscribe('sensors/#', (err) => {
      if (err) console.error('[BRIDGE] Subscribe fehlgeschlagen: sensors', err.message);
      else console.log('[BRIDGE] Subscribed: sensors');
    });
  });

  client.on('reconnect', () => console.log('[BRIDGE] Reconnecting...'));
  client.on('error', (err) => console.error('[BRIDGE] MQTT Fehler:', err.message));
  client.on('close', () => console.log('[BRIDGE] Verbindung getrennt'));

  client.on('message', async (_topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString());
      await insertSensorData(msg);
      messageCount++;
      if (messageCount % 50 === 0) {
        console.log(`[BRIDGE] ${messageCount} Nachrichten geschrieben`);
      }
    } catch (err) {
      console.error('[BRIDGE] Nachricht konnte nicht verarbeitet werden:', err.message);
    }
  });
}

async function insertSensorData(msg) {
  const { id: sensor_uuid, gateway_id, name, event_driven, timestamp, measurements } = msg;
  if (!sensor_uuid || !Array.isArray(measurements)) return;

  const time = new Date(timestamp);
  // Gemeldeten Namen verwenden; ohne Namen dient die UUID als Platzhalter.
  const sensorName = (typeof name === 'string' && name.trim()) ? name.trim() : sensor_uuid;
  const eventDriven = event_driven ? 1 : 0;

  // Sensor registrieren bzw. aktualisieren:
  //  - name: gemeldeten Namen nur übernehmen, solange der gespeicherte Name noch
  //    der UUID-Platzhalter ist – manuelle Umbenennungen bleiben so erhalten.
  //  - gateway_id / event_driven: auf den aktuell gemeldeten Wert setzen.
  // Die WHERE-Klausel verhindert unnötige Schreibvorgänge bei jeder Nachricht.
  await pool.query(
    `INSERT INTO sensor_registry (sensor_uuid, name, gateway_id, event_driven)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (sensor_uuid) DO UPDATE
       SET name = CASE
                    WHEN sensor_registry.name = sensor_registry.sensor_uuid::text
                    THEN EXCLUDED.name
                    ELSE sensor_registry.name
                  END,
           gateway_id   = EXCLUDED.gateway_id,
           event_driven = EXCLUDED.event_driven
     WHERE sensor_registry.name         = sensor_registry.sensor_uuid::text
        OR sensor_registry.gateway_id   IS DISTINCT FROM EXCLUDED.gateway_id
        OR sensor_registry.event_driven IS DISTINCT FROM EXCLUDED.event_driven`,
    [sensor_uuid, sensorName, gateway_id ?? null, eventDriven]
  );

  for (const meas of measurements) {
    const value = parseFloat(meas.value);
    if (isNaN(value)) continue;
    await pool.query(
      `INSERT INTO sensor_data (time, sensor_uuid, quantity, unit, value)
       VALUES ($1, $2, $3, $4, $5)`,
      [time, sensor_uuid, meas.quantity, meas.unit ?? '', value]
    );
  }
}

function shutdown() {
  console.log('\n[BRIDGE] Wird beendet...');
  if (client) client.end(true);
  pool.end().then(() => {
    console.log(`[BRIDGE] Gestoppt. ${messageCount} Nachrichten insgesamt geschrieben.`);
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[BRIDGE] MQTT-to-PostgreSQL Bridge');
console.log(`[BRIDGE] Broker: ${brokerUrl}`);
console.log(`[BRIDGE] DB: ${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}/${process.env.POSTGRES_DB}`);
console.log('');

// Schema absichern (z.B. event_driven-Spalte), dann MQTT-Verbindung aufbauen.
pool.ensureSchema()
  .catch((err) => console.error('[BRIDGE] Schema-Setup fehlgeschlagen:', err.message))
  .finally(start);
