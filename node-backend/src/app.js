/**
 * Baut die Express-Anwendung — ohne sie zu starten.
 *
 * Die Trennung von `server.js` ist der Grund, warum die API mit supertest testbar ist,
 * ohne einen Port zu belegen oder Hintergrunddienste (Alarm-Listener, Watchdog)
 * hochzufahren.
 */

// Muss vor der Definition der Routen geladen werden: Patcht den Express-Router so,
// dass abgelehnte Promises aus async-Handlern an die Fehler-Middleware gehen statt
// als unhandledRejection den Prozess zu beenden (REL-01).
require('express-async-errors');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');

const config = require('./config');
const logger = require('./lib/logger');
const { requestId } = require('./http/middleware/requestId');
const { errorHandler } = require('./http/middleware/errorHandler');
const { notFound } = require('./http/middleware/notFound');
const registerRoutes = require('./http/routes');

/**
 * Zustandsabfragen werden im Sekundentakt von Docker und Uptime Kuma gestellt und
 * würden jedes andere Ereignis im Log überdecken. Statt jeden Aufruf zu protokollieren,
 * meldet `healthService` Zustandswechsel — das ist die Information, die zählt.
 */
const QUIET_PATHS = new Set(['/healthz', '/readyz', '/api/health/deep']);

function corsOptions() {
  const origins = config.http.corsOrigins;
  if (origins.includes('*')) return { origin: true };
  return { origin: origins };
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Hinter nginx: echte Client-IP und Protokoll aus den X-Forwarded-*-Headern lesen.
  app.set('trust proxy', true);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => QUIET_PATHS.has(req.url) },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'debug';
      },
      // Ohne eigene Serializer protokolliert pino-http sämtliche Header und Parameter
      // je Anfrage — im Betrieb unlesbar und unnötig teuer.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // Die API liefert JSON; eine Content-Security-Policy hat dort keine Wirkung.
  // Für die einzige HTML-Antwort (Swagger UI) wird sie in openapi.js gesetzt.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '1mb' }));

  registerRoutes(app);

  // Reihenfolge ist bindend: erst 404, dann die Fehlerbehandlung.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
