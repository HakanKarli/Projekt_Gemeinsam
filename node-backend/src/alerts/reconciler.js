/**
 * Sicherheitsnetz gegen verlorene Alarme.
 *
 * `pg_notify` ist flüchtig: Ist im Moment des Auslösens kein Listener verbunden, ist
 * der Alarm nie passiert — die Datenbank merkt sich die Benachrichtigung nicht. Der
 * Datensatz in `threshold_violations` existiert aber sehr wohl.
 *
 * Der Abgleich holt periodisch die offenen, unquittierten Verletzungen und meldet
 * jene, die noch nicht verkündet wurden.
 *
 * Startverhalten: Beim ersten Lauf werden alle offenen Verletzungen vermerkt, gemeldet
 * werden aber nur die aus dem jüngsten Zeitfenster (siehe GAP_WINDOW_MINUTES). Ein
 * Alarm, der zwei Minuten vor dem Neustart auslöste, gilt damit als verpasst und wird
 * nachgereicht; einer von vor drei Stunden ist längst bekannt und löst keine erneute
 * Push-Welle aus.
 */

const db = require('../lib/db');
const logger = require('../lib/logger');

const POLL_MS = 60_000;
/** Nur so junge Ereignisse gelten als verpasste Alarme und lösen eine Meldung aus. */
const GAP_WINDOW_MINUTES = 10;

const OPEN_VIOLATIONS_SQL = `
  SELECT v.id, v.sensor_uuid, r.name AS sensor_name,
         v.cleanroom_id, c.name AS cleanroom_name,
         v.quantity, v.violation_type,
         v.threshold_min, v.threshold_max,
         v.peak_value AS value,
         lower(v.valid_during) AS time,
         lower(v.valid_during) > now() - ($1 || ' minutes')::interval AS is_recent
  FROM threshold_violations v
  LEFT JOIN sensor_registry r ON r.sensor_uuid = v.sensor_uuid
  LEFT JOIN cleanrooms c ON c.id = v.cleanroom_id
  WHERE upper(v.valid_during) = 'infinity'
    AND NOT v.acknowledged
`;

/** IDs bereits verkündeter Ereignisse. Wird jeden Lauf auf die offenen beschnitten. */
let announced = new Set();
/** @type {NodeJS.Timeout | null} */
let timer = null;

/**
 * Vermerkt eine ID als verkündet.
 * @param {number} id
 * @returns {boolean} true, wenn sie neu war
 */
function markAnnounced(id) {
  if (id === undefined || id === null) return true; // ohne ID keine Entdopplung möglich
  if (announced.has(id)) return false;
  announced.add(id);
  return true;
}

/**
 * @param {(event: import('./types').ViolationEvent, source: 'reconcile') => void} onMissed
 */
async function runOnce(onMissed) {
  const { rows } = await db.query(OPEN_VIOLATIONS_SQL, [GAP_WINDOW_MINUTES]);

  const openIds = new Set();
  for (const row of rows) {
    openIds.add(row.id);
    if (announced.has(row.id)) continue;

    announced.add(row.id);
    if (row.is_recent) {
      logger.warn({ violationId: row.id, sensor: row.sensor_uuid }, 'Verpasster Alarm nachgemeldet');
      onMissed(row, 'reconcile');
    }
  }

  // Beschneiden hält die Menge auf die Zahl offener Verletzungen begrenzt.
  announced = new Set([...announced].filter((id) => openIds.has(id)));
}

/**
 * @param {(event: import('./types').ViolationEvent, source: 'reconcile') => void} onMissed
 */
function start(onMissed) {
  if (timer) return;

  const tick = () => {
    runOnce(onMissed).catch((err) => logger.error({ err }, 'Alarm-Abgleich fehlgeschlagen'));
  };

  tick(); // Erster Lauf sofort: übernimmt den Bestand, ohne zu melden
  timer = setInterval(tick, POLL_MS);
  timer.unref();
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  announced = new Set();
}

module.exports = { start, stop, runOnce, markAnnounced, POLL_MS, GAP_WINDOW_MINUTES };
