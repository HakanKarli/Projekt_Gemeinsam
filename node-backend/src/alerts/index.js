/**
 * Alarmkette — Zusammenspiel der Bausteine.
 *
 *   Trigger --NOTIFY--> listener ─┐
 *                                 ├─> markAnnounced (Entdopplung) ─> SSE + Push
 *   threshold_violations --poll--> reconciler ─┘
 *
 * Beide Quellen laufen durch dieselbe Entdopplung, damit ein Alarm, der über NOTIFY
 * ankam, nicht eine Minute später vom Abgleich ein zweites Mal gemeldet wird.
 */

const logger = require('../lib/logger');
const listener = require('./listener');
const reconciler = require('./reconciler');
const sseHub = require('./sseHub');
const notifier = require('./notifier');

/**
 * @param {import('./types').ViolationEvent} event
 * @param {'notify' | 'reconcile'} source
 */
function handleEvent(event, source) {
  if (!reconciler.markAnnounced(event.id)) return;

  logger.info(
    {
      source,
      violationId: event.id,
      sensor: event.sensor_uuid,
      quantity: event.quantity,
      type: event.violation_type,
      value: event.value,
    },
    'Schwellenwert-Verletzung',
  );

  sseHub.broadcast(event);
  void notifier.sendPush(event);
}

async function start() {
  sseHub.startHeartbeat();
  await listener.start((event) => handleEvent(event, 'notify'));
  reconciler.start((event) => handleEvent(event, 'reconcile'));
}

async function stop() {
  reconciler.stop();
  await listener.stop();
  sseHub.closeAll();
}

/** Für den Watchdog: Ist die Alarmkette funktionsfähig? */
const isHealthy = () => listener.isConnected();

module.exports = { start, stop, isHealthy, handleEvent };
