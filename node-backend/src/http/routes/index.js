/**
 * Zentrale Registrierung aller Routen — die vollständige Landkarte der Schnittstelle
 * in einer Datei.
 */

const { mountDocs } = require('../openapi');

/**
 * @param {import('express').Express} app
 */
function registerRoutes(app) {
  // Betriebszustand ohne /api-Präfix, damit Docker-Healthchecks kurz bleiben.
  app.use(require('./health'));

  app.use('/api/cleanrooms', require('./cleanrooms'));
  app.use('/api/sensors', require('./sensors'));
  app.use('/api/assignments', require('./assignments'));
  app.use('/api/thresholds', require('./thresholds'));
  app.use('/api/sensordata', require('./sensorData'));
  app.use('/api/panels', require('./panels'));
  app.use('/api/violations', require('./violations'));
  app.use('/api/report', require('./report'));
  app.use('/api/alerts', require('./alerts'));

  // Zuletzt: Das Dokument entsteht aus den oben registrierten Pfaden.
  mountDocs(app);
}

module.exports = registerRoutes;
