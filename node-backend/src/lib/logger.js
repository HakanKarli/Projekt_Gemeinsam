/**
 * Strukturiertes Logging.
 *
 * In Produktion JSON auf stdout (maschinenlesbar, `docker compose logs` bleibt
 * greppbar), in der Entwicklung menschenlesbar über pino-pretty.
 *
 * Ersetzt die verstreuten `console.log('[BRIDGE] …')`-Aufrufe: Die hatten weder
 * Schweregrad noch Kontext und waren nicht auswertbar.
 */

const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.logLevel,
  // Ohne eigenen Serializer hängt ein pg-Fehler das komplette Client-Objekt an die
  // Logzeile — mehrere Kilobyte Verbindungsdaten je Eintrag, in denen die
  // eigentliche Meldung untergeht.
  serializers: {
    err: (err) => ({
      type: err?.constructor?.name,
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
    }),
  },
  // Zugangsdaten dürfen niemals im Log landen, auch nicht versehentlich über
  // einen mitgeloggten Fehler- oder Konfigurationsobjektbaum.
  redact: {
    paths: ['password', '*.password', 'db.password', 'config.db.password', 'req.headers.authorization'],
    censor: '[entfernt]',
  },
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }),
});

module.exports = logger;
