const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { registry, z, jsonResponse, errorResponses } = require('../openapi');
const S = require('../../domain/schemas');
const service = require('../../services/sensorService');

const router = Router();
const TAGS = ['Sensoren'];

registry.registerPath({
  method: 'get',
  path: '/api/sensors',
  tags: TAGS,
  summary: 'Alle registrierten Sensoren',
  description:
    'Sensoren werden nicht angelegt: Sie tragen sich beim ersten MQTT-Kontakt selbst ein. ' +
    'Die Antwort enthält den aktuell zugeordneten Reinraum und alle bisher gemessenen Größen.',
  responses: { 200: jsonResponse(z.array(S.Sensor), 'Liste der Sensoren') },
});
router.get('/', async (_req, res) => {
  res.json(await service.list());
});

registry.registerPath({
  method: 'patch',
  path: '/api/sensors/{sensor_uuid}',
  tags: TAGS,
  summary: 'Sensor umbenennen',
  description:
    'Ein hier vergebener Name wird vom Ingest nie durch einen vom Gerät gemeldeten Namen ' +
    'überschrieben.',
  request: {
    params: S.SensorUuidParam,
    body: { content: { 'application/json': { schema: S.RenameSensorBody } } },
  },
  responses: {
    200: jsonResponse(S.Sensor.partial(), 'Aktualisierter Sensor'),
    ...errorResponses(400, 404),
  },
});
router.patch(
  '/:sensor_uuid',
  validate({ params: S.SensorUuidParam, body: S.RenameSensorBody }),
  async (req, res) => {
    res.json(await service.rename(req.valid.params.sensor_uuid, req.valid.body.name));
  },
);

registry.registerPath({
  method: 'delete',
  path: '/api/sensors/{sensor_uuid}',
  tags: TAGS,
  summary: 'Sensor entfernen',
  description:
    'Entfernt Register-Eintrag, Zuordnungen, Schwellenwerte und Verletzungen. ' +
    'Die Messdaten selbst bleiben erhalten — sie gehören zur Historie des Reinraums.',
  request: { params: S.SensorUuidParam },
  responses: {
    200: jsonResponse(z.object({ deleted: z.boolean() }), 'Entfernt'),
    ...errorResponses(400, 404),
  },
});
router.delete('/:sensor_uuid', validate({ params: S.SensorUuidParam }), async (req, res) => {
  res.json(await service.remove(req.valid.params.sensor_uuid));
});

module.exports = router;
