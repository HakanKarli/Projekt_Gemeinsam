const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { registry, z, jsonResponse, errorResponses } = require('../openapi');
const S = require('../../domain/schemas');
const service = require('../../services/thresholdService');

const router = Router();
const TAGS = ['Schwellenwerte'];

registry.registerPath({
  method: 'get',
  path: '/api/thresholds',
  tags: TAGS,
  summary: 'Aktuell gültige Schwellenwerte',
  request: { query: S.ThresholdQuery },
  responses: {
    200: jsonResponse(z.array(S.Threshold), 'Schwellenwerte'),
    ...errorResponses(400),
  },
});
router.get('/', validate({ query: S.ThresholdQuery }), async (req, res) => {
  res.json(await service.listActive(req.valid.query.sensor_uuid));
});

registry.registerPath({
  method: 'post',
  path: '/api/thresholds',
  tags: TAGS,
  summary: 'Schwellenwert setzen',
  description:
    'Der bisherige Wert wird nicht überschrieben, sondern sein Gültigkeitszeitraum ' +
    'abgeschlossen. Auswertungen vergangener Zeiträume bleiben dadurch korrekt.',
  request: { body: { content: { 'application/json': { schema: S.SetThresholdBody } } } },
  responses: {
    201: jsonResponse(S.Threshold, 'Neuer Schwellenwert'),
    ...errorResponses(400, 409),
  },
});
router.post('/', validate({ body: S.SetThresholdBody }), async (req, res) => {
  res.status(201).json(await service.set(req.valid.body));
});

registry.registerPath({
  method: 'delete',
  path: '/api/thresholds/{id}',
  tags: TAGS,
  summary: 'Schwellenwert außer Kraft setzen',
  description:
    'Kein echtes Löschen: Der Eintrag bleibt als historischer Beleg erhalten und wird ' +
    'lediglich zeitlich abgeschlossen.',
  request: { params: S.IdParam },
  responses: {
    200: jsonResponse(
      z.object({ deleted: z.boolean(), threshold: S.Threshold }),
      'Abgeschlossener Schwellenwert',
    ),
    ...errorResponses(400, 404),
  },
});
router.delete('/:id', validate({ params: S.IdParam }), async (req, res) => {
  res.json(await service.softDelete(req.valid.params.id));
});

module.exports = router;
