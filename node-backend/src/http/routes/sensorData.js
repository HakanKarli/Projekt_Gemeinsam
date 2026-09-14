const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { registry, z, jsonResponse, errorResponses } = require('../openapi');
const S = require('../../domain/schemas');
const service = require('../../services/sensorDataService');

const router = Router();
const TAGS = ['Messdaten'];

registry.registerPath({
  method: 'get',
  path: '/api/sensordata',
  tags: TAGS,
  summary: 'Zeitreihe eines Kanals',
  description:
    'Ohne Zeitangaben werden die letzten 24 Stunden geliefert. Bei Erreichen von ' +
    '`limit` werden die JÜNGSTEN Werte zurückgegeben; die Ausgabe ist aufsteigend sortiert.',
  request: { query: S.SensorDataQuery },
  responses: {
    200: jsonResponse(z.array(S.DataPoint), 'Messwerte, älteste zuerst'),
    ...errorResponses(400),
  },
});
router.get('/', validate({ query: S.SensorDataQuery }), async (req, res) => {
  res.json(await service.list(req.valid.query));
});

registry.registerPath({
  method: 'get',
  path: '/api/sensordata/metrics',
  tags: TAGS,
  summary: 'Verfügbare Messgrößen eines Sensors',
  request: { query: S.MetricsQuery },
  responses: {
    200: jsonResponse(z.array(z.string()), 'Messgrößen'),
    ...errorResponses(400),
  },
});
router.get('/metrics', validate({ query: S.MetricsQuery }), async (req, res) => {
  res.json(await service.quantities(req.valid.query.sensor_uuid));
});

module.exports = router;
