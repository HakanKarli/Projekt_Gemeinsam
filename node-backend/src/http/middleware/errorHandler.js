/**
 * Zentrale Fehlerbehandlung — die einzige Stelle, an der aus einem Fehler eine
 * HTTP-Antwort wird.
 *
 * Zusammen mit `express-async-errors` schließt sie REL-01: Abgelehnte Promises aus
 * async-Handlern landen hier statt als `unhandledRejection` den Prozess zu beenden.
 *
 * Antwortform durchgängig:
 *   { "error": { "code", "message", "details"? }, "requestId": "…" }
 */

const { ZodError } = require('zod');
const { AppError, ValidationError } = require('../../lib/errors');
const logger = require('../../lib/logger');

// eslint-disable-next-line no-unused-vars -- Express erkennt Fehler-Middleware an der Stelligkeit
function errorHandler(err, req, res, next) {
  const appError = toAppError(err);

  if (appError.status >= 500) {
    logger.error({ err, requestId: req.id, path: req.originalUrl, method: req.method }, 'Anfrage fehlgeschlagen');
  } else {
    logger.warn(
      { code: appError.code, requestId: req.id, path: req.originalUrl, method: req.method },
      appError.message,
    );
  }

  // Bei bereits begonnener Antwort (z.B. Streaming) bleibt nur der Abbruch.
  if (res.headersSent) return req.socket.destroy();

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
    },
    requestId: req.id,
  });
}

/**
 * @param {unknown} err
 * @returns {AppError}
 */
function toAppError(err) {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new ValidationError(
      'Ungültige Eingabe',
      err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  }

  // Fehlerhaftes JSON im Request-Body (express.json setzt diese Eigenschaften).
  if (err instanceof SyntaxError && 'body' in err) {
    return new ValidationError('Body ist kein gültiges JSON');
  }

  // Interne Fehler geben nach außen keine Details preis — die stehen im Log.
  return new AppError(500, 'internal', 'Interner Serverfehler');
}

module.exports = { errorHandler, toAppError };
