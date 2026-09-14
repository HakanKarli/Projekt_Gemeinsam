const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { registry, z, jsonResponse, errorResponses } = require('../openapi');
const S = require('../../domain/schemas');
const service = require('../../services/violationService');

const router = Router();
const TAGS = ['Alarme'];

registry.registerPath({
  method: 'get',
  path: '/api/violations',
  tags: TAGS,
  summary: 'Schwellenwert-Verletzungen',
  description:
    'Ein Eintrag ist ein EREIGNIS, kein Einzelmesswert: Eine zehnminütige Überschreitung ' +
    'bei 2-Sekunden-Takt erzeugt 300 Messwerte, aber genau einen Eintrag mit Extremwert, ' +
    'Dauer und Anzahl betroffener Punkte.',
  request: { query: S.ViolationQuery },
  responses: {
    200: jsonResponse(z.array(S.Violation), 'Verletzungen, neueste zuerst'),
    ...errorResponses(400),
  },
});
router.get('/', validate({ query: S.ViolationQuery }), async (req, res) => {
  res.json(await service.list(req.valid.query));
});

registry.registerPath({
  method: 'get',
  path: '/api/violations/summary',
  tags: TAGS,
  summary: 'Aggregat je Reinraum, Messgröße und Verletzungsart',
  request: { query: S.SummaryQuery },
  responses: {
    200: jsonResponse(z.array(S.ViolationSummaryEntry), 'Aggregat'),
    ...errorResponses(400),
  },
});
router.get('/summary', validate({ query: S.SummaryQuery }), async (req, res) => {
  res.json(await service.summary(req.valid.query));
});

registry.registerPath({
  method: 'patch',
  path: '/api/violations/{id}/acknowledge',
  tags: TAGS,
  summary: 'Verletzung quittieren',
  request: { params: S.IdParam },
  responses: {
    200: jsonResponse(S.Violation.partial(), 'Quittierte Verletzung'),
    ...errorResponses(400, 404),
  },
});
router.patch('/:id/acknowledge', validate({ params: S.IdParam }), async (req, res) => {
  res.json(await service.acknowledge(req.valid.params.id));
});

module.exports = router;
