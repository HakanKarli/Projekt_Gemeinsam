/**
 * Push-Benachrichtigung per ntfy.sh.
 *
 * KORREKTUR gegenüber der Vorgängerfassung: Diese las `data.metric` und
 * `data.sensor_id`. Beide Felder existieren im Notify-Payload nicht — der Trigger
 * sendet `quantity` und `sensor_uuid`. Titel und Sensorzeile der Handy-Nachricht
 * enthielten deshalb "undefined".
 */

const config = require('../config');
const logger = require('../lib/logger');

const VIOLATION_LABELS = {
  above_max: 'über Maximum',
  below_min: 'unter Minimum',
};

/** @typedef {import('./types').ViolationEvent} ViolationEvent */

/**
 * @param {ViolationEvent} event
 * @returns {string}
 */
function describe(event) {
  return VIOLATION_LABELS[event.violation_type] ?? event.violation_type;
}

/**
 * @param {ViolationEvent} event
 * @returns {number | null}
 */
function limitOf(event) {
  return event.violation_type === 'above_max' ? event.threshold_max : event.threshold_min;
}

/**
 * Sendet eine Push-Nachricht. Fehler werden geloggt, aber nicht weitergereicht:
 * Ein nicht erreichbarer Push-Dienst darf die Alarmverarbeitung nicht anhalten.
 *
 * @param {ViolationEvent} event
 */
async function sendPush(event) {
  const url = `${config.alerts.ntfyServer}/${config.alerts.ntfyTopic}`;
  const label = describe(event);

  const title = `${event.quantity} ${label}`;
  const body = [
    `Sensor: ${event.sensor_name ?? event.sensor_uuid}`,
    `Wert: ${event.value} (Grenzwert: ${limitOf(event) ?? 'nicht gesetzt'})`,
    `Reinraum: ${event.cleanroom_name ?? event.cleanroom_id ?? 'nicht zugeordnet'}`,
    `Zeit: ${new Date(event.time).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`,
  ].join('\n');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Title: title, Priority: '4', Tags: 'warning,rotating_light' },
      body,
      signal: AbortSignal.timeout(5_000),
    });

    if (response.ok) {
      logger.info({ topic: config.alerts.ntfyTopic }, 'Push-Benachrichtigung gesendet');
    } else {
      logger.error({ status: response.status }, 'ntfy hat die Nachricht abgelehnt');
    }
  } catch (err) {
    logger.error({ err }, 'ntfy nicht erreichbar');
  }
}

module.exports = { sendPush, describe, limitOf };
