/**
 * Unbekannte Pfade beantworten wir mit derselben Fehlerform wie alles andere —
 * sonst bekäme der Client für 404 eine HTML-Seite und für 400 ein JSON-Objekt.
 */

const { NotFoundError } = require('../../lib/errors');

function notFound(req, _res, next) {
  next(new NotFoundError(`Endpunkt ${req.method} ${req.originalUrl}`));
}

module.exports = { notFound };
