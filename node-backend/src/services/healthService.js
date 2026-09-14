/**
 * Betriebszustand des Systems.
 *
 * Die wichtigste Kennzahl ist `worst_lag_sec`: Ein Dashboard, das eine drei Stunden
 * alte Kurve zeigt, sieht aus wie ein funktionierendes Dashboard. Nur der Ingest-Lag
 * entlarvt das.
 *
 * `archive_backlog` und `archive_last_failed` fangen die häufigste PostgreSQL-Störung
 * ab: Das Archivkommando scheitert still, WAL-Segmente stapeln sich, die Platte läuft
 * voll, die Datenbank stoppt. Mit dieser Prüfung wird daraus eine Meldung Tage vorher.
 */

const db = require('../lib/db');
const config = require('../config');
const logger = require('../lib/logger');

/**
 * Ältester Zeitpunkt der zuletzt eingegangenen Messung — betrachtet werden nur
 * Sensoren, die aktuell einem Reinraum zugeordnet sind. Ein nicht zugeordneter
 * Sensor, der schweigt, ist kein Vorfall.
 */
const METRICS_SQL = `
  SELECT
    (
      SELECT max(EXTRACT(EPOCH FROM now() - latest))
      FROM sensor_registry r
      JOIN sensor_assignments sa
        ON sa.sensor_uuid = r.sensor_uuid AND sa.valid_during @> now()
      CROSS JOIN LATERAL (
        SELECT max(d.time) AS latest FROM sensor_data d WHERE d.sensor_uuid = r.sensor_uuid
      ) x
      WHERE latest IS NOT NULL
    )                                                              AS worst_lag_sec,
    (
      SELECT count(*) FROM threshold_violations
      WHERE NOT acknowledged AND upper(valid_during) = 'infinity'
    )                                                              AS open_alerts,
    pg_database_size(current_database())                           AS db_bytes
`;

/**
 * Getrennte Abfrage, weil sie erweiterte Rechte braucht (pg_monitor bzw. Superuser).
 * Fehlt die Berechtigung, wird der Bereich als "unbekannt" gemeldet statt die
 * gesamte Statusauskunft scheitern zu lassen.
 */
const ARCHIVE_SQL = `
  SELECT
    (SELECT last_failed_time   FROM pg_stat_archiver)              AS archive_last_failed,
    (SELECT last_archived_time FROM pg_stat_archiver)              AS archive_last_success,
    (SELECT count(*) FROM pg_ls_dir('pg_wal/archive_status'))      AS archive_backlog,
    current_setting('archive_mode') = 'on'                         AS archive_enabled
`;

/**
 * Archiviert PostgreSQL gerade fehlerhaft?
 *
 * `pg_stat_archiver.last_failed_time` wird NIE zurückgesetzt — eine einmal
 * aufgetretene Störung bliebe dort bis zum nächsten `pg_stat_reset_shared('archiver')`
 * stehen. Ein Vergleich mit dem Zeitpunkt des letzten Erfolgs unterscheidet
 * "scheitert gerade" von "ist damals gescheitert und läuft längst wieder".
 */
function archivierungScheitert({ archive_enabled, archive_last_failed, archive_last_success }) {
  if (!archive_enabled || !archive_last_failed) return false;
  if (!archive_last_success) return true; // gescheitert und nie erfolgreich gewesen
  return new Date(archive_last_failed) > new Date(archive_last_success);
}

async function readiness() {
  await db.ping();
}

/**
 * Zustandsabfragen kommen im Minutentakt. Protokolliert wird deshalb nicht jeder
 * Aufruf, sondern nur der WECHSEL — das ist die Information, die im Log gesucht wird.
 * @type {string | null}
 */
let lastReportedStatus = null;

function logStatusChange(status, problems) {
  const key = `${status}:${problems.join(',')}`;
  if (key === lastReportedStatus) return;
  lastReportedStatus = key;

  if (status === 'ok') {
    logger.info('Systemzustand wieder in Ordnung');
  } else {
    logger.warn({ problems }, 'Systemzustand beeinträchtigt');
  }
}

/**
 * @returns {Promise<{ status: 'ok' | 'degraded', problems: string[], metrics: object }>}
 */
async function deep() {
  const { rows: [base] } = await db.query(METRICS_SQL);

  let archive = {
    archive_last_failed: null,
    archive_last_success: null,
    archive_backlog: null,
    archive_enabled: null,
  };
  try {
    const { rows: [row] } = await db.query(ARCHIVE_SQL);
    archive = row;
  } catch (err) {
    logger.debug({ err }, 'Archiv-Kennzahlen nicht abrufbar (fehlende Berechtigung?)');
  }

  const worstLagSec = base.worst_lag_sec === null ? null : Number(base.worst_lag_sec);
  const archiveBacklog = archive.archive_backlog === null ? null : Number(archive.archive_backlog);

  const problems = [];
  if (worstLagSec !== null && worstLagSec > config.health.maxIngestLagSec) problems.push('ingest_lag');
  if (archivierungScheitert(archive)) problems.push('wal_archive_failing');
  if (archiveBacklog !== null && archiveBacklog > config.health.maxArchiveBacklog) {
    problems.push('wal_archive_backlog');
  }

  const status = problems.length === 0 ? 'ok' : 'degraded';
  logStatusChange(status, problems);

  return {
    status,
    problems,
    metrics: {
      worst_lag_sec: worstLagSec,
      open_alerts: Number(base.open_alerts),
      db_bytes: Number(base.db_bytes),
      archive_enabled: archive.archive_enabled,
      archive_backlog: archiveBacklog,
      archive_last_failed: archive.archive_last_failed,
      archive_last_success: archive.archive_last_success,
    },
    thresholds: {
      max_ingest_lag_sec: config.health.maxIngestLagSec,
      max_archive_backlog: config.health.maxArchiveBacklog,
    },
  };
}

module.exports = { readiness, deep };
