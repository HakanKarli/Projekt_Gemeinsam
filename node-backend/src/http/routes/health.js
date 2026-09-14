/**
 * Drei Ebenen, drei Zwecke:
 *
 *   /healthz          Lebt der Prozess?       -> Docker-Healthcheck, ohne Datenbank
 *   /readyz           Kann er arbeiten?       -> Startreihenfolge, prüft die Verbindung
 *   /api/health/deep  Ist das System gesund?  -> Uptime Kuma, Kennzahlen und 503
 */

const { Router } = require('express');
const { registry, z, jsonResponse, errorResponses } = require('../openapi');
const S = require('../../domain/schemas');
const healthService = require('../../services/healthService');

const router = Router();
const TAGS = ['Betrieb'];

registry.registerPath({
  method: 'get',
  path: '/healthz',
  tags: TAGS,
  summary: 'Lebenszeichen des Prozesses',
  description: 'Ohne Datenbankzugriff — beantwortet ausschließlich, ob der Prozess reagiert.',
  responses: {
    200: jsonResponse(
      z.object({ status: z.literal('ok'), uptime_sec: z.number().int() }),
      'Prozess reagiert',
    ),
  },
});
router.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime_sec: Math.round(process.uptime()) });
});

registry.registerPath({
  method: 'get',
  path: '/readyz',
  tags: TAGS,
  summary: 'Bereitschaft',
  description: 'Prüft die Datenbankverbindung. Für die Startreihenfolge im Container-Verbund.',
  responses: {
    200: jsonResponse(z.object({ status: z.literal('ready') }), 'Bereit'),
    ...errorResponses(503),
  },
});
router.get('/readyz', async (_req, res) => {
  await healthService.readiness();
  res.json({ status: 'ready' });
});

registry.registerPath({
  method: 'get',
  path: '/api/health/deep',
  tags: TAGS,
  summary: 'Ausführlicher Systemzustand',
  description: [
    'Liefert die Kennzahlen, auf die die Überwachung anschlägt:',
    '',
    '- `worst_lag_sec` — Alter der jüngsten Messung des am längsten schweigenden',
    '  zugeordneten Sensors. Entlarvt ein Dashboard, das nur noch alte Kurven zeigt.',
    '- `archive_last_failed` / `archive_backlog` — fangen die häufigste',
    '  PostgreSQL-Störung ab: Das Archivkommando scheitert still, WAL-Segmente stapeln',
    '  sich, die Platte läuft voll.',
    '',
    'Antwortet mit **503**, sobald eine Schwelle überschritten ist.',
  ].join('\n'),
  responses: {
    200: jsonResponse(S.HealthReport, 'Alles in Ordnung'),
    503: jsonResponse(S.HealthReport, 'Beeinträchtigt — siehe problems'),
  },
});
router.get('/api/health/deep', async (_req, res) => {
  const report = await healthService.deep();
  res.status(report.status === 'ok' ? 200 : 503).json(report);
});

module.exports = router;
