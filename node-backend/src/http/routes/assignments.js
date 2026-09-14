const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { registry, z, jsonResponse, errorResponses } = require('../openapi');
const S = require('../../domain/schemas');
const service = require('../../services/assignmentService');

const router = Router();
const TAGS = ['Zuordnungen'];

registry.registerPath({
  method: 'get',
  path: '/api/assignments',
  tags: TAGS,
  summary: 'Aktuell gültige Zuordnungen',
  responses: { 200: jsonResponse(z.array(S.Assignment), 'Zuordnungen') },
});
router.get('/', async (_req, res) => {
  res.json(await service.listActive());
});

registry.registerPath({
  method: 'get',
  path: '/api/assignments/history',
  tags: TAGS,
  summary: 'Vollständige Raum-Historie eines Sensors',
  description: '`valid_to = null` bedeutet: bis auf Weiteres gültig.',
  request: { query: S.AssignmentHistoryQuery },
  responses: {
    200: jsonResponse(z.array(S.AssignmentHistoryEntry), 'Historie, neueste zuerst'),
    ...errorResponses(400),
  },
});
router.get('/history', validate({ query: S.AssignmentHistoryQuery }), async (req, res) => {
  res.json(await service.history(req.valid.query.sensor_uuid));
});

registry.registerPath({
  method: 'post',
  path: '/api/assignments',
  tags: TAGS,
  summary: 'Sensor einem Reinraum zuordnen',
  description:
    'Schließt die bisherige Zuordnung ab und öffnet eine neue — beides in einer ' +
    'Transaktion, sodass weder Lücke noch Überschneidung entstehen kann.',
  request: { body: { content: { 'application/json': { schema: S.CreateAssignmentBody } } } },
  responses: {
    201: jsonResponse(S.Assignment.partial(), 'Neue Zuordnung'),
    ...errorResponses(400, 409),
  },
});
router.post('/', validate({ body: S.CreateAssignmentBody }), async (req, res) => {
  const { sensor_uuid, cleanroom_id } = req.valid.body;
  res.status(201).json(await service.assign(sensor_uuid, cleanroom_id));
});

module.exports = router;
