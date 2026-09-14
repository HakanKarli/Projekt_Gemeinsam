/**
 * Watchdog — Selbstheilung ohne zusätzliche Infrastruktur.
 *
 * Hintergrund: Docker startet einen Container mit `restart: unless-stopped` neu, wenn
 * der Prozess ENDET — nicht, wenn ein Healthcheck auf `unhealthy` geht. Ein hängender
 * Prozess bliebe also ewig hängen. Statt dafür einen Autoheal-Container zu betreiben,
 * erkennt die Anwendung ihren eigenen Defekt und beendet sich.
 *
 * Wichtig ist die Trennung: Der Watchdog beendet nur bei Störungen, die ein Neustart
 * heilen kann (hängende Verbindung, Deadlock). Störungen, die er nicht heilt (volle
 * Platte, toter Sensor), gehören in die Überwachung — siehe /api/health/deep.
 */

/**
 * Eine Prüfung liefert `null` wenn alles in Ordnung ist, sonst den Grund als Text.
 * @typedef {() => string | null} HealthCheck
 */

/**
 * Beendet den Prozess mit Exit-Code 1, nachdem der Logger seine Ausgabe schreiben konnte.
 * @param {string} reason
 * @param {{ logger: import('pino').Logger, graceMs?: number }} options
 */
function fatalExit(reason, { logger, graceMs = 500 }) {
  logger.fatal({ reason }, 'Watchdog: Selbstabschaltung — Neustart durch Docker erwartet');
  setTimeout(() => process.exit(1), graceMs);
}

/**
 * Letzte Verteidigungslinie: Ohne diese Handler beendet Node den Prozess ebenfalls,
 * aber ohne verwertbare Logzeile.
 * @param {{ logger: import('pino').Logger }} options
 */
function installCrashHandlers({ logger }) {
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.fatal({ err: reason }, 'Unbehandelte Promise-Ablehnung');
    fatalExit(`unhandledRejection: ${message}`, { logger });
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Unbehandelte Ausnahme');
    fatalExit(`uncaughtException: ${err.message}`, { logger });
  });
}

/**
 * Startet die periodische Selbstprüfung.
 *
 * @param {object} options
 * @param {HealthCheck[]} options.checks
 * @param {import('pino').Logger} options.logger
 * @param {number} [options.intervalMs]
 * @param {(reason: string) => void} [options.onFatal] überschreibbar für Tests
 * @returns {() => void} Funktion zum Stoppen
 */
function startWatchdog({ checks, logger, intervalMs = 10_000, onFatal }) {
  const fail = onFatal ?? ((reason) => fatalExit(reason, { logger }));

  const timer = setInterval(() => {
    for (const check of checks) {
      const reason = check();
      if (reason) {
        fail(reason);
        return;
      }
    }
  }, intervalMs);

  // Der Timer darf den Prozess nicht am Beenden hindern.
  timer.unref?.();

  return () => clearInterval(timer);
}

module.exports = { startWatchdog, installCrashHandlers, fatalExit };
