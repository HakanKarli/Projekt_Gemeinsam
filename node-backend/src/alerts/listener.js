/**
 * LISTEN/NOTIFY-Anbindung an PostgreSQL.
 *
 * Eigene `pg.Client`-Verbindung statt Pool: LISTEN braucht eine dauerhafte Verbindung,
 * ein Pool würde sie nach jeder Abfrage zurückgeben und die Registrierung verlieren.
 *
 * KORREKTUR gegenüber der Vorgängerfassung: Dort starteten `error` UND `end` je einen
 * neuen Listener. Da pg bei einem Verbindungsabbruch typischerweise beide Ereignisse
 * feuert, verdoppelte sich die Zahl der Listener mit jeder Störung — und damit die
 * Zahl der Push-Nachrichten pro Alarm. Jetzt gibt es genau einen Reconnect-Pfad,
 * abgesichert über `reconnectTimer`.
 */

const { Client } = require('pg');
const config = require('../config');
const logger = require('../lib/logger');

const CHANNEL = 'threshold_alert';
const RECONNECT_MS = 5_000;

/** @type {import('pg').Client | null} */
let client = null;
/** @type {NodeJS.Timeout | null} */
let reconnectTimer = null;
let stopped = false;
/** @type {((event: import('./types').ViolationEvent) => void) | null} */
let handler = null;

function scheduleReconnect(reason) {
  // Der einzige Ort, an dem ein Reconnect entsteht. Ein bereits laufender Timer
  // verhindert, dass zwei Ereignisse zwei Verbindungen erzeugen.
  if (stopped || reconnectTimer) return;

  logger.warn({ reason, retryInMs: RECONNECT_MS }, 'Alarm-Listener getrennt — neuer Versuch geplant');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((err) => scheduleReconnect(err.message));
  }, RECONNECT_MS);
  reconnectTimer.unref();
}

async function connect() {
  if (stopped) return;

  const next = new Client({ ...config.db, application_name: 'ohb-alert-listener' });

  next.on('error', (err) => {
    logger.error({ err }, 'Fehler auf der Listener-Verbindung');
    scheduleReconnect('error');
  });
  next.on('end', () => scheduleReconnect('end'));

  next.on('notification', (message) => {
    if (message.channel !== CHANNEL || !message.payload) return;
    try {
      handler?.(JSON.parse(message.payload));
    } catch (err) {
      logger.error({ err, payload: message.payload }, 'Notify-Payload nicht lesbar');
    }
  });

  await next.connect();
  await next.query(`LISTEN ${CHANNEL}`);

  client = next;
  logger.info({ channel: CHANNEL }, 'Alarm-Listener verbunden');
}

/**
 * @param {(event: import('./types').ViolationEvent) => void} onEvent
 */
async function start(onEvent) {
  stopped = false;
  handler = onEvent;
  await connect();
}

async function stop() {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (client) {
    const current = client;
    client = null;
    current.removeAllListeners('end');
    await current.end().catch(() => {});
  }
}

const isConnected = () => client !== null;

module.exports = { start, stop, isConnected, CHANNEL };
