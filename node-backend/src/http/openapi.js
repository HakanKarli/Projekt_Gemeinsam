/**
 * OpenAPI-Dokument aus den Zod-Schemata.
 *
 * Die Beschreibung entsteht aus denselben Objekten, gegen die auch geprüft wird —
 * eine handgeschriebene Spezifikation würde binnen weniger Änderungen von der
 * Implementierung abweichen. Registriert wird direkt neben der jeweiligen Route,
 * damit Beschreibung und Verhalten zusammen geändert werden.
 */

const {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} = require('@asteasolutions/zod-to-openapi');
const swaggerUi = require('swagger-ui-express');

const { z, ErrorResponse } = require('../domain/schemas');

const registry = new OpenAPIRegistry();

registry.register('ErrorResponse', ErrorResponse);

/**
 * Antwortbeschreibung für eine JSON-Nutzlast.
 * @param {import('zod').ZodTypeAny} schema
 * @param {string} description
 */
function jsonResponse(schema, description) {
  return { description, content: { 'application/json': { schema } } };
}

/** Häufige Fehlerantworten — einmal beschrieben, überall referenziert. */
const ERROR_DESCRIPTIONS = {
  400: 'Ungültige Eingabe',
  404: 'Nicht gefunden',
  409: 'Konflikt mit dem aktuellen Zustand',
  503: 'Dienst nicht verfügbar',
};

/**
 * @param {...number} codes
 */
function errorResponses(...codes) {
  return Object.fromEntries(
    codes.map((code) => [code, jsonResponse(ErrorResponse, ERROR_DESCRIPTIONS[code] ?? 'Fehler')]),
  );
}

/** @type {object | null} zwischengespeichert — die Erzeugung ist rein und deterministisch. */
let cached = null;

function buildDocument() {
  if (cached) return cached;

  const generator = new OpenApiGeneratorV31(registry.definitions);

  cached = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'OHB Reinraum Sensor Dashboard — API',
      version: require('../../package.json').version,
      description: [
        'Schnittstelle des Reinraum-Überwachungssystems.',
        '',
        '**Fehlerformat:** Alle Fehler antworten mit `{ error: { code, message, details? }, requestId }`.',
        'Die `requestId` steht zusätzlich im Antwort-Header `X-Request-Id` und erlaubt die',
        'Zuordnung zu den Logzeilen des Servers.',
        '',
        '**Zeitangaben:** durchgängig ISO 8601 mit Zeitzonenangabe (`timestamptz`).',
        '',
        '**Zeitraum-Versionierung:** Zuordnungen und Schwellenwerte werden nie überschrieben.',
        'Eine Änderung schließt den bisherigen Gültigkeitszeitraum und öffnet einen neuen.',
        'Auswertungen beziehen sich deshalb immer auf den Stand zum jeweiligen Zeitpunkt.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'Gleiche Herkunft (hinter nginx)' }],
    tags: [
      { name: 'Betrieb', description: 'Zustand und Bereitschaft' },
      { name: 'Reinräume', description: 'Räume und Bereiche' },
      { name: 'Sensoren', description: 'Register der selbstregistrierenden Sensoren' },
      { name: 'Zuordnungen', description: 'Welcher Sensor war wann in welchem Raum' },
      { name: 'Schwellenwerte', description: 'Grenzwerte mit Gültigkeitszeitraum' },
      { name: 'Messdaten', description: 'Zeitreihen und Panel-Manifest' },
      { name: 'Alarme', description: 'Schwellenwert-Verletzungen und Live-Kanal' },
      { name: 'Report', description: 'Audit-Report als PDF' },
    ],
  });

  return cached;
}

/**
 * Hängt Dokument und Oberfläche ein.
 * @param {import('express').Express} app
 */
function mountDocs(app) {
  app.get('/api/openapi.json', (_req, res) => res.json(buildDocument()));

  // Swagger UI ist die einzige HTML-Antwort dieser Anwendung und braucht eigene
  // Inline-Stile. Die Richtlinie wird deshalb genau hier gesetzt statt global.
  const relaxCsp = (_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:",
    );
    next();
  };

  app.use(
    '/api/docs',
    relaxCsp,
    swaggerUi.serve,
    swaggerUi.setup(null, {
      swaggerOptions: { url: '/api/openapi.json', displayRequestDuration: true },
      customSiteTitle: 'OHB Sensor Dashboard — API',
    }),
  );
}

module.exports = { registry, z, jsonResponse, errorResponses, buildDocument, mountDocs };
