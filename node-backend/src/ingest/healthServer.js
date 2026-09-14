/**
 * Minimaler Health-Server des Ingest-Workers.
 *
 * Bewusst `node:http` statt Express: Der Worker braucht keine Middleware-Kette, keinen
 * Router und keine Fehlerbehandlung — nur einen Endpunkt, den der Docker-Healthcheck
 * abfragen kann. Eine zweite Express-Instanz wäre reines Gewicht.
 */

const http = require('node:http');
const logger = require('../lib/logger');

/**
 * @param {object} options
 * @param {number} options.port
 * @param {() => { healthy: boolean, details: object }} options.status
 * @returns {import('node:http').Server}
 */
function startHealthServer({ port, status }) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/healthz') {
      res.writeHead(404).end();
      return;
    }

    const { healthy, details } = status();
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', ...details }));
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Health-Endpunkt des Ingest bereit');
  });

  return server;
}

module.exports = { startHealthServer };
