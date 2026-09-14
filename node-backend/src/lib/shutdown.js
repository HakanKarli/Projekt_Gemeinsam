/**
 * Geordnetes Beenden.
 *
 * Docker sendet SIGTERM und wartet standardmäßig 10 Sekunden, bevor es SIGKILL
 * nachschiebt. In dieser Zeit müssen laufende Transaktionen abgeschlossen und
 * Verbindungen geschlossen werden — sonst kostet jedes Deployment Daten oder
 * hinterlässt verwaiste Verbindungen in PostgreSQL.
 */

/** @type {{ name: string, fn: () => Promise<void> | void }[]} */
const handlers = [];
let shuttingDown = false;

/**
 * Registriert einen Aufräumschritt. Ausgeführt wird in umgekehrter
 * Registrierungsreihenfolge — zuletzt Gestartetes wird zuerst beendet.
 *
 * @param {string} name
 * @param {() => Promise<void> | void} fn
 */
function onShutdown(name, fn) {
  handlers.push({ name, fn });
}

/** Signalisiert laufenden Arbeitsschleifen, dass sie nichts Neues mehr annehmen sollen. */
function isShuttingDown() {
  return shuttingDown;
}

/**
 * @param {{ logger: import('pino').Logger, timeoutMs?: number }} options
 */
function installShutdownHandlers({ logger, timeoutMs = 9_000 }) {
  const run = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Beende geordnet');

    // Sicherheitsnetz: Ein blockierender Handler darf das Beenden nicht verhindern.
    const hardStop = setTimeout(() => {
      logger.error({ timeoutMs }, 'Zeitlimit beim Beenden überschritten — harter Abbruch');
      process.exit(1);
    }, timeoutMs);
    hardStop.unref();

    for (const { name, fn } of [...handlers].reverse()) {
      try {
        await fn();
        logger.debug({ step: name }, 'Aufräumschritt abgeschlossen');
      } catch (err) {
        logger.error({ err, step: name }, 'Aufräumschritt fehlgeschlagen');
      }
    }

    clearTimeout(hardStop);
    logger.info('Beendet');
    process.exit(0);
  };

  process.once('SIGTERM', () => void run('SIGTERM'));
  process.once('SIGINT', () => void run('SIGINT'));
}

module.exports = { onShutdown, isShuttingDown, installShutdownHandlers };
